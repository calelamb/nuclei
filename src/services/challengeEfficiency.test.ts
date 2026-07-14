import { describe, expect, it } from 'vitest';
import {
  aggregateMetrics,
  bestMetrics,
  computeCircuitMetrics,
  computeEfficiency,
  isTwoQubitGate,
  rateMetric,
} from './challengeEfficiency';
import type { CircuitSnapshot, Gate } from '../types/quantum';

function gate(type: string, targets: number[], controls: number[] = []): Gate {
  return { type, targets, controls, params: [], layer: 0 };
}

function snapshot(gates: Gate[], depth: number, qubits: number): CircuitSnapshot {
  return { framework: 'qiskit', qubit_count: qubits, classical_bit_count: qubits, depth, gates };
}

describe('isTwoQubitGate', () => {
  it('is false for single-qubit gates and measurement', () => {
    expect(isTwoQubitGate(gate('H', [0]))).toBe(false);
    expect(isTwoQubitGate(gate('RZ', [1]))).toBe(false);
    expect(isTwoQubitGate(gate('measure', [0]))).toBe(false);
  });

  it('is true for CNOT / CZ (control + target)', () => {
    expect(isTwoQubitGate(gate('CNOT', [1], [0]))).toBe(true);
    expect(isTwoQubitGate(gate('CZ', [1], [0]))).toBe(true);
  });

  it('is true for multi-qubit gates like Toffoli', () => {
    expect(isTwoQubitGate(gate('CCX', [2], [0, 1]))).toBe(true);
  });

  it('is false when a two-target gate somehow lands on one qubit', () => {
    // Degenerate, but the count is by distinct qubits, not operand slots.
    expect(isTwoQubitGate(gate('X', [0], [0]))).toBe(false);
  });
});

describe('computeCircuitMetrics', () => {
  it('counts a Bell circuit: H + CNOT + measurements', () => {
    const snap = snapshot(
      [gate('H', [0]), gate('CNOT', [1], [0]), gate('measure', [0]), gate('measure', [1])],
      2,
      2,
    );
    const metrics = computeCircuitMetrics(snap, 1.4);
    expect(metrics.twoQubitGates).toBe(1);
    expect(metrics.gateCount).toBe(2); // measurements excluded
    expect(metrics.depth).toBe(2);
    expect(metrics.qubits).toBe(2);
    expect(metrics.executionTimeMs).toBe(1.4);
  });

  it('counts 0 two-qubit gates for a product-state (all-H) circuit', () => {
    const snap = snapshot([gate('H', [0]), gate('H', [1]), gate('H', [2])], 1, 3);
    expect(computeCircuitMetrics(snap).twoQubitGates).toBe(0);
  });
});

describe('rateMetric', () => {
  it('optimal at or below par', () => {
    expect(rateMetric(1, 1)).toBe('optimal');
    expect(rateMetric(0, 1)).toBe('optimal');
  });
  it('efficient within 50% of par', () => {
    expect(rateMetric(3, 2)).toBe('efficient'); // ceil(2*1.5)=3
    expect(rateMetric(6, 4)).toBe('efficient');
  });
  it('accepted beyond that', () => {
    expect(rateMetric(4, 2)).toBe('accepted');
  });
});

describe('aggregateMetrics', () => {
  it('takes the worst case (max) of each metric', () => {
    const a = { twoQubitGates: 1, depth: 2, gateCount: 3, qubits: 2, executionTimeMs: 1 };
    const b = { twoQubitGates: 3, depth: 2, gateCount: 5, qubits: 2, executionTimeMs: 4 };
    expect(aggregateMetrics([a, b])).toEqual({
      twoQubitGates: 3,
      depth: 2,
      gateCount: 5,
      qubits: 2,
      executionTimeMs: 4,
    });
  });
  it('returns null for an empty list', () => {
    expect(aggregateMetrics([])).toBeNull();
  });
});

describe('bestMetrics', () => {
  it('takes the element-wise minimum (lower is better)', () => {
    const a = { twoQubitGates: 2, depth: 3, gateCount: 5, qubits: 2, executionTimeMs: 5 };
    const b = { twoQubitGates: 1, depth: 4, gateCount: 3, qubits: 2, executionTimeMs: 2 };
    expect(bestMetrics(a, b)).toEqual({
      twoQubitGates: 1,
      depth: 3,
      gateCount: 3,
      qubits: 2,
      executionTimeMs: 2,
    });
  });
});

describe('computeEfficiency', () => {
  const metrics = { twoQubitGates: 1, depth: 2, gateCount: 3, qubits: 2 };

  it('marks isOptimal when every authored target is met', () => {
    const report = computeEfficiency(metrics, { twoQubitGates: 1, depth: 2 });
    expect(report.hasTarget).toBe(true);
    expect(report.isOptimal).toBe(true);
    const twoQ = report.reports.find((r) => r.key === 'twoQubitGates');
    expect(twoQ?.tier).toBe('optimal');
    expect(twoQ?.primary).toBe(true);
  });

  it('is not optimal when one target is missed, but still efficient-tiered', () => {
    const report = computeEfficiency({ ...metrics, twoQubitGates: 2 }, { twoQubitGates: 1, depth: 2 });
    expect(report.isOptimal).toBe(false);
    expect(report.reports.find((r) => r.key === 'twoQubitGates')?.tier).toBe('efficient');
  });

  it('has no target (info-only) when none authored, and never claims optimal', () => {
    const report = computeEfficiency(metrics, undefined);
    expect(report.hasTarget).toBe(false);
    expect(report.isOptimal).toBe(false);
    expect(report.reports.every((r) => r.optimal === undefined)).toBe(true);
  });

  it('grades only the authored metrics, leaving others untiered', () => {
    const report = computeEfficiency(metrics, { twoQubitGates: 1 });
    expect(report.reports.find((r) => r.key === 'twoQubitGates')?.optimal).toBe(1);
    expect(report.reports.find((r) => r.key === 'depth')?.optimal).toBeUndefined();
  });
});
