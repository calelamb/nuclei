import { useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import { QecCsvDropZone } from './QecCsvDropZone';
import { isWebBuild } from '../../platform/buildTarget';
import type { ThresholdSeries } from '../../types/qecStats';
import {
  DEFAULT_MAX_LIKELIHOOD_FACTOR,
  LAMBDA_CI_CONVENTION,
  MIN_LAMBDA_DISTANCES,
  lambdaEstimates,
  likelihoodSeries,
  qecFigureMetadata,
  roundsFromMetadata,
  whiskerConvention,
  type LambdaGroupEstimate,
  type RateUnits,
} from '../../lib/qecFit';
import { qecRatesToCsv } from '../../lib/qecExport';
import { downloadCsv, downloadSvg } from '../../services/experimentExport';

const DOCS = 'https://getnuclei.dev/docs/research/qec-studio/';
const PLOT = { x0: 46, y0: 12, x1: 288, y1: 150 }; // inner plot rect

/**
 * Logical error vs physical error. Logical error rate (per shot, or per round
 * when the campaign records rounds) against the noise parameter on log-log
 * axes, one series per (label × distance), colored by decoder. Whiskers are
 * sinter's likelihood-ratio interval. Λ is estimated by log-linear regression
 * of LER vs distance at each p (>= 3 distances) and shown with its interval.
 * No threshold p_th is estimated, so none is claimed. Exports SVG + CSV; the
 * SVG embeds a <metadata> block naming the estimators, CI method and units.
 */
export function ThresholdPanel() {
  const colors = useThemeStore((s) => s.colors);
  const rowsByStrongId = useQecCampaignStore((s) => s.rowsByStrongId);
  const rows = useMemo(() => Object.values(rowsByStrongId), [rowsByStrongId]);
  const svgRef = useRef<SVGSVGElement>(null);

  const [requestedUnits, setRequestedUnits] = useState<RateUnits>('per_shot');
  const roundsKnown = useMemo(() => rows.some((r) => roundsFromMetadata(r.json_metadata) !== null), [rows]);
  const units: RateUnits = roundsKnown ? requestedUnits : 'per_shot';
  const { series, excluded, invalid, noKept } = useMemo(() => likelihoodSeries(rows, { units }), [rows, units]);
  const lambdas = useMemo(() => lambdaEstimates(rows, { units }), [rows, units]);
  const meta = useMemo(() => qecFigureMetadata(units, DEFAULT_MAX_LIKELIHOOD_FACTOR, lambdas), [units, lambdas]);
  const lambdaLines = useMemo(() => lambdas.map(lambdaLine), [lambdas]);
  const hasDiscards = useMemo(() => rows.some((r) => r.discards > 0), [rows]);

  const domain = useMemo(() => computeLogDomain(series), [series]);

  const csvImport = useQecCampaignStore((s) => s.csvImport);
  const emptyBody = csvImport
    ? 'Nothing to plot yet: choose a numeric column for p in the mapping above.'
    : isWebBuild()
      ? 'Drop a sinter stats CSV to see logical error rate vs physical error, per distance.'
      : 'Run a QEC campaign over a noise sweep, or drop a sinter stats CSV, to see logical error rate vs physical error, per distance.';

  const header = (
    <PanelHeader
      title="Logical error vs physical error"
      helpHref={DOCS}
      actions={
        series.length > 0 ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <ExportButton label="SVG" onClick={() => svgRef.current && downloadSvg(svgRef.current, 'logical-error-vs-p.svg')} colors={colors} />
            <ExportButton label="CSV" onClick={() => downloadCsv(qecRatesToCsv(rows, { units }), 'logical-error-vs-p.csv')} colors={colors} />
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
          title={csvImport ? 'No plottable points' : 'No campaign results yet'}
          body={emptyBody}
          docsHref={DOCS}
        >
          <QecCsvDropZone />
        </QecEmptyState>
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
        {roundsKnown && <UnitsToggle units={units} onChange={setRequestedUnits} colors={colors} />}
        <svg
          ref={svgRef}
          viewBox={`0 0 300 ${180 + lambdaLines.length * 8 + (lambdaLines.length > 0 ? 4 : 0)}`}
          role="img"
          aria-labelledby="qec-fig-title qec-fig-desc"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: '100%', height: 'auto', display: 'block' }}
        >
          <title id="qec-fig-title">{meta.title}</title>
          <desc id="qec-fig-desc">{`${meta.units} versus physical error p, log-log. ${meta.ci_method}.`}</desc>
          <metadata id="qec-fig-metadata">{JSON.stringify(meta)}</metadata>
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
          <text x={(PLOT.x0 + PLOT.x1) / 2} y={165} fontSize={7} fill={colors.textDim} textAnchor="middle">physical error p</text>
          <text
            x={8} y={(PLOT.y0 + PLOT.y1) / 2} fontSize={7} fill={colors.textDim} textAnchor="middle"
            transform={`rotate(-90 8 ${(PLOT.y0 + PLOT.y1) / 2})`}
          >
            {meta.units}
          </text>
          <text x={(PLOT.x0 + PLOT.x1) / 2} y={175} fontSize={5.5} fill={colors.textDim} textAnchor="middle">
            {`Whiskers: sinter ${whiskerConvention()}, not Wilson`}
          </text>
          {lambdaLines.map((line, i) => (
            <text key={line} x={PLOT.x0} y={186 + i * 8} fontSize={5.5} fill={colors.text} fontFamily="'Fira Code', monospace">
              {line}
            </text>
          ))}
          {lambdaLines.length > 0 && (
            <text x={(PLOT.x0 + PLOT.x1) / 2} y={181} fontSize={5.5} fill={colors.textDim} textAnchor="middle">
              {`Λ interval: ${LAMBDA_CI_CONVENTION}`}
            </text>
          )}
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
          <LambdaReadout
            decoders={decoders} estimates={lambdas} decoderColor={decoderColor}
            units={units} colors={colors}
          />
          <div style={{ fontSize: 9, color: colors.textDim, marginTop: 6, lineHeight: 1.4 }}>
            {`Whiskers: ${whiskerConvention()}, `}
            {hasDiscards ? 'on shots − discards. ' : 'on shots. '}
            {excluded > 0 && `${excluded} row(s) without known rounds are hidden in per-round view. `}
            {invalid > 0 && `${invalid} malformed row(s) (errors exceed kept shots) skipped. `}
            {noKept > 0 && `${noKept} row(s) with every shot discarded skipped. `}
            No threshold p_th is estimated.
          </div>
        </div>
      </div>
    </div>
  );
}

type Colors = ReturnType<typeof useThemeStore.getState>['colors'];

function UnitsToggle({ units, onChange, colors }: { units: RateUnits; onChange: (u: RateUnits) => void; colors: Colors }) {
  const opts: Array<[RateUnits, string]> = [['per_shot', 'Per shot'], ['per_round', 'Per round']];
  return (
    <div role="group" aria-label="Logical error units" style={{ display: 'flex', gap: 4, padding: '6px 12px 0' }}>
      {opts.map(([u, text]) => (
        <button
          key={u}
          type="button"
          aria-pressed={units === u}
          onClick={() => onChange(u)}
          style={{
            background: units === u ? colors.accent : 'transparent',
            color: units === u ? colors.bg : colors.textMuted,
            border: `1px solid ${colors.border}`, borderRadius: 4, cursor: 'pointer',
            fontSize: 11, padding: '3px 8px', fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function lambdaLine(e: LambdaGroupEstimate): string {
  const dropped = e.estimate.droppedZeroError.length > 0 ? `; 0 errors at d ${e.estimate.droppedZeroError.join(',')} omitted` : '';
  return (
    `${e.decoder} ${e.label} p=${e.noise}: Λ = ${fmt(e.estimate.lambda.best)} ` +
    `(${fmt(e.estimate.lambda.low)} to ${fmt(e.estimate.lambda.high)}, ≈1σ), d ${e.estimate.distances.join(',')}${dropped}`
  );
}

const fmt = (x: number) => (x >= 100 ? x.toFixed(0) : x.toPrecision(3));

function LambdaReadout(props: {
  decoders: string[]; estimates: LambdaGroupEstimate[]; decoderColor: (d: string) => string;
  units: RateUnits; colors: Colors;
}) {
  const { decoders, estimates, decoderColor, units, colors } = props;
  return (
    <div aria-label="Error suppression factor Λ">
      {decoders.map((d) => {
        const mine = estimates.filter((e) => e.decoder === d);
        return (
          <div key={d} style={{ fontSize: 11, color: colors.text, marginBottom: 4 }}>
            <strong style={{ color: decoderColor(d) }}>{d}</strong>
            {mine.length === 0 ? (
              <span style={{ color: colors.textDim }}>{`: Λ not estimated, needs ≥ ${MIN_LAMBDA_DISTANCES} distances at the same p`}</span>
            ) : (
              mine.map((e) => (
                <div key={`${e.experiment}\u0000${e.noise}`} style={{ paddingLeft: 8 }}>
                  <span style={{ color: colors.textMuted }}>{`${e.label}: `}</span>
                  {`Λ = ${fmt(e.estimate.lambda.best)} (${fmt(e.estimate.lambda.low)} to ${fmt(e.estimate.lambda.high)}, ≈1σ)`}
                  <span style={{ color: colors.textDim }}>
                    {` at p=${e.noise}, d ${e.estimate.distances.join(',')}, per Δd=${e.estimate.step}, ${units === 'per_round' ? 'per round' : 'per shot'}`}
                    {e.estimate.droppedZeroError.length > 0 &&
                      `; d ${e.estimate.droppedZeroError.join(',')} had 0 errors and is not in the fit (suppression is at least as strong)`}
                  </span>
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

function ExportButton({ label, onClick, colors }: { label: string; onClick: () => void; colors: Colors }) {
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
