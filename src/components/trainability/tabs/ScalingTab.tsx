import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ChartFrame,
  LabCallout,
  LabKpi,
  LabKpiStrip,
  LabSegmented,
  LabTooltip,
  LegendItem,
  TooltipRows,
  catColor,
  formatInterval,
  formatSci,
  paddedDomain,
  type LabTooltipState,
} from '../../lab';
import type { ScalingFit, ScalingStudy } from '../../../types/trainability';
import { intervalNoun, methodName } from '../methodLabels';
import { VerdictPill } from '../pills';
import { distinctLayers, exponentialBand, exponentialCurve, meanOf, powerLawCurve, type Curve } from './scalingMath';

function path(curve: Curve[], x: (n: number) => number, y: (v: number) => number): string {
  return curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.n).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
}

function bandPath(lower: Curve[], upper: Curve[], x: (n: number) => number, y: (v: number) => number): string {
  const top = upper.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.n).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const bottom = [...lower].reverse().map((p) => `L${x(p.n).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return `${top} ${bottom} Z`;
}

function FitSummary({ fit }: { fit: ScalingFit }) {
  return (
    <div className="lab-stack" style={{ gap: 'var(--space-2)' }}>
      <div className="lab-row" style={{ flexWrap: 'wrap' }}>
        <VerdictPill verdict={fit.verdict} />
        {fit.exponential && (
          <span className="lab-mono" aria-label="Fitted scaling law">
            Var ∝ 2<sup>−β n</sup>, β = {formatSci(fit.exponential.beta, 3)} (95% CI {formatInterval(fit.exponential.beta_ci95, 3)})
          </span>
        )}
      </div>
      <p className="lab-muted" style={{ margin: 0 }}>{fit.summary}</p>
      <LabKpiStrip label="Model comparison">
        <LabKpi label="ΔAIC" value={fit.delta_aic === null ? '—' : formatSci(fit.delta_aic, 3)} detail={`preferred: ${fit.preferred.replace('_', ' ')}`} />
        <LabKpi label="Exponential R²" value={fit.exponential ? formatSci(fit.exponential.r2, 3) : '—'} detail={fit.exponential ? `AIC ${formatSci(fit.exponential.aic, 3)}` : undefined} />
        <LabKpi
          label="Power-law α"
          value={fit.power_law ? formatSci(fit.power_law.alpha, 3) : '—'}
          detail={fit.power_law ? `95% CI ${formatInterval(fit.power_law.alpha_ci95, 3)}` : undefined}
        />
      </LabKpiStrip>
    </div>
  );
}

export function ScalingTab({ data }: { data: ScalingStudy }) {
  const layers = useMemo(() => distinctLayers(data), [data]);
  const [chosen, setChosen] = useState<number | null>(null);
  const layer = chosen !== null && layers.includes(chosen) ? chosen : layers[layers.length - 1];
  const [tip, setTip] = useState<LabTooltipState | null>(null);

  const points = useMemo(() => data.points.filter((p) => p.n_layers === layer), [data, layer]);
  const fit = data.fits.find((f) => f.n_layers === layer) ?? null;
  const ns = points.map((p) => p.n_qubits);
  const nMin = Math.min(...ns, 2);
  const nMax = Math.max(...ns, nMin + 1);

  const curves = useMemo(() => {
    if (!fit) return null;
    const centroid = meanOf(ns);
    return {
      exp: fit.exponential ? exponentialCurve(fit.exponential, nMin, nMax) : null,
      band: fit.exponential ? exponentialBand(fit.exponential, centroid, nMin, nMax) : null,
      power: fit.power_law ? powerLawCurve(fit.power_law, points, nMin, nMax) : null,
    };
  }, [fit, ns, nMin, nMax, points]);

  const yDomain = useMemo(() => {
    const values = [
      ...points.flatMap((p) => [p.variance, ...(p.interval ?? p.variance_ci95)]),
      ...(curves?.band ? [...curves.band.lower, ...curves.band.upper].map((c) => c.value) : []),
    ];
    return paddedDomain(values, { log: true });
  }, [points, curves]);
  const xAxis = useMemo(
    () => ({
      domain: [Math.max(0, nMin - 1), nMax + 1] as [number, number],
      nice: false,
      label: 'qubits n',
      tickValues: [...new Set(ns)].filter((_, i, all) => all.length <= 10 || i % Math.ceil(all.length / 8) === 0),
      format: (v: number) => String(Math.round(v)),
    }),
    [ns, nMin, nMax],
  );
  const yAxis = useMemo(() => ({ type: 'log' as const, domain: yDomain, label: 'Var[∂C]' }), [yDomain]);

  const ppeCount = points.filter((p) => p.method === 'ppe').length;
  const maxN = Math.max(...ns);
  const summary = `Semilog plot of gradient variance against qubit count for ${points.length} points at ${layer} layers${
    fit ? `. ${fit.summary}` : '. No fit was returned.'
  }${ppeCount > 0 ? ` ${ppeCount} points use Pauli propagation, up to ${maxN} qubits.` : ''}`;

  return (
    <div className="lab-stack">
      {layers.length > 1 && (
        <LabSegmented
          label="Layer count"
          value={String(layer)}
          onChange={(id) => setChosen(Number(id))}
          items={layers.map((l) => ({ id: String(l), label: `${l} layers` }))}
        />
      )}
      {fit && <FitSummary fit={fit} />}
      {!fit && <LabCallout tone="warning" title="No fit for this layer count">The kernel did not return a scaling fit; the raw points are still shown.</LabCallout>}
      {data.points.length < 4 && (
        <LabCallout tone="info" title="Few qubit counts">
          Fits need at least 4 distinct n values; fewer is reported as inconclusive rather than guessed.
        </LabCallout>
      )}
      <ChartFrame
        x={xAxis}
        y={yAxis}
        height={300}
        ariaLabel="Gradient variance scaling with qubit count"
        summary={summary}
        legend={
          <>
            <LegendItem color={catColor(0)} shape="dot" label="sampling (95% bootstrap CI)" />
            <LegendItem color={catColor(0)} shape="square" label={`Pauli propagation (${intervalNoun('ppe')}, not a CI)`} />
            <LegendItem color="var(--color-accent-quantum)" shape="line" label="exponential fit" />
            <LegendItem color="var(--color-text-tertiary)" shape="line" label="power-law alternative" />
          </>
        }
      >
        {({ x, y }) => (
          <g>
            {curves?.band && <path d={bandPath(curves.band.lower, curves.band.upper, x, y)} style={{ fill: 'var(--lab-band)', stroke: 'none' }} />}
            {curves?.power && curves.power.length > 1 && (
              <path d={path(curves.power, x, y)} style={{ fill: 'none', stroke: 'var(--color-text-tertiary)', strokeWidth: 1.6, strokeDasharray: '5 4' }} />
            )}
            {curves?.exp && curves.exp.length > 1 && (
              <path d={path(curves.exp, x, y)} style={{ fill: 'none', stroke: 'var(--color-accent-quantum)', strokeWidth: 2 }} />
            )}
            {points.map((p) => {
              const interval = p.interval ?? p.variance_ci95;
              const cx = x(p.n_qubits);
              const ppe = p.method === 'ppe';
              const show = (e: ReactPointerEvent) =>
                setTip({
                  x: e.clientX,
                  y: e.clientY,
                  content: (
                    <TooltipRows
                      title={`n = ${p.n_qubits}, ${p.n_layers} layers`}
                      rows={[
                        { label: 'Var[∂C]', value: formatSci(p.variance) },
                        { label: intervalNoun(p.method), value: formatInterval(interval) },
                        { label: 'method', value: methodName(p.method) },
                        { label: 'parameters', value: String(p.n_params) },
                      ]}
                    />
                  ),
                });
              return (
                <g key={`${p.n_qubits}-${p.n_layers}`} onPointerEnter={show} onPointerMove={show} onPointerLeave={() => setTip(null)}>
                  <line x1={cx} x2={cx} y1={y(interval[0])} y2={y(interval[1])} style={{ stroke: catColor(0), strokeWidth: 1.6 }} />
                  <line x1={cx - 4} x2={cx + 4} y1={y(interval[0])} y2={y(interval[0])} style={{ stroke: catColor(0), strokeWidth: 1.6 }} />
                  <line x1={cx - 4} x2={cx + 4} y1={y(interval[1])} y2={y(interval[1])} style={{ stroke: catColor(0), strokeWidth: 1.6 }} />
                  {ppe ? (
                    <rect x={cx - 4.5} y={y(p.variance) - 4.5} width={9} height={9} rx={2} style={{ fill: catColor(0) }} />
                  ) : (
                    <circle cx={cx} cy={y(p.variance)} r={4.5} style={{ fill: catColor(0) }} />
                  )}
                </g>
              );
            })}
          </g>
        )}
      </ChartFrame>
      <p className="lab-muted" style={{ margin: 0 }}>
        The band propagates β&apos;s 95% CI about the data centroid; the power-law curve is anchored on the data&apos;s log-mean (the kernel reports α only). Squares mark Pauli-propagation points{ppeCount > 0 ? ` (${ppeCount}, up to ${maxN} qubits)` : ''}.
      </p>
      {(data.notes ?? []).map((note) => (
        <LabCallout key={note} tone="info">{note}</LabCallout>
      ))}
      <LabTooltip state={tip} />
    </div>
  );
}
