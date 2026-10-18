// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { PREVIEW_PENDING_DELAY_MS, usePreviewPending } from './usePreviewPending';
import { useCircuitStore } from '../stores/circuitStore';
import { useEditorStore } from '../stores/editorStore';

const snap = (qubits: number) => ({
  framework: 'qiskit' as const, qubit_count: qubits, classical_bit_count: 0, depth: 1,
  gates: [{ type: 'H', targets: [0], controls: [], params: [], layer: 0 }],
});

beforeEach(() => {
  vi.useFakeTimers();
  useCircuitStore.setState({ snapshot: snap(2), lastGood: null, snapshotKey: null, error: null, previewPaused: false });
  useEditorStore.setState({ code: 'qc = 1', kernelReady: true });
});
afterEach(() => vi.useRealTimers());

describe('usePreviewPending', () => {
  it('is false while the preview keeps up with typing', () => {
    const { result } = renderHook(() => usePreviewPending());
    expect(result.current).toBe(false);
    act(() => { useEditorStore.setState({ code: 'qc = 2' }); });
    act(() => { vi.advanceTimersByTime(PREVIEW_PENDING_DELAY_MS - 50); });
    expect(result.current).toBe(false);
  });

  it('turns true when no snapshot arrives for the edited buffer within the delay', () => {
    const { result } = renderHook(() => usePreviewPending());
    act(() => { useEditorStore.setState({ code: 'qc = 2' }); });
    act(() => { vi.advanceTimersByTime(PREVIEW_PENDING_DELAY_MS + 10); });
    expect(result.current).toBe(true);
  });

  it('clears on the next snapshot, error, or pause', () => {
    const { result } = renderHook(() => usePreviewPending());
    act(() => { useEditorStore.setState({ code: 'qc = 2' }); });
    act(() => { vi.advanceTimersByTime(PREVIEW_PENDING_DELAY_MS + 10); });
    act(() => { useCircuitStore.getState().setSnapshot(snap(1)); });
    expect(result.current).toBe(false);

    act(() => { useEditorStore.setState({ code: 'qc = 3' }); });
    act(() => { vi.advanceTimersByTime(PREVIEW_PENDING_DELAY_MS + 10); });
    expect(result.current).toBe(true);
    act(() => { useCircuitStore.getState().setPreviewPaused(true); });
    expect(result.current).toBe(false);
  });

  it('never claims an update is coming while the kernel is not ready', () => {
    useEditorStore.setState({ kernelReady: false });
    const { result } = renderHook(() => usePreviewPending());
    act(() => { useEditorStore.setState({ code: 'qc = 2' }); });
    act(() => { vi.advanceTimersByTime(PREVIEW_PENDING_DELAY_MS + 10); });
    expect(result.current).toBe(false);
  });
});
