import { MIN_LAMBDA_DISTANCES, type LambdaGroupEstimate, type RateUnits } from '../../lib/qecFit';
import { lambdaCaveats, lambdaSummary } from '../../lib/qecLambdaText';
import type { ThemeColors } from '../../stores/themeStore';

interface Props {
  decoders: string[];
  estimates: LambdaGroupEstimate[];
  units: RateUnits;
  colors: ThemeColors;
}

/**
 * Λ per decoder and experiment, with the same caveats Dirac and the exported
 * figure carry: fit-quality warnings, tasks that collide at a distance, and
 * rounds that vary with distance.
 */
export function QecLambdaReadout({ decoders, estimates, units, colors }: Props) {
  return (
    <div aria-label="Error suppression factor Λ">
      {decoders.map((d) => {
        const mine = estimates.filter((e) => e.decoder === d);
        return (
          <div key={d} style={{ fontSize: 11, color: colors.text, marginBottom: 6 }}>
            <strong>{d}</strong>
            {mine.length === 0 ? (
              <span style={{ color: colors.textMuted }}>{`: Λ not estimated, needs ≥ ${MIN_LAMBDA_DISTANCES} distances at the same p`}</span>
            ) : (
              mine.map((e) => <LambdaRow key={`${e.experiment}\u0000${e.noise}`} e={e} units={units} colors={colors} />)
            )}
          </div>
        );
      })}
    </div>
  );
}

function LambdaRow({ e, units, colors }: { e: LambdaGroupEstimate; units: RateUnits; colors: ThemeColors }) {
  const warnings = [...e.estimate.warnings, ...lambdaCaveats(e)];
  return (
    <div style={{ paddingLeft: 8 }}>
      <span style={{ color: colors.textMuted }}>{`${e.label}: `}</span>
      {lambdaSummary(e.estimate).text}
      <span style={{ color: colors.textMuted }}>
        {` at p=${e.noise}, d ${e.estimate.distances.join(',')}, per Δd=${e.estimate.step}, ${units === 'per_round' ? 'per round' : 'per shot'}`}
        {e.estimate.droppedZeroError.length > 0 &&
          `; d ${e.estimate.droppedZeroError.join(',')} had 0 errors and is not in the fit (suppression is at least as strong)`}
      </span>
      {warnings.map((w) => (
        <div key={w} role="note" style={{ color: colors.warning, fontSize: 10 }}>{`Warning: ${w}`}</div>
      ))}
    </div>
  );
}
