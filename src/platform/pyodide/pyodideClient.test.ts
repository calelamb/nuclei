import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PyodideRuntimeClient, PyodideRuntimeError, type WorkerLike } from './pyodideClient';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

type Responder = (request: WorkerRequest, reply: (r: WorkerResponse) => void) => void;

class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  terminated = false;
  readonly requests: WorkerRequest[] = [];

  constructor(private readonly responder: Responder) {}

  postMessage(message: WorkerRequest) {
    this.requests.push(message);
    this.responder(message, (r) => this.onmessage?.({ data: r }));
  }

  terminate() { this.terminated = true; }
}

function makeClient(responder: Responder) {
  const workers: FakeWorker[] = [];
  const client = new PyodideRuntimeClient(() => {
    const w = new FakeWorker(responder);
    workers.push(w);
    return w;
  });
  return { client, workers };
}

const okResponder: Responder = (req, reply) => {
  if (req.type === 'init') {
    reply({ type: 'progress', progress: { step: 1, total: 3, label: 'Downloading Python', fraction: 0 } });
    reply({ type: 'progress', progress: { step: 3, total: 3, label: 'Starting kernel', fraction: 0.85 } });
    reply({ id: req.id, type: 'result', value: 'ready' });
  } else {
    reply({ id: req.id, type: 'result', value: `${req.fn}:${String(req.args[0])}` });
  }
};

describe('PyodideRuntimeClient', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('boots once, reports progress, then clears it when ready', async () => {
    const { client, workers } = makeClient(okResponder);
    const seen: Array<string | null> = [];
    client.onProgress((p) => seen.push(p ? p.label : null));

    await Promise.all([client.ensureStarted(), client.ensureStarted()]);

    expect(workers).toHaveLength(1);
    expect(workers[0].requests.filter((r) => r.type === 'init')).toHaveLength(1);
    expect(seen).toEqual(['Downloading Python', 'Starting kernel', null]);
    expect(client.isReady()).toBe(true);
  });

  it('routes calls and returns the worker JSON string', async () => {
    const { client } = makeClient(okResponder);
    await expect(client.call('nuclei_parse', ['x = 1'])).resolves.toBe('nuclei_parse:x = 1');
  });

  it('rejects a failed boot with load_failed and allows a retry on a fresh worker', async () => {
    let attempts = 0;
    const { client, workers } = makeClient((req, reply) => {
      if (req.type === 'init') {
        attempts += 1;
        if (attempts === 1) reply({ id: req.id, type: 'failure', code: 'load_failed', message: 'Failed to fetch' });
        else reply({ id: req.id, type: 'result', value: 'ready' });
      }
    });

    await expect(client.ensureStarted()).rejects.toMatchObject({ code: 'load_failed' });
    expect(workers[0].terminated).toBe(true);
    expect(client.isReady()).toBe(false);

    await client.ensureStarted();
    expect(workers).toHaveLength(2);
    expect(client.isReady()).toBe(true);
  });

  it('terminates a runaway call at its timeout and boots a new worker next time', async () => {
    let calls = 0;
    const { client, workers } = makeClient((req, reply) => {
      if (req.type === 'init') reply({ id: req.id, type: 'result', value: 'ready' });
      else if (++calls === 1) reply({ id: req.id, type: 'started' }); // then never answers: infinite loop in user code
      else reply({ id: req.id, type: 'result', value: 'second' });
    });

    const hung = client.call('nuclei_parse', ['while True: pass'], { timeoutMs: 3000 });
    const assertion = expect(hung).rejects.toBeInstanceOf(PyodideRuntimeError);
    await vi.advanceTimersByTimeAsync(3001);
    await assertion;
    expect(workers[0].terminated).toBe(true);

    await expect(client.call('nuclei_parse', ['x'])).resolves.toBe('second');
    expect(workers).toHaveLength(2);
  });

  it('flags the restart after a timed-out live-preview call as quiet, and clears it once Python is back', async () => {
    let calls = 0;
    const { client } = makeClient((req, reply) => {
      if (req.type === 'init') reply({ id: req.id, type: 'result', value: 'ready' });
      else if (++calls === 1) reply({ id: req.id, type: 'started' });
      else reply({ id: req.id, type: 'result', value: 'ok' });
    });
    await client.ensureStarted();
    const quietAtState: boolean[] = [];
    client.onState((state) => { quietAtState.push(client.isQuietRestart()); if (state === 'idle') void client.ensureStarted(); });

    const hung = client.call('nuclei_parse', ['while True: pass'], { timeoutMs: 1000, quietRestart: true });
    const assertion = expect(hung).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    await vi.advanceTimersByTimeAsync(10);

    expect(quietAtState[0]).toBe(true); // idle
    expect(client.isReady()).toBe(true);
    expect(client.isQuietRestart()).toBe(false);
  });

  it('a preview timeout kills only the preview: a Run queued behind it is re-dispatched and resolves', async () => {
    const { client, workers } = makeClient((req, reply) => {
      if (req.type === 'init') { reply({ id: req.id, type: 'result', value: 'ready' }); return; }
      if (req.fn === 'nuclei_parse' && workers.length === 1) { reply({ id: req.id, type: 'started' }); return; } // hangs
      if (workers.length === 1) return; // the first worker is busy: the execute only queues
      reply({ id: req.id, type: 'started' });
      reply({ id: req.id, type: 'result', value: `${req.fn}:done` });
    });
    await client.ensureStarted();

    const preview = client.call('nuclei_parse', ['slow'], { timeoutMs: 5000, quietRestart: true });
    const previewAssertion = expect(preview).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(10);
    const run = client.call('nuclei_execute', ['slow', 1024, undefined], { timeoutMs: 120_000 });
    const runResult = expect(run).resolves.toBe('nuclei_execute:done');

    await vi.advanceTimersByTimeAsync(5001);
    await previewAssertion;
    await vi.advanceTimersByTimeAsync(50);
    await runResult;
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
  });

  it('a timed-out Run (not a preview) is an ordinary, visible restart', async () => {
    const { client } = makeClient((req, reply) => {
      if (req.type === 'init') reply({ id: req.id, type: 'result', value: 'ready' });
      else reply({ id: req.id, type: 'started' });
    });
    await client.ensureStarted();
    const seen: boolean[] = [];
    client.onState(() => seen.push(client.isQuietRestart()));
    const hung = client.call('nuclei_execute', ['while True: pass'], { timeoutMs: 1000 });
    const assertion = expect(hung).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    expect(seen).toEqual([false]);
  });

  it('does not fail a reboot started by a state listener while tearing down', async () => {
    let calls = 0;
    const { client, workers } = makeClient((req, reply) => {
      if (req.type === 'init') reply({ id: req.id, type: 'result', value: 'ready' });
      else if (++calls === 1) reply({ id: req.id, type: 'started' });
    });
    await client.ensureStarted();
    let reboot: Promise<void> | null = null;
    client.onState((state) => { if (state === 'idle') reboot = client.ensureStarted(); });

    const hung = client.call('nuclei_parse', ['while True: pass'], { timeoutMs: 1000 });
    const assertion = expect(hung).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;

    await expect(reboot).resolves.toBeUndefined();
    expect(workers).toHaveLength(2);
    expect(client.isReady()).toBe(true);
  });

  it('does not start the timeout clock until the worker reports it began the call', async () => {
    const { client, workers } = makeClient((req, reply) => {
      if (req.type === 'init') reply({ id: req.id, type: 'result', value: 'ready' });
      // call: no 'started', e.g. still installing Cirq or queued behind another call
    });
    const waiting = client.call('nuclei_parse', ['import cirq'], { timeoutMs: 3000 });
    let settled = false;
    waiting.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    expect(workers[0].terminated).toBe(false);
  });

  it('forwards worker notices (lazy Cirq install) to listeners', async () => {
    const { client } = makeClient((req, reply) => {
      if (req.type === 'init') reply({ id: req.id, type: 'result', value: 'ready' });
      else {
        reply({ type: 'notice', text: 'Installing Cirq' });
        reply({ id: req.id, type: 'result', value: '{}' });
      }
    });
    const notices: string[] = [];
    client.onNotice((t) => notices.push(t));
    await client.call('nuclei_execute', ['import cirq', 10]);
    expect(notices).toEqual(['Installing Cirq']);
  });

  it('routes live stdout only to the call that printed it, never to notice listeners', async () => {
    const { client } = makeClient((req, reply) => {
      if (req.type === 'init') reply({ id: req.id, type: 'result', value: 'ready' });
      else {
        reply({ id: req.id, type: 'started' });
        reply({ id: req.id, type: 'stdout', text: 'hello' });
        reply({ id: req.id + 99, type: 'stdout', text: 'someone else' });
        reply({ id: req.id, type: 'result', value: '{}' });
      }
    });
    const notices: string[] = [];
    const lines: string[] = [];
    client.onNotice((t) => notices.push(t));
    await client.call('nuclei_execute', ['print("hello")', 10], { onOutput: (l) => lines.push(l) });
    expect(lines).toEqual(['hello']);
    expect(notices).toEqual([]);
  });

  it('turns a worker script error into a load failure', async () => {
    const { client, workers } = makeClient(() => { /* never answers */ });
    const boot = client.ensureStarted();
    const assertion = expect(boot).rejects.toMatchObject({ code: 'load_failed' });
    workers[0].onerror?.({ message: 'Script error' });
    await assertion;
  });

  it('stop() cancels the in-flight call with a stopped error, not a timeout', async () => {
    const { client, workers } = makeClient((req, reply) => {
      if (req.type === 'init') reply({ id: req.id, type: 'result', value: 'ready' });
      else reply({ id: req.id, type: 'started' }); // runs forever
    });
    await client.ensureStarted();
    const call = client.call('nuclei_execute', ['while True: pass']);
    const assertion = expect(call).rejects.toMatchObject({ code: 'stopped', message: 'Run stopped.' });
    await Promise.resolve();
    client.stop();
    await assertion;
    expect(workers[0].terminated).toBe(true);
    expect(client.getState()).toBe('idle');
  });

  it('labels the boot after a restart as restarting, not downloading', async () => {
    const { client } = makeClient(okResponder);
    await client.ensureStarted();
    client.stop();
    const seen: string[] = [];
    client.onProgress((p) => { if (p) seen.push(p.label); });
    await client.ensureStarted();
    expect(seen).toEqual(['Restarting Python', 'Restarting Python']);
  });
});
