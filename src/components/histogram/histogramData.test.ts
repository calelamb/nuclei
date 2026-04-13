import { describe, expect, it } from 'vitest';
import { getExecutedShotCount, getHistogramData } from './histogramData';

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
