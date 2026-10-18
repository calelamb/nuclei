// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useErrorPending } from './useErrorPending';
import { PREVIEW_PENDING_DELAY_MS } from '../../layout/usePreviewPending';
import { useCircuitStore } from '../../stores/circuitStore';
import { useEditorStore } from '../../stores/editorStore';

beforeEach(() => {
  vi.useFakeTimers();
  useEditorStore.setState({ code: 'qc.h(0', kernelReady: true, errors: [{ line: 3, message: 'bad' }] });
  useCircuitStore.setState({ snapshot: null, error: 'bad', previewPaused: false });
});
afterEach(() => vi.useRealTimers());

describe('useErrorPending (interaction-r-07)', () => {
  it('is false until the code is edited and the old error is still the only answer', () => {
    const { result } = renderHook(() => useErrorPending());
    expect(result.current).toBe(false);
    act(() => { useEditorStore.setState({ code: 'qc.h(0)\nslow()' }); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(PREVIEW_PENDING_DELAY_MS + 10); });
    expect(result.current).toBe(true);
  });

  it('ends when any new answer arrives', () => {
    const { result } = renderHook(() => useErrorPending());
    act(() => { useEditorStore.setState({ code: 'fixed' }); });
    act(() => { vi.advanceTimersByTime(PREVIEW_PENDING_DELAY_MS + 10); });
    expect(result.current).toBe(true);
    act(() => { useCircuitStore.getState().setSnapshot(null); useEditorStore.setState({ errors: [] }); });
    expect(result.current).toBe(false);
  });

  it('does nothing when there was no error to be stale', () => {
    useCircuitStore.setState({ error: null });
    useEditorStore.setState({ errors: [] });
    const { result } = renderHook(() => useErrorPending());
    act(() => { useEditorStore.setState({ code: 'other' }); });
    act(() => { vi.advanceTimersByTime(PREVIEW_PENDING_DELAY_MS + 10); });
    expect(result.current).toBe(false);
  });

  it('ends when the kernel answers with the very same error (regression: stuck on Updating)', () => {
    const { result } = renderHook(() => useErrorPending());
    act(() => { useEditorStore.setState({ code: 'qc.h(0\n# comment' }); });
    act(() => { vi.advanceTimersByTime(PREVIEW_PENDING_DELAY_MS + 10); });
    expect(result.current).toBe(true);
    act(() => { useCircuitStore.getState().setSnapshot(null); useCircuitStore.getState().setError('bad'); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current).toBe(false);
  });
});
