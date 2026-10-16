import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openAuthenticatedKernelSocket } from './kernelSocket';

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

  it('sends no auth frame when no token is available (web or insecure dev)', async () => {
    const ws = (await openAuthenticatedKernelSocket('ws://localhost:9742', async () => null)) as unknown as FakeSocket;
    ws.open();
    expect(ws.sent).toEqual([]);
  });

  it('treats a token lookup failure as no token instead of throwing', async () => {
    const ws = (await openAuthenticatedKernelSocket('ws://localhost:9742', async () => {
      throw new Error('kernel not started');
    })) as unknown as FakeSocket;
    ws.open();
    expect(ws.sent).toEqual([]);
  });

  it('works when no token provider is supplied', async () => {
    const ws = (await openAuthenticatedKernelSocket('ws://localhost:9742')) as unknown as FakeSocket;
    ws.open();
    expect(ws.sent).toEqual([]);
  });
});
