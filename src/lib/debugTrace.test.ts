import { describe, it, expect } from 'vitest';
import { activeDebugStep } from './debugTrace';
import type { DebugTrace } from '../types/quantum';

const trace: DebugTrace = {
  framework: 'qiskit',
  qubit_count: 1,
  steps: [
    { gate_index: -1, label: 'initial', probabilities: { '0': 1 }, bloch_coords: [{ x: 0, y: 0, z: 1 }] },
    { gate_index: 0, label: 'h q0', probabilities: { '0': 0.5, '1': 0.5 }, bloch_coords: [{ x: 1, y: 0, z: 0 }] },
    { gate_index: 1, label: 'x q0', probabilities: { '1': 1 }, bloch_coords: [{ x: 0, y: 0, z: -1 }] },
  ],
};

describe('activeDebugStep', () => {
  it('maps cursor index 0 (after gate 0) to steps[1]', () => {
    expect(activeDebugStep(trace, 0)?.label).toBe('h q0');
  });

  it('maps cursor index 1 (after gate 1) to steps[2]', () => {
    expect(activeDebugStep(trace, 1)?.gate_index).toBe(1);
  });

  it('returns the initial state for cursor index -1', () => {
    expect(activeDebugStep(trace, -1)?.label).toBe('initial');
  });

  it('returns null when the cursor is past the trace (stale trace)', () => {
    expect(activeDebugStep(trace, 5)).toBeNull();
  });

  it('returns null when there is no trace', () => {
    expect(activeDebugStep(null, 0)).toBeNull();
  });
});
