import type { CircuitSnapshot, Gate } from '../../types/quantum';

// ---------------------------------------------------------------------------
// Pure, side-effect-free quantum-program analysis over CircuitSnapshot and
// SimulationResult. No kernel access, no I/O — every function here is a plain
// deterministic transform so it can be unit tested without mocks and reused
// by any tool executor that already has a snapshot/result in hand.
// ---------------------------------------------------------------------------

export interface ResourceEstimate {
  qubitCount: number;
  classicalBitCount: number;
  depth: number;
  gateCount: number;
  twoQubitGateCount: number;
  multiQubitGateCount: number;
  measurementCount: number;
  gateHistogram: Record<string, number>;
}

const MEASUREMENT_TYPE_RE = /^(measure|m|mz|mresetz)$/i;

function involvedQubitCount(gate: Gate): number {
  return new Set([...gate.targets, ...gate.controls]).size;
}

/** Computes qubit/gate/depth resource metrics for a parsed circuit. Pure —
 * takes a snapshot, returns a plain summary, no side effects. */
export function estimateResources(snapshot: CircuitSnapshot): ResourceEstimate {
  const gateHistogram: Record<string, number> = {};
  let twoQubitGateCount = 0;
  let multiQubitGateCount = 0;
  let measurementCount = 0;

  for (const gate of snapshot.gates) {
    const key = gate.type.toUpperCase();
    gateHistogram[key] = (gateHistogram[key] ?? 0) + 1;

    const involved = involvedQubitCount(gate);
    if (involved === 2) twoQubitGateCount += 1;
    if (involved >= 2) multiQubitGateCount += 1;
    if (MEASUREMENT_TYPE_RE.test(gate.type)) measurementCount += 1;
  }

  return {
    qubitCount: snapshot.qubit_count,
    classicalBitCount: snapshot.classical_bit_count,
    depth: snapshot.depth,
    gateCount: snapshot.gates.length,
    twoQubitGateCount,
    multiQubitGateCount,
    measurementCount,
    gateHistogram,
  };
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
}

/** Expected involved-qubit count for canonical gates whose arity is
 * unambiguous. Types not listed here are intentionally left unchecked —
 * custom or parametrized-arity gates (e.g. RZZ) must never produce a false
 * positive. */
const KNOWN_ARITY: Record<string, number> = {
  H: 1,
  X: 1,
  Y: 1,
  Z: 1,
  S: 1,
  T: 1,
  SX: 1,
  RX: 1,
  RY: 1,
  RZ: 1,
  PHASE: 1,
  P: 1,
  U1: 1,
  CNOT: 2,
  CX: 2,
  CZ: 2,
  SWAP: 2,
  CY: 2,
  CH: 2,
  CCX: 3,
  TOFFOLI: 3,
  CSWAP: 3,
  FREDKIN: 3,
};

function checkEmptyCircuit(snapshot: CircuitSnapshot): Diagnostic[] {
  if (snapshot.gates.length > 0) return [];
  return [{ severity: 'warning', code: 'empty_circuit', message: 'The circuit has no gates.' }];
}

function checkNoMeasurement(snapshot: CircuitSnapshot): Diagnostic[] {
  const hasMeasurement = snapshot.gates.some((g) => MEASUREMENT_TYPE_RE.test(g.type));
  if (hasMeasurement || snapshot.classical_bit_count !== 0) return [];
  return [
    {
      severity: 'info',
      code: 'no_measurement',
      message: 'No measurement gates and no classical bits — this program is statevector-only; add measurements to see counts.',
    },
  ];
}

function checkQubitRange(snapshot: CircuitSnapshot): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const gate of snapshot.gates) {
    for (const index of [...gate.targets, ...gate.controls]) {
      if (index < 0 || index >= snapshot.qubit_count) {
        diagnostics.push({
          severity: 'error',
          code: 'qubit_out_of_range',
          message: `Gate ${gate.type} references qubit index ${index}, which is out of range for a ${snapshot.qubit_count}-qubit circuit.`,
        });
      }
    }
  }
  return diagnostics;
}

function checkControlEqualsTarget(snapshot: CircuitSnapshot): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const gate of snapshot.gates) {
    const controls = new Set(gate.controls);
    for (const target of gate.targets) {
      if (controls.has(target)) {
        diagnostics.push({
          severity: 'error',
          code: 'control_equals_target',
          message: `Gate ${gate.type} uses qubit ${target} as both a control and a target.`,
        });
      }
    }
  }
  return diagnostics;
}

function checkArityMismatch(snapshot: CircuitSnapshot): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const gate of snapshot.gates) {
    const expected = KNOWN_ARITY[gate.type.toUpperCase()];
    if (expected === undefined) continue;

    const involved = involvedQubitCount(gate);
    if (involved !== expected) {
      diagnostics.push({
        severity: 'warning',
        code: 'arity_mismatch',
        message: `Gate ${gate.type} expects ${expected} qubit(s) but involves ${involved}.`,
      });
    }
  }
  return diagnostics;
}

/** Runs a curated, no-false-positive set of structural/semantic checks over
 * a parsed circuit. Every check is deliberately conservative: types or
 * shapes it doesn't recognize are left alone rather than flagged. */
export function validateProgram(snapshot: CircuitSnapshot): Diagnostic[] {
  return [
    ...checkEmptyCircuit(snapshot),
    ...checkNoMeasurement(snapshot),
    ...checkQubitRange(snapshot),
    ...checkControlEqualsTarget(snapshot),
    ...checkArityMismatch(snapshot),
  ];
}

export interface ComparisonPerState {
  state: string;
  actual: number;
  expected: number;
  delta: number;
}

export interface ComparisonReport {
  matches: boolean;
  worstDelta: number;
  totalVariationDistance: number;
  perState: ComparisonPerState[];
}

const DEFAULT_COMPARE_TOLERANCE = 0.1;

/** Compares two probability distributions over measurement outcomes. Pure —
 * no reference to any live simulation; callers pass the two maps directly. */
export function compareDistributions(
  actual: Record<string, number>,
  expected: Record<string, number>,
  tolerance: number = DEFAULT_COMPARE_TOLERANCE,
): ComparisonReport {
  const states = new Set([...Object.keys(actual), ...Object.keys(expected)]);

  const perState: ComparisonPerState[] = Array.from(states).map((state) => {
    const actualValue = actual[state] ?? 0;
    const expectedValue = expected[state] ?? 0;
    const delta = Math.abs(actualValue - expectedValue);
    return { state, actual: actualValue, expected: expectedValue, delta };
  });

  perState.sort((a, b) => b.delta - a.delta);

  const worstDelta = perState.reduce((max, entry) => Math.max(max, entry.delta), 0);
  const totalVariationDistance = 0.5 * perState.reduce((sum, entry) => sum + entry.delta, 0);
  const matches = worstDelta <= tolerance;

  return { matches, worstDelta, totalVariationDistance, perState };
}
