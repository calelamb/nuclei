import { useId, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ChartFrame,
  LabCallout,
  LabKpi,
  LabKpiStrip,
  LabPill,
  LabTooltip,
  LegendItem,
  TooltipRows,
  formatDuration,
  formatInterval,
  formatSci,
  formatValue,
  paddedDomain,
  type LabTooltipState,
} from '../../lab';
import type { GradientStatistics } from '../../../types/trainability';
import { intervalKindOf, intervalNounOf, isNumber, methodDescription, validInterval } from '../../../services/trainability/intervals';
import { MethodPill } from '../pills';

/** Smallest plottable variance; zero-variance (dead) parameters pin here. */
const FLOOR = 1e-12;
const UNRESOLVED = 'unresolved (interval only)';

export function GradientsTab({ data }: { data: GradientStatistics }) {
  const [tip, setTip] = useState<LabTooltipState | null>(null);
  const hatchId = useId();
  const params = data.per_parameter;
  const ppe = data.method === 'ppe';
  const noun = intervalNounOf(data);
  const kind = intervalKindOf(data);
  const meanResolved = isNumber(data.variance_mean);
  const meanInterval = validInterval(data.variance_mean_ci95);
  const unresolvedCount = params.filter((p) => !isNumber(p.variance)).length;

  const yDomain = useMemo(() => {
    const values = params
      .flatMap((p) => [p.variance, ...(validInterval(p.variance_ci95) ?? [])])
      .filter((v): v is number => isNumber(v) && v > FLOOR);
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

  const basis = isNumber(data.samples) ? `${data.samples} samples` : methodDescription(data.method);
  const summary = `Per-parameter gradient variance for ${params.length} parameters on a log axis, with ${noun}s${
    unresolvedCount > 0 ? `; ${unresolvedCount} unresolved, interval only` : ''
  }. Mean variance ${meanResolved ? formatSci(data.variance_mean) : UNRESOLVED}; mean gradient norm ${formatSci(
    data.gradient_norm_mean,
  )}; ${basis}.`;

  const notes = (data.notes ?? []).filter((n) => n.trim().length > 0);

  return (
    <div className="lab-stack">
      {!meanResolved && (
        <LabCallout tone="warning" title="Mean variance is unresolved">
          {methodDescription(data.method)} did not produce a variance estimate for this circuit. Only the {noun}{' '}
          <span className="lab-mono">{formatInterval(meanInterval)}</span> is rigorous
          {notes.length > 0 ? `: ${notes.join(' ')}` : '.'}
        </LabCallout>
      )}
      {meanResolved && notes.map((n) => <LabCallout key={n} tone="info">{n}</LabCallout>)}
      <LabKpiStrip label="Gradient summary">
        <LabKpi
          label="Mean Var[∂C/∂θ]"
          value={meanResolved ? formatSci(data.variance_mean) : 'unresolved'}
          detail={`${noun} ${formatInterval(meanInterval)}`}
        />
        <LabKpi label="Mean ‖∇C‖" value={formatSci(data.gradient_norm_mean)} detail={data.gradient_norm_mean === null ? 'not reported by this estimator' : undefined} />
        <LabKpi
          label="Samples"
          value={isNumber(data.samples) ? data.samples : '—'}
          detail={isNumber(data.samples) ? `init ${data.init}` : ppe ? 'exact Pauli propagation, no sampling' : `init ${data.init}`}
        />
        <LabKpi label="Elapsed" value={formatDuration(data.elapsed_ms)} detail={data.backend ?? undefined} />
        {isNumber(data.cost_variance) && (
          <LabKpi
            label="Cost variance Var[C]"
            value={formatSci(data.cost_variance)}
            detail={validInterval(data.cost_variance_ci95) ? `95% CI ${formatInterval(data.cost_variance_ci95)}` : undefined}
            title="Empirical variance of the cost itself, the quantity Ragone et al. predict"
          />
        )}
      </LabKpiStrip>
      <div className="lab-row" style={{ flexWrap: 'wrap' }}>
        <MethodPill method={data.method} />
        {ppe && (
          <span className="lab-muted">
            Exact Pauli propagation, no sampling. Whiskers are {kind === 'truncation' ? 'the rigorous truncation interval' : 'an interval'}, not a confidence interval.
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
            <LegendItem color="var(--color-accent-quantum)" shape="line" label={kind === 'truncation' ? 'rigorous truncation interval' : '95% bootstrap CI'} />
            <LegendItem color="var(--color-text-tertiary)" shape="ring" label="dead (variance ≈ 0)" />
            {unresolvedCount > 0 && <LegendItem color="var(--color-text-tertiary)" shape="square" label={UNRESOLVED} />}
          </>
        }
      >
        {({ x, y, innerHeight }) => (
          <g>
            <defs>
              <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="5" style={{ stroke: 'var(--color-text-tertiary)', strokeWidth: 1.4 }} />
              </pattern>
            </defs>
            {params.map((p, i) => {
              const cx = x(i);
              const ci = validInterval(p.variance_ci95);
              const variance = p.variance;
              const resolved = isNumber(variance);
              const dead = resolved && variance <= FLOOR;
              const lo = ci ? Math.max(FLOOR, ci[0]) : null;
              const hi = ci ? Math.max(FLOOR, ci[1]) : null;
              const show = (event: ReactPointerEvent) =>
                setTip({
                  x: event.clientX,
                  y: event.clientY,
                  content: (
                    <TooltipRows
                      title={p.name}
                      rows={[
                        { label: 'Var[∂C/∂θ]', value: resolved ? formatSci(variance) : UNRESOLVED },
                        { label: noun, value: formatInterval(ci) },
                        { label: 'E|∂C/∂θ|', value: formatSci(p.abs_mean) },
                        { label: 'E[∂C/∂θ]', value: formatSci(p.mean) },
                        { label: 'samples', value: formatValue(data.samples) },
                      ]}
                    />
                  ),
                });
              return (
                <g key={p.name} onPointerEnter={show} onPointerMove={show} onPointerLeave={() => setTip(null)}>
                  <rect x={cx - 10} y={0} width={20} height={innerHeight} fill="transparent" />
                  {!resolved && lo !== null && hi !== null && (
                    <rect
                      x={cx - 6}
                      y={y(hi)}
                      width={12}
                      height={Math.max(2, y(lo) - y(hi))}
                      style={{ fill: `url(#${hatchId})`, stroke: 'var(--color-text-tertiary)', strokeWidth: 1, strokeDasharray: '3 2' }}
                    />
                  )}
                  {resolved && !dead && lo !== null && hi !== null && (
                    <>
                      <line x1={cx} x2={cx} y1={y(lo)} y2={y(hi)} style={{ stroke: 'var(--color-accent-quantum)', strokeWidth: 1.6 }} />
                      <line x1={cx - 4} x2={cx + 4} y1={y(lo)} y2={y(lo)} style={{ stroke: 'var(--color-accent-quantum)', strokeWidth: 1.6 }} />
                      <line x1={cx - 4} x2={cx + 4} y1={y(hi)} y2={y(hi)} style={{ stroke: 'var(--color-accent-quantum)', strokeWidth: 1.6 }} />
                    </>
                  )}
                  {resolved &&
                    (dead ? (
                      <circle cx={cx} cy={y(FLOOR)} r={4} style={{ fill: 'none', stroke: 'var(--color-text-tertiary)', strokeWidth: 1.6 }} />
                    ) : (
                      <circle cx={cx} cy={y(variance)} r={4} style={{ fill: 'var(--color-accent-quantum)' }} />
                    ))}
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
              <th className="lab-num">{kind === 'truncation' ? 'Truncation interval' : '95% CI'}</th>
              <th className="lab-num">E|∂C/∂θ|</th>
              <th className="lab-num">Mean</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {params.map((p) => (
              <tr key={p.name}>
                <td className="lab-mono">{p.name}</td>
                <td className="lab-num">{isNumber(p.variance) ? formatSci(p.variance) : <span className="lab-dim">{UNRESOLVED}</span>}</td>
                <td className="lab-num">{formatInterval(p.variance_ci95)}</td>
                <td className="lab-num">{formatSci(p.abs_mean)}</td>
                <td className="lab-num">{formatSci(p.mean)}</td>
                <td>
                  {!isNumber(p.variance) ? (
                    <LabPill tone="neutral" outline>unresolved</LabPill>
                  ) : p.variance <= FLOOR ? (
                    <LabPill tone="warning" dot>dead</LabPill>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LabTooltip state={tip} />
    </div>
  );
}
