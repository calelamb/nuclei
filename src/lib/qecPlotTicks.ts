import { formatMultiplierTick, formatPow10 } from './qecPlotFormat';

export interface LogTick {
  value: number;
  label: string;
  major: boolean;
}

export interface LogAxis {
  /** Domain in log10 units. */
  lo: number;
  hi: number;
  labeled: LogTick[];
  /** Unlabeled minor tick values (2..9 x 10^n) inside the domain. */
  minors: number[];
}

const DEFAULT_PAD = 0.05;
const MIN_SPAN = 0.3;
const MAX_LABELED_DECADES = 8;
const EPS = 1e-9;
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function paddedDomain(values: number[], pad: number): { lo: number; hi: number } {
  const logs = values.map(Math.log10);
  let lo = Math.min(...logs);
  let hi = Math.max(...logs);
  if (hi - lo < MIN_SPAN) {
    const mid = (lo + hi) / 2;
    lo = mid - MIN_SPAN / 2;
    hi = mid + MIN_SPAN / 2;
  }
  return { lo: lo - pad, hi: hi + pad };
}

function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const stride = Math.ceil(items.length / max);
  return items.filter((_, i) => i % stride === 0);
}

/**
 * Log-axis domain and ticks for a set of positive values; with fewer than three decades in view the 2 and 5 multiples are labelled too, and under one decade every 2-9 multiple is. Non-positive and
 * non-finite values are ignored (they cannot be placed on a log axis).
 */
export function logAxis(values: readonly number[], opts: { pad?: number } = {}): LogAxis | null {
  const positive = values.filter((v) => Number.isFinite(v) && v > 0);
  if (positive.length === 0) return null;
  const { lo, hi } = paddedDomain(positive, opts.pad ?? DEFAULT_PAD);
  const decades = range(Math.ceil(lo - EPS), Math.floor(hi + EPS));
  const inside = (v: number) => Math.log10(v) >= lo - EPS && Math.log10(v) <= hi + EPS;
  const sparse = decades.length < 3;
  const narrow = hi - lo < 1;
  const majorTicks: LogTick[] = thin(decades, MAX_LABELED_DECADES).map((e) => ({
    value: 10 ** e, label: formatPow10(e), major: true,
  }));
  const extra: LogTick[] = [];
  const minors: number[] = [];
  for (let e = Math.floor(lo) - 1; e <= Math.ceil(hi); e++) {
    for (let m = 2; m <= 9; m++) {
      const value = m * 10 ** e;
      if (!inside(value)) continue;
      if (narrow || (sparse && (m === 2 || m === 5))) extra.push({ value, label: formatMultiplierTick(m, e), major: false });
      else minors.push(value);
    }
  }
  const labeled = [...majorTicks, ...extra].sort((a, b) => a.value - b.value);
  return { lo, hi, labeled, minors };
}

/** Linear map from a log10 domain to a pixel range; non-positive input clamps to the range start. */
export function makeLogScale(
  domain: { lo: number; hi: number }, r0: number, r1: number,
): (value: number) => number {
  const span = domain.hi - domain.lo || 1;
  return (value) => {
    if (!(value > 0) || !Number.isFinite(value)) return r0;
    return r0 + ((Math.log10(value) - domain.lo) / span) * (r1 - r0);
  };
}
