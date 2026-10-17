import { describe, it, expect } from 'vitest';
import { estimateLambda, type LambdaGroupEstimate } from './qecFit';
import { lambdaLine, figureFooterLines } from './qecFigureText';

const est = estimateLambda([3, 5, 7].map((d, i) => ({ distance: d, errors: 50, rate: [0.1, 0.027, 0.0058][i] })))!;
const group = (over: Partial<LambdaGroupEstimate> = {}): LambdaGroupEstimate => ({
  decoder: 'mwpm', label: 'exp', experiment: 'exp', noise: 0.001, units: 'per_round', estimate: est,
  collidingDistances: [], roundsVaryWithD: false, ...over,
});

describe('lambdaLine', () => {
  it('states decoder, experiment, p, interval, distances and units', () => {
    const line = lambdaLine(group());
    expect(line).toMatch(/^mwpm exp p=0.001: Λ = .* to .*, d 3,5,7, per round$/);
  });
  it('includes colliding-distance and rounds-vary caveats', () => {
    const line = lambdaLine(group({ units: 'per_shot', collidingDistances: [5], roundsVaryWithD: true }));
    expect(line).toContain('distinct tasks collide at d 5, fitted as replicates');
    expect(line).toContain('rounds vary with d, confounding this per-shot Λ');
  });
});

describe('figureFooterLines', () => {
  it('always states the whisker convention and adds Λ lines only when estimated', () => {
    expect(figureFooterLines([])).toHaveLength(1);
    expect(figureFooterLines([])[0]).toMatch(/Whiskers: sinter likelihood ratio/);
    const withLambda = figureFooterLines([group()]);
    expect(withLambda).toHaveLength(3);
    expect(withLambda[1]).toMatch(/^Λ interval:/);
  });
});
