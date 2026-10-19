import type { HistogramSeriesInput } from './histogramData';

export function hasMeasurements(s: HistogramSeriesInput): boolean {
  return Object.values(s.measurements).some((count) => count > 0);
}

/** Tooltip rows follow legend (series) order, not Recharts' reversed bar order. */
export function tooltipOrder(series: readonly HistogramSeriesInput[], dataKey: unknown): number {
  const index = series.findIndex((s) => s.label === dataKey);
  return index === -1 ? series.length : index;
}
