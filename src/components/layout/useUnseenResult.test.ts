// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useUnseenResult } from './useUnseenResult';

describe('useUnseenResult', () => {
  it('is quiet while the results column is visible', () => {
    const { result, rerender } = renderHook(({ r, folded }) => useUnseenResult(r, folded), { initialProps: { r: null as object | null, folded: false } });
    rerender({ r: {}, folded: false });
    expect(result.current).toBe(false);
  });

  it('flags a result that lands behind the folded column, and clears once the column is open', () => {
    const { result, rerender } = renderHook(({ r, folded }) => useUnseenResult(r, folded), { initialProps: { r: null as object | null, folded: true } });
    expect(result.current).toBe(false);
    rerender({ r: {}, folded: true });
    expect(result.current).toBe(true);
    rerender({ r: result.current ? {} : null, folded: false });
    expect(result.current).toBe(false);
  });

  it('does not flag a result that was already on screen before the column folded', () => {
    const existing = {};
    const { result, rerender } = renderHook(({ r, folded }) => useUnseenResult(r, folded), { initialProps: { r: existing as object | null, folded: false } });
    rerender({ r: existing, folded: true });
    expect(result.current).toBe(false);
  });
});
