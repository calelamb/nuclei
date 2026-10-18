/**
 * MAP-Elites archive + Pareto front (PRD 14 §7.4). Pure and immutable: every
 * operation returns a new `ArchiveState`, and the state is plain JSON so it
 * can be written into `run.json` verbatim.
 *
 * - One grid per island, binned over two evaluator descriptors.
 * - A cell keeps its highest-fitness elite; ties go to the lower cost, then
 *   to the earlier candidate.
 * - Only `scored` evaluations from the `full` or `confirm` stage may enter:
 *   screen-stage numbers are cheap estimates and never become elites.
 * - The Pareto front is global, over the evaluator's declared objectives.
 */

import type {
  ArchiveAxis,
  ArchiveElite,
  ArchiveState,
  DiscoveryEvaluation,
  EvaluatorDescriptorDef,
  EvaluatorObjectiveDef,
  ObjectiveDirection,
} from '../../types/discovery';

export type { ArchiveElite, ArchiveState };

export const DEFAULT_BINS = 8;

export function createArchive(
  axes: readonly [ArchiveAxis, ArchiveAxis],
  objectives: readonly EvaluatorObjectiveDef[],
  islands: number,
): ArchiveState {
  return {
    axes,
    objectives: objectives.map(({ key, label, direction }) => ({ key, label, direction })),
    islands: Array.from({ length: Math.max(1, islands) }, () => ({})),
  };
}

export function axisFromDescriptor(def: EvaluatorDescriptorDef, bins?: number): ArchiveAxis {
  return {
    key: def.key,
    label: def.label,
    min: def.min,
    max: def.max,
    bins: bins ?? def.default_bins ?? DEFAULT_BINS,
  };
}

/** Bin index in [0, bins-1]; out-of-range and non-finite values clamp to the edge bins. */
export function binIndex(value: number, axis: ArchiveAxis): number {
  if (!Number.isFinite(value) || axis.max <= axis.min) return 0;
  const raw = Math.floor(((value - axis.min) / (axis.max - axis.min)) * axis.bins);
  return Math.min(axis.bins - 1, Math.max(0, raw));
}

export function cellKey(cell: readonly [number, number]): string {
  return `${cell[0]},${cell[1]}`;
}

export function candidateOrder(candidateId: string): number {
  const match = /(\d+)$/.exec(candidateId);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

/**
 * Tie-break cost: the evaluator's second objective (qubits, gate count,
 * parameter count, ...), sign-adjusted so that lower is always better.
 * Evaluators list the quality objective first and the resource objective
 * second; with a single objective the cost is 0.
 */
export function eliteCost(
  objectives: Record<string, number>,
  defs: ArchiveState['objectives'],
): number {
  const def = defs[1];
  if (!def) return 0;
  const value = objectives[def.key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  return def.direction === 'maximize' ? -value : value;
}

export function isArchiveEligible(evaluation: DiscoveryEvaluation | null | undefined): boolean {
  if (!evaluation || evaluation.status !== 'scored') return false;
  if (evaluation.fitness === null || !Number.isFinite(evaluation.fitness)) return false;
  return evaluation.stage === 'full' || evaluation.stage === 'confirm';
}

export interface EliteSource {
  candidateId: string;
  island: number;
  programHash: string;
}

/** Build an elite from an evaluation, or null when it may not enter the archive. */
export function eliteFromEvaluation(
  archive: ArchiveState,
  source: EliteSource,
  evaluation: DiscoveryEvaluation,
): ArchiveElite | null {
  if (!isArchiveEligible(evaluation)) return null;
  const objectives: Record<string, number> = {};
  for (const [key, objective] of Object.entries(evaluation.objectives)) {
    objectives[key] = objective.value;
  }
  const cell = [
    binIndex(evaluation.descriptors[archive.axes[0].key] ?? 0, archive.axes[0]),
    binIndex(evaluation.descriptors[archive.axes[1].key] ?? 0, archive.axes[1]),
  ] as const;
  return {
    candidateId: source.candidateId,
    island: source.island,
    fitness: evaluation.fitness as number,
    cost: eliteCost(objectives, archive.objectives),
    order: candidateOrder(source.candidateId),
    programHash: source.programHash,
    cell,
    descriptors: { ...evaluation.descriptors },
    objectives,
  };
}

/** True when `a` should replace `b`: higher fitness, then lower cost, then earlier. */
export function isBetterElite(a: ArchiveElite, b: ArchiveElite): boolean {
  if (a.fitness !== b.fitness) return a.fitness > b.fitness;
  if (a.cost !== b.cost) return a.cost < b.cost;
  return a.order < b.order;
}

export interface InsertResult {
  archive: ArchiveState;
  accepted: boolean;
  replaced: ArchiveElite | null;
}

export function insertElite(archive: ArchiveState, elite: ArchiveElite): InsertResult {
  const island = elite.island;
  const grid = archive.islands[island];
  if (!grid) return { archive, accepted: false, replaced: null };
  const key = cellKey(elite.cell);
  const incumbent = grid[key];
  if (incumbent && !isBetterElite(elite, incumbent)) {
    return { archive, accepted: false, replaced: null };
  }
  const nextGrid = { ...grid, [key]: elite };
  const islands = archive.islands.map((g, i) => (i === island ? nextGrid : g));
  return { archive: { ...archive, islands }, accepted: true, replaced: incumbent ?? null };
}

export function islandElites(archive: ArchiveState, island: number): ArchiveElite[] {
  return sortElites(Object.values(archive.islands[island] ?? {}));
}

export function allElites(archive: ArchiveState): ArchiveElite[] {
  return sortElites(archive.islands.flatMap((grid) => Object.values(grid)));
}

/** Best first: fitness desc, cost asc, order asc, then island/id for total order. */
export function sortElites(elites: readonly ArchiveElite[]): ArchiveElite[] {
  return [...elites].sort((a, b) => {
    if (a.fitness !== b.fitness) return b.fitness - a.fitness;
    if (a.cost !== b.cost) return a.cost - b.cost;
    if (a.order !== b.order) return a.order - b.order;
    return a.island - b.island;
  });
}

export function bestElite(archive: ArchiveState, island?: number): ArchiveElite | null {
  const pool = island === undefined ? allElites(archive) : islandElites(archive, island);
  return pool[0] ?? null;
}

/** Migration copies one candidate into several islands; keep the first (best-sorted) copy. */
export function uniqueByCandidate(elites: readonly ArchiveElite[]): ArchiveElite[] {
  const seen = new Set<string>();
  return elites.filter((e) => (seen.has(e.candidateId) ? false : (seen.add(e.candidateId), true)));
}

export function medianFitness(elites: readonly ArchiveElite[]): number | null {
  if (elites.length === 0) return null;
  const sorted = elites.map((e) => e.fitness).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function archiveCoverage(archive: ArchiveState, island: number): number {
  const total = archive.axes[0].bins * archive.axes[1].bins;
  return total === 0 ? 0 : Object.keys(archive.islands[island] ?? {}).length / total;
}

// ── Pareto ─────────────────────────────────────────────────────────────

type ObjectiveDefs = ArchiveState['objectives'];

/** Objective value oriented so that smaller is better; missing values are worst. */
function minimized(elite: ArchiveElite, key: string, direction: ObjectiveDirection): number {
  const value = elite.objectives[key];
  if (typeof value !== 'number' || Number.isNaN(value)) return Number.POSITIVE_INFINITY;
  return direction === 'maximize' ? -value : value;
}

export function dominates(a: ArchiveElite, b: ArchiveElite, defs: ObjectiveDefs): boolean {
  let strictlyBetter = false;
  for (const def of defs) {
    const av = minimized(a, def.key, def.direction);
    const bv = minimized(b, def.key, def.direction);
    if (av > bv) return false;
    if (av < bv) strictlyBetter = true;
  }
  return strictlyBetter;
}

/** Fast non-dominated sort: returns fronts of indices into `elites`, best front first. */
export function nonDominatedSort(elites: readonly ArchiveElite[], defs: ObjectiveDefs): number[][] {
  const n = elites.length;
  const dominatedBy: number[][] = Array.from({ length: n }, () => []);
  const counts = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (dominates(elites[i], elites[j], defs)) {
        dominatedBy[i].push(j);
        counts[j] += 1;
      } else if (dominates(elites[j], elites[i], defs)) {
        dominatedBy[j].push(i);
        counts[i] += 1;
      }
    }
  }
  const fronts: number[][] = [];
  let current = counts.flatMap((c, i) => (c === 0 ? [i] : []));
  while (current.length > 0) {
    fronts.push(current);
    const next: number[] = [];
    for (const i of current) {
      for (const j of dominatedBy[i]) {
        counts[j] -= 1;
        if (counts[j] === 0) next.push(j);
      }
    }
    current = next;
  }
  return fronts;
}

/** Crowding distance of each member of one front (boundary points are Infinity). */
export function crowdingDistance(
  elites: readonly ArchiveElite[],
  front: readonly number[],
  defs: ObjectiveDefs,
): Map<number, number> {
  const distance = new Map<number, number>(front.map((i) => [i, 0]));
  if (front.length <= 2) {
    for (const i of front) distance.set(i, Number.POSITIVE_INFINITY);
    return distance;
  }
  for (const def of defs) {
    const sorted = [...front].sort(
      (a, b) => minimized(elites[a], def.key, def.direction) - minimized(elites[b], def.key, def.direction),
    );
    const lo = minimized(elites[sorted[0]], def.key, def.direction);
    const hi = minimized(elites[sorted[sorted.length - 1]], def.key, def.direction);
    distance.set(sorted[0], Number.POSITIVE_INFINITY);
    distance.set(sorted[sorted.length - 1], Number.POSITIVE_INFINITY);
    const range = hi - lo;
    if (!(range > 0) || !Number.isFinite(range)) continue;
    for (let k = 1; k < sorted.length - 1; k += 1) {
      const gap =
        minimized(elites[sorted[k + 1]], def.key, def.direction) -
        minimized(elites[sorted[k - 1]], def.key, def.direction);
      distance.set(sorted[k], (distance.get(sorted[k]) ?? 0) + gap / range);
    }
  }
  return distance;
}

export interface RankedElite {
  elite: ArchiveElite;
  rank: number;
  crowding: number;
}

/** Every elite with its front rank and crowding distance (display order: rank, then crowding desc). */
export function rankElites(elites: readonly ArchiveElite[], defs: ObjectiveDefs): RankedElite[] {
  const fronts = nonDominatedSort(elites, defs);
  const ranked: RankedElite[] = [];
  fronts.forEach((front, rank) => {
    const crowding = crowdingDistance(elites, front, defs);
    for (const i of front) ranked.push({ elite: elites[i], rank, crowding: crowding.get(i) ?? 0 });
  });
  return ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      b.crowding - a.crowding ||
      b.elite.fitness - a.elite.fitness ||
      a.elite.order - b.elite.order,
  );
}

/** The global non-dominated set over all islands, fittest first. */
export function paretoFront(archive: ArchiveState): ArchiveElite[] {
  const elites = uniqueByCandidate(allElites(archive));
  const [front = []] = nonDominatedSort(elites, archive.objectives);
  return front.map((i) => elites[i]);
}
