import { describe, expect, it } from 'vitest';
import { scoreLabel } from './scoreLabel';
import type { TestCase } from '../../types/challenge';

const base = { id: 'c', label: 'C', description: '', params: {}, hidden: false, weight: 1 };

describe('scoreLabel (learn-r10-01)', () => {
  it('calls a graded state "fidelity"', () => {
    const testCase: TestCase = { ...base, validation: { type: 'state_fidelity' } };
    expect(scoreLabel(testCase, 0)).toBe('fidelity 0%');
    expect(scoreLabel(testCase, 0.9876)).toBe('fidelity 99%');
  });

  it('calls graded counts and values "match"', () => {
    const probabilities: TestCase = { ...base, validation: { type: 'probability_match', expected: { '0': 1 }, tolerance: 0.1 } };
    const values: TestCase = { ...base, validation: { type: 'value_match', expected: 1 } };
    expect(scoreLabel(probabilities, 1)).toBe('match 100%');
    expect(scoreLabel(values, 0.5)).toBe('match 50%');
  });
});
