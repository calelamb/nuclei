import { describe, it, expect } from 'vitest';
import { estimateLambda } from './qecFit';
import { lambdaSummary, lambdaCaveats } from './qecLambdaText';
import type { LambdaGroupEstimate } from './qecFit';

const mk = (rates: number[]) => rates.map((rate, i) => ({ distance: 3 + 2 * i, errors: 50, rate }));

describe('lambdaSummary', () => {
  it('prints the 95% interval with r² and dof', () => {
    const s = lambdaSummary(estimateLambda(mk([0.1, 0.027, 0.0058, 0.0016]))!);
    expect(s.text).toMatch(/Λ = [\d.]+ \([\d.]+ to [\d.]+, 95% t; /);
    expect(s.text).toMatch(/r² \d\.\d\d, 2 dof/);
    expect(s.text).not.toMatch(/1σ/);
  });
  it('never prints a zero-width interval for saturated rates', () => {
    const s = lambdaSummary(estimateLambda(mk([0.5, 0.5, 0.5, 0.5001]))!);
    expect(s.text).toMatch(/interval not meaningful/);
    expect(s.text).not.toMatch(/ to /);
    expect(s.warnings.join(' ')).toMatch(/saturated/);
  });
  it('surfaces no-suppression warnings', () => {
    const s = lambdaSummary(estimateLambda(mk([0.010, 0.011, 0.0105, 0.0112]))!);
    expect(s.warnings.join(' ')).toMatch(/do not decrease/);
  });
});

describe('lambdaCaveats', () => {
  const group = (over: Partial<LambdaGroupEstimate>): LambdaGroupEstimate => ({
    decoder: 'pymatching', label: 'exp', experiment: 'exp', noise: 0.001, units: 'per_round',
    estimate: estimateLambda(mk([0.1, 0.027, 0.0058, 0.0016]))!,
    collidingDistances: [], roundsVaryWithD: false, ...over,
  });
  it('is empty for a clean group', () => {
    expect(lambdaCaveats(group({}))).toEqual([]);
  });
  it('flags several experiments sharing a distance', () => {
    expect(lambdaCaveats(group({ collidingDistances: [3, 5] }))).toEqual([
      'distinct tasks collide at d 3,5, fitted as replicates',
    ]);
  });
  it('flags rounds varying with d only for per-shot Λ', () => {
    expect(lambdaCaveats(group({ roundsVaryWithD: true, units: 'per_shot' }))).toEqual([
      'rounds vary with d, confounding this per-shot Λ',
    ]);
    expect(lambdaCaveats(group({ roundsVaryWithD: true, units: 'per_round' }))).toEqual([]);
  });
  it('lists both together', () => {
    expect(lambdaCaveats(group({ collidingDistances: [3], roundsVaryWithD: true, units: 'per_shot' }))).toHaveLength(2);
  });
});
