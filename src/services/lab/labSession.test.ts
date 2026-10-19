import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { labAvailability, LabUnavailableError, openLabSession, request } from './labSession';
import { KernelAuthRejectedError } from '../kernelSocket';
import type { KernelResponse } from '../../types/quantum';

/**
 * A kernel stand-in that enforces the v2 handshake: it acknowledges only when
 * the first frame is `{type:'authenticate', token: EXPECTED_TOKEN}` and closes
 * with 4401 otherwise. Installed as the global WebSocket, like the browser's.
 */
const EXPECTED_TOKEN = 'lab-test-token';

class FakeSocket extends EventTarget {
  static last: FakeSocket | null = null;
  static requireToken = true;
  readyState = 0;
  sent: string[] = [];
  constructor(public url: string) {
    super();
    FakeSocket.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    });
  }
  send(data: string) {
    if (FakeSocket.requireToken && this.sent.length === 0) {
      const frame = JSON.parse(data) as { type?: string; token?: string };
      if (frame.type === 'authenticate' && frame.token === EXPECTED_TOKEN) {
        this.emit({ type: 'authenticated' });
      } else {
        this.readyState = 3;
        this.dispatchEvent(Object.assign(new Event('close'), { code: 4401 }));
      }
    }
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
  emit(message: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
}

const goodToken = async () => EXPECTED_TOKEN;

async function open(): Promise<{ session: Awaited<ReturnType<typeof openLabSession>>; socket: FakeSocket }> {
  const session = await openLabSession('desktop', { getToken: goodToken });
  return { session, socket: FakeSocket.last! };
}

/** The tests run in a node environment: give the DEV override a `window.location.search`. */
function setSearch(url: string): void {
  vi.stubGlobal('window', { location: { search: url.slice(url.indexOf('?')) } });
}

beforeEach(() => {
  FakeSocket.last = null;
  FakeSocket.requireToken = true;
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('labAvailability', () => {
  it('is available on desktop and unavailable on the web build', () => {
    expect(labAvailability('desktop').available).toBe(true);
    expect(labAvailability('web')).toEqual({ available: false, reason: 'web_build' });
  });
});

describe('openLabSession', () => {
  it('rejects on the web build without an override', async () => {
    await expect(openLabSession('web')).rejects.toBeInstanceOf(LabUnavailableError);
  });

  it('fans responses out to every subscriber and serializes sends', async () => {
    const { session, socket } = await open();
    const a: KernelResponse[] = [];
    const b: KernelResponse[] = [];
    session.subscribe((m) => a.push(m));
    const off = session.subscribe((m) => b.push(m));
    session.send({ type: 'discovery_evaluators' });
    expect(JSON.parse(socket.sent[1])).toEqual({ type: 'discovery_evaluators' });
    socket.emit({ type: 'discovery_evaluators_result', evaluators: [] });
    off();
    socket.emit({ type: 'trainability_started', job_id: 'j1' });
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(1);
  });

  it('correlates request/response and resolves kernel errors as values', async () => {
    const { session, socket } = await open();
    const pending = request(
      session,
      { type: 'trainability_lint', code: 'x' },
      (m): m is Extract<KernelResponse, { type: 'trainability_lint_result' }> => m.type === 'trainability_lint_result',
    );
    socket.emit({ type: 'output', text: 'noise' });
    socket.emit({ type: 'error', message: 'bad', phase: 'trainability' });
    const result = await pending;
    expect(result.ok).toBe(false);
  });

  it('rejects pending requests when the socket closes and refuses later sends', async () => {
    const { session, socket } = await open();
    const pending = request(session, { type: 'discovery_evaluators' }, (m): m is KernelResponse => m.type === 'discovery_evaluators_result');
    socket.close();
    await expect(pending).rejects.toThrow(/closed/);
    expect(session.closed).toBe(true);
    expect(() => session.send({ type: 'discovery_evaluators' })).toThrow(/closed/);
  });

  it('sends the authenticate frame first and hides the ack from subscribers', async () => {
    const { session, socket } = await open();
    const seen: KernelResponse[] = [];
    session.subscribe((m) => seen.push(m));
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'authenticate', token: EXPECTED_TOKEN });
    socket.emit({ type: 'authenticated' });
    expect(seen).toEqual([]);
  });

  it('rejects with KernelAuthRejectedError when the kernel refuses the token', async () => {
    await expect(openLabSession('desktop', { getToken: async () => 'wrong' })).rejects.toBeInstanceOf(
      KernelAuthRejectedError,
    );
  });

  it('connects without a frame when no token is available (insecure dev kernel)', async () => {
    FakeSocket.requireToken = false;
    const session = await openLabSession('desktop');
    expect(FakeSocket.last!.sent).toEqual([]);
    session.close();
  });
});

describe('DEV ?labKernel override with ?labKernelToken', () => {
  it('uses the token from the query string instead of the desktop shell', async () => {
    setSearch(`/?labKernel=ws://127.0.0.1:9777&labKernelToken=${EXPECTED_TOKEN}`);
    expect(labAvailability('web')).toEqual({
      available: true, url: 'ws://127.0.0.1:9777', devToken: EXPECTED_TOKEN,
    });
    const session = await openLabSession('web');
    expect(FakeSocket.last!.url).toBe('ws://127.0.0.1:9777');
    expect(JSON.parse(FakeSocket.last!.sent[0])).toEqual({ type: 'authenticate', token: EXPECTED_TOKEN });
    session.close();
  });

  it('ignores a malformed token', () => {
    setSearch('/?labKernel=ws://127.0.0.1:9777&labKernelToken=a%20b');
    expect(labAvailability('web')).toEqual({ available: true, url: 'ws://127.0.0.1:9777' });
  });
});
