import type { CircuitSnapshot, Gate } from '../types/quantum';
import type {
  CircuitMetrics,
  EfficiencyMetricKey,
  EfficiencyMetricReport,
  EfficiencyReport,
  EfficiencyTarget,
  EfficiencyTier,
} from '../types/challenge';

/**
 * Circuit-efficiency scoring for the quantum-LeetCode challenges. Pure and
 * framework-agnostic: it reads a CircuitSnapshot (produced every run by the
 * kernel) and grades the measured metrics against a per-problem optimum.
 *
 * The headline metric is the **two-qubit (entangling) gate count** — on real
 * hardware it dominates error and runtime, so it's the true quantum analog of
 * "time complexity". It's also measurement-independent, which makes it a
 * robust, honest thing to grade on.
 */

/** A two-qubit (entangling) gate touches ≥2 distinct qubits across its
 * controls and targets — CNOT/CX, CZ, SWAP, controlled-U, and multi-qubit
 * gates like Toffoli. Single-qubit gates and measurements are excluded. */
export function isTwoQubitGate(gate: Gate): boolean {
  const qubits = new Set<number>([...(gate.controls ?? []), ...(gate.targets ?? [])]);
  return qubits.size >= 2;
}

/** Measurement pseudo-gates aren't "work" a solver should be scored on. */
function isMeasurement(gate: Gate): boolean {
  return /^measure/i.test(gate.type) || gate.type.toLowerCase() === 'm';
}

export function computeCircuitMetrics(
  snapshot: CircuitSnapshot,
  executionTimeMs?: number,
  oracleQueries?: number,
): CircuitMetrics {
  const operations = snapshot.gates.filter((gate) => !isMeasurement(gate));
  return {
    twoQubitGates: operations.filter(isTwoQubitGate).length,
    depth: snapshot.depth,
    gateCount: operations.length,
    qubits: snapshot.qubit_count,
    executionTimeMs,
    ...(oracleQueries !== undefined ? { oracleQueries } : {}),
  };
}

/** Combine per-test-case metrics into one worst-case record — the honest
 * thing to report for a parameterized problem is its most expensive point. */
export function aggregateMetrics(list: ReadonlyArray<CircuitMetrics>): CircuitMetrics | null {
  const present = list.filter((m): m is CircuitMetrics => m != null);
  if (present.length === 0) return null;

  const execTimes = present
    .map((m) => m.executionTimeMs)
    .filter((t): t is number => typeof t === 'number');
  const queries = present
    .map((m) => m.oracleQueries)
    .filter((q): q is number => typeof q === 'number');

  return {
    twoQubitGates: Math.max(...present.map((m) => m.twoQubitGates)),
    depth: Math.max(...present.map((m) => m.depth)),
    gateCount: Math.max(...present.map((m) => m.gateCount)),
    qubits: Math.max(...present.map((m) => m.qubits)),
    executionTimeMs: execTimes.length > 0 ? Math.max(...execTimes) : undefined,
    ...(queries.length > 0 ? { oracleQueries: Math.max(...queries) } : {}),
  };
}

/** Best-of two metric records, element-wise minimum (lower is better). Used
 * to track a problem's personal best across submissions. */
export function bestMetrics(a: CircuitMetrics, b: CircuitMetrics): CircuitMetrics {
  const bestTime =
    a.executionTimeMs != null && b.executionTimeMs != null
      ? Math.min(a.executionTimeMs, b.executionTimeMs)
      : (a.executionTimeMs ?? b.executionTimeMs);
  const bestQueries =
    a.oracleQueries != null && b.oracleQueries != null
      ? Math.min(a.oracleQueries, b.oracleQueries)
      : (a.oracleQueries ?? b.oracleQueries);
  return {
    twoQubitGates: Math.min(a.twoQubitGates, b.twoQubitGates),
    depth: Math.min(a.depth, b.depth),
    gateCount: Math.min(a.gateCount, b.gateCount),
    qubits: Math.min(a.qubits, b.qubits),
    executionTimeMs: bestTime,
    ...(bestQueries !== undefined ? { oracleQueries: bestQueries } : {}),
  };
}

/** Tier a measured value against its optimum: at-or-below par is Optimal,
 * within 50% of par is Efficient, otherwise just Accepted. */
export function rateMetric(value: number, optimal: number): EfficiencyTier {
  if (value <= optimal) return 'optimal';
  if (value <= Math.ceil(optimal * 1.5)) return 'efficient';
  return 'accepted';
}

const METRIC_LABELS: Record<EfficiencyMetricKey, string> = {
  oracleQueries: 'Oracle queries',
  twoQubitGates: '2-qubit gates',
  depth: 'Circuit depth',
  gateCount: 'Total gates',
  qubits: 'Qubits',
};

// Oracle queries lead when present (the query-complexity headline); 2-qubit
// gates and depth are the primary hardware-cost metrics otherwise.
const PRIMARY_KEYS: ReadonlySet<EfficiencyMetricKey> = new Set(['oracleQueries', 'twoQubitGates', 'depth']);
const METRIC_ORDER: EfficiencyMetricKey[] = ['oracleQueries', 'twoQubitGates', 'depth', 'gateCount', 'qubits'];

export function computeEfficiency(
  metrics: CircuitMetrics,
  target?: EfficiencyTarget,
): EfficiencyReport {
  const reports: EfficiencyMetricReport[] = METRIC_ORDER.flatMap((key) => {
    const value = metrics[key];
    // A metric with no measured value (e.g. oracleQueries on a non-oracle
    // challenge) simply isn't reported.
    if (value === undefined) return [];
    const optimal = target?.[key];
    const tier: EfficiencyTier = optimal === undefined ? 'accepted' : rateMetric(value, optimal);
    return [{
      key,
      label: METRIC_LABELS[key],
      value,
      optimal,
      tier,
      primary: PRIMARY_KEYS.has(key),
    }];
  });

  const authored = reports.filter((report) => report.optimal !== undefined);
  return {
    metrics,
    reports,
    hasTarget: authored.length > 0,
    isOptimal: authored.length > 0 && authored.every((report) => report.tier === 'optimal'),
  };
}
