import type { LambdaEstimate, LambdaGroupEstimate } from './qecFit';
import { formatLambda as fmt } from './qecPlotFormat';

/** One text convention for Λ on every surface (panel, SVG, AI context). */
export function lambdaSummary(e: LambdaEstimate): { text: string; warnings: string[] } {
  const stats = `r² ${e.rSquared.toFixed(2)}, ${e.dof} dof`;
  const text = e.intervalMeaningful
    ? `Λ = ${fmt(e.lambda.best)} (${fmt(e.ci95.low)} to ${fmt(e.ci95.high)}, 95% t; ${stats})`
    : `Λ = ${fmt(e.lambda.best)} (interval not meaningful; ${stats})`;
  return { text, warnings: e.warnings };
}

/**
 * Caveats on how a Λ group was assembled (not on the fit quality, which
 * lambdaSummary reports). Shared by the panel, the SVG export and Dirac.
 */
export function lambdaCaveats(g: Pick<LambdaGroupEstimate, 'collidingDistances' | 'roundsVaryWithD' | 'units'>): string[] {
  return [
    ...(g.collidingDistances.length > 0
      ? [`distinct tasks collide at d ${g.collidingDistances.join(',')}, fitted as replicates`] : []),
    ...(g.units === 'per_shot' && g.roundsVaryWithD ? ['rounds vary with d, confounding this per-shot Λ'] : []),
  ];
}
