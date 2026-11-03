import { LabCallout, LabKpi, LabKpiStrip, LabPill, formatDuration, formatSci } from '../../lab';
import type { ClassicalBaselineResult } from '../../../types/trainability';
import { formatChannelNoise, isExactChannelNoise } from '../../../services/trainability/settings';

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signedPp(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)} pp`;
}

const VERDICT_LABELS: Record<string, string> = {
  quantum_ahead: 'quantum ahead',
  classical_ahead: 'classical ahead',
  tie: 'tie',
  no_quantum_kernel: 'no quantum kernel',
};

export function ClassicalBaselineTab({ data }: { data: ClassicalBaselineResult }) {
  const bestIndex = data.baselines.reduce(
    (best, entry, i) =>
      entry.alignment > data.baselines[best].alignment ||
      (entry.alignment === data.baselines[best].alignment && entry.train_accuracy > data.baselines[best].train_accuracy)
        ? i
        : best,
    0,
  );
  const best = data.baselines[bestIndex];
  const verdictTone =
    data.verdict === 'quantum_ahead'
      ? 'success'
      : data.verdict === 'classical_ahead'
        ? 'warning'
        : data.verdict === 'tie'
          ? 'neutral'
          : 'dirac';
  const summary = data.quantum
    ? `On the ${data.dataset} split (${data.n_train} train / ${data.n_test} test) the quantum kernel scores ${pct(data.quantum.test_accuracy)} test accuracy against the best classical baseline (${data.best_baseline}) at ${pct(best.test_accuracy)}; verdict ${VERDICT_LABELS[data.verdict] ?? data.verdict}.`
    : `Classical baselines on the ${data.dataset} split (${data.n_train} train / ${data.n_test} test); best is ${data.best_baseline} at ${pct(best.test_accuracy)}. No quantum kernel was computed for this circuit.`;
  return (
    <div className="lab-stack">
      <LabKpiStrip label="Classical baseline summary">
        <LabKpi
          label="Quantum test accuracy"
          value={data.quantum ? pct(data.quantum.test_accuracy) : '—'}
          detail={data.quantum ? `${data.n_test} held out` : 'no quantum kernel'}
        />
        <LabKpi label="Best classical" value={pct(best.test_accuracy)} detail={`${best.name}${best.gamma != null ? `, γ = ${formatSci(best.gamma)}` : ''}`} />
        <LabKpi
          label="Δ test accuracy"
          value={data.delta_test_accuracy != null ? signedPp(data.delta_test_accuracy) : '—'}
          detail="quantum − best classical"
        />
        <LabKpi
          label="Geometric diff."
          value={data.geometric_difference != null ? formatSci(data.geometric_difference) : '—'}
          detail="g CQ vs best classical"
          title="Huang et al. geometric difference between the quantum and best classical kernels; bounds the separation any kernel method could achieve between the two feature maps"
        />
        <LabKpi label="Elapsed" value={formatDuration(data.elapsed_ms)} detail={data.backend} />
      </LabKpiStrip>
      <div className="lab-row" style={{ flexWrap: 'wrap' }}>
        <LabPill tone={verdictTone} outline title="Verdict on this split; |Δ| within one test sample counts as a tie">
          verdict: {VERDICT_LABELS[data.verdict] ?? data.verdict}
        </LabPill>
        <LabPill tone="quantum" outline title="Selected by train alignment (tie: train accuracy); test accuracy is never used for selection">
          best baseline: {data.best_baseline}
        </LabPill>
        {!isExactChannelNoise(data.channel_noise) && (
          <LabPill tone="dirac" outline title="Simulated channel, not a device calibration">
            noise: {formatChannelNoise(data.channel_noise)}
          </LabPill>
        )}
      </div>
      <p className="lab-muted" style={{ margin: 0 }}>{summary}</p>
      <div style={{ overflow: 'auto', maxHeight: 260 }}>
        <table className="lab-table" aria-label="Quantum kernel versus classical baselines">
          <thead>
            <tr>
              <th>Kernel</th>
              <th className="lab-num">γ</th>
              <th className="lab-num">Alignment</th>
              <th className="lab-num">Train accuracy</th>
              <th className="lab-num">Test accuracy</th>
              <th className="lab-num">Effective dim.</th>
            </tr>
          </thead>
          <tbody>
            {data.quantum && (
              <tr>
                <td className="lab-mono">quantum</td>
                <td className="lab-num">—</td>
                <td className="lab-num">{formatSci(data.quantum.alignment)}</td>
                <td className="lab-num">{pct(data.quantum.train_accuracy)}</td>
                <td className="lab-num">{pct(data.quantum.test_accuracy)}</td>
                <td className="lab-num">{formatSci(data.quantum.effective_dimension)}</td>
              </tr>
            )}
            {data.baselines.map((entry, i) => (
              <tr key={`${entry.name}-${entry.gamma ?? 'linear'}`}>
                <td className="lab-mono">{entry.name}{i === bestIndex ? ' (best)' : ''}</td>
                <td className="lab-num">{entry.gamma != null ? formatSci(entry.gamma) : '—'}</td>
                <td className="lab-num">{formatSci(entry.alignment)}</td>
                <td className="lab-num">{pct(entry.train_accuracy)}</td>
                <td className="lab-num">{pct(entry.test_accuracy)}</td>
                <td className="lab-num">{formatSci(entry.effective_dimension)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lab-muted" style={{ margin: 0 }}>
        Every kernel is scored by kernel ridge regression on the identical {data.dataset} split the quantum
        kernel sees. The RBF grid is anchored at the train-pairs median heuristic; the winner is picked by
        train alignment, so the baseline choice cannot leak test information.
        {data.geometric_difference != null && (
          <>
            {' '}The geometric difference <span className="lab-mono">g_CQ = {formatSci(data.geometric_difference)}</span>{' '}
            bounds how far the quantum geometry can separate from the best classical one on this data.
          </>
        )}
      </p>
      {data.notes.map((note) => (
        <LabCallout key={note} tone="info">{note}</LabCallout>
      ))}
    </div>
  );
}
