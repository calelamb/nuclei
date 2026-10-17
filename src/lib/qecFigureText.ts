import { LAMBDA_CI_SHORT, whiskerConvention, type LambdaGroupEstimate } from './qecFit';
import { lambdaCaveats, lambdaSummary } from './qecLambdaText';
import { formatNoise } from './qecPlotFormat';

/** One-line text form of a Λ estimate, with units, dropped points and every caveat. */
export function lambdaLine(e: LambdaGroupEstimate): string {
  const unitText = e.units === 'per_round' ? 'per round' : 'per shot';
  const dropped = e.estimate.droppedZeroError.length > 0 ? `; 0 errors at d ${e.estimate.droppedZeroError.join(',')} omitted` : '';
  const caveats = [...lambdaCaveats(e), ...e.estimate.warnings];
  const warn = caveats.length > 0 ? `; WARNING: ${caveats.join('; ')}` : '';
  return `${e.decoder} ${e.label} p=${formatNoise(e.noise)}: ${lambdaSummary(e.estimate).text}, d ${e.estimate.distances.join(',')}, ${unitText}${dropped}${warn}`;
}

/**
 * Text under an exported figure. One short line by default (whisker convention
 * plus the Λ method when Λ was estimated); the per-Λ lines are an opt-in
 * caption, since they belong in the paper's own caption, not the plot.
 */
export function figureFooterLines(
  lambdas: readonly LambdaGroupEstimate[], opts: { includeLambdaLines?: boolean } = {},
): string[] {
  const whiskers = `Whiskers: sinter ${whiskerConvention()}, not Wilson`;
  if (lambdas.length === 0) return [whiskers];
  return [
    `${whiskers} · Λ interval: ${LAMBDA_CI_SHORT}`,
    ...(opts.includeLambdaLines ? lambdas.map(lambdaLine) : []),
  ];
}
