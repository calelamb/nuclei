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

/** Local date-time plus relative age, e.g. "Oct 15, 2:18 PM (3 d ago)". Raw string if unparsable. */
export function formatStartedAt(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const local = date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const relative = formatRelative(date, now);
  return relative ? `${local} (${relative})` : local;
}

/** Turns a record of values into `key = value` chip labels. */
export function toChips(record: Record<string, unknown>, numberFormat: (n: number) => string = String): string[] {
  return Object.entries(record).map(([key, value]) =>
    `${key} = ${typeof value === 'number' ? numberFormat(value) : String(value)}`);
}
