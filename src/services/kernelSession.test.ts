import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ackForSent } from '../test/kernelAuthProof';
import { createKernelSession } from './kernelSession';

class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly OPEN = 1;
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  readyState = 0;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {}

  closeFromServer(code: number) {
    this.readyState = 3;
    (this.listeners.get('close') ?? []).forEach((l) => l({ code }));
  }

  open() {
    this.readyState = 1;
    (this.listeners.get('open') ?? []).forEach((l) => l({}));
  }

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
  }
}

describe('createKernelSession (desktop)', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the authenticate frame before the first request', async () => {
    const pending = createKernelSession('desktop', () => {}, async () => 'tok');
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const ws = FakeSocket.instances[0];
    ws.open();
    ws.receive(ackForSent(ws.sent, 'tok'));
    const session = await pending;
    session.send({ type: 'qec_campaign_list' } as never);
    expect(ws.sent).toHaveLength(2);
    expect(JSON.parse(ws.sent[0])).toMatchObject({ type: 'authenticate', token: 'tok' });
    expect(ws.sent[1]).toBe(JSON.stringify({ type: 'qec_campaign_list' }));
  });

  it('does not forward the authenticated ack to the caller', async () => {
    const seen: unknown[] = [];
    const pending = createKernelSession('desktop', (m) => seen.push(m), async () => 'tok');
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const ws = FakeSocket.instances[0];
    ws.open();
    ws.receive(ackForSent(ws.sent, 'tok'));
    await pending;
    ws.receive({ type: 'snapshot' });
    expect(seen).toEqual([{ type: 'snapshot' }]);
  });

  it('does not resolve before the authenticated ack', async () => {
    let settled = false;
    const pending = createKernelSession('desktop', () => {}, async () => 'tok').then((s) => { settled = true; return s; });
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    FakeSocket.instances[0].open();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    FakeSocket.instances[0].receive(ackForSent(FakeSocket.instances[0].sent, 'tok'));
    await pending;
    expect(settled).toBe(true);
  });

  it('rejects with the clear auth error when the kernel closes with 4401', async () => {
    const pending = createKernelSession('desktop', () => {}, async () => 'wrong');
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const ws = FakeSocket.instances[0];
    ws.open();
    ws.closeFromServer(4401);
    await expect(pending).rejects.toThrow('Kernel rejected the session token — restart Nuclei');
  });
});
