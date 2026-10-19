import type { ComputeMethod, MutatorKind, RunRecord } from '../../types/discovery';
import { EXPLOIT_BONUS } from './redQueen';

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

/** The seed is the baseline, not a proposal: outcome counts everywhere exclude it. */
export const SEED_EXCLUDED_NOTE = 'excluding the seed';

/** One wording for "N scored" so the KPI tile and the trajectory summary agree. */
export function scoredCountLabel(scoredExcludingSeed: number, seedScored = false): string {
  return `${scoredExcludingSeed} scored (${SEED_EXCLUDED_NOTE}${seedScored ? ', seed scored too' : ''})`;
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

/**
 * What a run row's "best" number means. In Red Queen runs the history holds the
 * adversarial fitness (EXPLOIT_BONUS + gap for an exploit), not evaluator fitness.
 */
export function bestFitnessLabel(
  best: number | undefined,
  redQueen: boolean,
  formatValue: (v: number) => string,
): { text: string; title: string } {
  if (best === undefined || !Number.isFinite(best)) return { text: '—', title: 'No fitness recorded yet' };
  if (!redQueen) return { text: formatValue(best), title: 'Best fitness' };
  if (best >= EXPLOIT_BONUS) return { text: 'exploit', title: `Adversarial fitness ${formatValue(best)}: at least one exploit was found` };
  return { text: `gap ${formatValue(best)}`, title: 'Best adversarial fitness: the largest evaluator-minus-audit gap' };
}

/**
 * Explains a run that ended before spending its budget. Prefers the runner's
 * own `message`; falls back to the structured `stop_reason`. Returns null when
 * the run is still going, ended for a self-explanatory reason (budget, user
 * stop, error) or has nothing to say.
 */
export function earlyStopNotice(run: Pick<RunRecord, 'status' | 'stop_reason' | 'message' | 'stale_generations' | 'usage' | 'spec'>): string | null {
  if (run.status !== 'completed' && run.status !== 'stopped') return null;
  if (run.stop_reason === 'early_stop') {
    const patience = run.spec.search.early_stop_patience;
    return run.message ?? `Stopped early: no improvement in ${patience > 0 ? patience : run.stale_generations} generations.`;
  }
  if (run.stop_reason === 'generations' && run.usage.evaluations < run.spec.budget.max_evaluations) {
    return run.message ?? `Finished all ${run.spec.search.generations} generations after ${run.usage.evaluations} of ${run.spec.budget.max_evaluations} evaluations; the search completed before the evaluation budget was spent.`;
  }
  return null;
}
