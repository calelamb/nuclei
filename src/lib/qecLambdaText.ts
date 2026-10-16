import type { LambdaEstimate } from './qecFit';

const fmt = (x: number) => (x >= 100 ? x.toFixed(0) : x.toPrecision(3));

/** One text convention for Λ on every surface (panel, SVG, AI context). */
export function lambdaSummary(e: LambdaEstimate): { text: string; warnings: string[] } {
  const stats = `r² ${e.rSquared.toFixed(2)}, ${e.dof} dof`;
  const text = e.intervalMeaningful
    ? `Λ = ${fmt(e.lambda.best)} (${fmt(e.ci95.low)} to ${fmt(e.ci95.high)}, 95% t; ${stats})`
    : `Λ = ${fmt(e.lambda.best)} (interval not meaningful; ${stats})`;
  return { text, warnings: e.warnings };
}
