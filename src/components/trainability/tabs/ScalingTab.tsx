import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ChartFrame,
  LabCallout,
  LabKpi,
  LabKpiStrip,
  LabSectionLabel,
  LabSegmented,
  LabTooltip,
  LegendItem,
  TooltipRows,
  catColor,
  formatInterval,
  formatSci,
  formatValue,
  paddedDomain,
  type LabTooltipState,
} from '../../lab';
import type { ScalingFit, ScalingPoint, ScalingStudy } from '../../../types/trainability';
import { intervalNounOf } from '../../../services/trainability/intervals';
import { stripVerdictPrefix } from '../../../services/trainability/verdict';
import { methodName } from '../methodLabels';
import { VerdictPill } from '../pills';
import {
  distinctLayers,
  exponentialBand,
  exponentialCurve,
  meanOf,
  powerLawCurve,
  preferredModel,
  splitScalingPoints,
  type Curve,
} from './scalingMath';

function path(curve: Curve[], x: (n: number) => number, y: (v: number) => number): string {
  return curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.n).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
}

function bandPath(lower: Curve[], upper: Curve[], x: (n: number) => number, y: (v: number) => number): string {
  const top = upper.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.n).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const bottom = [...lower].reverse().map((p) => `L${x(p.n).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return `${top} ${bottom} Z`;
}

/** The headline names the preferred model first, then the verdict it supports. */
function Headline({ fit }: { fit: ScalingFit }) {
  const preferred = preferredModel(fit);
  if (preferred === 'power_law' && fit.power_law) {
    return (
      <span className="lab-mono" aria-label="Preferred scaling model">
        Preferred: power law, Var ∝ n<sup>−α</sup>, α = {formatSci(fit.power_law.alpha, 3)} (95% CI {formatInterval(fit.power_law.alpha_ci95, 3)})
      </span>
    );
  }
  if (preferred === 'exponential' && fit.exponential) {
    return (
      <span className="lab-mono" aria-label="Preferred scaling model">
        Preferred: exponential, Var ∝ 2<sup>−β n</sup>, β = {formatSci(fit.exponential.beta, 3)} (95% CI {formatInterval(fit.exponential.beta_ci95, 3)})
      </span>
    );
  }
  return <span className="lab-muted">No scaling model is preferred for this layer count.</span>;
}

function FitSummary({ fit }: { fit: ScalingFit }) {
  const reason = fit.verdict === 'inconclusive' ? stripVerdictPrefix(fit.summary) : fit.summary;
  const preferred = preferredModel(fit);
  return (
    <div className="lab-stack" style={{ gap: 'var(--space-2)' }}>
      <div className="lab-row" style={{ flexWrap: 'wrap' }}>
        <VerdictPill verdict={fit.verdict} />
        <Headline fit={fit} />
      </div>
      {reason && <p className="lab-muted" style={{ margin: 0 }}>{reason}</p>}
      <LabKpiStrip label="Model comparison">
        <LabKpi label="ΔAIC" value={fit.delta_aic === null ? '—' : formatSci(fit.delta_aic, 3)} detail={`preferred: ${preferred === 'none' ? 'none' : preferred.replace('_', ' ')}`} />
        <LabKpi
          label="Exponential β"
          value={fit.exponential ? formatSci(fit.exponential.beta, 3) : '—'}
          detail={fit.exponential ? `R² ${formatSci(fit.exponential.r2, 3)}, AIC ${formatSci(fit.exponential.aic, 3)}` : undefined}
        />
        <LabKpi
          label="Power-law α"
          value={fit.power_law ? formatSci(fit.power_law.alpha, 3) : '—'}
          detail={fit.power_law ? `95% CI ${formatInterval(fit.power_law.alpha_ci95, 3)}` : undefined}
        />
      </LabKpiStrip>
    </div>
  );
}

function FailedPoints({ points }: { points: ScalingPoint[] }) {
  if (points.length === 0) return null;
  return (
    <section aria-label="Failed points">
      <LabSectionLabel>Failed points ({points.length})</LabSectionLabel>
      <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-4)', color: 'var(--color-text-secondary)' }}>
        {points.map((p, i) => (
          <li key={`${p.n_qubits}-${p.n_layers}-${i}`}>
            <span className="lab-mono">n = {p.n_qubits}, {p.n_layers} layers</span>: {p.error ? `${p.error.code}, ${p.error.message}` : 'no estimate returned'}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ScalingTab({ data }: { data: ScalingStudy }) {
  const layers = useMemo(() => distinctLayers(data), [data]);
  const [chosen, setChosen] = useState<number | null>(null);
  const layer = chosen !== null && layers.includes(chosen) ? chosen : layers[layers.length - 1];
  const [tip, setTip] = useState<LabTooltipState | null>(null);

  const sets = useMemo(() => splitScalingPoints(data.points), [data]);
  const resolved = useMemo(() => sets.resolved.filter((p) => p.n_layers === layer), [sets, layer]);
  const intervalOnly = useMemo(() => sets.intervalOnly.filter((p) => p.n_layers === layer), [sets, layer]);
  const plotted = useMemo(() => [...resolved, ...intervalOnly], [resolved, intervalOnly]);
  const fit = data.fits.find((f) => f.n_layers === layer) ?? null;
  const ns = useMemo(() => plotted.map((p) => p.n_qubits), [plotted]);
  const nMin = Math.min(...ns, 2);
  const nMax = Math.max(...ns, nMin + 1);

  const curves = useMemo(() => {
    if (!fit) return null;
    const centroid = meanOf(ns);
    return {
      exp: fit.exponential ? exponentialCurve(fit.exponential, nMin, nMax) : null,
      band: fit.exponential ? exponentialBand(fit.exponential, centroid, nMin, nMax) : null,
      power: fit.power_law ? powerLawCurve(fit.power_law, resolved, nMin, nMax) : null,
    };
  }, [fit, ns, nMin, nMax, resolved]);

  const yDomain = useMemo(() => {
    const values = [
      ...plotted.flatMap((p) => [...(p.variance === null ? [] : [p.variance]), ...p.variance_ci95]),
      ...(curves?.band ? [...curves.band.lower, ...curves.band.upper].map((c) => c.value) : []),
    ];
    return paddedDomain(values, { log: true });
  }, [plotted, curves]);
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

  const ppeCount = plotted.filter((p) => p.method === 'ppe').length;
  const samplingCount = plotted.length - ppeCount;
  const maxN = ns.length > 0 ? Math.max(...ns) : null;
  const summary = `Semilog plot of gradient variance against qubit count for ${plotted.length} points at ${layer} layers${
    fit ? `. ${fit.verdict === 'inconclusive' ? `Inconclusive: ${stripVerdictPrefix(fit.summary) || 'no reason given'}` : fit.summary}` : '. No fit was returned.'
  }${ppeCount > 0 && maxN !== null ? ` ${ppeCount} points use Pauli propagation, up to ${maxN} qubits.` : ''}`;

  if (layers.length === 0) {
    return (
      <LabCallout tone="warning" title="No scaling points">
        The kernel returned no scaling points, so there is nothing to plot.
      </LabCallout>
    );
  }

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
      {sets.resolved.length + sets.intervalOnly.length < 4 && (
        <LabCallout tone="info" title="Few qubit counts">
          Fits need at least 4 distinct n values; fewer is reported as inconclusive rather than guessed.
        </LabCallout>
      )}
      {intervalOnly.length > 0 && (
        <LabCallout tone="info" title="Interval-only points">
          {intervalOnly.length} point{intervalOnly.length === 1 ? '' : 's'} (hollow whiskers) resolved only a rigorous truncation interval, so no
          variance is plotted and the fit excludes them.
        </LabCallout>
      )}
      {plotted.length === 0 ? (
        <LabCallout tone="warning" title="No plottable points">
          Every point at {layer} layers failed or returned no estimate, so there is nothing to plot.
        </LabCallout>
      ) : (
        <ChartFrame
          x={xAxis}
          y={yAxis}
          height={300}
          ariaLabel="Gradient variance scaling with qubit count"
          summary={summary}
          legend={
            <>
              {samplingCount > 0 && <LegendItem color={catColor(0)} shape="dot" label="sampling (95% bootstrap CI)" />}
              {ppeCount > 0 && <LegendItem color={catColor(0)} shape="square" label="Pauli propagation (rigorous truncation interval, not a CI)" />}
              {curves?.exp && <LegendItem color="var(--color-accent-quantum)" shape="line" label="exponential fit" />}
              {curves?.power && <LegendItem color="var(--color-text-tertiary)" shape="line" label="power-law alternative" />}
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
              {plotted.map((p) => {
                const interval = p.variance_ci95;
                const cx = x(p.n_qubits);
                const ppe = p.method === 'ppe';
                const hollow = p.variance === null;
                const show = (e: ReactPointerEvent) =>
                  setTip({
                    x: e.clientX,
                    y: e.clientY,
                    content: (
                      <TooltipRows
                        title={`n = ${p.n_qubits}, ${p.n_layers} layers`}
                        rows={[
                          { label: 'Var[∂C]', value: hollow ? 'unresolved (interval only)' : formatSci(p.variance) },
                          { label: intervalNounOf(p), value: formatInterval(interval) },
                          { label: 'method', value: methodName(p.method) },
                          { label: 'parameters', value: formatValue(p.n_params) },
                        ]}
                      />
                    ),
                  });
                const stroke = { stroke: catColor(0), strokeWidth: 1.6, strokeDasharray: hollow ? '3 2' : undefined };
                return (
                  <g key={`${p.n_qubits}-${p.n_layers}`} onPointerEnter={show} onPointerMove={show} onPointerLeave={() => setTip(null)}>
                    <line x1={cx} x2={cx} y1={y(interval[0])} y2={y(interval[1])} style={stroke} />
                    <line x1={cx - 4} x2={cx + 4} y1={y(interval[0])} y2={y(interval[0])} style={stroke} />
                    <line x1={cx - 4} x2={cx + 4} y1={y(interval[1])} y2={y(interval[1])} style={stroke} />
                    {p.variance !== null &&
                      (ppe ? (
                        <rect x={cx - 4.5} y={y(p.variance) - 4.5} width={9} height={9} rx={2} style={{ fill: catColor(0) }} />
                      ) : (
                        <circle cx={cx} cy={y(p.variance)} r={4.5} style={{ fill: catColor(0) }} />
                      ))}
                  </g>
                );
              })}
            </g>
          )}
        </ChartFrame>
      )}
      {plotted.length > 0 && (
        <p className="lab-muted" style={{ margin: 0 }}>
          {curves?.band ? 'The band propagates β’s 95% CI about the data centroid. ' : ''}
          {curves?.power ? 'The power-law curve is anchored on the data’s log-mean (the kernel reports α only). ' : ''}
          {ppeCount > 0 && maxN !== null ? `Squares mark Pauli-propagation points (${ppeCount}, up to ${maxN} qubits).` : ''}
        </p>
      )}
      <FailedPoints points={sets.failed} />
      {(data.notes ?? []).map((note) => (
        <LabCallout key={note} tone="info">{note}</LabCallout>
      ))}
      <LabTooltip state={tip} />
    </div>
  );
}

