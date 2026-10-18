/** Pure geometry for the scaling plot's fit curves. */

import type { ScalingFit, ScalingStudy } from '../../../types/trainability';

type Point = ScalingStudy['points'][number];

export interface Curve {
  n: number;
  value: number;
}

export function sampleCurve(from: number, to: number, fn: (n: number) => number, steps = 48): Curve[] {
  const out: Curve[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const n = from + ((to - from) * i) / steps;
    const value = fn(n);
    if (Number.isFinite(value) && value > 0) out.push({ n, value });
  }
  return out;
}

export function meanOf(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Var(n) = 2^(log2_intercept − β n). */
export function exponentialCurve(fit: NonNullable<ScalingFit['exponential']>, from: number, to: number): Curve[] {
  return sampleCurve(from, to, (n) => 2 ** (fit.log2_intercept - fit.beta * n));
}

/**
 * Band of β's 95% CI, pivoted at the data centroid n̄ so that it opens away
 * from the fitted line (the fit passes near the centroid). Returns paired
 * lower/upper curves.
 */
export function exponentialBand(
  fit: NonNullable<ScalingFit['exponential']>,
  centroid: number,
  from: number,
  to: number,
): { lower: Curve[]; upper: Curve[] } {
  const pivot = 2 ** (fit.log2_intercept - fit.beta * centroid);
  const [bLo, bHi] = fit.beta_ci95;
  const make = (beta: number, n: number) => pivot * 2 ** (-(beta - fit.beta) * (n - centroid));
  const a = sampleCurve(from, to, (n) => make(bLo, n));
  const b = sampleCurve(from, to, (n) => make(bHi, n));
  // For n < centroid the larger β gives the larger value; sort per n.
  const lower = a.map((p, i) => ({ n: p.n, value: Math.min(p.value, b[i]?.value ?? p.value) }));
  const upper = a.map((p, i) => ({ n: p.n, value: Math.max(p.value, b[i]?.value ?? p.value) }));
  return { lower, upper };
}

/**
 * Power-law alternative Var(n) = c n^(−α). The kernel reports α but not c, so
 * c is anchored on the data's log-mean (a drawing aid; the fit statistics are
 * the kernel's).
 */
export function powerLawCurve(
  fit: NonNullable<ScalingFit['power_law']>,
  points: readonly Point[],
  from: number,
  to: number,
): Curve[] {
  const usable = points.filter((p) => p.variance > 0 && p.n_qubits > 0);
  if (usable.length === 0) return [];
  const meanLogVar = meanOf(usable.map((p) => Math.log(p.variance)));
  const meanLogN = meanOf(usable.map((p) => Math.log(p.n_qubits)));
  const logC = meanLogVar + fit.alpha * meanLogN;
  return sampleCurve(Math.max(from, 1e-6), to, (n) => Math.exp(logC - fit.alpha * Math.log(n)));
}

export function distinctLayers(study: ScalingStudy): number[] {
  return [...new Set(study.points.map((p) => p.n_layers))].sort((a, b) => a - b);
}
