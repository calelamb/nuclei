import type { ThresholdSeries } from '../types/qecStats';
import type { ThemeMode } from '../styles/tokens';
import type { RateUnits } from './qecFit';
import { logAxis, type LogAxis } from './qecPlotTicks';
import { omissionNotes, partitionSeries, type PartitionedSeries } from './qecPlotPoints';
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
  xTitle: string;
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
  const yAxis = logAxis(drawn.flatMap((p) => [p.rate.p, p.rate.hi]), { pad: 0.25 });
  if (!xAxis || !yAxis) return null;
  const { byKey, legend } = buildPlotStyle(series, mode, neutral);
  return {
    parts, notes: omissionNotes(counts), xAxis, yAxis, style: byKey, legend, units,
    yTitle: units === 'per_round' ? 'logical error per round' : 'logical error per shot',
    xTitle: 'physical error rate p',
  };
}
