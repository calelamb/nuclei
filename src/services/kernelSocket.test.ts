import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KERNEL_AUTH_REJECTED_MESSAGE,
  KernelAuthRejectedError,
  KernelTokenUnavailableError,
  openAuthenticatedKernelSocket,
  openKernelConnection,
} from './kernelSocket';

class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = 0;

  constructor(readonly url: string, readonly protocols?: unknown) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {}

  /** Mirrors browser dispatch order: addEventListener listeners, then onX. */
  open() {
    this.readyState = 1;
    (this.listeners.get('open') ?? []).forEach((l) => l({}));
    this.onopen?.();
  }

  /** Server-initiated close: addEventListener listeners, then onclose. */
  closeFromServer(code: number) {
    this.readyState = 3;
    const event = { code };
    (this.listeners.get('close') ?? []).forEach((l) => l(event));
    this.onclose?.(event);
  }

  onclose: ((event: { code: number }) => void) | null = null;

  receive(data: unknown) {
    const event = {
      data: JSON.stringify(data),
      stopped: false,
      stopImmediatePropagation() { this.stopped = true; },
    };
    for (const l of this.listeners.get('message') ?? []) {
      l(event);
      if (event.stopped) return;
    }
    this.onmessage?.(event);
  }
}

describe('openAuthenticatedKernelSocket', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the token as the first frame and never puts it in the URL', async () => {
    const ws = (await openAuthenticatedKernelSocket('ws://localhost:9742', async () => 'secret-token')) as unknown as FakeSocket;
    expect(ws.url).toBe('ws://localhost:9742');
    expect(ws.protocols).toBeUndefined();
    const sentByCaller: string[] = [];
    ws.onopen = () => {
      ws.send('{"type":"parse"}');
      sentByCaller.push('parse');
    };
    ws.open();
    expect(ws.sent[0]).toBe(JSON.stringify({ type: 'authenticate', token: 'secret-token' }));
    expect(ws.sent[1]).toBe('{"type":"parse"}');
    expect(ws.url).not.toContain('secret-token');
  });

  it('swallows the authenticated ack but passes other messages through', async () => {
    const ws = (await openAuthenticatedKernelSocket('ws://localhost:9742', async () => 't')) as unknown as FakeSocket;
    const seen: unknown[] = [];
    ws.onmessage = (e) => seen.push(JSON.parse(e.data));
    ws.open();
    ws.receive({ type: 'authenticated' });
    ws.receive({ type: 'snapshot' });
    expect(seen).toEqual([{ type: 'snapshot' }]);
  });

  it('refuses to connect when the provider returns an empty token', async () => {
    await expect(
      openAuthenticatedKernelSocket('ws://localhost:9742', async () => null),
    ).rejects.toBeInstanceOf(KernelTokenUnavailableError);
    await expect(
      openAuthenticatedKernelSocket('ws://localhost:9742', async () => ''),
    ).rejects.toBeInstanceOf(KernelTokenUnavailableError);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('fails closed when the token lookup throws: no socket is opened', async () => {
    await expect(
      openAuthenticatedKernelSocket('ws://localhost:9742', async () => {
        throw new Error('Kernel is not running');
      }),
    ).rejects.toThrow(/Kernel is not running/);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('works when no token provider is supplied', async () => {
    const ws = (await openAuthenticatedKernelSocket('ws://localhost:9742')) as unknown as FakeSocket;
    ws.open();
    expect(ws.sent).toEqual([]);
  });
});

describe('openKernelConnection (authentication ack)', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not resolve `authenticated` on open, only on the kernel ack', async () => {
    const { ws, authenticated } = await openKernelConnection('ws://localhost:9742', async () => 'tok');
    const fake = ws as unknown as FakeSocket;
    let done = false;
    void authenticated.then(() => { done = true; });
    fake.open();
    await Promise.resolve();
    expect(done).toBe(false);
    fake.receive({ type: 'authenticated' });
    await authenticated;
    expect(done).toBe(true);
  });

  it('rejects with KernelTokenUnavailableError for an empty token (the upgrade-path PoC)', async () => {
    await expect(
      openKernelConnection('ws://localhost:9742', async () => { throw new Error('Kernel is not running'); }),
    ).rejects.toBeInstanceOf(KernelTokenUnavailableError);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('resolves on open only when there is no token provider at all (web build)', async () => {
    const { ws, authenticated } = await openKernelConnection('ws://localhost:9742');
    (ws as unknown as FakeSocket).open();
    await expect(authenticated).resolves.toBeUndefined();
  });

  it('rejects with KernelAuthRejectedError when the kernel closes with 4401', async () => {
    const { ws, authenticated } = await openKernelConnection('ws://localhost:9742', async () => 'bad');
    const fake = ws as unknown as FakeSocket;
    fake.open();
    fake.closeFromServer(4401);
    const error = await authenticated.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KernelAuthRejectedError);
    expect((error as Error).message).toBe(KERNEL_AUTH_REJECTED_MESSAGE);
    expect(KERNEL_AUTH_REJECTED_MESSAGE).toBe('Kernel rejected the session token — restart Nuclei');
  });

  it('rejects with a plain error when the socket closes before the ack for another reason', async () => {
    const { ws, authenticated } = await openKernelConnection('ws://localhost:9742', async () => 't');
    const fake = ws as unknown as FakeSocket;
    fake.open();
    fake.closeFromServer(1006);
    const error = await authenticated.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(KernelAuthRejectedError);
  });

  it('rejects when the kernel never acknowledges within the timeout', async () => {
    vi.useFakeTimers();
    const { ws, authenticated } = await openKernelConnection('ws://localhost:9742', async () => 't', 500);
    (ws as unknown as FakeSocket).open();
    const outcome = authenticated.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(501);
    expect(((await outcome) as Error).message).toMatch(/did not acknowledge/i);
  });

  it('openAuthenticatedKernelSocket callers never see an unhandled rejection on a 4401 close', async () => {
    const ws = (await openAuthenticatedKernelSocket('ws://localhost:9742', async () => 'bad')) as unknown as FakeSocket;
    ws.open();
    ws.closeFromServer(4401);
    await Promise.resolve();
  });
});
