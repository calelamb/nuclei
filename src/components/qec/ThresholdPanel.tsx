import { useMemo, useRef } from 'react';
import { Download } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import {
  thresholdSeries,
  lambdaFit,
  projectedDistanceForTarget,
  statsPointsToCsv,
  type ThresholdSeries,
} from '../../types/qecStats';
import { downloadCsv, downloadSvg } from '../../services/experimentExport';

const DOCS = 'https://getnuclei.dev/docs/research/qec-studio/';
const TARGET_LER = 1e-6;
const PLOT = { x0: 46, y0: 12, x1: 288, y1: 150 }; // inner plot rect

/**
 * PRD 10 Phase E — the threshold / Λ panel. Logical error rate per shot vs
 * the noise parameter on log-log axes, one series per (label × distance),
 * colored by decoder, with Wilson CI whiskers. Reports the fitted Λ (error-
 * suppression factor between successive distances) per decoder and a projected
 * code distance to reach a target logical error rate. Exports SVG + CSV.
 */
export function ThresholdPanel() {
  const colors = useThemeStore((s) => s.colors);
  const rowsByStrongId = useQecCampaignStore((s) => s.rowsByStrongId);
  const rows = useMemo(() => Object.values(rowsByStrongId), [rowsByStrongId]);
  const svgRef = useRef<SVGSVGElement>(null);

  const series = useMemo(() => thresholdSeries(rows), [rows]);
  const fits = useMemo(() => lambdaFit(rows), [rows]);

  const domain = useMemo(() => computeLogDomain(series), [series]);

  const header = (
    <PanelHeader
      title="Threshold / Λ"
      helpHref={DOCS}
      actions={
        series.length > 0 ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <ExportButton label="SVG" onClick={() => svgRef.current && downloadSvg(svgRef.current, 'threshold.svg')} colors={colors} />
            <ExportButton label="CSV" onClick={() => downloadCsv(statsPointsToCsv(rows), 'threshold.csv')} colors={colors} />
          </div>
        ) : undefined
      }
    />
  );

  if (series.length === 0 || !domain) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
        {header}
        <QecEmptyState
          title="No campaign results yet"
          body="Run a QEC campaign over a noise sweep to see logical error rate vs physical error, per distance."
          docsHref={DOCS}
        />
      </div>
    );
  }

  const decoders = [...new Set(series.map((s) => s.decoder))].sort();
  const decoderColor = (d: string) =>
    [colors.dirac, colors.accent, colors.success, colors.warning][decoders.indexOf(d) % 4];

  const sx = (noise: number) =>
    PLOT.x0 + ((Math.log10(noise) - domain.xMin) / (domain.xMax - domain.xMin)) * (PLOT.x1 - PLOT.x0);
  const sy = (ler: number) => {
    const v = Math.log10(Math.max(ler, domain.yFloor));
    return PLOT.y1 - ((v - domain.yMin) / (domain.yMax - domain.yMin)) * (PLOT.y1 - PLOT.y0);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
      {header}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <svg ref={svgRef} viewBox="0 0 300 168" style={{ width: '100%', height: 'auto', display: 'block' }}>
          {/* axes */}
          <line x1={PLOT.x0} y1={PLOT.y0} x2={PLOT.x0} y2={PLOT.y1} stroke={colors.border} strokeWidth={0.6} />
          <line x1={PLOT.x0} y1={PLOT.y1} x2={PLOT.x1} y2={PLOT.y1} stroke={colors.border} strokeWidth={0.6} />
          {/* y decade gridlines + labels */}
          {domain.yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={PLOT.x0} y1={sy(10 ** t)} x2={PLOT.x1} y2={sy(10 ** t)} stroke={colors.border} strokeWidth={0.25} strokeOpacity={0.5} />
              <text x={PLOT.x0 - 4} y={sy(10 ** t) + 2.5} fontSize={6.5} fill={colors.textDim} textAnchor="end" fontFamily="'Fira Code', monospace">
                1e{t}
              </text>
            </g>
          ))}
          {domain.xTicks.map((t) => (
            <text key={`x${t}`} x={sx(10 ** t)} y={PLOT.y1 + 8} fontSize={6.5} fill={colors.textDim} textAnchor="middle" fontFamily="'Fira Code', monospace">
              1e{t}
            </text>
          ))}
          <text x={(PLOT.x0 + PLOT.x1) / 2} y={166} fontSize={7} fill={colors.textDim} textAnchor="middle">physical error p</text>
          {/* series */}
          {series.map((s) => {
            const color = decoderColor(s.decoder);
            const pts = s.points.map((p) => ({ x: sx(p.noise), y: sy(p.rate.p), lo: sy(p.rate.lo), hi: sy(p.rate.hi) }));
            return (
              <g key={s.key}>
                <polyline
                  points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none" stroke={color} strokeWidth={0.9}
                  strokeDasharray={(s.distance ?? 0) % 2 === 1 ? undefined : '3 2'}
                />
                {pts.map((p, i) => (
                  <g key={i}>
                    <line x1={p.x} y1={p.hi} x2={p.x} y2={p.lo} stroke={color} strokeWidth={0.5} strokeOpacity={0.7} />
                    <circle cx={p.x} cy={p.y} r={1.4} fill={color} />
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
        {/* legend + Λ + projection */}
        <div style={{ padding: '4px 12px 10px', fontFamily: "'Geist Sans', sans-serif" }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
            {decoders.map((d) => (
              <span key={d} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: colors.textMuted }}>
                <span style={{ width: 10, height: 2, background: decoderColor(d) }} /> {d}
              </span>
            ))}
            <span style={{ fontSize: 9, color: colors.textDim }}>solid = odd distance · dashed = even</span>
          </div>
          {fits.map((f) => {
            const anySeries = series.find((s) => s.decoder === f.decoder && s.distance !== null);
            const base = anySeries?.points[0];
            const projected =
              f.lambda !== null && anySeries?.distance != null && base
                ? projectedDistanceForTarget(anySeries.distance, base.rate.p, f.lambda, TARGET_LER)
                : null;
            return (
              <div key={f.decoder} style={{ fontSize: 11, color: colors.text, marginBottom: 2 }}>
                <strong style={{ color: decoderColor(f.decoder) }}>{f.decoder}</strong>: Λ ={' '}
                {f.lambda !== null ? f.lambda.toFixed(2) : '—'}
                {projected !== null && (
                  <span style={{ color: colors.textDim }}> · ~d{projected} for {TARGET_LER.toExponential(0)} LER</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ExportButton({ label, onClick, colors }: { label: string; onClick: () => void; colors: ReturnType<typeof useThemeStore.getState>['colors'] }) {
  return (
    <button
      onClick={onClick}
      title={`Export ${label}`}
      aria-label={`Export ${label}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, background: 'transparent',
        border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.textMuted,
        cursor: 'pointer', fontSize: 11, padding: '4px 8px', fontFamily: "'Geist Sans', sans-serif",
      }}
    >
      <Download size={12} /> {label}
    </button>
  );
}

/** Log-domain bounds + decade ticks for the log-log axes. Returns null when
 * there is nothing plottable. */
function computeLogDomain(series: ThresholdSeries[]) {
  const noises: number[] = [];
  const lers: number[] = [];
  for (const s of series) {
    for (const p of s.points) {
      if (p.noise > 0) noises.push(p.noise);
      if (p.rate.hi > 0) lers.push(p.rate.hi);
      if (p.rate.p > 0) lers.push(p.rate.p);
    }
  }
  if (noises.length === 0 || lers.length === 0) return null;
  const yFloor = 1e-7;
  const xMin = Math.floor(Math.log10(Math.min(...noises)));
  const xMax = Math.ceil(Math.log10(Math.max(...noises)));
  const yMin = Math.floor(Math.log10(Math.max(Math.min(...lers), yFloor)));
  const yMax = Math.ceil(Math.log10(Math.max(...lers)));
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  return {
    xMin, xMax: Math.max(xMax, xMin + 1),
    yMin, yMax: Math.max(yMax, yMin + 1),
    yFloor,
    xTicks: range(xMin, Math.max(xMax, xMin + 1)),
    yTicks: range(yMin, Math.max(yMax, yMin + 1)),
  };
}
