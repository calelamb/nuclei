// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { PARSE_TIMEOUT_MS, PyodideKernel } from './pyodideKernel';
import { PyodideRuntimeClient, type WorkerLike } from './pyodide/pyodideClient';
import type { WorkerRequest, WorkerResponse } from './pyodide/workerProtocol';

class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  terminated = false;

  constructor(private readonly responder: (req: WorkerRequest, reply: (r: WorkerResponse) => void) => void) {}

  postMessage(message: WorkerRequest) {
    this.responder(message, (r) => this.onmessage?.({ data: r }));
  }

  terminate() { this.terminated = true; }
}

type CapturedMessage = { type: string; [key: string]: unknown };

describe('PyodideKernel — Q# rejection', () => {
  it('rejects qsharp parse before touching Pyodide', async () => {
    const captured: CapturedMessage[] = [];
    const kernel = new PyodideKernel((msg) => captured.push(msg));

    // Deliberately no init(): the language gate must run first.
    await kernel.send({
      type: 'parse',
      code: 'operation Main() : Unit {}',
      language: 'qsharp',
    });

    expect(captured).toHaveLength(2);
    expect(captured[0]).toEqual({ type: 'snapshot', data: null });
    expect(captured[1].type).toBe('error');
    expect(captured[1].code).toBe('unsupported_framework');
    expect(captured[1].phase).toBe('parse');
    expect(String(captured[1].message)).toContain('desktop');
  });

  it('rejects qsharp execute with a null result as well', async () => {
    const captured: CapturedMessage[] = [];
    const kernel = new PyodideKernel((msg) => captured.push(msg));

    await kernel.send({
      type: 'execute',
      code: 'operation Main() : Unit {}',
      shots: 1024,
      language: 'qsharp',
    });

    expect(captured.map((m) => m.type)).toEqual(['snapshot', 'result', 'error']);
    expect(captured[0]).toEqual({ type: 'snapshot', data: null });
    expect(captured[1]).toEqual({ type: 'result', data: null });
    expect(captured[2].code).toBe('unsupported_framework');
    expect(captured[2].phase).toBe('execute');
    expect(String(captured[2].message)).toContain('desktop');
  });
});

describe('PyodideKernel — worker-backed runtime', () => {
  type Reply = Record<string, unknown>;

  function makeKernel(handlers: { parse?: Reply | 'hang'; execute?: Reply | 'hang'; run_python?: Reply; notice?: string }) {
    const captured: CapturedMessage[] = [];
    const workers: FakeWorker[] = [];
    const runtime = new PyodideRuntimeClient(() => {
      const w = new FakeWorker((req, reply) => {
        if (req.type === 'init') {
          reply({ id: req.id, type: 'result', value: 'ready' });
          return;
        }
        const key = req.fn.replace('nuclei_', '') as 'parse' | 'execute' | 'run_python';
        const body = handlers[key];
        if (body === 'hang') {
          reply({ id: req.id, type: 'started' });
          return;
        }
        if (handlers.notice) reply({ type: 'notice', text: handlers.notice });
        reply({ id: req.id, type: 'result', value: JSON.stringify(body ?? {}) });
      });
      workers.push(w);
      return w;
    });
    const kernel = new PyodideKernel((m) => captured.push(m), runtime);
    return { kernel, captured, runtime, workers };
  }

  it('init() is silent: no "kernel ready" chatter reaches output panes', async () => {
    const { kernel, captured } = makeKernel({});
    await kernel.init();
    expect(captured).toEqual([]);
    expect(kernel.isReady()).toBe(true);
  });

  it('tags parse-phase stdout so it stays out of the Terminal', async () => {
    const { kernel, captured } = makeKernel({ parse: { snapshot: { framework: 'qiskit' }, output: 'leak\n', error: null } });
    await kernel.init();
    await kernel.send({ type: 'parse', code: 'print("leak")' });
    expect(captured).toEqual([
      { type: 'output', text: 'leak\n', phase: 'parse' },
      { type: 'snapshot', data: { framework: 'qiskit' } },
    ]);
  });

  it('turns browser-subset limits into a friendly unsupported_framework error', async () => {
    const error = [
      'Traceback (most recent call last):',
      '  File "<string>", line 1, in <module>',
      "_nuclei_unsupported.UnsupportedInBrowser: qiskit_aer.noise.NoiseModel isn't available in the browser version of Qiskit (Qiskit browser subset). Open this in the Nuclei desktop app (getnuclei.dev) to run it with full Qiskit.",
    ].join('\n');
    const { kernel, captured } = makeKernel({ execute: { result: null, snapshot: null, output: '', error } });
    await kernel.init();
    await kernel.send({ type: 'execute', code: 'x', shots: 10 });
    const err = captured.find((m) => m.type === 'error')!;
    expect(err.code).toBe('unsupported_framework');
    expect(err.phase).toBe('execute');
    expect(String(err.message)).toMatch(/^qiskit_aer\.noise\.NoiseModel isn't available in the browser version of Qiskit/);
    expect(String(err.message)).not.toContain('_nuclei_unsupported');
    expect(captured.some((m) => m.type === 'result' && m.data === null)).toBe(true);
  });

  it('keeps what plain Python printed and tags a run without a circuit as no_circuit (a clean finish for the UI)', async () => {
    const { kernel, captured } = makeKernel({
      execute: { result: null, snapshot: null, output: 'step 0\nDone\n', error: 'No circuit found.' },
    });
    await kernel.init();
    await kernel.send({ type: 'execute', code: 'print("Done")', shots: 10 });
    expect(captured[0]).toEqual({ type: 'output', text: 'step 0\nDone\n' });
    const err = captured.find((m) => m.type === 'error')!;
    expect(err).toMatchObject({ code: 'no_circuit', phase: 'execute' });
  });

  it('emits result, snapshot and stdout for a successful execute', async () => {
    const { kernel, captured } = makeKernel({
      execute: { result: { shot_count: 10 }, snapshot: { framework: 'qiskit' }, output: 'hi\n', error: null },
    });
    await kernel.init();
    await kernel.send({ type: 'execute', code: 'x', shots: 10 });
    expect(captured.map((m) => m.type)).toEqual(['output', 'snapshot', 'result']);
  });

  it('reports a stopped runaway parse as a parse-phase timeout and restarts Python', async () => {
    vi.useFakeTimers();
    try {
      const { kernel, captured, workers } = makeKernel({ parse: 'hang' });
      await kernel.init();
      const sending = kernel.send({ type: 'parse', code: 'while True: pass' });
      await vi.advanceTimersByTimeAsync(PARSE_TIMEOUT_MS + 1);
      await sending;
      expect(workers[0].terminated).toBe(true);
      expect(captured[0]).toEqual({ type: 'snapshot', data: null });
      expect(captured[1]).toMatchObject({ type: 'error', phase: 'parse', code: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a user stop ends the run quietly: just a stopped marker, no error or wiped circuit', async () => {
    const { kernel, captured, runtime } = makeKernel({ execute: 'hang' });
    await kernel.init();
    const sending = kernel.send({ type: 'execute', code: 'while True: pass', shots: 10 });
    await vi.waitFor(() => expect(runtime.getState()).toBe('ready'));
    await Promise.resolve();
    runtime.stop();
    await sending;
    expect(captured).toEqual([
      { type: 'result', data: null, stopped: true },
    ]);
  });

  it('after Stop during an install, the preview parse stays quiet and never starts the install again', async () => {
    const calls: string[] = [];
    const captured: CapturedMessage[] = [];
    const runtime = new PyodideRuntimeClient(() => new FakeWorker((req, reply) => {
      if (req.type === 'init') { reply({ id: req.id, type: 'result', value: 'ready' }); return; }
      calls.push(req.fn);
      if (req.fn === 'nuclei_execute' && calls.length === 1) { reply({ type: 'installing', package: 'Cirq', active: true }); return; }
      reply({ id: req.id, type: 'result', value: '{}' });
    }));
    const kernel = new PyodideKernel((m) => captured.push(m), runtime);
    await kernel.init();
    const sending = kernel.send({ type: 'execute', code: 'import cirq', shots: 10 });
    await Promise.resolve();
    await Promise.resolve();
    runtime.stop();
    await sending;
    await kernel.init(); // Python reboots after the stop
    await kernel.send({ type: 'parse', code: 'import cirq' });
    expect(calls).toEqual(['nuclei_execute']);
    expect(runtime.currentInstall()).toBeNull();
    await kernel.send({ type: 'execute', code: 'x = 1', shots: 10 });
    await kernel.send({ type: 'parse', code: 'x = 1' });
    expect(calls).toEqual(['nuclei_execute', 'nuclei_execute', 'nuclei_parse']);
  });

  it('skips parse requests while Python is not running instead of erroring', async () => {
    const { kernel, captured } = makeKernel({});
    await kernel.send({ type: 'parse', code: 'x = 1' });
    expect(captured).toEqual([]);
  });

  it('batches live stdout into a few output messages and keeps every line', async () => {
    const captured: CapturedMessage[] = [];
    const runtime = new PyodideRuntimeClient(() => new FakeWorker((req, reply) => {
      if (req.type === 'init') { reply({ id: req.id, type: 'result', value: 'ready' }); return; }
      reply({ id: req.id, type: 'started' });
      for (let i = 0; i < 1000; i++) reply({ id: req.id, type: 'stdout', text: `line ${i}` });
      reply({ id: req.id, type: 'result', value: JSON.stringify({ result: null, snapshot: null, output: '', error: null }) });
    }));
    const kernel = new PyodideKernel((m) => captured.push(m), runtime);
    await kernel.init();
    await kernel.send({ type: 'execute', code: 'x', shots: 10 });
    const outputs = captured.filter((m) => m.type === 'output');
    expect(outputs.length).toBeLessThanOrEqual(3);
    const text = outputs.map((m) => String(m.text)).join('');
    expect(text.split('\n').filter(Boolean)).toHaveLength(1000);
    expect(text.startsWith('line 0\n')).toBe(true);
  });

  it('forwards the lazy Cirq install notice for execute but not for parse', async () => {
    const { kernel, captured } = makeKernel({
      notice: 'Installing Cirq',
      parse: { snapshot: null, output: '', error: null },
      execute: { result: {}, snapshot: null, output: '', error: null },
    });
    await kernel.init();
    await kernel.send({ type: 'parse', code: 'import cirq' });
    expect(captured.some((m) => m.type === 'output')).toBe(false);
    await kernel.send({ type: 'execute', code: 'import cirq', shots: 1 });
    expect(captured.filter((m) => m.type === 'output')).toEqual([{ type: 'output', text: 'Installing Cirq\n' }]);
  });
});
