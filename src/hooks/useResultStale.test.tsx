// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useResultStale } from './useResultStale';
import { useSimulationStore } from '../stores/simulationStore';
import { useEditorStore } from '../stores/editorStore';

const result = { probabilities: { '00': 0.5, '11': 0.5 }, bloch_coords: [] } as never;

describe('useResultStale', () => {
  beforeEach(() => {
    useSimulationStore.getState().clearResult();
    useEditorStore.setState({ code: 'qc.h(0)' });
  });

  it('is false with no result and false right after a run of the current code', () => {
    const { result: hook } = renderHook(() => useResultStale());
    expect(hook.current).toBe(false);
    act(() => {
      useSimulationStore.getState().beginRun('qc.h(0)');
      useSimulationStore.getState().setResult(result);
    });
    expect(hook.current).toBe(false);
  });

  it('turns true when the code is edited after the run and clears on the next run', () => {
    const { result: hook } = renderHook(() => useResultStale());
    act(() => {
      useSimulationStore.getState().beginRun('qc.h(0)');
      useSimulationStore.getState().setResult(result);
      useEditorStore.setState({ code: 'qc.h(0)\nqc.x(1)' });
    });
    expect(hook.current).toBe(true);
    act(() => {
      useSimulationStore.getState().clearResult();
      useSimulationStore.getState().beginRun('qc.h(0)\nqc.x(1)');
      useSimulationStore.getState().setResult(result);
    });
    expect(hook.current).toBe(false);
  });
});
