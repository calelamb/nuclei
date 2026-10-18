import { paramValues, type RunRecord, type Sweep } from '../../types/experiment';

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
export function deriveColumns(runs: readonly RunRecord[], declaredParams: readonly string[] = []): RunColumn[] {
  const paramNames: string[] = [...declaredParams];
  const seenParams = new Set<string>(declaredParams);
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

const TEXT_FIELD_KEYS = new Set(['status', 'seed_honored']);

/** Whether a column's cells (and header) right-align as numbers. */
export function isNumericColumn(column: RunColumn): boolean {
  return column.kind !== 'field' || !TEXT_FIELD_KEYS.has(column.key);
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

const MAX_DECIMALS = 4;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RUN_DIR_PATTERN = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-([A-Za-z0-9]+)$/;

function decimalsOf(value: number): number {
  if (Number.isInteger(value)) return 0;
  const [, fraction = ''] = value.toFixed(MAX_DECIMALS).split('.');
  return fraction.replace(/0+$/, '').length;
}

/**
 * Decimals every cell of a numeric column should show: the most any row needs,
 * capped at 4, so a column reads 6.2 / 6.0 / 5.8 rather than 6.2000 / 6 / 5.8000.
 */
export function columnDecimals(runs: readonly RunRecord[], column: RunColumn): number {
  let decimals = 0;
  for (const run of runs) {
    const value = getRunValue(run, column);
    if (typeof value === 'number' && Number.isFinite(value)) decimals = Math.max(decimals, decimalsOf(value));
  }
  return decimals;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * "Oct 15 08:20:30 · a458" in local time, matching the sidebar and run detail.
 * Run dirs are named in UTC, so the clock time comes from `startedAt` (an ISO
 * instant) when valid; otherwise the dir's own timestamp is parsed as UTC and
 * converted. Shapes that aren't run dirs pass through.
 */
export function formatRunLabel(dir: string, startedAt?: string): string {
  const match = RUN_DIR_PATTERN.exec(dir);
  if (!match) return dir;
  const [, year, month, day, hh, mm, ss, suffix] = match;
  const fromManifest = startedAt ? new Date(startedAt) : null;
  const instant = fromManifest && !Number.isNaN(fromManifest.getTime())
    ? fromManifest
    : new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hh), Number(mm), Number(ss)));
  if (Number.isNaN(instant.getTime())) return dir;
  const monthName = MONTHS[instant.getMonth()];
  return `${monthName} ${instant.getDate()} ${pad2(instant.getHours())}:${pad2(instant.getMinutes())}:${pad2(instant.getSeconds())} · ${suffix}`;
}

/**
 * Decimals each metric needs across `runs` (same rule as the runs table), so
 * the table, run detail and Compare print one metric identically.
 */
export function metricDecimals(runs: readonly RunRecord[]): ReadonlyMap<string, number> {
  const names = new Set<string>();
  for (const run of runs) for (const name of Object.keys(run.metrics)) names.add(name);
  const map = new Map<string, number>();
  for (const name of names) map.set(name, columnDecimals(runs, { key: name, label: name, kind: 'metric' }));
  return map;
}

/** "counts_entropy" -> "Counts entropy": readable two-line headers instead of clipped snake_case. */
export function humanizeColumnLabel(label: string): string {
  if (!/[_-]/.test(label)) return label;
  const spaced = label.replace(/[_-]+/g, ' ').trim();
  return spaced.length === 0 ? label : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The one spelling of a metric name in every view: "counts_entropy" -> "Counts entropy", "energy" -> "Energy". */
export function metricLabel(name: string): string {
  const spaced = name.replace(/[_-]+/g, ' ').trim();
  return spaced.length === 0 ? name : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Header text for a runs-table column: metrics are sentence-cased, swept parameters stay the identifiers the script uses. */
export function columnDisplayLabel(column: RunColumn): string {
  return column.kind === 'metric' ? metricLabel(column.label) : column.label;
}

/** "depth × 4, theta × 11": how many values each swept parameter takes. Unreadable axes print "?". */
export function sweepAxesSummary(sweep: Sweep | undefined): string {
  return Object.entries(sweep ?? {})
    .map(([name, spec]) => {
      try {
        return `${name} × ${paramValues(spec, name).length}`;
      } catch {
        return `${name} × ?`;
      }
    })
    .join(', ');
}
