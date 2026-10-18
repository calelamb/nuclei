/**
 * Presentation-side classification of candidates, shared by the lineage,
 * trajectory, table and drawer so one candidate reads the same everywhere.
 */

import type { CandidateRecord, DiscoveryEvaluation, RunRecord } from '../../types/discovery';

export type CandidateKind =
  | 'seed'
  | 'scored'
  | 'rejected'
  | 'failed'
  | 'screened_out'
  | 'duplicate'
  | 'invalid'
  | 'pending';

export const CANDIDATE_KIND_LABEL: Record<CandidateKind, string> = {
  seed: 'Seed',
  scored: 'Scored',
  rejected: 'Rejected',
  failed: 'Failed',
  screened_out: 'Screened out',
  duplicate: 'Duplicate',
  invalid: 'Invalid proposal',
  pending: 'Pending',
};

export function candidateKind(c: CandidateRecord): CandidateKind {
  if (c.outcome === 'duplicate') return 'duplicate';
  if (c.outcome === 'invalid_proposal') return 'invalid';
  if (c.outcome === 'screened_out') return 'screened_out';
  if (c.outcome === 'pending' && !c.evaluation) return 'pending';
  const status = c.evaluation?.status;
  if (status === 'rejected') return 'rejected';
  if (status === 'failed') return 'failed';
  if (status === 'scored') return c.mutator === 'seed' ? 'seed' : 'scored';
  return c.mutator === 'seed' ? 'seed' : 'pending';
}

export function candidateFitness(c: CandidateRecord): number | null {
  const f = c.evaluation?.fitness;
  return typeof f === 'number' && Number.isFinite(f) ? f : null;
}

/** Fitness of the cheap screen-stage estimate, when the cascade ran. */
export function screenFitness(c: CandidateRecord): number | null {
  const f = c.screen?.fitness;
  return typeof f === 'number' && Number.isFinite(f) ? f : null;
}

/** True when a scored candidate beats its scored parent. */
export function isImprovement(c: CandidateRecord, byId: ReadonlyMap<string, CandidateRecord>): boolean {
  if (c.mutator === 'seed' || c.evaluation?.status !== 'scored') return false;
  const own = candidateFitness(c);
  const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
  const parentFitness = parent ? candidateFitness(parent) : null;
  return own !== null && parentFitness !== null && own > parentFitness;
}

export function indexById(candidates: readonly CandidateRecord[]): Map<string, CandidateRecord> {
  return new Map(candidates.map((c) => [c.id, c]));
}

/** The evaluation to explain a candidate by: the full one, else the screen estimate. */
export function primaryEvaluation(c: CandidateRecord): DiscoveryEvaluation | null {
  return c.evaluation ?? c.screen;
}

export function primaryObjectiveKey(run: RunRecord | null): string | null {
  return run?.archive.objectives[0]?.key ?? null;
}

export function numericId(id: string): number {
  const match = /(\d+)$/.exec(id);
  return match ? Number.parseInt(match[1], 10) : 0;
}

/** Latest scored fitness range over the candidates (for color scales). */
export function fitnessExtent(candidates: readonly CandidateRecord[]): [number, number] | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const c of candidates) {
    const f = c.evaluation?.status === 'scored' ? candidateFitness(c) : null;
    if (f === null) continue;
    lo = Math.min(lo, f);
    hi = Math.max(hi, f);
  }
  return lo <= hi ? [lo, hi] : null;
}

export function normalizeFitness(value: number, extent: [number, number] | null): number {
  if (!extent) return 0.5;
  const [lo, hi] = extent;
  return hi > lo ? (value - lo) / (hi - lo) : 0.5;
}
