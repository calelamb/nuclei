import { LabCallout, LabKpi, LabKpiStrip, LabPill, formatDuration, formatSci } from '../../lab';
import type { QuantumKernelResult } from '../../../types/trainability';
import { formatChannelNoise, isExactChannelNoise } from '../../../services/trainability/settings';

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function QmlKernelTab({ data }: { data: QuantumKernelResult }) {
  const n = data.kernel.length;
  const summary = `Fidelity kernel matrix for ${n} samples of the ${data.dataset} dataset. Centred kernel-target alignment ${formatSci(data.alignment)}; kernel ridge test accuracy ${pct(data.test_accuracy)} on ${data.n_test} held-out samples.`;
  return (
    <div className="lab-stack">
      <LabKpiStrip label="Quantum kernel summary">
        <LabKpi label="Alignment" value={formatSci(data.alignment)} detail="centred alignment with y yᵀ" title="Kernel-target alignment in [0, 1]; higher means the geometry matches the labels" />
        <LabKpi label="Test accuracy" value={pct(data.test_accuracy)} detail={`${data.n_test} held out`} />
        <LabKpi label="Train accuracy" value={pct(data.train_accuracy)} detail={`${data.n_train} train`} />
        <LabKpi label="Effective dim." value={formatSci(data.effective_dimension)} detail={`top eigenvalue share ${pct(data.top_eigenvalue_share)}`} />
        <LabKpi label="Elapsed" value={formatDuration(data.elapsed_ms)} detail={data.backend} />
      </LabKpiStrip>
      {!isExactChannelNoise(data.channel_noise) && (
        <div className="lab-row" style={{ flexWrap: 'wrap' }}>
          <LabPill tone="dirac" outline title="Simulated channel, not a device calibration">
            noise: {formatChannelNoise(data.channel_noise)}
          </LabPill>
          {data.kernel_shot_variance != null && (
            <LabPill outline title="Mean per-entry shot variance of the kernel estimate">
              kernel shot variance {formatSci(data.kernel_shot_variance)}
            </LabPill>
          )}
        </div>
      )}
      <figure style={{ margin: 0 }}>
        <div
          role="img"
          aria-label="Quantum kernel matrix heatmap"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${n}, 1fr)`,
            gap: 1,
            maxWidth: 520,
            aspectRatio: '1 / 1',
            background: 'var(--lab-surface-3)',
            border: '1px solid var(--lab-hairline)',
            borderRadius: 'var(--radius-soft)',
            padding: 4,
          }}
        >
          {data.kernel.flatMap((row, i) =>
            row.map((value, j) => (
              <div
                key={`${i}-${j}`}
                title={`K[${i}][${j}] = ${value.toFixed(3)} (labels ${data.labels[i]}, ${data.labels[j]})`}
                style={{
                  background: 'var(--color-accent-quantum)',
                  opacity: Math.max(0.04, Math.min(1, value)),
                  outline: data.labels[i] !== data.labels[j] ? '1px solid var(--lab-surface-1)' : undefined,
                }}
              />
            )),
          )}
        </div>
        <figcaption className="lab-sr-only">{summary}</figcaption>
      </figure>
      <p className="lab-muted" style={{ margin: 0 }}>
        Rows and columns are dataset samples in dataset order; brightness is the fidelity
        {' '}<span className="lab-mono">K(x, x′) = |⟨φ(x)|φ(x′)⟩|²</span>. The classifier is kernel ridge regression
        (λ = {data.ridge_lambda}) on this precomputed kernel.
      </p>
      <div style={{ overflow: 'auto', maxHeight: 200 }}>
        <table className="lab-table" aria-label="Kernel spectrum">
          <thead>
            <tr><th>Eigenvalue rank</th><th className="lab-num">λ</th><th className="lab-num">Share</th></tr>
          </thead>
          <tbody>
            {data.eigenvalues.slice(0, 8).map((value, i) => {
              const total = data.eigenvalues.reduce((a, b) => a + b, 0);
              return (
                <tr key={i}>
                  <td className="lab-mono">{i + 1}</td>
                  <td className="lab-num">{formatSci(value)}</td>
                  <td className="lab-num">{total > 0 ? pct(value / total) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data.notes.map((note) => (
        <LabCallout key={note} tone="info">{note}</LabCallout>
      ))}
    </div>
  );
}
