import { describe, expect, it } from 'vitest';
import { labAvailability, LabUnavailableError, openLabSession, request } from './labSession';
import type { KernelResponse } from '../../types/quantum';

class FakeSocket extends EventTarget {
  readyState = 0;
  sent: string[] = [];
  constructor(public url: string) {
    super();
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    });
  }
  send(data: string) {
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
    let socket: FakeSocket | null = null;
    const session = await openLabSession('desktop', (url) => {
      socket = new FakeSocket(url);
      return socket as unknown as WebSocket;
    });
    const a: KernelResponse[] = [];
    const b: KernelResponse[] = [];
    session.subscribe((m) => a.push(m));
    const off = session.subscribe((m) => b.push(m));
    session.send({ type: 'discovery_evaluators' });
    expect(JSON.parse(socket!.sent[0])).toEqual({ type: 'discovery_evaluators' });
    socket!.emit({ type: 'discovery_evaluators_result', evaluators: [] });
    off();
    socket!.emit({ type: 'trainability_started', job_id: 'j1' });
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(1);
  });

  it('correlates request/response and resolves kernel errors as values', async () => {
    let socket: FakeSocket | null = null;
    const session = await openLabSession('desktop', (url) => {
      socket = new FakeSocket(url);
      return socket as unknown as WebSocket;
    });
    const pending = request(
      session,
      { type: 'trainability_lint', code: 'x' },
      (m): m is Extract<KernelResponse, { type: 'trainability_lint_result' }> => m.type === 'trainability_lint_result',
    );
    socket!.emit({ type: 'output', text: 'noise' });
    socket!.emit({ type: 'error', message: 'bad', phase: 'trainability' });
    const result = await pending;
    expect(result.ok).toBe(false);
  });

  it('rejects pending requests when the socket closes and refuses later sends', async () => {
    let socket: FakeSocket | null = null;
    const session = await openLabSession('desktop', (url) => {
      socket = new FakeSocket(url);
      return socket as unknown as WebSocket;
    });
    const pending = request(session, { type: 'discovery_evaluators' }, (m): m is KernelResponse => m.type === 'discovery_evaluators_result');
    socket!.close();
    await expect(pending).rejects.toThrow(/closed/);
    expect(session.closed).toBe(true);
    expect(() => session.send({ type: 'discovery_evaluators' })).toThrow(/closed/);
  });
});
