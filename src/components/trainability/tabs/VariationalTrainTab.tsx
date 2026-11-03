import { useMemo } from 'react';
import { ChartFrame, LabCallout, LabKpi, LabKpiStrip, LabPill, LegendItem, formatDuration, formatSci, paddedDomain } from '../../lab';
import type { VariationalTrainResult } from '../../../types/trainability';
import { formatChannelNoise, isExactChannelNoise } from '../../../services/trainability/settings';

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function VariationalTrainTab({ data }: { data: VariationalTrainResult }) {
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
  const optimizerLabel = data.optimizer ?? 'adam';
  const methodLabel = data.gradient_method === 'parameter_shift' ? 'parameter-shift' : data.gradient_method ?? 'adjoint';
  const summary = `Training loss over ${epochsRun} epochs of ${optimizerLabel} (${methodLabel}) on the ${data.dataset} dataset. Loss fell from ${formatSci(data.initial_loss)} to ${formatSci(data.final_loss)}; final test accuracy ${pct(data.final_test_accuracy)}.`;
  return (
    <div className="lab-stack">
      <LabKpiStrip label="Variational training summary">
        <LabKpi label="Final loss" value={formatSci(data.final_loss)} detail={`from ${formatSci(data.initial_loss)}`} />
        <LabKpi label="Test accuracy" value={pct(data.final_test_accuracy)} detail={`${data.n_test} held out`} />
        <LabKpi label="Train accuracy" value={pct(data.final_train_accuracy)} detail={`${data.n_train} train`} />
        <LabKpi label="Epochs" value={epochsRun} detail={data.stopped_early ? `early stop of ${data.epochs}, ${optimizerLabel}` : `${optimizerLabel}, lr ${data.learning_rate}`} />
        <LabKpi label="Optimizer" value={optimizerLabel} detail={data.optimizer === 'spsa' ? 'SPSA (own gradient)' : methodLabel} />
        <LabKpi label="Elapsed" value={formatDuration(data.elapsed_ms)} detail={data.backend} />
      </LabKpiStrip>
      <div className="lab-row" style={{ flexWrap: 'wrap' }}>
        <LabPill tone="quantum" outline title="Optimizer and gradient method that produced this result">
          {optimizerLabel} · {methodLabel}
        </LabPill>
        {data.stopped_early && (
          <LabPill tone="warning" outline title="Training stopped before the requested epoch count">
            stopped early at {epochsRun}/{data.epochs}
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
        ariaLabel="Variational training loss curve"
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
        parameters: <span className="lab-mono">{data.trainable_params.join(', ')}</span>.
      </p>
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
