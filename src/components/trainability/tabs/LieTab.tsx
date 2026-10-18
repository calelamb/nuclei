import {
  LabCallout,
  LabKpi,
  LabKpiStrip,
  LabMeter,
  LabPill,
  LabSectionLabel,
  formatSci,
  type LabTone,
} from '../../lab';
import { maxAlgebraDimension } from './lieMath';
import type { GradientStatistics, LieAlgebraResult } from '../../../types/trainability';

const STATUS_TONE: Record<LieAlgebraResult['status'], LabTone> = {
  complete: 'success',
  truncated: 'warning',
  unsupported: 'danger',
};

const SIMULABILITY: Record<LieAlgebraResult['simulability']['kind'], { tone: LabTone; label: string }> = {
  g_sim_feasible: { tone: 'success', label: 'Trainable and classically simulable (𝔤-sim)' },
  exponential_dla: { tone: 'danger', label: 'Exponential DLA' },
  unknown: { tone: 'neutral', label: 'Simulability unknown' },
};

const yesNo = (v: boolean | null) => (v === null ? '—' : v ? 'yes' : 'no');

export function LieTab({ data, gradients }: { data: LieAlgebraResult; gradients?: GradientStatistics }) {
  const top = maxAlgebraDimension(data.n_qubits);
  const dim = data.dimension ?? data.dimension_lower_bound;
  const empirical = gradients?.variance_mean;
  const sim = SIMULABILITY[data.simulability.kind];

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
          format={(v) => formatSci(10 ** v, 3)}
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
        <LabKpi label="Fixed gates" value={data.fixed_gates.clifford ? 'Clifford' : 'non-Clifford'} detail={data.fixed_gates.handled_by.replace(/_/g, ' ')} />
      </LabKpiStrip>
      <div>
        <LabSectionLabel>Predicted vs empirical gradient variance</LabSectionLabel>
        <LabKpiStrip label="Predicted and empirical variance">
          <LabKpi
            label="Predicted (Ragone et al.)"
            value={data.prediction_applicable ? formatSci(data.predicted_variance) : 'not applicable'}
            detail={data.prediction_applicable ? 'P𝔤(ρ) P𝔤(O) / dim 𝔤' : 'needs O or ρ in 𝔤'}
          />
          <LabKpi
            label="Empirical (mean)"
            value={empirical === undefined ? 'run gradients' : formatSci(empirical)}
            detail={
              empirical !== undefined && data.predicted_variance
                ? `ratio ${formatSci(empirical / data.predicted_variance, 2)}× predicted`
                : undefined
            }
          />
        </LabKpiStrip>
        <h4 className="lab-section-label" style={{ marginTop: 'var(--space-3)' }}>Assumptions</h4>
        <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', color: 'var(--color-text-secondary)' }}>
          {data.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>
      <LabCallout tone={data.simulability.kind === 'g_sim_feasible' ? 'success' : data.simulability.kind === 'exponential_dla' ? 'warning' : 'info'} title="Simulability verdict">
        {data.simulability.summary}
      </LabCallout>
      {data.generators.examples.length > 0 && (
        <p className="lab-muted" style={{ margin: 0 }}>
          Example generators: <span className="lab-mono">{data.generators.examples.join(', ')}</span>
        </p>
      )}
    </div>
  );
}
