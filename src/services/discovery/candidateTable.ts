/** Sorting and filtering for the Candidates tab (pure). */

import type { CandidateMutator, CandidateRecord } from '../../types/discovery';
import { candidateFitness, candidateKind, numericId, type CandidateKind } from './candidateView';

export type SortKey = 'id' | 'island' | 'generation' | 'mutator' | 'status' | 'fitness' | 'objective';
export type SortDir = 'asc' | 'desc';

export interface CandidateFilter {
  status: CandidateKind | 'all';
  mutator: CandidateMutator | 'all';
  /** Island index as a string, or `all`. */
  island: string;
  query: string;
}

export const DEFAULT_FILTER: CandidateFilter = { status: 'all', mutator: 'all', island: 'all', query: '' };

export function filterCandidates(list: readonly CandidateRecord[], filter: CandidateFilter): CandidateRecord[] {
  const q = filter.query.trim().toLowerCase();
  return list.filter((c) => {
    if (filter.status !== 'all' && candidateKind(c) !== filter.status) return false;
    if (filter.mutator !== 'all' && c.mutator !== filter.mutator) return false;
    if (filter.island !== 'all' && String(c.island) !== filter.island) return false;
    if (q && !c.id.toLowerCase().includes(q) && !(c.parent_id ?? '').toLowerCase().includes(q)) return false;
    return true;
  });
}

function sortValue(c: CandidateRecord, key: SortKey, objectiveKey: string | null): number | string | null {
  switch (key) {
    case 'id': return numericId(c.id);
    case 'island': return c.island;
    case 'generation': return c.generation;
    case 'mutator': return c.mutator;
    case 'status': return candidateKind(c);
    case 'fitness': return candidateFitness(c);
    case 'objective': {
      const v = objectiveKey ? c.evaluation?.objectives[objectiveKey]?.value : undefined;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
  }
}

/** Stable sort; empty values always sink to the bottom, whatever the direction. */
export function sortCandidates(
  list: readonly CandidateRecord[],
  key: SortKey,
  dir: SortDir,
  objectiveKey: string | null = null,
): CandidateRecord[] {
  const sign = dir === 'asc' ? 1 : -1;
  return list
    .map((c, i) => ({ c, i, v: sortValue(c, key, objectiveKey) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const cmp = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v));
      return cmp !== 0 ? cmp * sign : a.i - b.i;
    })
    .map((x) => x.c);
}
