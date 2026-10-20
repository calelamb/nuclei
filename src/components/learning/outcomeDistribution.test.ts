import { describe, it, expect } from 'vitest';
import { sampledProbabilities, formatCircuitMeta } from './outcomeDistribution';

describe('sampledProbabilities', () => {
  it('turns measurement counts into observed frequencies', () => {
    expect(sampledProbabilities({ measurements: { '0': 520, '1': 504 }, shot_count: 1024 })).toEqual({
      '0': 520 / 1024,
      '1': 504 / 1024,
    });
  });
  it('returns null when the run took no shots', () => {
    expect(sampledProbabilities({ measurements: {}, shot_count: 0 })).toBeNull();
  });
});

describe('formatCircuitMeta', () => {
  it('matches the rail wording', () => {
    expect(formatCircuitMeta(1, 1)).toBe('1 qubit · depth 1');
    expect(formatCircuitMeta(2, 3)).toBe('2 qubits · depth 3');
  });
});
