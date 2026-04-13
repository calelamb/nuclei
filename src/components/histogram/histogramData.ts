import type { SimulationResult } from '../../types/quantum';

export type HistogramViewMode = 'ideal' | 'sampled';

export function getExecutedShotCount(result: SimulationResult): number {
  if (result.shot_count > 0) return result.shot_count;
  return Object.values(result.measurements).reduce((sum, count) => sum + count, 0);
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
