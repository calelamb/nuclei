// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useLayoutSettled } from './useLayoutSettled';

describe('useLayoutSettled (shell-r6-08)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('stays false until the layout is ready, then flips only after the first painted frames', () => {
    const { result, rerender } = renderHook(({ ready }) => useLayoutSettled(ready), { initialProps: { ready: false } });
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current).toBe(false);
    rerender({ ready: true });
    expect(result.current).toBe(false); // the width the layout lands on must not animate
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe(true);
  });

  it('never goes back to false once settled', () => {
    const { result, rerender } = renderHook(({ ready }) => useLayoutSettled(ready), { initialProps: { ready: true } });
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe(true);
    rerender({ ready: false });
    expect(result.current).toBe(true);
  });
});
