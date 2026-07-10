import { describe, expect, it } from 'vitest';
import type { BackendInfo } from '../../types/hardware';
import type { CircuitSnapshot, Gate } from '../../types/quantum';
import { filterCompatible, planHardwareRun, scoreBackend } from './hardwarePlanner';

const BELL_GATES: Gate[] = [
  { type: 'H', targets: [0], controls: [], params: [], layer: 0 },
  { type: 'CNOT', targets: [1], controls: [0], params: [], layer: 1 },
  { type: 'measure', targets: [0], controls: [], params: [], layer: 2 },
  { type: 'measure', targets: [1], controls: [], params: [], layer: 2 },
];

function makeSnapshot(overrides: Partial<CircuitSnapshot> = {}): CircuitSnapshot {
  return {
    framework: 'qiskit',
    qubit_count: 3,
    classical_bit_count: 3,
    depth: 3,
    gates: BELL_GATES,
    ...overrides,
  };
}

function makeBackend(overrides: Partial<BackendInfo> = {}): BackendInfo {
  return {
    name: 'test-backend',
    provider: 'ibm',
    qubitCount: 5,
    connectivity: [],
    queueLength: 5,
    averageErrorRate: 0.01,
    gateSet: ['h', 'cx', 'measure'],
    status: 'online',
    ...overrides,
  };
}

describe('filterCompatible', () => {
  it('rejects a backend with too few qubits', () => {
    const snapshot = makeSnapshot({ qubit_count: 3 });
    const backend = makeBackend({ qubitCount: 2, name: 'small' });
    const [result] = filterCompatible(snapshot, [backend]);
    expect(result.compatible).toBe(false);
    expect(result.reasons.some((r) => /needs 3 qubits, backend has 2/.test(r))).toBe(true);
  });

  it('accepts an online backend with enough qubits and gate coverage', () => {
    const snapshot = makeSnapshot({ qubit_count: 3 });
    const backend = makeBackend({ qubitCount: 5, status: 'online', gateSet: ['h', 'cx', 'measure'] });
    const [result] = filterCompatible(snapshot, [backend]);
    expect(result.compatible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('rejects a backend missing a used gate in its advertised gate set', () => {
    const snapshot = makeSnapshot({ gates: [{ type: 'TOFFOLI', targets: [2], controls: [0, 1], params: [], layer: 0 }] });
    const backend = makeBackend({ qubitCount: 5, gateSet: ['h', 'cx', 'measure'] });
    const [result] = filterCompatible(snapshot, [backend]);
    expect(result.compatible).toBe(false);
    expect(result.reasons.some((r) => /TOFFOLI/.test(r))).toBe(true);
  });

  it('does not reject a CNOT/CX synonym pair', () => {
    const snapshot = makeSnapshot({
      qubit_count: 2,
      gates: [{ type: 'CNOT', targets: [1], controls: [0], params: [], layer: 0 }],
    });
    const backend = makeBackend({ qubitCount: 2, gateSet: ['h', 'cx', 'measure'] });
    const [result] = filterCompatible(snapshot, [backend]);
    expect(result.compatible).toBe(true);
  });

  it('rejects an offline backend with a status reason', () => {
    const snapshot = makeSnapshot();
    const backend = makeBackend({ status: 'maintenance' });
    const [result] = filterCompatible(snapshot, [backend]);
    expect(result.compatible).toBe(false);
    expect(result.reasons.some((r) => /maintenance/.test(r))).toBe(true);
  });

  it('never rejects on gate coverage when gateSet is empty/unknown', () => {
    const snapshot = makeSnapshot({
      gates: [{ type: 'TOFFOLI', targets: [2], controls: [0, 1], params: [], layer: 0 }],
    });
    const backend = makeBackend({ gateSet: [] });
    const [result] = filterCompatible(snapshot, [backend]);
    expect(result.compatible).toBe(true);
  });
});

describe('scoreBackend', () => {
  it('scores a backend with a lower queue and error rate higher than a busier, noisier one', () => {
    const snapshot = makeSnapshot({ qubit_count: 2 });
    const good = makeBackend({ name: 'good', queueLength: 1, averageErrorRate: 0.001, qubitCount: 5 });
    const bad = makeBackend({ name: 'bad', queueLength: 50, averageErrorRate: 0.1, qubitCount: 5 });

    const goodScore = scoreBackend(snapshot, good).score;
    const badScore = scoreBackend(snapshot, bad).score;

    expect(goodScore).toBeGreaterThan(badScore);
  });

  it('returns explainable factors summing to the reported score', () => {
    const snapshot = makeSnapshot({ qubit_count: 2 });
    const backend = makeBackend();
    const { score, factors } = scoreBackend(snapshot, backend);

    expect(factors.length).toBeGreaterThan(0);
    for (const factor of factors) {
      expect(factor.value).toBeGreaterThanOrEqual(0);
      expect(factor.value).toBeLessThanOrEqual(1);
      expect(factor.contribution).toBeCloseTo(factor.value * factor.weight, 4);
    }
    const total = factors.reduce((sum, f) => sum + f.contribution, 0);
    expect(score).toBeCloseTo(total, 4);
  });
});

describe('planHardwareRun', () => {
  it('selects the best-scoring compatible backend and gives a non-empty rationale', () => {
    const snapshot = makeSnapshot({ qubit_count: 2 });
    const busy = makeBackend({ name: 'busy', queueLength: 80, averageErrorRate: 0.05, qubitCount: 5 });
    const great = makeBackend({ name: 'great', queueLength: 0, averageErrorRate: 0.001, qubitCount: 5 });
    const tooSmall = makeBackend({ name: 'tiny', qubitCount: 1 });

    const plan = planHardwareRun(snapshot, [busy, great, tooSmall]);

    expect(plan.selected?.name).toBe('great');
    expect(plan.candidates.length).toBe(2);
    expect(plan.rejected.length).toBe(1);
    expect(plan.rejected[0].backend.name).toBe('tiny');
    expect(plan.rationale.length).toBeGreaterThan(0);
    expect(plan.rationale).toMatch(/great/);
  });

  it('returns a null selection with a rationale when no backends are given', () => {
    const snapshot = makeSnapshot();
    const plan = planHardwareRun(snapshot, []);
    expect(plan.selected).toBeNull();
    expect(plan.candidates).toEqual([]);
    expect(plan.rejected).toEqual([]);
    expect(plan.rationale.length).toBeGreaterThan(0);
  });

  it('returns a null selection with a rationale when nothing is compatible', () => {
    const snapshot = makeSnapshot({ qubit_count: 10 });
    const backend = makeBackend({ qubitCount: 2 });
    const plan = planHardwareRun(snapshot, [backend]);
    expect(plan.selected).toBeNull();
    expect(plan.rejected.length).toBe(1);
    expect(plan.rationale.length).toBeGreaterThan(0);
  });
});
