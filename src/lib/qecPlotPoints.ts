import type { Rate, ThresholdSeries } from '../types/qecStats';
import type { RateUnits } from './qecFit';
import { formatSci } from './qecPlotFormat';

export type SeriesPoint = ThresholdSeries['points'][number];
export type PointKind = 'normal' | 'upper' | 'skip-noise' | 'skip-rate';

/**
 * How a point can be placed on log-log axes. p <= 0 has no position at all;
 * a zero-error point is plotted at its interval upper bound (an honest upper
 * limit) rather than at an invented value; a zero rate with a zero upper bound
 * cannot be placed.
 */
export function classifyPoint(p: SeriesPoint): PointKind {
  if (!Number.isFinite(p.noise) || p.noise <= 0) return 'skip-noise';
  if (p.rate.p > 0 && Number.isFinite(p.rate.p)) return 'normal';
  return p.rate.hi > 0 && Number.isFinite(p.rate.hi) ? 'upper' : 'skip-rate';
}

export interface PartitionedSeries {
  source: ThresholdSeries;
  normal: SeriesPoint[];
  upper: SeriesPoint[];
}

export interface OmissionCounts {
  skipNoise: number;
  skipRate: number;
  upper: number;
  /** True when every skipped-noise point has exactly p = 0. */
  noiseAllZero: boolean;
}

export function partitionSeries(all: readonly ThresholdSeries[]): { series: PartitionedSeries[]; counts: OmissionCounts } {
  let skipNoise = 0;
  let skipRate = 0;
  let upper = 0;
  let noiseAllZero = true;
  const series = all.map((source) => {
    const normal: SeriesPoint[] = [];
    const up: SeriesPoint[] = [];
    for (const p of source.points) {
      const kind = classifyPoint(p);
      if (kind === 'normal') normal.push(p);
      else if (kind === 'upper') { up.push(p); upper += 1; }
      else if (kind === 'skip-noise') { skipNoise += 1; if (p.noise !== 0) noiseAllZero = false; }
      else skipRate += 1;
    }
    return { source, normal, upper: up };
  });
  return { series, counts: { skipNoise, skipRate, upper, noiseAllZero } };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function omissionNotes(c: OmissionCounts): string[] {
  const notes: string[] = [];
  if (c.skipNoise > 0) {
    notes.push(`${plural(c.skipNoise, 'point', 'points')} not drawn: p ${c.noiseAllZero ? '=' : '≤'} 0 on a log axis`);
  }
  if (c.skipRate > 0) {
    notes.push(`${plural(c.skipRate, 'point', 'points')} not drawn: rate and upper bound are both 0`);
  }
  if (c.upper > 0) {
    notes.push(`${plural(c.upper, 'zero-error point', 'zero-error points')} drawn at ${c.upper === 1 ? 'its' : 'their'} upper bound (hollow ▽)`);
  }
  return notes;
}

export interface HitTarget { id: string; x: number; y: number }

export function nearestPoint<T extends HitTarget>(targets: readonly T[], px: number, py: number, radius: number): T | null {
  let best: T | null = null;
  let bestD2 = radius * radius;
  for (const t of targets) {
    const d2 = (t.x - px) ** 2 + (t.y - py) ** 2;
    if (d2 <= bestD2) { best = t; bestD2 = d2; }
  }
  return best;
}

const formatNoise = (x: number) => (x >= 0.001 ? String(Number(x.toPrecision(4))) : formatSci(x));
const intl = (n: number) => n.toLocaleString('en-US');

export function tooltipLines(
  s: Pick<ThresholdSeries, 'distance' | 'decoder' | 'label'>, p: SeriesPoint, units: RateUnits,
): string[] {
  const rate: Rate = p.rate;
  const unitText = units === 'per_round' ? 'per round' : 'per shot';
  const zero = p.rate.p === 0;
  const lines = [
    `d = ${s.distance ?? '?'} · p = ${formatNoise(p.noise)} · ${s.decoder}`,
    zero ? `rate ${unitText}: 0 observed (upper bound ${formatSci(rate.hi)})` : `rate ${unitText}: ${formatSci(rate.p)}`,
    `interval: ${formatSci(rate.lo)} to ${formatSci(rate.hi)}`,
  ];
  if (p.errors !== undefined && p.kept !== undefined) {
    lines.push(`${intl(p.errors)} ${p.errors === 1 ? 'error' : 'errors'} in ${intl(p.kept)} kept shots${zero ? ' (0 errors: upper bound)' : ''}`);
  }
  return lines;
}
