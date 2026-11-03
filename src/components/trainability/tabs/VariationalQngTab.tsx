import { useMemo } from 'react';
import { ChartFrame, LabCallout, LabKpi, LabKpiStrip, LabPill, LegendItem, formatDuration, formatSci, paddedDomain } from '../../lab';
import type { VariationalQngResult } from '../../../types/trainability';
import { formatChannelNoise, isExactChannelNoise } from '../../../services/trainability/settings';

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function fmtNullable(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? formatSci(value) : '—';
}

export function VariationalQngTab({ data }: { data: VariationalQngResult }) {
  const losses = data.history.map((h) => h.loss);
  const yDomain = useMemo(
    () => paddedDomain(losses.length > 0 ? losses : [0, 1]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );
  const xAxis = useMemo(
    () => ({
      domain: [0, Math.max(1, data.history.length - 1)] as [number, number],
      nice: false,
      label: 'epoch',
      format: (v: number) => (Number.isInteger(v) ? String(v) : ''),
    }),
    [data],
  );
  const yAxis = useMemo(() => ({ domain: yDomain, label: 'MSE loss', nice: true }), [yDomain]);
  const epochsRun = data.epochs_run ?? data.history.length;
  const last = data.history.length > 0 ? data.history[data.history.length - 1] : undefined;
  const summary = `Quantum natural gradient training loss over ${epochsRun} epochs on the ${data.dataset} dataset. Loss fell from ${formatSci(data.initial_loss)} to ${formatSci(data.final_loss)}; final test accuracy ${pct(data.final_test_accuracy)}${last ? `; final natural-gradient norm ${fmtNullable(last.natural_grad_norm)} and metric condition ${fmtNullable(last.metric_condition)}` : ''}.`;
  return (
    <div className="lab-stack">
      <LabKpiStrip label="Variational QNG summary">
        <LabKpi label="Final loss" value={formatSci(data.final_loss)} detail={`from ${formatSci(data.initial_loss)}`} />
        <LabKpi label="Test accuracy" value={pct(data.final_test_accuracy)} detail={`${data.n_test} held out`} />
        <LabKpi label="Train accuracy" value={pct(data.final_train_accuracy)} detail={`${data.n_train} train`} />
        <LabKpi label="Epochs" value={epochsRun} detail={`qng, lr ${data.learning_rate}`} />
        <LabKpi label="Natural-grad norm" value={fmtNullable(last?.natural_grad_norm)} detail="final epoch ‖(g + λI)⁻¹∇L‖" title="Norm of the Fubini–Study-preconditioned gradient step direction at the final epoch" />
        <LabKpi label="Metric condition" value={fmtNullable(last?.metric_condition)} detail="final epoch, regularized" title="Condition number of g + λI; large values mean the natural-gradient solve is ill-conditioned" />
        <LabKpi label="Metric eff. dim." value={formatSci(data.metric_effective_dimension)} detail={`${data.metric_eigenvalues.length} eigenvalues`} />
        <LabKpi label="Elapsed" value={formatDuration(data.elapsed_ms)} detail={data.backend} />
      </LabKpiStrip>
      <div className="lab-row" style={{ flexWrap: 'wrap' }}>
        <LabPill tone="quantum" outline title="Quantum natural gradient: θ ← θ − η (g + λI)⁻¹ ∇L with the Fubini–Study metric g">
          qng · λ = {formatSci(data.metric_regularization)}, metric every {data.metric_every}
        </LabPill>
        {data.fallbacks > 0 && (
          <LabPill tone="warning" outline title="Epochs where the metric solve fell back to lstsq or a plain gradient step">
            {data.fallbacks} metric fallback{data.fallbacks === 1 ? '' : 's'}
          </LabPill>
        )}
        {!isExactChannelNoise(data.channel_noise) && (
          <LabPill tone="dirac" outline title="Simulated channel, not a device calibration">
            noise: {formatChannelNoise(data.channel_noise)}
          </LabPill>
        )}
      </div>
      <ChartFrame
        x={xAxis}
        y={yAxis}
        height={240}
        ariaLabel="Variational QNG loss curve"
        summary={summary}
        legend={<LegendItem color="var(--color-accent-quantum)" shape="line" label="train MSE loss" />}
      >
        {({ x, y }) => (
          <g>
            <polyline
              points={data.history.map((h) => `${x(h.epoch)},${y(h.loss)}`).join(' ')}
              style={{ fill: 'none', stroke: 'var(--color-accent-quantum)', strokeWidth: 2 }}
            />
            {data.history.map((h) => (
              <circle key={h.epoch} cx={x(h.epoch)} cy={y(h.loss)} r={2} style={{ fill: 'var(--color-accent-quantum)' }} />
            ))}
          </g>
        )}
      </ChartFrame>
      <p className="lab-muted" style={{ margin: 0 }}>
        Model score is <span className="lab-mono">⟨{data.observable}⟩</span>, prediction is its sign. Data parameters
        {' '}<span className="lab-mono">{data.data_params.join(', ')}</span> encode the {data.dataset} features; trained
        parameters: <span className="lab-mono">{data.trainable_params.join(', ')}</span>. Each step preconditions
        the exact adjoint gradient with the batch-averaged Fubini–Study metric.
      </p>
      <div style={{ overflow: 'auto', maxHeight: 220 }}>
        <table className="lab-table" aria-label="Natural gradient history">
          <thead>
            <tr>
              <th className="lab-num">Epoch</th>
              <th className="lab-num">‖∇L‖</th>
              <th className="lab-num">‖natural grad‖</th>
              <th className="lab-num">Metric condition</th>
            </tr>
          </thead>
          <tbody>
            {data.history.map((h) => (
              <tr key={h.epoch}>
                <td className="lab-num">{h.epoch}</td>
                <td className="lab-num">{fmtNullable(h.grad_norm)}</td>
                <td className="lab-num">{fmtNullable(h.natural_grad_norm)}</td>
                <td className="lab-num">{fmtNullable(h.metric_condition)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ overflow: 'auto', maxHeight: 220 }}>
        <table className="lab-table" aria-label="Trained parameters">
          <thead>
            <tr><th>Parameter</th><th className="lab-num">Initial</th><th className="lab-num">Final</th></tr>
          </thead>
          <tbody>
            {data.trainable_params.map((name) => (
              <tr key={name}>
                <td className="lab-mono">{name}</td>
                <td className="lab-num">{formatSci(data.initial_parameters[name])}</td>
                <td className="lab-num">{formatSci(data.final_parameters[name])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.notes.map((note) => (
        <LabCallout key={note} tone="info">{note}</LabCallout>
      ))}
    </div>
  );
}
