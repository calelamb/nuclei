/** Pure geometry for the scaling plot's fit curves. */

import type { Interval, ScalingFit, ScalingPoint, ScalingStudy } from '../../../types/trainability';
import { isNumber, validInterval } from '../../../services/trainability/intervals';

/** A point with a usable variance (the interval defaults to the point itself). */
export type ResolvedPoint = ScalingPoint & { variance: number; variance_ci95: Interval };
/** A PPE point that produced only a rigorous interval, no variance estimate. */
export type IntervalOnlyPoint = ScalingPoint & { variance: null; variance_ci95: Interval };
type Point = ResolvedPoint;

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
  const make = (beta: number, n: number) => pivot * 2 ** (-beta * (n - centroid));
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
  const usable = points.filter((p) => isNumber(p.variance) && p.variance > 0 && p.n_qubits > 0);
  if (usable.length === 0) return [];
  const meanLogVar = meanOf(usable.map((p) => Math.log(p.variance)));
  const meanLogN = meanOf(usable.map((p) => Math.log(p.n_qubits)));
  const logC = meanLogVar + fit.alpha * meanLogN;
  return sampleCurve(Math.max(from, 1e-6), to, (n) => Math.exp(logC - fit.alpha * Math.log(n)));
}

export function distinctLayers(study: ScalingStudy): number[] {
  return [...new Set(study.points.map((p) => p.n_layers))].sort((a, b) => a - b);
}

export interface ScalingPointSets {
  resolved: ResolvedPoint[];
  intervalOnly: IntervalOnlyPoint[];
  failed: ScalingPoint[];
}

/**
 * Sort kernel points into what can be plotted and what cannot (CR-C2). A
 * failed point carries `error` and null variance/interval/params/method; an
 * interval-only point has a rigorous bound but no estimate, so it must never
 * be drawn as if it were a measurement.
 */
export function splitScalingPoints(points: readonly ScalingPoint[]): ScalingPointSets {
  const resolved: ResolvedPoint[] = [];
  const intervalOnly: IntervalOnlyPoint[] = [];
  const failed: ScalingPoint[] = [];
  for (const p of points) {
    const ci = validInterval(p.variance_ci95);
    if (p.error) {
      failed.push(p);
    } else if (isNumber(p.variance)) {
      resolved.push({ ...p, variance: p.variance, variance_ci95: ci ?? [p.variance, p.variance] });
    } else if (ci) {
      intervalOnly.push({ ...p, variance: null, variance_ci95: ci });
    } else {
      failed.push(p);
    }
  }
  return { resolved, intervalOnly, failed };
}

/** The fit's preferred model, with a null from the kernel meaning "none". */
export function preferredModel(fit: ScalingFit): 'exponential' | 'power_law' | 'none' {
  return fit.preferred ?? 'none';
}
