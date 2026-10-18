/**
 * Cascade promotion (spec §4.1.5) and champion confirmation statistics
 * (honesty principle 4: report the confirmed, not the selected, number).
 */

import type {
  ConfirmedObjective,
  DiscoveryEvaluation,
  EvaluatorObjectiveDef,
  RunConfirmation,
} from '../../types/discovery';
import { medianFitness, type ArchiveElite } from './archive';

export type PromoteRule = 'island_median' | 'island_best' | 'always';

/**
 * Optimistic screen bound. Kernel fitness is built from the pessimistic end
 * of the primary objective's 95% interval, so the optimistic fitness is the
 * fitness plus the gap to the other end: a log10 ratio when both bounds are
 * positive (the log-scale evaluators), else the linear width. No interval
 * means no slack. This is a deliberately generous filter: the screen exists
 * to drop clear losers, not to rank near-ties.
 */
export function optimisticFitness(
  evaluation: DiscoveryEvaluation,
  primary: Pick<EvaluatorObjectiveDef, 'key'> | undefined,
): number | null {
  if (evaluation.status !== 'scored' || evaluation.fitness === null) return null;
  const ci = primary ? evaluation.objectives[primary.key]?.ci95 : null;
  if (!ci || !(ci[1] > ci[0])) return evaluation.fitness;
  const delta = ci[0] > 0 ? Math.log10(ci[1] / ci[0]) : ci[1] - ci[0];
  return evaluation.fitness + (Number.isFinite(delta) ? delta : 0);
}

/** Promotion threshold from the island's elites, frozen at generation start. */
export function promotionThreshold(rule: PromoteRule, islandElites: readonly ArchiveElite[]): number | null {
  if (rule === 'always' || islandElites.length === 0) return null;
  if (rule === 'island_best') return Math.max(...islandElites.map((e) => e.fitness));
  return medianFitness(islandElites);
}

export function shouldPromote(optimistic: number | null, threshold: number | null): boolean {
  if (optimistic === null) return false;
  return threshold === null || optimistic > threshold;
}

// Two-sided 95% Student-t critical values, df 1..30.
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12,
  2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

export function meanCi95(values: readonly number[]): { mean: number; ci95: [number, number] | null } {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, ci95: null };
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1);
  const half = (T95[n - 2] ?? 1.96) * Math.sqrt(variance / n);
  return { mean, ci95: [mean - half, mean + half] };
}

export function summarizeConfirmation(input: {
  championId: string;
  championFitness: number;
  seeds: readonly number[];
  evaluations: readonly DiscoveryEvaluation[];
  now: string;
}): RunConfirmation {
  const scored = input.evaluations.filter((e) => e.status === 'scored' && e.fitness !== null);
  const objectives: ConfirmedObjective[] = [];
  const first = scored[0];
  if (first) {
    for (const [key, def] of Object.entries(first.objectives)) {
      const values = scored.map((e) => e.objectives[key]?.value).filter((v): v is number => typeof v === 'number');
      if (values.length === 0) continue;
      const { mean, ci95 } = meanCi95(values);
      objectives.push({ key, label: def.label, direction: def.direction, mean, ci95, n: values.length });
    }
  }
  const fitness = scored.length > 0 ? meanCi95(scored.map((e) => e.fitness as number)) : null;
  return {
    champion_id: input.championId,
    seeds: [...input.seeds],
    n_scored: scored.length,
    fitness_mean: fitness?.mean ?? null,
    fitness_ci95: fitness?.ci95 ?? null,
    fitness_drop: fitness ? input.championFitness - fitness.mean : null,
    objectives,
    evaluations: [...input.evaluations],
    created_at: input.now,
  };
}
