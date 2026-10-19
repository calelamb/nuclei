import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KERNEL_AUTH_REJECTED_MESSAGE,
  KernelAuthRejectedError,
  KernelProofError,
  KernelTokenUnavailableError,
  generateNonce,
  openAuthenticatedKernelSocket,
  openKernelConnection,
} from './kernelSocket';
import { ackForSent } from '../test/kernelAuthProof';

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

  it('sends the token and a fresh nonce first, holds caller frames until the proof verifies, never puts the token in the URL', async () => {
    const { ws: raw, authenticated } = await openKernelConnection('ws://localhost:9742', async () => 'secret-token');
    const ws = raw as unknown as FakeSocket;
    expect(ws.url).toBe('ws://localhost:9742');
    expect(ws.protocols).toBeUndefined();
    ws.onopen = () => ws.send('{"type":"parse"}');
    ws.open();
    const first = JSON.parse(ws.sent[0]) as { type: string; token: string; nonce: string };
    expect(first).toMatchObject({ type: 'authenticate', token: 'secret-token' });
    expect(first.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(ws.sent).toHaveLength(1); // caller's parse is held back
    ws.receive(ackForSent(ws.sent, 'secret-token'));
    await authenticated;
    expect(ws.sent[1]).toBe('{"type":"parse"}');
    expect(ws.url).not.toContain('secret-token');
  });

  it('swallows the authenticated ack but passes other messages through', async () => {
    const { ws: raw, authenticated } = await openKernelConnection('ws://localhost:9742', async () => 't');
    const ws = raw as unknown as FakeSocket;
    const seen: unknown[] = [];
    ws.onmessage = (e) => seen.push(JSON.parse(e.data));
    ws.open();
    ws.receive(ackForSent(ws.sent, 't'));
    await authenticated;
    ws.receive({ type: 'snapshot' });
    expect(seen).toEqual([{ type: 'snapshot' }]);
  });

  it('generates a distinct 32-byte hex nonce per connection', () => {
    const a = generateNonce();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generateNonce()).not.toBe(a);
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
    fake.receive(ackForSent(fake.sent, 'tok'));
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

  it('rejects with KernelProofError and closes when the ack carries no proof (unauthenticated or squatting kernel)', async () => {
    const { ws, authenticated } = await openKernelConnection('ws://localhost:9742', async () => 'tok');
    const fake = ws as unknown as FakeSocket;
    const closeSpy = vi.spyOn(fake, 'close');
    fake.open();
    fake.receive({ type: 'authenticated' });
    const error = await authenticated.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KernelProofError);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('rejects with KernelProofError when the proof was computed with the wrong token', async () => {
    const { ws, authenticated } = await openKernelConnection('ws://localhost:9742', async () => 'tok');
    const fake = ws as unknown as FakeSocket;
    fake.open();
    fake.receive(ackForSent(fake.sent, 'some-other-token'));
    await expect(authenticated).rejects.toBeInstanceOf(KernelProofError);
  });

  it('rejects a proof computed over a different nonce (replay)', async () => {
    const first = await openKernelConnection('ws://localhost:9742', async () => 'tok');
    const second = await openKernelConnection('ws://localhost:9742', async () => 'tok');
    const a = first.ws as unknown as FakeSocket;
    const b = second.ws as unknown as FakeSocket;
    a.open();
    b.open();
    b.receive(ackForSent(a.sent, 'tok'));
    await expect(second.authenticated).rejects.toBeInstanceOf(KernelProofError);
  });

  it('rejects a malformed proof', async () => {
    const { ws, authenticated } = await openKernelConnection('ws://localhost:9742', async () => 'tok');
    const fake = ws as unknown as FakeSocket;
    fake.open();
    fake.receive({ type: 'authenticated', proof: 'zz-not-hex' });
    await expect(authenticated).rejects.toBeInstanceOf(KernelProofError);
  });

  it('never delivers caller frames to, or accepts messages from, an unverified peer', async () => {
    const { ws, authenticated } = await openKernelConnection('ws://localhost:9742', async () => 'tok');
    const fake = ws as unknown as FakeSocket;
    const seen: unknown[] = [];
    fake.onmessage = (e) => seen.push(e.data);
    fake.open();
    fake.send('{"type":"execute","code":"secret user code"}');
    fake.receive({ type: 'output', text: 'forged result' });
    fake.receive({ type: 'authenticated' });
    await authenticated.catch(() => undefined);
    expect(seen).toEqual([]);
    expect(fake.sent.filter((f) => f.includes('secret user code'))).toEqual([]);
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
