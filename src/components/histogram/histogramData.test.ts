import { describe, expect, it } from 'vitest';
import { getExecutedShotCount, getHistogramData, getMultiSeriesHistogramData, sampledProbabilities } from './histogramData';

const result = {
  state_vector: [],
  probabilities: { '00': 0.5, '11': 0.5 },
  measurements: { '00': 512, '11': 512 },
  bloch_coords: [],
  execution_time_ms: 1,
  shot_count: 1024,
};

describe('histogramData', () => {
  it('uses the executed shot count instead of mutable UI state', () => {
    expect(getExecutedShotCount(result)).toBe(1024);
    expect(getHistogramData(result, 'sampled')).toEqual([
      { state: '|00⟩', probability: 0.5 },
      { state: '|11⟩', probability: 0.5 },
    ]);
  });

  it('falls back to measurement totals when shot_count is unavailable', () => {
    expect(getExecutedShotCount({ ...result, shot_count: 0 })).toBe(1024);
  });
});

describe('getMultiSeriesHistogramData', () => {
  it('aligns 2+ series over the union of observed states, normalizing each independently', () => {
    const rows = getMultiSeriesHistogramData([
      { label: 'run-a', measurements: { '00': 90, '11': 10 } },
      { label: 'run-b', measurements: { '00': 50, '01': 50 } },
    ]);
    expect(rows).toEqual([
      { state: '|00⟩', 'run-a': 0.9, 'run-b': 0.5 },
      { state: '|01⟩', 'run-a': 0, 'run-b': 0.5 },
      { state: '|11⟩', 'run-a': 0.1, 'run-b': 0 },
    ]);
  });

  it('returns an empty array when no series have any measurements', () => {
    expect(getMultiSeriesHistogramData([{ label: 'empty', measurements: {} }])).toEqual([]);
  });

  it('returns an empty array for zero series', () => {
    expect(getMultiSeriesHistogramData([])).toEqual([]);
  });

  it('handles a single series the same way multi-series-with-one-entry would', () => {
    const rows = getMultiSeriesHistogramData([{ label: 'solo', measurements: { '0': 3, '1': 1 } }]);
    expect(rows).toEqual([
      { state: '|0⟩', solo: 0.75 },
      { state: '|1⟩', solo: 0.25 },
    ]);
  });
});

import { formatProbabilityTick, PROBABILITY_TICKS } from './histogramData';

describe('probability axis ticks', () => {
  it('labels every tick distinctly so quarter ticks are not rounded to tenths (research-10)', () => {
    const labels = PROBABILITY_TICKS.map(formatProbabilityTick);
    expect(labels).toEqual(['0', '0.25', '0.50', '0.75', '1']);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('sampledProbabilities', () => {
  const base = { state_vector: [], bloch_coords: [], execution_time_ms: 1 } as never;
  it('turns measured counts into probabilities over the executed shots', () => {
    const result = { ...base, probabilities: { '00': 0.5, '11': 0.5 }, measurements: { '00': 480, '11': 544 }, shot_count: 1024 };
    expect(sampledProbabilities(result)).toEqual({ '00': 480 / 1024, '11': 544 / 1024 });
  });
  it('falls back to the ideal distribution when nothing was measured', () => {
    const result = { ...base, probabilities: { '0': 1 }, measurements: {}, shot_count: 0 };
    expect(sampledProbabilities(result)).toEqual({ '0': 1 });
  });
});
