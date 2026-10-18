/**
 * Data for the fitness-trajectory chart (PRD 14 §3.2): best-so-far per
 * island, every evaluated candidate as a point, rejected and failed
 * candidates on a baseline lane, screened-out candidates distinct.
 */

import type { CandidateMutator, CandidateRecord } from '../../types/discovery';
import { candidateFitness, candidateKind, indexById, isImprovement, numericId, screenFitness } from './candidateView';

export type TrajectoryKind = 'scored' | 'rejected' | 'failed' | 'screened_out';

export interface TrajectoryPoint {
  id: string;
  /** Candidate creation order (x axis). */
  index: number;
  /** Fitness for scored and screened-out points; the lane value for rejected and failed ones. */
  y: number;
  kind: TrajectoryKind;
  mutator: CandidateMutator;
  island: number;
  improved: boolean;
}

export interface IslandStep {
  index: number;
  best: number;
}

export interface IslandSeries {
  island: number;
  steps: IslandStep[];
}

export interface Trajectory {
  points: TrajectoryPoint[];
  islands: IslandSeries[];
  xMax: number;
  yMin: number;
  yMax: number;
  /** y of the baseline lane that holds rejected and failed candidates. */
  laneY: number;
  /** Candidates that cannot be placed (duplicates, invalid proposals, pending, unscored screens). */
  unplotted: number;
}

export function buildTrajectory(candidates: readonly CandidateRecord[]): Trajectory {
  const byId = indexById(candidates);
  const ordered = [...candidates].sort((a, b) => numericId(a.id) - numericId(b.id));
  const placed: Array<Omit<TrajectoryPoint, 'y'> & { y: number | null }> = [];
  const bestByIsland = new Map<number, IslandStep[]>();
  let unplotted = 0;

  for (const c of ordered) {
    const kind = candidateKind(c);
    const base = { id: c.id, index: numericId(c.id), mutator: c.mutator, island: c.island, improved: isImprovement(c, byId) };
    if (kind === 'scored' || kind === 'seed') {
      const fitness = candidateFitness(c);
      if (fitness === null) {
        unplotted += 1;
        continue;
      }
      placed.push({ ...base, y: fitness, kind: 'scored' });
      const steps = bestByIsland.get(c.island) ?? [];
      if (steps.length === 0 || fitness > steps[steps.length - 1].best) {
        bestByIsland.set(c.island, [...steps, { index: base.index, best: fitness }]);
      }
    } else if (kind === 'rejected' || kind === 'failed') {
      placed.push({ ...base, y: null, kind });
    } else if (kind === 'screened_out') {
      const estimate = screenFitness(c);
      if (estimate === null) unplotted += 1;
      else placed.push({ ...base, y: estimate, kind: 'screened_out' });
    } else {
      unplotted += 1;
    }
  }

  const values = placed.flatMap((p) => (p.y === null ? [] : [p.y]));
  const yMin = values.length > 0 ? Math.min(...values) : 0;
  const yMax = values.length > 0 ? Math.max(...values) : 1;
  const span = yMax > yMin ? yMax - yMin : Math.max(1, Math.abs(yMax) * 0.2);
  const laneY = yMin - span * 0.14;
  const xMax = Math.max(1, ...placed.map((p) => p.index), ...ordered.map((c) => numericId(c.id)));

  return {
    points: placed.map((p) => ({ ...p, y: p.y ?? laneY })),
    islands: [...bestByIsland].sort((a, b) => a[0] - b[0]).map(([island, steps]) => ({ island, steps })),
    xMax,
    yMin,
    yMax,
    laneY,
    unplotted,
  };
}

/** SVG step path (hold, then jump) from the first step to `xEnd`. */
export function stepPath(steps: readonly IslandStep[], xEnd: number, x: (v: number) => number, y: (v: number) => number): string {
  if (steps.length === 0) return '';
  const parts = [`M${x(steps[0].index)},${y(steps[0].best)}`];
  for (let i = 1; i < steps.length; i += 1) {
    parts.push(`H${x(steps[i].index)}`, `V${y(steps[i].best)}`);
  }
  parts.push(`H${x(Math.max(xEnd, steps[steps.length - 1].index))}`);
  return parts.join('');
}

export function trajectorySummary(t: Trajectory): string {
  const scored = t.points.filter((p) => p.kind === 'scored').length;
  const rejected = t.points.filter((p) => p.kind === 'rejected').length;
  const failed = t.points.filter((p) => p.kind === 'failed').length;
  const screened = t.points.filter((p) => p.kind === 'screened_out').length;
  const bests = t.islands.map((s) => `island ${s.island + 1} best ${s.steps[s.steps.length - 1].best.toPrecision(4)}`).join(', ');
  return `Fitness over ${t.xMax} candidates: ${scored} scored, ${rejected} rejected, ${failed} failed, ${screened} screened out. ${bests || 'No scored candidate yet.'}`;
}
