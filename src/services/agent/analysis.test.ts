import { describe, expect, it } from 'vitest';
import type { CircuitSnapshot, Gate } from '../../types/quantum';
import { compareDistributions, estimateResources, validateProgram } from './analysis';

function gate(overrides: Partial<Gate> & Pick<Gate, 'type'>): Gate {
  return { targets: [], controls: [], params: [], layer: 0, ...overrides };
}

const BELL_SNAPSHOT: CircuitSnapshot = {
  framework: 'qiskit',
  qubit_count: 2,
  classical_bit_count: 2,
  depth: 3,
  gates: [
    gate({ type: 'H', targets: [0], layer: 0 }),
    gate({ type: 'CNOT', targets: [1], controls: [0], layer: 1 }),
    gate({ type: 'measure', targets: [0], layer: 2 }),
    gate({ type: 'measure', targets: [1], layer: 2 }),
  ],
};

const GHZ_SNAPSHOT: CircuitSnapshot = {
  framework: 'qiskit',
  qubit_count: 3,
  classical_bit_count: 3,
  depth: 4,
  gates: [
    gate({ type: 'H', targets: [0], layer: 0 }),
    gate({ type: 'CNOT', targets: [1], controls: [0], layer: 1 }),
    gate({ type: 'CNOT', targets: [2], controls: [1], layer: 2 }),
    gate({ type: 'measure', targets: [0, 1, 2], layer: 3 }),
  ],
};

const TELEPORT_SNAPSHOT: CircuitSnapshot = {
  framework: 'qiskit',
  qubit_count: 3,
  classical_bit_count: 3,
  depth: 6,
  gates: [
    gate({ type: 'H', targets: [1], layer: 0 }),
    gate({ type: 'CNOT', targets: [2], controls: [1], layer: 1 }),
    gate({ type: 'CNOT', targets: [1], controls: [0], layer: 2 }),
    gate({ type: 'H', targets: [0], layer: 3 }),
    gate({ type: 'measure', targets: [0, 1], layer: 4 }),
    gate({ type: 'CCX', targets: [2], controls: [0, 1], layer: 5 }),
  ],
};

describe('estimateResources', () => {
  it('summarizes a Bell circuit', () => {
    const estimate = estimateResources(BELL_SNAPSHOT);
    expect(estimate.qubitCount).toBe(2);
    expect(estimate.classicalBitCount).toBe(2);
    expect(estimate.depth).toBe(3);
    expect(estimate.gateCount).toBe(4);
    expect(estimate.twoQubitGateCount).toBe(1);
    expect(estimate.multiQubitGateCount).toBe(1);
    expect(estimate.measurementCount).toBe(2);
    expect(estimate.gateHistogram).toEqual({ H: 1, CNOT: 1, MEASURE: 2 });
    expect(estimate.tCount).toBe(0);
    // H(0) plus the two single-qubit measure gates are each single-qubit.
    expect(estimate.singleQubitGateCount).toBe(3);
    expect(estimate.nonMeasurementGateCount).toBe(2);
  });

  it('summarizes a GHZ circuit', () => {
    const estimate = estimateResources(GHZ_SNAPSHOT);
    expect(estimate.qubitCount).toBe(3);
    expect(estimate.gateCount).toBe(4);
    expect(estimate.twoQubitGateCount).toBe(2);
    expect(estimate.measurementCount).toBe(1);
    expect(estimate.gateHistogram).toEqual({ H: 1, CNOT: 2, MEASURE: 1 });
    expect(estimate.tCount).toBe(0);
    expect(estimate.singleQubitGateCount).toBe(1);
    expect(estimate.nonMeasurementGateCount).toBe(3);
  });

  it('counts T and T-dagger gates as tCount regardless of spelling', () => {
    const snapshot: CircuitSnapshot = {
      framework: 'qiskit',
      qubit_count: 1,
      classical_bit_count: 0,
      depth: 5,
      gates: [
        gate({ type: 'T', targets: [0] }),
        gate({ type: 'tdg', targets: [0] }),
        gate({ type: 'T†', targets: [0] }),
        gate({ type: 'TDAGGER', targets: [0] }),
        gate({ type: 'H', targets: [0] }),
      ],
    };
    const estimate = estimateResources(snapshot);
    expect(estimate.tCount).toBe(4);
    expect(estimate.singleQubitGateCount).toBe(5);
    expect(estimate.nonMeasurementGateCount).toBe(5);
  });

  it('uppercases gate types in the histogram regardless of source casing', () => {
    const snapshot: CircuitSnapshot = {
      framework: 'cirq',
      qubit_count: 1,
      classical_bit_count: 0,
      depth: 1,
      gates: [gate({ type: 'h', targets: [0] })],
    };
    expect(estimateResources(snapshot).gateHistogram).toEqual({ H: 1 });
  });

  it('returns zeroed metrics for an empty circuit', () => {
    const snapshot: CircuitSnapshot = { framework: 'qiskit', qubit_count: 1, classical_bit_count: 0, depth: 0, gates: [] };
    const estimate = estimateResources(snapshot);
    expect(estimate.gateCount).toBe(0);
    expect(estimate.twoQubitGateCount).toBe(0);
    expect(estimate.measurementCount).toBe(0);
    expect(estimate.gateHistogram).toEqual({});
    expect(estimate.tCount).toBe(0);
    expect(estimate.singleQubitGateCount).toBe(0);
    expect(estimate.nonMeasurementGateCount).toBe(0);
  });
});

describe('validateProgram', () => {
  it('produces zero diagnostics for a correct Bell circuit', () => {
    expect(validateProgram(BELL_SNAPSHOT)).toEqual([]);
  });

  it('produces zero diagnostics for a correct GHZ circuit', () => {
    expect(validateProgram(GHZ_SNAPSHOT)).toEqual([]);
  });

  it('produces zero diagnostics for a correct teleportation circuit', () => {
    expect(validateProgram(TELEPORT_SNAPSHOT)).toEqual([]);
  });

  it('flags an empty circuit as a warning', () => {
    // An empty circuit with 0 classical bits also has no measurement, so both
    // checks fire; assert on the specific code rather than the full array.
    const snapshot: CircuitSnapshot = { framework: 'qiskit', qubit_count: 1, classical_bit_count: 0, depth: 0, gates: [] };
    const diagnostics = validateProgram(snapshot);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'empty_circuit' }),
    );
  });

  it('flags only empty_circuit (not no_measurement) when classical bits exist but the circuit is empty', () => {
    const snapshot: CircuitSnapshot = { framework: 'qiskit', qubit_count: 1, classical_bit_count: 1, depth: 0, gates: [] };
    const diagnostics = validateProgram(snapshot);
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'empty_circuit' }),
    ]);
  });

  it('flags an out-of-range qubit index as an error', () => {
    const snapshot: CircuitSnapshot = {
      framework: 'qiskit',
      qubit_count: 2,
      classical_bit_count: 0,
      depth: 1,
      gates: [gate({ type: 'X', targets: [5] })],
    };
    const diagnostics = validateProgram(snapshot);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'qubit_out_of_range' }),
    );
  });

  it('flags a negative qubit index as an error', () => {
    const snapshot: CircuitSnapshot = {
      framework: 'qiskit',
      qubit_count: 2,
      classical_bit_count: 0,
      depth: 1,
      gates: [gate({ type: 'X', targets: [-1] })],
    };
    const diagnostics = validateProgram(snapshot);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'qubit_out_of_range' }),
    );
  });

  it('flags a control equal to its target as an error', () => {
    const snapshot: CircuitSnapshot = {
      framework: 'qiskit',
      qubit_count: 2,
      classical_bit_count: 0,
      depth: 1,
      gates: [gate({ type: 'CNOT', targets: [0], controls: [0] })],
    };
    const diagnostics = validateProgram(snapshot);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'control_equals_target' }),
    );
  });

  it('flags an arity mismatch for a known single-qubit gate applied to two qubits', () => {
    const snapshot: CircuitSnapshot = {
      framework: 'qiskit',
      qubit_count: 2,
      classical_bit_count: 0,
      depth: 1,
      gates: [gate({ type: 'H', targets: [0, 1] })],
    };
    const diagnostics = validateProgram(snapshot);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'arity_mismatch' }),
    );
  });

  it('does not flag arity for gate types outside the known-arity table', () => {
    const snapshot: CircuitSnapshot = {
      framework: 'qiskit',
      qubit_count: 3,
      classical_bit_count: 0,
      depth: 1,
      gates: [gate({ type: 'RZZ', targets: [0, 1, 2] })],
    };
    expect(validateProgram(snapshot).filter((d) => d.code === 'arity_mismatch')).toEqual([]);
  });

  it('flags statevector-only circuits with no classical bits and no measurement', () => {
    const snapshot: CircuitSnapshot = {
      framework: 'qiskit',
      qubit_count: 1,
      classical_bit_count: 0,
      depth: 1,
      gates: [gate({ type: 'H', targets: [0] })],
    };
    const diagnostics = validateProgram(snapshot);
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: 'info', code: 'no_measurement' }),
    ]);
  });

  it('does not flag no_measurement when classical bits exist even without a measure gate', () => {
    const snapshot: CircuitSnapshot = {
      framework: 'qiskit',
      qubit_count: 1,
      classical_bit_count: 1,
      depth: 1,
      gates: [gate({ type: 'H', targets: [0] })],
    };
    expect(validateProgram(snapshot).filter((d) => d.code === 'no_measurement')).toEqual([]);
  });
});

describe('compareDistributions', () => {
  it('reports zero TVD and a match for identical distributions', () => {
    const report = compareDistributions({ '00': 0.5, '11': 0.5 }, { '00': 0.5, '11': 0.5 });
    expect(report.totalVariationDistance).toBe(0);
    expect(report.worstDelta).toBe(0);
    expect(report.matches).toBe(true);
  });

  it('computes TVD 0.5 and no match against a fully divergent distribution', () => {
    const report = compareDistributions({ '00': 0.5, '11': 0.5 }, { '00': 1 });
    expect(report.totalVariationDistance).toBeCloseTo(0.5);
    expect(report.worstDelta).toBeCloseTo(0.5);
    expect(report.matches).toBe(false);
  });

  it('treats a missing key in either map as probability 0', () => {
    const report = compareDistributions({ '00': 0.3 }, { '00': 0.3, '11': 0.7 });
    const eleven = report.perState.find((p) => p.state === '11');
    expect(eleven).toEqual({ state: '11', actual: 0, expected: 0.7, delta: 0.7 });
  });

  it('sorts perState by delta descending', () => {
    const report = compareDistributions({ '00': 0.1, '01': 0.9 }, { '00': 0.5, '01': 0.5 });
    const deltas = report.perState.map((p) => p.delta);
    expect(deltas).toEqual([...deltas].sort((a, b) => b - a));
  });

  it('respects a custom tolerance', () => {
    const tight = compareDistributions({ '00': 0.52 }, { '00': 0.5 }, 0.01);
    expect(tight.matches).toBe(false);
    const loose = compareDistributions({ '00': 0.52 }, { '00': 0.5 }, 0.05);
    expect(loose.matches).toBe(true);
  });
});
