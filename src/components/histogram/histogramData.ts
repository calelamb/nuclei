import type { SimulationResult } from '../../types/quantum';

export type HistogramViewMode = 'ideal' | 'sampled';

export function getExecutedShotCount(result: SimulationResult): number {
  if (result.shot_count > 0) return result.shot_count;
  return Object.values(result.measurements).reduce((sum, count) => sum + count, 0);
}

/** Histogram rows straight from a probability map — used by the Quantum
 * Debugger, whose per-step payload carries probabilities but no sampled
 * measurements (so only the ideal distribution is meaningful per step). */
export function getProbabilityHistogramData(probabilities: Record<string, number>) {
  return Object.entries(probabilities)
    .map(([state, probability]) => ({ state: `|${state}⟩`, probability }))
    .sort((a, b) => a.state.localeCompare(b.state));
}

export function getHistogramData(result: SimulationResult, viewMode: HistogramViewMode) {
  if (viewMode === 'ideal') {
    return Object.entries(result.probabilities)
      .map(([state, probability]) => ({ state: `|${state}⟩`, probability }))
      .sort((a, b) => a.state.localeCompare(b.state));
  }

  const executedShots = getExecutedShotCount(result);
  return Object.entries(result.measurements)
    .map(([state, count]) => ({
      state: `|${state}⟩`,
      probability: executedShots > 0 ? count / executedShots : 0,
    }))
    .sort((a, b) => a.state.localeCompare(b.state));
}

// ---------------------------------------------------------------------------
// PRD 09 Phase E (E1) — multi-series histogram data (additive).
//
// `getHistogramData` above stays exactly as-is for the existing
// single-result callers (`ProbabilityHistogram`, `RunHistogram`). This adds
// a second, independent pure transform for the Compare view: 2+ labelled
// runs' measurement counts, each normalized to probabilities within its own
// run, aligned over the UNION of observed states so every series' bar
// appears at the same x position (missing states render as 0 for that
// series rather than shifting the axis).
// ---------------------------------------------------------------------------

export interface HistogramSeriesInput {
  /** Unique label for this series — becomes both the legend entry and the
   * recharts `dataKey` for its bar. */
  label: string;
  measurements: Record<string, number>;
}

export interface MultiSeriesHistogramRow {
  state: string;
  [seriesLabel: string]: string | number;
}

export function getMultiSeriesHistogramData(
  series: readonly HistogramSeriesInput[],
): MultiSeriesHistogramRow[] {
  const stateSet = new Set<string>();
  const totals = series.map((s) => Object.values(s.measurements).reduce((a, b) => a + b, 0));
  for (const s of series) {
    for (const state of Object.keys(s.measurements)) stateSet.add(state);
  }

  return [...stateSet].sort().map((state) => {
    const row: MultiSeriesHistogramRow = { state: `|${state}⟩` };
    series.forEach((s, i) => {
      const total = totals[i];
      row[s.label] = total > 0 ? (s.measurements[state] ?? 0) / total : 0;
    });
    return row;
  });
}
