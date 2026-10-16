import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    const session = await pending;
    session.send({ type: 'qec_campaign_list' } as never);
    expect(ws.sent).toEqual([
      JSON.stringify({ type: 'authenticate', token: 'tok' }),
      JSON.stringify({ type: 'qec_campaign_list' }),
    ]);
  });

  it('does not forward the authenticated ack to the caller', async () => {
    const seen: unknown[] = [];
    const pending = createKernelSession('desktop', (m) => seen.push(m), async () => 'tok');
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const ws = FakeSocket.instances[0];
    ws.open();
    await pending;
    ws.receive({ type: 'authenticated' });
    ws.receive({ type: 'snapshot' });
    expect(seen).toEqual([{ type: 'snapshot' }]);
  });
});
