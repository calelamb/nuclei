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
  if (!sparse && !narrow) {
    // Three or more decades label only whole decades; keep 2x and 5x in the closing partial decades.
    for (const e of [Math.floor(lo), Math.floor(hi)]) {
      for (const m of [2, 5]) {
        const value = m * 10 ** e;
        if (inside(value) && !extra.some((t) => t.value === value)) extra.push({ value, label: formatMultiplierTick(m, e), major: false });
      }
    }
  }
  const base = [...majorTicks, ...extra].sort((a, b) => a.value - b.value);
  const labeled = fillEndGaps(base, lo, hi);
  return { lo, hi, labeled, minors };
}

const END_GAP_FRACTION = 0.3;
const FINE_MANTISSAS = [1.2, 1.4, 1.6, 1.8];

/**
 * When the first or last label sits more than 30% of the axis from its end,
 * data there would have no label to read against; add the 1.2 .. 1.8
 * multiples of the decade so each 30% of the axis carries at least one label.
 */
function fillEndGaps(ticks: LogTick[], lo: number, hi: number): LogTick[] {
  const span = hi - lo;
  const logs = ticks.map((t) => Math.log10(t.value));
  const needsTail = logs.length === 0 || hi - Math.max(...logs) > END_GAP_FRACTION * span;
  const needsHead = logs.length === 0 || Math.min(...logs) - lo > END_GAP_FRACTION * span;
  if (!needsTail && !needsHead) return ticks;
  const fine: LogTick[] = [];
  for (let e = Math.floor(lo) - 1; e <= Math.ceil(hi); e++) {
    for (const m of FINE_MANTISSAS) {
      const value = m * 10 ** e;
      const log = Math.log10(value);
      if (log < lo - EPS || log > hi + EPS) continue;
      const tail = needsTail && log > Math.max(...logs, lo);
      const head = needsHead && log < Math.min(...logs, hi);
      if (tail || head) fine.push({ value, label: formatMultiplierTick(m, e), major: false });
    }
  }
  return [...ticks, ...fine].sort((a, b) => a.value - b.value);
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

const mantissaRank = (value: number): number => {
  const m = Math.round(value / 10 ** Math.floor(Math.log10(value) + 1e-9));
  return m === 1 ? 0 : m === 5 ? 1 : m === 2 ? 2 : 3 + m;
};

/**
 * Tick labels that fit without touching: whole decades first, then 5x, 2x and the other multiples,
 * each kept only if it clears every label already placed by `gap` pixels. Returned in axis order.
 */
export function visibleLabels<T extends { value: number; major: boolean }>(
  ticks: readonly T[], px: (value: number) => number, widthOf: (tick: T) => number, gap = 8,
): T[] {
  const byPriority = [...ticks].sort((a, b) => Number(b.major) - Number(a.major) || mantissaRank(a.value) - mantissaRank(b.value));
  const placed: Array<{ tick: T; lo: number; hi: number }> = [];
  for (const tick of byPriority) {
    const centre = px(tick.value);
    const half = widthOf(tick) / 2;
    const lo = centre - half - gap / 2;
    const hi = centre + half + gap / 2;
    if (placed.every((p) => hi <= p.lo || lo >= p.hi)) placed.push({ tick, lo, hi });
  }
  return placed.map((p) => p.tick).sort((a, b) => a.value - b.value);
}
