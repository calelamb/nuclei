import type { RunRecord } from '../../types/experiment';

/**
 * PRD 09 Phase D (D2) — pure column derivation + sort/filter logic for
 * `RunsTable`. Kept free of React so it's trivially unit-testable and so
 * `RunsTable` itself stays a thin render layer.
 */

export type RunColumnKind = 'param' | 'field' | 'metric';

export interface RunColumn {
  key: string;
  label: string;
  kind: RunColumnKind;
}

const FIELD_COLUMNS: RunColumn[] = [
  { key: 'status', label: 'Status', kind: 'field' },
  { key: 'duration_ms', label: 'Duration (ms)', kind: 'field' },
  { key: 'seed', label: 'Seed', kind: 'field' },
  { key: 'seed_honored', label: 'Seed honored', kind: 'field' },
];

/**
 * Derive the full column set from the runs currently known for an
 * experiment: swept-param columns (union across runs, first-seen order),
 * the fixed manifest fields, then metric columns (union, alphabetical so
 * newly-appearing user metrics don't jump around the header).
 */
export function deriveColumns(runs: readonly RunRecord[]): RunColumn[] {
  const paramNames: string[] = [];
  const seenParams = new Set<string>();
  const metricNames = new Set<string>();

  for (const run of runs) {
    for (const name of Object.keys(run.manifest.params)) {
      if (!seenParams.has(name)) {
        seenParams.add(name);
        paramNames.push(name);
      }
    }
    for (const name of Object.keys(run.metrics)) metricNames.add(name);
  }

  const paramColumns: RunColumn[] = paramNames.map((name) => ({
    key: name,
    label: name,
    kind: 'param',
  }));
  const metricColumns: RunColumn[] = [...metricNames].sort().map((name) => ({
    key: name,
    label: name,
    kind: 'metric',
  }));

  return [...paramColumns, ...FIELD_COLUMNS, ...metricColumns];
}

/** Resolve a single run's value for a column, for both display and sorting. */
export function getRunValue(run: RunRecord, column: RunColumn): number | string | boolean | null {
  if (column.kind === 'param') return run.manifest.params[column.key] ?? null;
  if (column.kind === 'metric') return run.metrics[column.key] ?? null;
  switch (column.key) {
    case 'status':
      return run.manifest.status;
    case 'duration_ms':
      return run.manifest.duration_ms;
    case 'seed':
      return run.manifest.seed;
    case 'seed_honored':
      return run.manifest.seed_honored;
    default:
      return null;
  }
}

export type SortDirection = 'asc' | 'desc';

function compareValues(a: number | string | boolean | null, b: number | string | boolean | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

/** Stable sort (never mutates the input array). */
export function sortRuns(
  runs: readonly RunRecord[],
  column: RunColumn,
  direction: SortDirection,
): RunRecord[] {
  const withIndex = runs.map((run, index) => ({ run, index }));
  withIndex.sort((a, b) => {
    const cmp = compareValues(getRunValue(a.run, column), getRunValue(b.run, column));
    if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
    return a.index - b.index; // stable tiebreaker
  });
  return withIndex.map((w) => w.run);
}

export function filterByStatus(
  runs: readonly RunRecord[],
  status: RunRecord['manifest']['status'] | 'all',
): RunRecord[] {
  if (status === 'all') return [...runs];
  return runs.filter((run) => run.manifest.status === status);
}
