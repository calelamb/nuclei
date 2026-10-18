import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ChartFrame,
  LabKpi,
  LabKpiStrip,
  LabPill,
  LabTooltip,
  LegendItem,
  TooltipRows,
  formatDuration,
  formatInterval,
  formatSci,
  paddedDomain,
  type LabTooltipState,
} from '../../lab';
import type { GradientStatistics } from '../../../types/trainability';
import { intervalNoun } from '../methodLabels';
import { MethodPill } from '../pills';

/** Smallest plottable variance; zero-variance (dead) parameters pin here. */
const FLOOR = 1e-12;

export function GradientsTab({ data }: { data: GradientStatistics }) {
  const [tip, setTip] = useState<LabTooltipState | null>(null);
  const params = data.per_parameter;
  const ppe = data.method === 'ppe';
  const noun = intervalNoun(data.method);

  const yDomain = useMemo(() => {
    const values = params.flatMap((p) => [p.variance, ...p.variance_ci95]).filter((v) => v > FLOOR);
    return paddedDomain(values.length > 0 ? values : [FLOOR * 10, 1], { log: true });
  }, [params]);
  const xAxis = useMemo(
    () => ({
      domain: [-0.5, Math.max(0.5, params.length - 0.5)] as [number, number],
      nice: false,
      label: 'parameter',
      tickValues: params.map((_, i) => i).filter((i) => params.length <= 16 || i % Math.ceil(params.length / 12) === 0),
      format: (v: number) => (Number.isInteger(v) ? String(v) : ''),
    }),
    [params],
  );
  const yAxis = useMemo(() => ({ type: 'log' as const, domain: yDomain, label: 'Var[∂C/∂θ]' }), [yDomain]);

  const summary = `Per-parameter gradient variance for ${params.length} parameters on a log axis, with ${noun}s. Mean variance ${formatSci(
    data.variance_mean,
  )}; mean gradient norm ${formatSci(data.gradient_norm_mean)}; ${data.samples} samples.`;

  return (
    <div className="lab-stack">
      <LabKpiStrip label="Gradient summary">
        <LabKpi label="Mean Var[∂C/∂θ]" value={formatSci(data.variance_mean)} detail={`${noun} ${formatInterval(data.interval ?? data.variance_mean_ci95)}`} />
        <LabKpi label="Mean ‖∇C‖" value={formatSci(data.gradient_norm_mean)} />
        <LabKpi label="Samples" value={data.samples} detail={`init ${data.init}`} />
        <LabKpi label="Elapsed" value={formatDuration(data.elapsed_ms)} detail={data.backend ?? undefined} />
      </LabKpiStrip>
      <div className="lab-row" style={{ flexWrap: 'wrap' }}>
        <MethodPill method={data.method} />
        {ppe && (
          <span className="lab-muted">
            Whiskers are the rigorous truncation interval of the Pauli-propagation estimate, not a confidence interval.
          </span>
        )}
      </div>
      <ChartFrame
        x={xAxis}
        y={yAxis}
        height={280}
        ariaLabel="Per-parameter gradient variance"
        summary={summary}
        legend={
          <>
            <LegendItem color="var(--color-accent-quantum)" shape="dot" label="Var[∂C/∂θ]" />
            <LegendItem color="var(--color-accent-quantum)" shape="line" label={ppe ? 'rigorous truncation interval' : '95% bootstrap CI'} />
            <LegendItem color="var(--color-text-tertiary)" shape="ring" label="dead (variance ≈ 0)" />
          </>
        }
      >
        {({ x, y, innerHeight }) => (
          <g>
            {params.map((p, i) => {
              const dead = p.variance <= FLOOR;
              const cx = x(i);
              const lo = Math.max(FLOOR, p.variance_ci95[0]);
              const hi = Math.max(FLOOR, p.variance_ci95[1]);
              const show = (event: ReactPointerEvent) =>
                setTip({
                  x: event.clientX,
                  y: event.clientY,
                  content: (
                    <TooltipRows
                      title={p.name}
                      rows={[
                        { label: 'Var[∂C/∂θ]', value: formatSci(p.variance) },
                        { label: noun, value: formatInterval(p.variance_ci95) },
                        { label: 'E|∂C/∂θ|', value: formatSci(p.abs_mean) },
                        { label: 'E[∂C/∂θ]', value: formatSci(p.mean) },
                        { label: 'samples', value: String(data.samples) },
                      ]}
                    />
                  ),
                });
              return (
                <g key={p.name} onPointerEnter={show} onPointerMove={show} onPointerLeave={() => setTip(null)}>
                  <rect x={cx - 10} y={0} width={20} height={innerHeight} fill="transparent" />
                  {!dead && (
                    <>
                      <line x1={cx} x2={cx} y1={y(lo)} y2={y(hi)} style={{ stroke: 'var(--color-accent-quantum)', strokeWidth: 1.6 }} />
                      <line x1={cx - 4} x2={cx + 4} y1={y(lo)} y2={y(lo)} style={{ stroke: 'var(--color-accent-quantum)', strokeWidth: 1.6 }} />
                      <line x1={cx - 4} x2={cx + 4} y1={y(hi)} y2={y(hi)} style={{ stroke: 'var(--color-accent-quantum)', strokeWidth: 1.6 }} />
                    </>
                  )}
                  {dead ? (
                    <circle cx={cx} cy={y(FLOOR)} r={4} style={{ fill: 'none', stroke: 'var(--color-text-tertiary)', strokeWidth: 1.6 }} />
                  ) : (
                    <circle cx={cx} cy={y(p.variance)} r={4} style={{ fill: 'var(--color-accent-quantum)' }} />
                  )}
                </g>
              );
            })}
          </g>
        )}
      </ChartFrame>
      <div style={{ overflow: 'auto', maxHeight: 220 }}>
        <table className="lab-table" aria-label="Per-parameter gradient statistics">
          <thead>
            <tr>
              <th>Parameter</th>
              <th className="lab-num">Var[∂C/∂θ]</th>
              <th className="lab-num">{ppe ? 'Truncation interval' : '95% CI'}</th>
              <th className="lab-num">E|∂C/∂θ|</th>
              <th className="lab-num">Mean</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {params.map((p) => (
              <tr key={p.name}>
                <td className="lab-mono">{p.name}</td>
                <td className="lab-num">{formatSci(p.variance)}</td>
                <td className="lab-num">{formatInterval(p.variance_ci95)}</td>
                <td className="lab-num">{formatSci(p.abs_mean)}</td>
                <td className="lab-num">{formatSci(p.mean)}</td>
                <td>{p.variance <= FLOOR ? <LabPill tone="warning" dot>dead</LabPill> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LabTooltip state={tip} />
    </div>
  );
}
