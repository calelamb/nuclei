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
 *     differ from ours by ~1e-6 relative on the scalar golden cases (tested
 *     at 1e-5) and by 2.5e-3 to 5e-3 on the worst fixture Λ fit (tested at 5e-3),
 *     where sinter's inner least-squares is approximate; ours satisfies
 *     cost = base + extra exactly. `best` agrees to 1e-9.
 *  2. The Λ default for `maxExtraSquaredError` is ours (sinter leaves it to
 *     the caller); see `defaultMaxExtraSquaredError`. It is an ~1σ interval
 *     (stated on the figure), unlike the 1000x-likelihood whiskers (~3.7σ).
 *  3. Rows are pooled into a curve or a Λ fit only within one experiment
 *     (see qecExperiments.ts); sinter leaves grouping to the caller.
 */
import type { QecCampaignStatsRow } from '../types/qec';
import type { ThresholdSeries } from '../types/qecStats';
import { assignExperiments } from './qecExperiments';
import { roundsFromMetadata } from './qecRounds';
import { lambdaQuality, tCritical95 } from './qecLambdaStats';

export { roundsFromMetadata };

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

/**
 * Why a row cannot be turned into a rate, or null if it can. `invalid` rows
 * are malformed (non-finite or negative counts, discards > shots, errors
 * above kept shots); `no_kept` rows have zero kept shots (no information).
 */
export function rowProblem(
  row: Pick<QecCampaignStatsRow, 'shots' | 'errors' | 'discards'>,
): 'invalid' | 'no_kept' | null {
  const discards = row.discards || 0;
  const { shots, errors } = row;
  if (![shots, errors, discards].every(Number.isFinite) || shots < 0 || errors < 0 || discards < 0) return 'invalid';
  const kept = shots - discards;
  if (kept < 0 || errors > kept) return 'invalid';
  return kept === 0 ? 'no_kept' : null;
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
  /** Distances whose points had zero logical errors (ln 0) and were left out. */
  droppedZeroError: number[];
  /** 95% Student-t interval (unweighted OLS), the convention shared with the MCP `fit` tool. */
  ci95: { low: number; high: number };
  rSquared: number;
  /** Residual degrees of freedom, nPoints - 2. */
  dof: number;
  warnings: string[];
  /** False when the interval is degenerate or the rates are saturated (do not print it). */
  intervalMeaningful: boolean;
}

export const MIN_LAMBDA_DISTANCES = 3;
export const DEFAULT_LAMBDA_STEP = 2;

/**
 * Default extra-squared-error budget for the Λ interval: the larger of the
 * regression's residual mean square (misfit of the log-linear model) and the
 * sampling variance of the OLS slope times Sxx. ln(count) has delta-method
 * variance 1/errors_i, which differs a lot between distances (the largest d
 * has the fewest errors), so the slope variance is the heteroscedastic
 * Σ(xi−x̄)² σi² / Sxx² rather than a mean-variance shortcut, which would be too
 * narrow. The resulting interval is roughly ±1σ (about 68%).
 */
export function defaultMaxExtraSquaredError(points: readonly LambdaPoint[]): (f: { rss: number; n: number }) => number {
  const mx = points.reduce((s, p) => s + p.distance, 0) / points.length;
  const sxx = points.reduce((s, p) => s + (p.distance - mx) ** 2, 0);
  const sampling = points.reduce((s, p) => s + (p.distance - mx) ** 2 / p.errors, 0) / sxx;
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
  const dof = usable.length - 2;
  const half = tCritical95(dof) * fit.stderr;
  const ci95 = { low: toLambda(fit.slope.best + half), high: toLambda(fit.slope.best - half) };
  const ys = usable.map((p) => Math.log(p.rate));
  const myy = ys.reduce((a, b) => a + b, 0) / ys.length;
  const tss = ys.reduce((a, y) => a + (y - myy) ** 2, 0);
  const rSquared = tss === 0 ? 0 : Math.max(0, 1 - fit.rss / tss);
  const quality = lambdaQuality({ lambda: toLambda(fit.slope.best), ci95, rSquared, rates: usable.map((p) => p.rate) });
  return {
    ci95, rSquared, dof, warnings: quality.warnings, intervalMeaningful: quality.intervalMeaningful,
    lambda: { low: toLambda(fit.slope.high), best: toLambda(fit.slope.best), high: toLambda(fit.slope.low) },
    slope: fit.slope,
    stderr: fit.stderr,
    step,
    distances,
    nPoints: usable.length,
    droppedZeroError: [...new Set(points.filter((p) => !(p.errors > 0 && p.rate > 0)).map((p) => p.distance))]
      .filter((d) => !distances.includes(d))
      .sort((a, b) => a - b),
  };
}

export interface LambdaGroupEstimate {
  decoder: string;
  /** Experiment name: metadata label plus rounds scheme, e.g. "synth r=3d". */
  label: string;
  /** Unique experiment identity (see qecExperiments.ts). */
  experiment: string;
  noise: number;
  units: RateUnits;
  estimate: LambdaEstimate;
  /** Distances where distinct tasks (strong_ids) share this cell and were fitted as replicates. */
  collidingDistances: number[];
  /** True when rounds differ between the fitted distances (confounds a per-shot Λ). */
  roundsVaryWithD: boolean;
}

const finiteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Λ at each (experiment, p) that has >= 3 distances. Malformed rows are skipped. */
export function lambdaEstimates(
  rows: readonly QecCampaignStatsRow[],
  opts: { units?: RateUnits; step?: number } = {},
): LambdaGroupEstimate[] {
  const experiments = assignExperiments(rows);
  type Pending = Omit<LambdaGroupEstimate, 'estimate' | 'collidingDistances' | 'roundsVaryWithD'> & {
    pts: LambdaPoint[]; ids: Map<number, Set<string>>; rounds: Set<number>;
  };
  const groups = new Map<string, Pending>();
  for (const row of rows) {
    const meta = (row.json_metadata ?? {}) as Record<string, unknown>;
    if (!finiteNum(meta.d) || !finiteNum(meta.p) || rowProblem(row) === 'invalid') continue;
    const { fit, units } = rowRate(row, { units: opts.units, maxLikelihoodFactor: 1 });
    // Never mix units: a per-round request skips rows whose rounds are unknown.
    if (units !== (opts.units ?? 'per_shot')) continue;
    const ex = experiments.get(row)!;
    const key = `${ex.key}\u0000${meta.p}\u0000${units}`;
    const g = groups.get(key) ?? {
      decoder: row.decoder, label: ex.name, experiment: ex.key, noise: meta.p, units, pts: [],
      ids: new Map<number, Set<string>>(), rounds: new Set<number>(),
    };
    const rounds = roundsFromMetadata(row.json_metadata);
    groups.set(key, {
      ...g,
      pts: [...g.pts, { distance: meta.d, errors: row.errors, rate: fit.best }],
      ids: new Map(g.ids).set(meta.d, new Set(g.ids.get(meta.d) ?? []).add(row.strong_id)),
      rounds: rounds === null ? g.rounds : new Set(g.rounds).add(rounds),
    });
  }
  const out: LambdaGroupEstimate[] = [];
  for (const { pts, ids, rounds, ...g } of groups.values()) {
    const estimate = estimateLambda(pts, { step: opts.step });
    if (!estimate) continue;
    const collidingDistances = [...ids].filter(([, set]) => set.size > 1).map(([d]) => d).sort((a, b) => a - b);
    out.push({ ...g, estimate, collidingDistances, roundsVaryWithD: rounds.size > 1 });
  }
  return out.sort((a, b) => a.decoder.localeCompare(b.decoder) || a.label.localeCompare(b.label) || a.noise - b.noise);
}

// ───────────────────────── plot series + figure metadata ─────────────────────────

export interface LikelihoodSeriesResult {
  series: ThresholdSeries[];
  /** Rows hidden because per-round was requested and their rounds are unknown. */
  excluded: number;
  /** Malformed rows (e.g. errors > kept shots), skipped. */
  invalid: number;
  /** Rows whose shots were all discarded, skipped (no information). */
  noKept: number;
}

/**
 * Plot series (one per experiment x distance x decoder) with sinter
 * likelihood-ratio intervals. In `per_round` mode, rows without known rounds
 * are excluded (never silently mixed into a per-shot curve); their count is
 * returned so the UI can say so. Malformed and fully-discarded rows are
 * skipped and counted separately.
 */
export function likelihoodSeries(
  rows: readonly QecCampaignStatsRow[],
  opts: { units?: RateUnits; maxLikelihoodFactor?: number } = {},
): LikelihoodSeriesResult {
  const want = opts.units ?? 'per_shot';
  const experiments = assignExperiments(rows);
  const groups = new Map<string, ThresholdSeries>();
  let excluded = 0;
  let invalid = 0;
  let noKept = 0;
  for (const row of rows) {
    const meta = (row.json_metadata ?? {}) as Record<string, unknown>;
    const noise = meta.p;
    if (!finiteNum(noise)) continue;
    const problem = rowProblem(row);
    if (problem === 'invalid') { invalid += 1; continue; }
    if (problem === 'no_kept') { noKept += 1; continue; }
    const { fit, units, kept } = rowRate(row, { units: want, maxLikelihoodFactor: opts.maxLikelihoodFactor });
    if (units !== want) { excluded += 1; continue; }
    const distance = finiteNum(meta.d) ? meta.d : null;
    const label = experiments.get(row)!.name;
    const key = `${label}·d${distance ?? '?'}·${row.decoder}`;
    const prev = groups.get(key) ?? { key, label, distance, decoder: row.decoder, points: [] };
    groups.set(key, { ...prev, points: [...prev.points, { noise, rate: { p: fit.best, lo: fit.low, hi: fit.high }, errors: row.errors, kept }] });
  }
  const series = [...groups.values()]
    .map((s) => ({ ...s, points: [...s.points].sort((a, b) => a.noise - b.noise) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return { series, excluded, invalid, noKept };
}

/** z-equivalent of a likelihood factor F: ln F = z^2 / 2. */
export const likelihoodFactorSigma = (factor: number) => Math.sqrt(2 * Math.log(factor));

/** One-line description of the whisker convention, shared by figure and metadata. */
export function whiskerConvention(factor = DEFAULT_MAX_LIKELIHOOD_FACTOR): string {
  return `likelihood ratio, factor ${factor} (about ${likelihoodFactorSigma(factor).toFixed(1)}σ)`;
}

export const LAMBDA_CI_CONVENTION =
  '95% Student-t interval on the slope of unweighted OLS of ln(rate) vs distance (n-2 degrees of freedom); same convention as the MCP fit tool';

/** Short form for the figure footer. */
export const LAMBDA_CI_SHORT = '95% Student-t, unweighted OLS (n−2 d.o.f.)';

/** Machine-readable provenance embedded in exported figures. */
/** FNV-1a 64-bit of the sorted strong_ids: order-independent identity of the data behind a figure. */
export function strongIdDigest(strongIds: readonly string[]): string {
  const mask = (1n << 64n) - 1n;
  let h = 0xcbf29ce484222325n;
  for (const ch of [...strongIds].sort().join('\n')) {
    h = ((h ^ BigInt(ch.codePointAt(0)!)) * 0x100000001b3n) & mask;
  }
  return h.toString(16).padStart(16, '0');
}

const MAX_LISTED_STRONG_IDS = 200;

export interface FigureSource {
  /** Name of the file the rows came from, or null for a live campaign. */
  file: string | null;
  rows: readonly QecCampaignStatsRow[];
}

export function qecFigureMetadata(
  units: RateUnits,
  maxLikelihoodFactor = DEFAULT_MAX_LIKELIHOOD_FACTOR,
  lambdas: readonly LambdaGroupEstimate[] = [],
  source?: FigureSource,
) {
  return {
    title: 'Logical error vs physical error',
    units: units === 'per_round' ? 'logical error per round' : 'logical error per shot',
    rate_estimator: 'errors / (shots - discards); per-round via sinter shot_error_rate_to_piece_error_rate',
    ci_method: `sinter likelihood-ratio interval (fit_binomial, max_likelihood_factor=${maxLikelihoodFactor}, about ${likelihoodFactorSigma(maxLikelihoodFactor).toFixed(1)}σ)`,
    lambda_estimator:
      `OLS slope of ln(LER) vs code distance at fixed p (>= ${MIN_LAMBDA_DISTANCES} distances) within one experiment; ` +
      `lambda = exp(-${DEFAULT_LAMBDA_STEP} * slope) per distance step of ${DEFAULT_LAMBDA_STEP}; ` +
      'interval is 95% Student-t on the OLS slope',
    lambda_ci: `Λ interval is ${LAMBDA_CI_CONVENTION}`,
    lambda_estimates: lambdas.map((e) => ({
      decoder: e.decoder, experiment: e.label, p: e.noise, units: e.units,
      lambda: e.estimate.lambda.best, low: e.estimate.ci95.low, high: e.estimate.ci95.high, ci_level: 0.95,
      r_squared: e.estimate.rSquared, dof: e.estimate.dof, warnings: e.estimate.warnings,
      sinter_style_1sigma: { low: e.estimate.lambda.low, high: e.estimate.lambda.high },
      distances: e.estimate.distances, dropped_zero_error_distances: e.estimate.droppedZeroError,
    })),
    source: source ? figureSource(source) : null,
    implementation: 'nuclei src/lib/qecFit.ts (TypeScript port of sinter)',
  };
}

function figureSource({ file, rows }: FigureSource) {
  const ids = rows.map((r) => r.strong_id);
  return {
    file,
    tasks: ids.length,
    strong_id_digest: strongIdDigest(ids),
    strong_ids: ids.length <= MAX_LISTED_STRONG_IDS ? [...ids].sort() : null,
  };
}
