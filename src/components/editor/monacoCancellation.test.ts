// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installMonacoCancellationGuard, isMonacoCancellation } from './monacoCancellation';

function rejection(reason: unknown): PromiseRejectionEvent {
  const e = new Event('unhandledrejection', { cancelable: true }) as unknown as { reason: unknown };
  e.reason = reason;
  return e as unknown as PromiseRejectionEvent;
}

describe('monaco cancellation guard', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => { dispose?.(); dispose = null; });

  it('recognises the Canceled error Monaco throws when a delayed task is disposed', () => {
    expect(isMonacoCancellation(Object.assign(new Error('Canceled'), { name: 'Canceled' }))).toBe(true);
    expect(isMonacoCancellation(new Error('Canceled'))).toBe(false);
    expect(isMonacoCancellation(new Error('boom'))).toBe(false);
    expect(isMonacoCancellation(null)).toBe(false);
  });

  it('swallows only Canceled rejections', () => {
    dispose = installMonacoCancellationGuard(window);
    const cancel = rejection(Object.assign(new Error('Canceled'), { name: 'Canceled' }));
    window.dispatchEvent(cancel as unknown as Event);
    expect((cancel as unknown as Event).defaultPrevented).toBe(true);
    const real = rejection(new Error('real failure'));
    window.dispatchEvent(real as unknown as Event);
    expect((real as unknown as Event).defaultPrevented).toBe(false);
  });
});
