/**
 * Parent selection, inspirations and ring migration (PRD 14 §7.4). Pure over
 * an `ArchiveState`; randomness comes only from the injected `Rng`.
 */

import {
  allElites,
  cellKey,
  insertElite,
  isBetterElite,
  islandElites,
  bestElite,
  type ArchiveElite,
  type ArchiveState,
} from './archive';
import type { Rng } from './rng';

const TOURNAMENT_SIZE = 3;

/**
 * With probability `exploration` pick a uniform random elite of the island;
 * otherwise run a size-3 tournament on fitness (ties: lower cost, earlier).
 * An island with no elites yet borrows from the global pool; null only when
 * the whole archive is empty.
 */
export function selectParent(
  archive: ArchiveState,
  island: number,
  rng: Rng,
  exploration: number,
): ArchiveElite | null {
  let pool = islandElites(archive, island);
  if (pool.length === 0) pool = allElites(archive);
  if (pool.length === 0) return null;
  if (rng.chance(exploration)) return rng.pick(pool);
  let winner = rng.pick(pool);
  for (let i = 1; i < TOURNAMENT_SIZE; i += 1) {
    const challenger = rng.pick(pool);
    if (isBetterElite(challenger, winner)) winner = challenger;
  }
  return winner;
}

/**
 * Top-k global elites from cells other than the parent's, deduplicated by
 * program hash (and never the parent's own program).
 */
export function selectInspirations(archive: ArchiveState, parent: ArchiveElite, k: number): ArchiveElite[] {
  if (k <= 0) return [];
  const parentCell = cellKey(parent.cell);
  const seen = new Set<string>([parent.programHash]);
  const picked: ArchiveElite[] = [];
  for (const elite of allElites(archive)) {
    if (elite.island === parent.island && cellKey(elite.cell) === parentCell) continue;
    if (seen.has(elite.programHash)) continue;
    seen.add(elite.programHash);
    picked.push(elite);
    if (picked.length === k) break;
  }
  return picked;
}

export interface Migration {
  from: number;
  to: number;
  candidateId: string;
  accepted: boolean;
}

export function isMigrationGeneration(generation: number, interval: number): boolean {
  return interval > 0 && generation > 0 && generation % interval === 0;
}

/**
 * Ring migration: every `interval` generations each island's best elite is
 * copied into the next island's grid (where it still has to win its cell).
 * Bests are read from the archive *before* any copy, so one migration round
 * never relays a migrant twice.
 */
export function migrate(
  archive: ArchiveState,
  generation: number,
  interval: number,
): { archive: ArchiveState; migrations: Migration[] } {
  const islands = archive.islands.length;
  if (islands < 2 || !isMigrationGeneration(generation, interval)) return { archive, migrations: [] };
  const bests = archive.islands.map((_, i) => bestElite(archive, i));
  let next = archive;
  const migrations: Migration[] = [];
  bests.forEach((best, from) => {
    if (!best) return;
    const to = (from + 1) % islands;
    const result = insertElite(next, { ...best, island: to });
    next = result.archive;
    migrations.push({ from, to, candidateId: best.candidateId, accepted: result.accepted });
  });
  return { archive: next, migrations };
}
