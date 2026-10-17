import { LAMBDA_CI_SHORT, whiskerConvention, type LambdaGroupEstimate } from './qecFit';
import { lambdaCaveats, lambdaSummary } from './qecLambdaText';

/** One-line text form of a Λ estimate, with units, dropped points and every caveat. */
export function lambdaLine(e: LambdaGroupEstimate): string {
  const unitText = e.units === 'per_round' ? 'per round' : 'per shot';
  const dropped = e.estimate.droppedZeroError.length > 0 ? `; 0 errors at d ${e.estimate.droppedZeroError.join(',')} omitted` : '';
  const caveats = [...lambdaCaveats(e), ...e.estimate.warnings];
  const warn = caveats.length > 0 ? `; WARNING: ${caveats.join('; ')}` : '';
  return `${e.decoder} ${e.label} p=${e.noise}: ${lambdaSummary(e.estimate).text}, d ${e.estimate.distances.join(',')}, ${unitText}${dropped}${warn}`;
}

/** Text block under an exported figure: interval conventions then one line per Λ. */
export function figureFooterLines(lambdas: readonly LambdaGroupEstimate[]): string[] {
  return [
    `Whiskers: sinter ${whiskerConvention()}, not Wilson`,
    ...(lambdas.length > 0 ? [`Λ interval: ${LAMBDA_CI_SHORT}`, ...lambdas.map(lambdaLine)] : []),
  ];
}
