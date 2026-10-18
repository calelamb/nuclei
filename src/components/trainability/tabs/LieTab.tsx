import {
  LabCallout,
  LabKpi,
  LabKpiStrip,
  LabMeter,
  LabPill,
  LabSectionLabel,
  formatCount,
  formatInterval,
  formatSci,
  type LabTone,
} from '../../lab';
import { G_SIM_NOT_APPLICABLE_TEXT, gSimNotApplicable } from '../../../services/trainability/verdict';
import { validInterval } from '../../../services/trainability/intervals';
import { maxAlgebraDimension, ragoneComparison } from './lieMath';
import type { GradientStatistics, LieAlgebraResult } from '../../../types/trainability';

const STATUS_TONE: Record<LieAlgebraResult['status'], LabTone> = {
  complete: 'success',
  truncated: 'warning',
  unsupported: 'danger',
};

const SIMULABILITY: Record<LieAlgebraResult['simulability']['kind'], { tone: LabTone; label: string }> = {
  g_sim_feasible: { tone: 'success', label: 'Classically simulable (𝔤-sim)' },
  exponential_dla: { tone: 'danger', label: 'Exponential DLA' },
  unknown: { tone: 'neutral', label: 'Simulability unknown' },
};

/** "none" means the circuit has no fixed (non-parametrized) gates, so Clifford/non-Clifford is moot. */
function fixedGatesKpi(fixed: LieAlgebraResult['fixed_gates']): { value: string; detail: string } {
  if (fixed.handled_by === 'none') return { value: 'None', detail: 'no fixed gates in the circuit' };
  return {
    value: fixed.clifford ? 'Clifford' : 'non-Clifford',
    detail: fixed.handled_by === 'clifford_conjugation' ? 'handled by Clifford conjugation' : 'handled densely',
  };
}

/** A small DLA only supports a 𝔤-sim claim when the observable/state overlap 𝔤. */
function simulabilityPill(data: LieAlgebraResult): { tone: LabTone; label: string } {
  if (data.simulability.kind === 'g_sim_feasible' && gSimNotApplicable(data)) {
    return { tone: 'neutral', label: G_SIM_NOT_APPLICABLE_TEXT };
  }
  return SIMULABILITY[data.simulability.kind];
}

const yesNo = (v: boolean | null) => (v === null ? '—' : v ? 'yes' : 'no');

/**
 * Ragone et al. predict the variance of the COST, Var[C]. Compare it with the
 * empirical Var[C] (never with the gradient variance, which is a different
 * quantity); the ratio appears only when both numbers exist.
 */
function RagoneComparison({ data, gradients }: { data: LieAlgebraResult; gradients?: GradientStatistics }) {
  const cmp = ragoneComparison(data, gradients);
  return (
    <div>
      <LabSectionLabel>Predicted vs empirical cost variance</LabSectionLabel>
      <LabKpiStrip label="Predicted and empirical cost variance">
        <LabKpi
          label="Predicted Var[C] (Ragone et al.)"
          value={cmp.predicted === null ? 'not applicable' : formatSci(cmp.predicted)}
          detail={cmp.predicted === null ? 'needs O and ρ to overlap a simple 𝔤' : 'P𝔤(ρ) P𝔤(O) / dim 𝔤'}
        />
        <LabKpi
          label="Empirical Var[C]"
          value={cmp.empirical === null ? (gradients ? 'not measured' : 'run gradients') : formatSci(cmp.empirical)}
          detail={
            cmp.empirical !== null
              ? validInterval(gradients?.cost_variance_ci95)
                ? `95% CI ${formatInterval(gradients?.cost_variance_ci95)}`
                : undefined
              : gradients
                ? 'the sampling estimator reports it; Pauli propagation does not'
                : undefined
          }
        />
        {cmp.ratio !== null && (
          <LabKpi label="Empirical / predicted" value={`${formatSci(cmp.ratio, 2)}×`} detail="cost variance on both sides" />
        )}
      </LabKpiStrip>
    </div>
  );
}

export function LieTab({ data, gradients }: { data: LieAlgebraResult; gradients?: GradientStatistics }) {
  const top = maxAlgebraDimension(data.n_qubits);
  const dim = data.dimension ?? data.dimension_lower_bound;
  const sim = simulabilityPill(data);
  const simNotApplicable = data.simulability.kind === 'g_sim_feasible' && gSimNotApplicable(data);

  if (data.status === 'unsupported') {
    return (
      <LabCallout tone="danger" title="Lie-algebra analysis unsupported">
        {data.reason ?? 'The kernel could not compute the dynamical Lie algebra for this circuit.'}
      </LabCallout>
    );
  }

  const summary = `Dynamical Lie algebra dimension ${data.dimension ?? `at least ${data.dimension_lower_bound}`} out of ${formatSci(top)} (4 to the n minus 1) for ${data.n_qubits} qubits; status ${data.status}.`;

  return (
    <div className="lab-stack">
      <div className="lab-row" style={{ flexWrap: 'wrap' }}>
        <LabPill tone={STATUS_TONE[data.status]} dot>{data.status}</LabPill>
        {data.classification && (
          <LabPill tone="quantum" outline title={data.classification.note}>
            {data.classification.label}
          </LabPill>
        )}
        <LabPill tone={sim.tone}>{sim.label}</LabPill>
      </div>
      {data.status === 'truncated' && (
        <LabCallout tone="warning" title="Closure truncated">
          {data.reason ?? 'Hit the dimension or time cap.'} Showing a lower bound: dim 𝔤 ≥ {data.dimension_lower_bound}.
        </LabCallout>
      )}
      <div>
        <LabSectionLabel>dim 𝔤 vs 4ⁿ − 1 (log scale)</LabSectionLabel>
        <LabMeter
          label={data.dimension === null ? 'dim 𝔤 (lower bound, log scale)' : 'dim 𝔤 (log scale)'}
          value={Math.log10(Math.max(1, dim))}
          max={Math.log10(top)}
          format={(v) => (10 ** v < 1e15 ? formatCount(10 ** v) : formatSci(10 ** v, 3))}
        />
        <p className="lab-sr-only">{summary}</p>
      </div>
      {data.classification && (
        <p className="lab-muted" style={{ margin: 0 }}>
          {data.classification.label} ({data.classification.confidence.replace(/_/g, ' ')}). {data.classification.note}
        </p>
      )}
      <LabKpiStrip label="Lie algebra purities">
        <LabKpi label="g-purity of ρ₀" value={formatSci(data.purity.initial_state)} detail={`state in 𝔤: ${yesNo(data.purity.state_in_algebra)}`} />
        <LabKpi label="g-purity of O" value={formatSci(data.purity.observable)} detail={`observable in 𝔤: ${yesNo(data.purity.observable_in_algebra)}`} />
        <LabKpi label="Generators" value={data.generators.unique} detail={`${data.generators.count} total`} />
        <LabKpi label="Fixed gates" {...fixedGatesKpi(data.fixed_gates)} />
      </LabKpiStrip>
      <RagoneComparison data={data} gradients={gradients} />
      <div>
        <h4 className="lab-section-label" style={{ marginTop: 'var(--space-3)' }}>Assumptions</h4>
        <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', color: 'var(--color-text-secondary)' }}>
          {data.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>
      <LabCallout
        tone={simNotApplicable ? 'info' : data.simulability.kind === 'g_sim_feasible' ? 'success' : data.simulability.kind === 'exponential_dla' ? 'warning' : 'info'}
        title="Simulability verdict"
      >
        {simNotApplicable ? G_SIM_NOT_APPLICABLE_TEXT : data.simulability.summary}
      </LabCallout>
      {data.generators.examples.length > 0 && (
        <p className="lab-muted" style={{ margin: 0 }}>
          Example generators: <span className="lab-mono">{data.generators.examples.join(', ')}</span>
        </p>
      )}
    </div>
  );
}
