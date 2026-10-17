/** Pure formatters for the run detail manifest (kept out of the component). */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 4 significant figures, no trailing zeros: -0.15368363905066929 -> "-0.1537". */
export function formatSignificant(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return String(Number(value.toPrecision(4)));
}

/** "3 min ago", "2 h ago", "5 d ago"; falls back to "" for the future / invalid input. */
export function formatRelative(then: Date, now: Date): string {
  const delta = now.getTime() - then.getTime();
  if (Number.isNaN(delta) || delta < 0) return '';
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} min ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)} h ago`;
  return `${Math.floor(delta / DAY)} d ago`;
}

/** Local 24-hour date-time, e.g. "Oct 15, 14:18:30". Raw string if unparsable. */
export function formatLocalDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // 24-hour, matching the run labels in the runs table and Compare headers.
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
}

/** Local date-time plus relative age, e.g. "Oct 15, 14:18:30 (3 d ago)". Raw string if unparsable. */
export function formatStartedAt(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const local = formatLocalDateTime(iso);
  const relative = formatRelative(date, now);
  return relative ? `${local} (${relative})` : local;
}

/** Turns a record of values into `key = value` chip labels. */
export function toChips(record: Record<string, unknown>, numberFormat: (n: number) => string = String): string[] {
  return Object.entries(record).map(([key, value]) =>
    `${key} = ${typeof value === 'number' ? numberFormat(value) : String(value)}`);
}

/** Sidebar "last run": relative age with the full local time for a tooltip; "never run" without runs. */
export function describeLastRun(
  iso: string | undefined,
  now: Date = new Date(),
): { label: string; title: string; summary: string } {
  if (!iso) return { label: 'never run', title: 'No runs yet', summary: 'not run yet' };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { label: iso, title: iso, summary: `last run ${iso}` };
  const label = formatRelative(date, now) || formatLocalDateTime(iso);
  return { label, title: formatLocalDateTime(iso), summary: `last run ${label}` };
}

/** Metric chips printed with the same per-metric decimals the runs table uses. */
export function toMetricChips(metrics: Record<string, number>, decimals: ReadonlyMap<string, number>): string[] {
  return Object.entries(metrics).map(([name, value]) => `${name} = ${value.toFixed(decimals.get(name) ?? 4)}`);
}
