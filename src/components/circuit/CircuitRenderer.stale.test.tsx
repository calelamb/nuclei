// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { CircuitRenderer } from './CircuitRenderer';
import { useCircuitStore } from '../../stores/circuitStore';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore } from '../../stores/projectStore';

const snap = {
  framework: 'qiskit' as const, qubit_count: 2, classical_bit_count: 0, depth: 1,
  gates: [{ type: 'H', targets: [0], controls: [], params: [], layer: 0 }],
};

beforeEach(() => {
  useProjectStore.setState({ tabs: [], activeTabPath: null, projectRoot: null });
  useCircuitStore.setState({ snapshot: null, lastGood: null, snapshotKey: null, error: null });
  useEditorStore.setState({ errors: [] });
});
afterEach(cleanup);

describe('CircuitRenderer when the live preview was paused', () => {
  it('names the pause instead of calling it an error, and keeps the last circuit', () => {
    render(<CircuitRenderer />);
    act(() => { useCircuitStore.getState().setSnapshot(snap); });
    act(() => {
      useCircuitStore.getState().setSnapshot(null);
      useCircuitStore.getState().setPreviewPaused(true);
    });
    expect(screen.getByRole('img')).toBeTruthy();
    expect(screen.getByText(/Preview paused/)).toBeTruthy();
    expect(screen.queryByText(/Out of date/)).toBeNull();
  });

  it('shows the pause (not an error) when no circuit ever parsed', () => {
    render(<CircuitRenderer />);
    act(() => { useCircuitStore.getState().setPreviewPaused(true); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Preview paused/)).toBeTruthy();
  });

  it('keeps the export trigger mounted (disabled) while the diagram is stale so the header never hops', () => {
    render(<CircuitRenderer />);
    act(() => { useCircuitStore.getState().setSnapshot(snap); });
    expect(screen.getByRole('button', { name: /export/i }).hasAttribute('disabled')).toBe(false);
    act(() => {
      useCircuitStore.getState().setSnapshot(null);
      useCircuitStore.getState().setError('invalid syntax');
      useEditorStore.getState().setErrors([{ line: 5, message: 'invalid syntax' }]);
    });
    expect(screen.getByRole('button', { name: /export/i }).hasAttribute('disabled')).toBe(true);
  });
});

describe('CircuitRenderer during a transient syntax error', () => {
  it('keeps drawing the last good circuit, dimmed, with a caption naming the line', () => {
    render(<CircuitRenderer />);
    act(() => { useCircuitStore.getState().setSnapshot(snap); });
    expect(screen.getByRole('img')).toBeTruthy();
    act(() => {
      useCircuitStore.getState().setSnapshot(null);
      useCircuitStore.getState().setError('invalid syntax');
      useEditorStore.getState().setErrors([{ line: 7, message: 'invalid syntax' }]);
    });
    expect(screen.getByRole('img')).toBeTruthy();
    expect(screen.getByText(/Out of date: error on line 7/)).toBeTruthy();
  });

  it('shows the error empty state when no circuit ever parsed', () => {
    render(<CircuitRenderer />);
    act(() => { useCircuitStore.getState().setError('invalid syntax'); });
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('invalid syntax');
  });
});
