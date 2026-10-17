/** Axis scaling and outcome capping for the probability histogram. */

export interface HistogramRow {
  state: string;
  probability: number;
}

export const MAX_VISIBLE_OUTCOMES = 16;

/** Candidate axis maxima, smallest first: the first one that leaves headroom wins. */
const AXIS_MAXIMA = [0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.6, 0.8, 1];
const HEADROOM = 1.12;

export interface ProbabilityAxis {
  max: number;
  ticks: number[];
}

function niceStep(max: number): number {
  const target = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  for (const multiple of [1, 2, 2.5, 5, 10]) {
    if (multiple * magnitude >= target) return multiple * magnitude;
  }
  return 10 * magnitude;
}

/** A y axis that fits the tallest bar, with 4-6 whole-percent ticks. */
export function probabilityAxis(maxProbability: number): ProbabilityAxis {
  const wanted = Math.max(0, maxProbability) * HEADROOM;
  const max = AXIS_MAXIMA.find((m) => m >= wanted) ?? 1;
  const step = niceStep(max);
  const ticks: number[] = [];
  for (let i = 0; i * step <= max + 1e-9; i += 1) ticks.push(Number((i * step).toFixed(6)));
  return { max, ticks };
}

export function formatPercentTick(value: number): string {
  const percent = value * 100;
  if (percent === 0) return '0%';
  return Number.isInteger(Number(percent.toFixed(6))) ? `${Math.round(percent)}%` : `${Number(percent.toFixed(2))}%`;
}

export interface TopOutcomes {
  shown: HistogramRow[];
  hiddenCount: number;
  hiddenProbability: number;
}

/** The `limit` most likely outcomes (shown in basis order), plus what was left out. */
export function topOutcomes(rows: readonly HistogramRow[], limit: number = MAX_VISIBLE_OUTCOMES): TopOutcomes {
  if (rows.length <= limit) {
    return { shown: [...rows].sort((a, b) => a.state.localeCompare(b.state)), hiddenCount: 0, hiddenProbability: 0 };
  }
  const ranked = [...rows].sort((a, b) => b.probability - a.probability || a.state.localeCompare(b.state));
  const kept = ranked.slice(0, limit);
  const dropped = ranked.slice(limit);
  return {
    shown: kept.sort((a, b) => a.state.localeCompare(b.state)),
    hiddenCount: dropped.length,
    hiddenProbability: dropped.reduce((sum, r) => sum + r.probability, 0),
  };
}
