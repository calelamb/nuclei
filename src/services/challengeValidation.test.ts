import { describe, expect, it } from 'vitest';
import { validateValueTestCase } from './challengeValidation';
import type { TestCase } from '../types/challenge';

function makeCase(validation: TestCase['validation']): TestCase {
  return {
    id: 'value-case',
    label: 'Value Case',
    description: 'desc',
    params: {},
    validation,
    hidden: false,
    weight: 2,
  };
}

describe('challengeValidation value-return contracts', () => {
  it('passes exact nested JSON matches', () => {
    const result = validateValueTestCase(
      makeCase({
        type: 'value_match',
        expected: { kept_rounds: [0, 2], audit: { abort: false } },
      }),
      { kept_rounds: [0, 2], audit: { abort: false } },
      12,
    );

    expect(result).toEqual(expect.objectContaining({
      passed: true,
      score: 2,
      verdict: 'accepted',
    }));
  });

  it('respects numeric tolerance inside nested JSON', () => {
    const result = validateValueTestCase(
      makeCase({
        type: 'value_match',
        expected: { qber: 0.375, abort: true },
        tolerance: 0.001,
      }),
      { qber: 0.3754, abort: true },
      12,
    );

    expect(result.passed).toBe(true);
  });

  it('validates scalar and nested numeric outputs', () => {
    const scalar = validateValueTestCase(
      makeCase({ type: 'numeric_match', expected: 2.828, tolerance: 0.01 }),
      2.8279,
      12,
    );
    const nested = validateValueTestCase(
      makeCase({ type: 'numeric_match', expected: 0.25, tolerance: 0.001, path: 'sample.qber' }),
      { sample: { qber: 0.2505 } },
      12,
    );

    expect(scalar.passed).toBe(true);
    expect(nested.passed).toBe(true);
  });

  it('returns readable mismatch messages', () => {
    const result = validateValueTestCase(
      makeCase({
        type: 'value_match',
        expected: { disturbed_rounds: [1], error_rate: 0.5 },
        tolerance: 0.001,
      }),
      { disturbed_rounds: [2], error_rate: 0.25 },
      12,
    );

    expect(result.passed).toBe(false);
    expect(result.message).toContain('Value mismatch');
    expect(result.message).toContain('disturbed_rounds[0]');
    expect(result.message).toContain('error_rate');
  });
});
