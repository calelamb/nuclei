import { useMemo } from 'react';
import { ChartFrame, LabCallout, LabKpi, LabKpiStrip, LabPill, LegendItem, formatDuration, formatSci, paddedDomain } from '../../lab';
import type { KernelAlignmentResult } from '../../../types/trainability';
import { formatChannelNoise, isExactChannelNoise } from '../../../services/trainability/settings';

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function KernelAlignmentTab({ data }: { data: KernelAlignmentResult }) {
  const alignments = data.history.map((h) => h.alignment);
  const yDomain = useMemo(
    () => paddedDomain(alignments.length > 0 ? alignments : [0, 1]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );
  const xAxis = useMemo(
    () => ({
      domain: [0, Math.max(1, data.history.length - 1)] as [number, number],
      nice: false,
      label: 'step',
      format: (v: number) => (Number.isInteger(v) ? String(v) : ''),
    }),
    [data],
  );
  const yAxis = useMemo(() => ({ domain: yDomain, label: 'train alignment', nice: true }), [yDomain]);
  const stepsRun = data.steps_run ?? data.history.length;
  const n = data.kernel.length;
  const summary = `Kernel-alignment search (${data.mode}) on the ${data.dataset} dataset over ${stepsRun} SPSA steps. Train alignment rose from ${formatSci(data.initial.alignment)} to ${formatSci(data.best.alignment)} at the best iterate; its test accuracy is ${pct(data.best.test_accuracy)} against the RBF baseline's ${pct(data.rbf_baseline_test_accuracy)}.`;
  return (
    <div className="lab-stack">
      <LabKpiStrip label="Kernel alignment summary">
        <LabKpi label="Best alignment" value={formatSci(data.best.alignment)} detail={`from ${formatSci(data.initial.alignment)}`} title="Centred kernel-target alignment of the train Gram matrix at the restored best iterate" />
        <LabKpi label="Best test accuracy" value={pct(data.best.test_accuracy)} detail={`from ${pct(data.initial.test_accuracy)}, ${data.n_test} held out`} />
        <LabKpi label="Best train accuracy" value={pct(data.best.train_accuracy)} detail={`from ${pct(data.initial.train_accuracy)}, ${data.n_train} train`} />
        <LabKpi label="RBF baseline" value={pct(data.rbf_baseline_test_accuracy)} detail="test accuracy, same split" title="Bandwidth-tuned quantum kernels collapse toward RBF kernels; read the tuned numbers against this" />
        <LabKpi label="Steps" value={stepsRun} detail={data.mode} />
        <LabKpi label="Elapsed" value={formatDuration(data.elapsed_ms)} detail={data.backend} />
      </LabKpiStrip>
      <div className="lab-row" style={{ flexWrap: 'wrap' }}>
        <LabPill tone="quantum" outline title="What the SPSA search optimized: per-feature bandwidths, the non-data circuit parameters, or both">
          mode: {data.mode}
        </LabPill>
        <LabPill outline title="Per-feature bandwidths w at the best iterate (data enter as w ⊙ x)">
          bandwidth: {data.bandwidth.map((w) => formatSci(w)).join(', ')}
        </LabPill>
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
        ariaLabel="Kernel alignment search history"
        summary={summary}
        legend={<LegendItem color="var(--color-accent-quantum)" shape="line" label="train alignment" />}
      >
        {({ x, y }) => (
          <g>
            <polyline
              points={data.history.map((h) => `${x(h.step)},${y(h.alignment)}`).join(' ')}
              style={{ fill: 'none', stroke: 'var(--color-accent-quantum)', strokeWidth: 2 }}
            />
            {data.history.map((h) => (
              <circle key={h.step} cx={x(h.step)} cy={y(h.alignment)} r={2} style={{ fill: 'var(--color-accent-quantum)' }} />
            ))}
          </g>
        )}
      </ChartFrame>
      <div style={{ overflow: 'auto', maxHeight: 200 }}>
        <table className="lab-table" aria-label="Alignment before and after search">
          <thead>
            <tr><th>Iterate</th><th className="lab-num">Alignment</th><th className="lab-num">Train accuracy</th><th className="lab-num">Test accuracy</th></tr>
          </thead>
          <tbody>
            <tr>
              <td className="lab-mono">initial</td>
              <td className="lab-num">{formatSci(data.initial.alignment)}</td>
              <td className="lab-num">{pct(data.initial.train_accuracy)}</td>
              <td className="lab-num">{pct(data.initial.test_accuracy)}</td>
            </tr>
            <tr>
              <td className="lab-mono">best (restored)</td>
              <td className="lab-num">{formatSci(data.best.alignment)}</td>
              <td className="lab-num">{pct(data.best.train_accuracy)}</td>
              <td className="lab-num">{pct(data.best.test_accuracy)}</td>
            </tr>
            <tr>
              <td className="lab-mono">final</td>
              <td className="lab-num">{formatSci(data.final.alignment)}</td>
              <td className="lab-num">{pct(data.final.train_accuracy)}</td>
              <td className="lab-num">{pct(data.final.test_accuracy)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <figure style={{ margin: 0 }}>
        <div
          role="img"
          aria-label="Best quantum kernel matrix heatmap"
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
        Best-iterate kernel above. Off-diagonal concentration moved from mean{' '}
        <span className="lab-mono">{formatSci(data.concentration.before.offdiag_mean)}</span> (var{' '}
        {formatSci(data.concentration.before.offdiag_var)}, effective dim.{' '}
        {formatSci(data.concentration.before.effective_dimension)}) to mean{' '}
        <span className="lab-mono">{formatSci(data.concentration.after.offdiag_mean)}</span> (var{' '}
        {formatSci(data.concentration.after.offdiag_var)}, effective dim.{' '}
        {formatSci(data.concentration.after.effective_dimension)}). Alignment is optimized on the train
        split only; test accuracy is observational.
      </p>
      <div style={{ overflow: 'auto', maxHeight: 220 }}>
        <table className="lab-table" aria-label="Best parameters">
          <thead>
            <tr><th>Parameter</th><th>Kind</th><th className="lab-num">Best value</th></tr>
          </thead>
          <tbody>
            {data.data_params.map((name, i) => (
              <tr key={name}>
                <td className="lab-mono">{name}</td>
                <td>bandwidth</td>
                <td className="lab-num">{formatSci(data.bandwidth[i])}</td>
              </tr>
            ))}
            {data.trainable_params.map((name) => (
              <tr key={name}>
                <td className="lab-mono">{name}</td>
                <td>circuit θ</td>
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
