import type { ThresholdSeries } from '../types/qecStats';
import type { ThemeMode } from '../styles/tokens';
import type { RateUnits } from './qecFit';
import { logAxis, type LogAxis } from './qecPlotTicks';
import { omissionNotes, partitionSeries, type PartitionedSeries, type SeriesPoint } from './qecPlotPoints';
import { buildPlotStyle, type LegendGroup, type SeriesStyle } from './qecPlotStyle';

export interface PlotModel {
  parts: PartitionedSeries[];
  notes: string[];
  xAxis: LogAxis;
  yAxis: LogAxis;
  style: Map<string, SeriesStyle>;
  legend: LegendGroup[];
  units: RateUnits;
  yTitle: string;
  /** Compact y title for plots too short for the full one. */
  yTitleShort: string;
  xTitle: string;
}

/** Lower whiskers may reach at most this many decades below the smallest drawn rate. */
export const MAX_WHISKER_DECADES = 1.5;

/** Values that set the y-domain: rates, upper bounds and (floored) positive lower bounds. */
function yDomainValues(drawn: readonly SeriesPoint[]): number[] {
  const rates = drawn.map((p) => p.rate.p).filter((v) => v > 0 && Number.isFinite(v));
  const minRate = rates.length > 0 ? Math.min(...rates) : 0;
  const floor = minRate * 10 ** -MAX_WHISKER_DECADES;
  const lows = drawn.map((p) => p.rate.lo).filter((v) => v > 0 && Number.isFinite(v)).map((v) => Math.max(v, floor));
  return [...drawn.flatMap((p) => [p.rate.p, p.rate.hi]), ...lows];
}

/**
 * Where a lower whisker ends. A bound that is non-positive or below the axis
 * is clamped to the axis bottom and flagged open (no cap), so the clip edge
 * never masquerades as the interval end.
 */
export function whiskerLow(lo: number, axis: { lo: number }): { value: number; open: boolean } {
  const bottom = 10 ** axis.lo;
  return lo > 0 && lo >= bottom ? { value: lo, open: false } : { value: bottom, open: true };
}

/**
 * Everything the figure needs that does not depend on pixels: which points are
 * drawn, the log axes (from positive, finite values only), and styling.
 * Null when no point can be placed on log-log axes.
 */
export function buildPlotModel(
  series: readonly ThresholdSeries[], mode: ThemeMode, neutral: string, units: RateUnits,
): PlotModel | null {
  const { series: parts, counts } = partitionSeries(series);
  const drawn = parts.flatMap((s) => [...s.normal, ...s.upper]);
  if (drawn.length === 0) return null;
  const xAxis = logAxis(drawn.map((p) => p.noise));
  const yAxis = logAxis(yDomainValues(drawn), { pad: 0.25 });
  if (!xAxis || !yAxis) return null;
  const { byKey, legend } = buildPlotStyle(series, mode, neutral);
  return {
    parts, notes: omissionNotes(counts), xAxis, yAxis, style: byKey, legend, units,
    yTitle: units === 'per_round' ? 'logical error per round' : 'logical error per shot',
    yTitleShort: units === 'per_round' ? 'LER / round' : 'LER / shot',
    xTitle: 'physical error rate p',
  };
}
