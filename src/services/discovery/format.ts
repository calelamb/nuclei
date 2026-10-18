import type { ComputeMethod, MutatorKind } from '../../types/discovery';

/** Small number formatters shared by the Discovery Engine UI. */

/** 1234 → "1.2k", 1_500_000 → "1.5M"; small counts stay exact. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs < 1000) return String(Math.round(value));
  if (abs < 1_000_000) return `${(value / 1000).toFixed(abs < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function signed(value: number, formatter: (v: number) => string): string {
  return `${value >= 0 ? '+' : '−'}${formatter(Math.abs(value))}`;
}

/** `20261018-141530-a1b2` → `2026-10-18 14:15`. */
export function runTimeLabel(runId: string, short = false): string {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(runId);
  if (!m) return runId;
  return short ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

export const EVALUATOR_TITLE = {
  qec_memory: 'QEC memory',
  state_synthesis: 'State synthesis',
  vqe_ground_state: 'VQE ground state',
  trainability_frontier: 'Trainability frontier',
} as const;

export function mutatorLabel(kind: MutatorKind, breadth: string, depth: string): string {
  if (kind === 'ast') return 'AST mutator';
  if (kind === 'red_queen') return 'Red Queen';
  return `${kind === 'llm' ? 'LLM' : 'Hybrid'} · ${breadth}/${depth}`;
}

const METHOD_LABEL: Record<ComputeMethod, string> = {
  statevector_sampling: 'statevector sampling',
  statevector_exact: 'exact statevector',
  pauli_propagation_exact: 'exact Pauli propagation',
  pauli_propagation_bounded: 'bounded Pauli propagation',
  stim_pymatching_sampling: 'Stim sampling with PyMatching',
};

/** A readable name for a kernel compute method; an unknown (newer) label is shown as the kernel sent it. */
export function describeMethod(method: string): string {
  return (METHOD_LABEL as Record<string, string>)[method] ?? method.replaceAll('_', ' ');
}

/**
 * The audit seed is a 64-bit integer that JSON parsing rounds above 2^53, so it is for display only:
 * shown exactly when it is a safe integer, otherwise flagged as approximate.
 */
export function formatAuditSeed(seed: number | null | undefined): string {
  if (seed === null || seed === undefined || !Number.isFinite(seed)) return '—';
  if (Number.isSafeInteger(seed)) return String(seed);
  return `≈ ${BigInt(Math.trunc(seed)).toString()} (rounded; not exact)`;
}
