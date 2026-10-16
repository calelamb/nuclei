/**
 * Λ interval and fit-quality helpers shared by the QEC Workbench and exports.
 * The convention matches the MCP `fit` tool: unweighted OLS of ln(rate) vs
 * distance with a two-sided 95% Student-t interval on the slope.
 */

export const LAMBDA_CONFIDENCE = 0.95;
export const LAMBDA_MIN_R_SQUARED = 0.5;
/** Per-round or per-shot rates at or above this are indistinguishable from pure noise (0.5). */
export const SATURATED_RATE = 0.4;

/** Two-sided 95% Student-t critical values for dof 1..30. */
const T95 = [
  12.706204736432095, 4.302652729911275, 3.1824463052837, 2.7764451051977934, 2.570581835636314,
  2.446911848791681, 2.364624251592785, 2.306004135033371, 2.2621571627409915, 2.2281388519649385,
  2.200985159946108, 2.178812829663418, 2.1603686564610127, 2.1447866879178044, 2.131449545559323,
  2.1199052992210112, 2.109815577833317, 2.10092204024096, 2.093024054408263, 2.0859634472658364,
  2.079613844727662, 2.0738730679040147, 2.0686576104190406, 2.0638985616280205, 2.059538552753294,
  2.055529438642871, 2.0518305164802833, 2.048407141795244, 2.045229642132703, 2.04227245630124,
];

export function tCritical95(dof: number): number {
  if (!Number.isInteger(dof) || dof < 1) throw new RangeError('dof must be a positive integer');
  if (dof <= T95.length) return T95[dof - 1];
  // Cornish-Fisher expansion around z = 1.96 is accurate to ~1e-4 for dof > 30.
  const z = 1.959963984540054;
  return z + (z ** 3 + z) / (4 * dof) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * dof ** 2);
}

export interface LambdaQualityInput {
  lambda: number;
  ci95: { low: number; high: number };
  rSquared: number;
  rates: readonly number[];
}

export function lambdaQuality(q: LambdaQualityInput): { warnings: string[]; intervalMeaningful: boolean } {
  const warnings: string[] = [];
  const saturated = Math.max(...q.rates) >= SATURATED_RATE;
  if (saturated) {
    warnings.push('saturated: rates are near 0.5 (pure noise); Λ and its interval carry no information');
  }
  if (q.lambda <= 1) {
    warnings.push('Λ ≤ 1: logical errors do not decrease with distance (no suppression, above threshold)');
  } else if (q.ci95.low <= 1) {
    warnings.push('95% interval includes 1: suppression with distance is not established');
  }
  if (q.rSquared < LAMBDA_MIN_R_SQUARED) {
    warnings.push(`r² ${q.rSquared.toFixed(2)} < ${LAMBDA_MIN_R_SQUARED}: ln(rate) is poorly described by a line in distance`);
  }
  const zeroWidth = q.ci95.high - q.ci95.low <= 1e-9 * Math.max(1, Math.abs(q.lambda));
  return { warnings, intervalMeaningful: !saturated && !zeroWidth };
}
