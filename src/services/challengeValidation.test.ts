import { describe, expect, it } from 'vitest';
import { validateTestCase, validateValueTestCase } from './challengeValidation';
import type { TestCase } from '../types/challenge';
import type { SimulationResult } from '../types/quantum';

function resultWithMetrics(metrics: Record<string, number>): SimulationResult {
  return {
    state_vector: [],
    probabilities: {},
    measurements: {},
    bloch_coords: [],
    execution_time_ms: 1,
    shot_count: 0,
    metrics,
  };
}

function fidelityCase(min?: number, expectedProbabilities?: Record<string, number>): TestCase {
  return {
    id: 'fid',
    label: 'Fidelity Case',
    description: 'desc',
    params: {},
    validation: {
      type: 'state_fidelity',
      ...(min === undefined ? {} : { min_fidelity: min }),
      ...(expectedProbabilities ? { expected_probabilities: expectedProbabilities } : {}),
    },
    hidden: false,
    weight: 1,
  };
}

describe('challengeValidation state_fidelity', () => {
  it('passes when recorded fidelity meets the default threshold', () => {
    const r = validateTestCase(fidelityCase(), resultWithMetrics({ fidelity: 0.9999 }), 5);
    expect(r.passed).toBe(true);
    expect(r.verdict).toBe('accepted');
    expect(r.score).toBeCloseTo(0.9999, 4);
  });

  it('fails a spoof-level fidelity without claiming the counts match when the target counts are unknown', () => {
    const r = validateTestCase(fidelityCase(), resultWithMetrics({ fidelity: 0.5 }), 5);
    expect(r.passed).toBe(false);
    expect(r.verdict).toBe('wrong_answer');
    expect(r.message).toContain('prepares a different state');
    expect(r.message).not.toMatch(/counts/i);
  });

  describe('counts vs state (learn-r10-01)', () => {
    const BELL = { '00': 0.5, '11': 0.5 };
    const withProbabilities = (probabilities: Record<string, number>, fidelity: number): SimulationResult => ({
      ...resultWithMetrics({ fidelity }),
      probabilities,
    });

    it('says the counts match only when they do (Phi- written as Phi+: same counts, wrong phase)', () => {
      const r = validateTestCase(fidelityCase(undefined, BELL), withProbabilities(BELL, 0), 5);
      expect(r.passed).toBe(false);
      expect(r.message).toContain('Your measurement counts match the target, but the prepared state differs');
      expect(r.message).toContain('Relative phase and entanglement are graded too');
    });

    it('says the state differs when the counts do not match either (the Uniform Superposition starter)', () => {
      const r = validateTestCase(fidelityCase(undefined, BELL), withProbabilities({ '00': 1 }, 0.5), 5);
      expect(r.passed).toBe(false);
      expect(r.message).toContain('Your circuit prepares a different state');
      expect(r.message).not.toMatch(/counts match/i);
    });

    it('leaves an accepted case alone', () => {
      const r = validateTestCase(fidelityCase(undefined, BELL), withProbabilities(BELL, 1), 5);
      expect(r.passed).toBe(true);
      expect(r.message).not.toMatch(/differs/);
    });
  });

  it('states the overlap and the threshold instead of claiming the histogram looks right (learn-r9-08)', () => {
    const r = validateTestCase(fidelityCase(), resultWithMetrics({ fidelity: 0.25 }), 5);
    expect(r.message).toContain('25% overlap with the target');
    expect(r.message).toContain('99% needed');
    expect(r.message).not.toMatch(/may look right/i);
    const near = validateTestCase(fidelityCase(), resultWithMetrics({ fidelity: 0.9895 }), 5);
    expect(near.message).toContain('98.9% overlap');
  });

  it('does not floor floating-point noise below the true value (0.2499999999999999 reads 25%)', () => {
    const r = validateTestCase(fidelityCase(), resultWithMetrics({ fidelity: 0.2499999999999999 }), 5);
    expect(r.message).toContain('25% overlap');
    const half = validateTestCase(fidelityCase(), resultWithMetrics({ fidelity: 0.4999999999999999 }), 5);
    expect(half.message).toContain('50% overlap');
  });

  it('respects a custom min_fidelity', () => {
    expect(validateTestCase(fidelityCase(0.8), resultWithMetrics({ fidelity: 0.85 }), 5).passed).toBe(true);
    expect(validateTestCase(fidelityCase(0.9), resultWithMetrics({ fidelity: 0.85 }), 5).passed).toBe(false);
  });

  it('fails cleanly when no fidelity was recorded (e.g. no desktop kernel)', () => {
    const r = validateTestCase(fidelityCase(), resultWithMetrics({}), 5);
    expect(r.passed).toBe(false);
    expect(r.message).toContain('desktop');
  });
});

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

    // score is the raw per-test fraction (0..1); weight is applied only when
    // aggregating the submission total, so a passing case is 1 regardless of
    // its weight (2 here).
    expect(result).toEqual(expect.objectContaining({
      passed: true,
      score: 1,
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
