/**
 * Reviewer-grade QEC statistics (pure functions, no DOM).
 *
 * A TypeScript port of the parts of sinter (sinter/_probability_util.py) that
 * matter for reporting logical error rates, so desktop and web share one
 * path (the web build has no sinter):
 *
 *  - `fitBinomial`                       <- sinter.fit_binomial
 *  - `shotErrorRateToPieceErrorRate`     <- sinter.shot_error_rate_to_piece_error_rate
 *  - `fitLineSlope`                      <- sinter.fit_line_slope (analytic, see note)
 *  - `lambdaEstimates`                   <- Λ by log-linear regression of
 *                                           ln(LER) vs code distance at each p
 *
 * Golden tests (qecFit.test.ts) compare against real sinter output.
 *
 * Deliberate differences from sinter:
 *  1. `fitLineSlope` solves the constrained least-squares problem in closed
 *     form: for a fixed slope m the best intercept is the mean of (y - m x),
 *     so extra squared error = Sxx (m - m*)^2 and the interval is
 *     m* ± sqrt(maxExtra / Sxx). sinter finds the same interval numerically
 *     (scipy leastsq + bisection to atol 1e-5 on the cost), so its low/high
 *     differ from ours, by up to ~2e-3 relative on the golden fixtures (its
 *     inner least-squares is approximate; ours satisfies cost = base + extra
 *     exactly). `best` agrees to 1e-9.
 *  2. The Λ default for `maxExtraSquaredError` is ours (sinter leaves it to
 *     the caller); see `defaultMaxExtraSquaredError`.
 */
import type { QecCampaignStatsRow } from '../types/qec';
import type { ThresholdSeries } from '../types/qecStats';

export interface Fit {
  low: number;
  best: number;
  high: number;
}

/** sinter.plot_error_rate's default highlight_max_likelihood_factor. */
export const DEFAULT_MAX_LIKELIHOOD_FACTOR = 1e3;
/** Resolution of sinter's binomial search: 1/ACC of one expected error. */
const BINOMIAL_ACC = 100;

// ───────────────────────── log-binomial (float32, as sinter) ─────────────────────────

const f32 = Math.fround;

/** ln(n!) via lgamma(n+1): exact sum for small n, Stirling series otherwise. */
export function logFactorial(n: number): number {
  if (n < 2) return 0;
  if (n < 30) {
    let s = 0;
    for (let k = 2; k <= n; k += 1) s += Math.log(k);
    return s;
  }
  const x = n + 1;
  const x2 = x * x;
  return (
    (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI) +
    1 / (12 * x) - 1 / (360 * x * x2) + 1 / (1260 * x2 * x2 * x) - 1 / (1680 * x2 * x2 * x2 * x)
  );
}

/**
 * ln P(hits | Binomial(n, p)) rounded through float32 at the same points as
 * sinter's log_binomial (which accumulates in a float32 array). Mirroring the
 * rounding matters: sinter's bisection compares these float32 values, so the
 * exact interval endpoints depend on it.
 */
export function logBinomial(p: number, n: number, hits: number): number {
  const pc = Math.min(1, Math.max(0, p));
  const misses = n - hits;
  let r = 0;
  if (hits > 0 && pc === 0) r = -Infinity;
  if (misses > 0 && pc === 1) r = -Infinity;
  if (pc !== 0) r = f32(r + Math.log(pc) * hits);
  if (pc !== 1) r = f32(r + Math.log1p(-pc) * misses);
  const choose = logFactorial(n) - logFactorial(misses) - logFactorial(hits);
  return f32(r + f32(choose));
}

function binarySearch(func: (x: number) => number, minX0: number, maxX0: number, target: number): number {
  let minX = minX0;
  let maxX = maxX0;
  while (maxX > minX + 1) {
    const med = Math.floor((minX + maxX) / 2);
    const out = func(med);
    if (out < target) minX = med;
    else if (out > target) maxX = med;
    else return med;
  }
  const fmax = func(maxX);
  const fmin = func(minX);
  const dmax = fmax === target ? 0 : f32(fmax - target);
  const dmin = fmin === target ? 0 : f32(fmin - target);
  return Math.abs(dmax) < Math.abs(dmin) ? maxX : minX;
}

/**
 * Likelihood-ratio interval for a binomial proportion: the smallest and
 * largest hypotheses whose likelihood is within `maxLikelihoodFactor` of the
 * maximum-likelihood one. `numShots` must already exclude discards.
 */
export function fitBinomial(args: { numShots: number; numHits: number; maxLikelihoodFactor: number }): Fit {
  const { numShots, numHits, maxLikelihoodFactor } = args;
  if (!(maxLikelihoodFactor >= 1)) throw new RangeError(`max_likelihood_factor=${maxLikelihoodFactor} < 1`);
  if (numHits < 0 || numHits > numShots) throw new RangeError(`need 0 <= hits <= shots (hits=${numHits}, shots=${numShots})`);
  if (numShots === 0) return { low: 0, best: 0.5, high: 1 };
  const acc = BINOMIAL_ACC;
  const logMax = logBinomial(numHits / numShots, numShots, numHits);
  const target = f32(logMax - f32(Math.log(maxLikelihoodFactor)));
  const at = (expErr: number) => logBinomial(expErr / (acc * numShots), numShots, numHits);
  const low = binarySearch(at, 0, numHits * acc, target) / acc;
  const high = binarySearch((x) => -at(x), numHits * acc, numShots * acc, -target) / acc;
  return { low: low / numShots, best: numHits / numShots, high: high / numShots };
}

// ───────────────────────── shot -> per-round conversion ─────────────────────────

/**
 * Convert a per-shot failure probability to a per-piece (per-round) one, as
 * sinter does: the shot fails if an odd number of `pieces` independent
 * round-failures occur (xor), over `values` independent observables (or).
 */
export function shotErrorRateToPieceErrorRate(shotErrorRate: number, opts: { pieces: number; values?: number }): number {
  const { pieces } = opts;
  const values = opts.values ?? 1;
  if (!(shotErrorRate >= 0 && shotErrorRate <= 1)) throw new RangeError(`need 0 <= shot_error_rate=${shotErrorRate} <= 1`);
  if (!(pieces > 0)) throw new RangeError('need pieces > 0');
  if (pieces === 1) return shotErrorRate;
  if (values !== 1) {
    const p = 1 - (1 - shotErrorRate) ** (1 / values);
    const q = shotErrorRateToPieceErrorRate(p, { pieces });
    return 1 - (1 - q) ** values;
  }
  if (shotErrorRate > 0.5) return 1 - shotErrorRateToPieceErrorRate(1 - shotErrorRate, { pieces });
  const randomizeRate = 2 * shotErrorRate;
  const roundRandomizeRate = 1 - (1 - randomizeRate) ** (1 / pieces);
  const roundErrorRate = roundRandomizeRate / 2;
  // Intermediate underflow: fall back to the division approximation.
  if (roundErrorRate === 0) return shotErrorRate / pieces;
  return roundErrorRate;
}

export function fitToPieceRate(fit: Fit, opts: { pieces: number; values?: number }): Fit {
  return {
    low: shotErrorRateToPieceErrorRate(fit.low, opts),
    best: shotErrorRateToPieceErrorRate(fit.best, opts),
    high: shotErrorRateToPieceErrorRate(fit.high, opts),
  };
}

// ───────────────────────── per-row logical error rate ─────────────────────────

export type RateUnits = 'per_shot' | 'per_round';

/** Number of QEC rounds per shot from sinter metadata (`r` or `rounds`), or null. */
export function roundsFromMetadata(meta: unknown): number | null {
  if (typeof meta !== 'object' || meta === null) return null;
  const m = meta as Record<string, unknown>;
  for (const k of ['r', 'rounds']) {
    const v = m[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

export interface RowRateOptions {
  units?: RateUnits;
  maxLikelihoodFactor?: number;
}

/**
 * Logical error rate of a stats row with sinter's likelihood interval.
 * Discarded shots are excluded from the denominator (shots - discards).
 * `per_round` requires known rounds; otherwise it falls back to per-shot and
 * reports the units actually used.
 */
export function rowRate(
  row: Pick<QecCampaignStatsRow, 'shots' | 'errors' | 'discards' | 'json_metadata'>,
  opts: RowRateOptions = {},
): { fit: Fit; units: RateUnits; kept: number } {
  const kept = row.shots - (row.discards || 0);
  const fit = fitBinomial({
    numShots: kept,
    numHits: row.errors,
    maxLikelihoodFactor: opts.maxLikelihoodFactor ?? DEFAULT_MAX_LIKELIHOOD_FACTOR,
  });
  const rounds = roundsFromMetadata(row.json_metadata);
  if (opts.units === 'per_round' && rounds !== null && kept > 0) {
    return { fit: fitToPieceRate(fit, { pieces: rounds }), units: 'per_round', kept };
  }
  return { fit, units: 'per_shot', kept };
}

// ───────────────────────── line fit ─────────────────────────

export interface LineFit {
  slope: Fit;
  intercept: number;
  /** Standard error of the slope (n-2 degrees of freedom). */
  stderr: number;
  /** Residual sum of squares of the best fit. */
  rss: number;
  /** Sum of squared deviations of x. */
  sxx: number;
  n: number;
}

/** Ordinary least squares with sinter.fit_line_slope-style slope bounds. */
export function fitLineSlope(args: {
  xs: readonly number[];
  ys: readonly number[];
  maxExtraSquaredError: number | ((f: { rss: number; n: number }) => number);
}): LineFit {
  const { xs, ys } = args;
  const n = xs.length;
  if (n !== ys.length || n < 2) throw new RangeError('need >= 2 paired points');
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) throw new RangeError('xs must not all be equal');
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let rss = 0;
  for (let i = 0; i < n; i += 1) rss += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const extra = typeof args.maxExtraSquaredError === 'function' ? args.maxExtraSquaredError({ rss, n }) : args.maxExtraSquaredError;
  const half = Math.sqrt(extra / sxx);
  const stderr = n > 2 ? Math.sqrt(rss / (n - 2) / sxx) : Number.NaN;
  return { slope: { low: slope - half, best: slope, high: slope + half }, intercept, stderr, rss, sxx, n };
}

// ───────────────────────── Λ ─────────────────────────

export interface LambdaPoint {
  distance: number;
  errors: number;
  /** Logical error rate (best estimate) in the chosen units. */
  rate: number;
}

export interface LambdaEstimate {
  /** Error-suppression factor per `step` of code distance: LER(d)/LER(d+step). */
  lambda: Fit;
  slope: Fit;
  stderr: number;
  step: number;
  distances: number[];
  nPoints: number;
}

export const MIN_LAMBDA_DISTANCES = 3;
export const DEFAULT_LAMBDA_STEP = 2;

/**
 * Default extra-squared-error budget for the Λ interval: the larger of the
 * regression's residual mean square (misfit of the log-linear model) and the
 * mean delta-method variance of ln(count) = 1/errors (sampling noise, which
 * dominates when 3 points happen to fall on a line). Roughly a 1σ interval.
 */
export function defaultMaxExtraSquaredError(points: readonly LambdaPoint[]): (f: { rss: number; n: number }) => number {
  const sampling = points.reduce((s, p) => s + 1 / p.errors, 0) / points.length;
  return ({ rss, n }) => Math.max(rss / (n - 2), sampling);
}

/**
 * Λ from ln(LER) vs d. Needs >= 3 distinct distances with at least one logical
 * error each (ln 0 is undefined); otherwise null. Ratios <= 1 are reported as
 * they are — they mean "above threshold", not "no data".
 */
export function estimateLambda(
  points: readonly LambdaPoint[],
  opts: { step?: number; maxExtraSquaredError?: number } = {},
): LambdaEstimate | null {
  const usable = points.filter((p) => p.errors > 0 && p.rate > 0 && Number.isFinite(p.rate));
  const distances = [...new Set(usable.map((p) => p.distance))].sort((a, b) => a - b);
  if (distances.length < MIN_LAMBDA_DISTANCES) return null;
  const step = opts.step ?? DEFAULT_LAMBDA_STEP;
  const fit = fitLineSlope({
    xs: usable.map((p) => p.distance),
    ys: usable.map((p) => Math.log(p.rate)),
    maxExtraSquaredError: opts.maxExtraSquaredError ?? defaultMaxExtraSquaredError(usable),
  });
  const toLambda = (m: number) => Math.exp(-step * m);
  return {
    lambda: { low: toLambda(fit.slope.high), best: toLambda(fit.slope.best), high: toLambda(fit.slope.low) },
    slope: fit.slope,
    stderr: fit.stderr,
    step,
    distances,
    nPoints: usable.length,
  };
}

export interface LambdaGroupEstimate {
  decoder: string;
  label: string;
  noise: number;
  units: RateUnits;
  estimate: LambdaEstimate;
}

/** Λ at each (decoder, label, p) that has >= 3 distances. */
export function lambdaEstimates(
  rows: readonly QecCampaignStatsRow[],
  opts: { units?: RateUnits; step?: number } = {},
): LambdaGroupEstimate[] {
  const groups = new Map<string, { decoder: string; label: string; noise: number; units: RateUnits; pts: LambdaPoint[] }>();
  for (const row of rows) {
    const meta = (row.json_metadata ?? {}) as Record<string, unknown>;
    const d = meta.d;
    const p = meta.p;
    if (typeof d !== 'number' || typeof p !== 'number' || !Number.isFinite(d) || !Number.isFinite(p)) continue;
    const label = typeof meta.label === 'string' ? meta.label : '';
    const { fit, units } = rowRate(row, { units: opts.units, maxLikelihoodFactor: 1 });
    // Never mix units: a per-round request skips rows whose rounds are unknown.
    if (units !== (opts.units ?? 'per_shot')) continue;
    const key = `${row.decoder}\u0000${label}\u0000${p}\u0000${units}`;
    const g = groups.get(key) ?? { decoder: row.decoder, label, noise: p, units, pts: [] };
    groups.set(key, { ...g, pts: [...g.pts, { distance: d, errors: row.errors, rate: fit.best }] });
  }
  const out: LambdaGroupEstimate[] = [];
  for (const g of groups.values()) {
    const estimate = estimateLambda(g.pts, { step: opts.step });
    if (estimate) out.push({ decoder: g.decoder, label: g.label, noise: g.noise, units: g.units, estimate });
  }
  return out.sort((a, b) => a.decoder.localeCompare(b.decoder) || a.label.localeCompare(b.label) || a.noise - b.noise);
}

// ───────────────────────── plot series + figure metadata ─────────────────────────

/**
 * Threshold-plot series (one per label x distance x decoder) with sinter
 * likelihood-ratio intervals. In `per_round` mode, rows without known rounds
 * are excluded (never silently mixed into a per-shot curve); their count is
 * returned so the UI can say so.
 */
export function likelihoodSeries(
  rows: readonly QecCampaignStatsRow[],
  opts: { units?: RateUnits; maxLikelihoodFactor?: number } = {},
): { series: ThresholdSeries[]; excluded: number } {
  const want = opts.units ?? 'per_shot';
  const groups = new Map<string, ThresholdSeries>();
  let excluded = 0;
  for (const row of rows) {
    const meta = (row.json_metadata ?? {}) as Record<string, unknown>;
    const noise = meta.p;
    if (typeof noise !== 'number' || !Number.isFinite(noise)) continue;
    const { fit, units } = rowRate(row, { units: want, maxLikelihoodFactor: opts.maxLikelihoodFactor });
    if (units !== want) { excluded += 1; continue; }
    const distance = typeof meta.d === 'number' && Number.isFinite(meta.d) ? meta.d : null;
    const label = typeof meta.label === 'string' ? meta.label : row.strong_id.slice(0, 8);
    const key = `${label}·d${distance ?? '?'}·${row.decoder}`;
    const prev = groups.get(key) ?? { key, label, distance, decoder: row.decoder, points: [] };
    groups.set(key, { ...prev, points: [...prev.points, { noise, rate: { p: fit.best, lo: fit.low, hi: fit.high } }] });
  }
  const series = [...groups.values()]
    .map((s) => ({ ...s, points: [...s.points].sort((a, b) => a.noise - b.noise) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return { series, excluded };
}

/** Machine-readable provenance embedded in exported figures. */
export function qecFigureMetadata(units: RateUnits, maxLikelihoodFactor = DEFAULT_MAX_LIKELIHOOD_FACTOR) {
  return {
    title: 'Logical error vs physical error',
    units: units === 'per_round' ? 'logical error per round' : 'logical error per shot',
    rate_estimator: 'errors / (shots - discards); per-round via sinter shot_error_rate_to_piece_error_rate',
    ci_method: `sinter likelihood-ratio interval (fit_binomial, max_likelihood_factor=${maxLikelihoodFactor})`,
    lambda_estimator:
      `OLS slope of ln(LER) vs code distance at fixed p (>= ${MIN_LAMBDA_DISTANCES} distances); ` +
      `lambda = exp(-${DEFAULT_LAMBDA_STEP} * slope) per distance step of ${DEFAULT_LAMBDA_STEP}; ` +
      'interval from fit_line_slope-style extra squared error',
    implementation: 'nuclei src/lib/qecFit.ts (TypeScript port of sinter)',
  };
}
