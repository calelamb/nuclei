import { useMemo, type MouseEvent } from 'react';
import type { ThemeColors } from '../../stores/themeStore';
import { whiskerLow, type PlotModel } from '../../lib/qecPlotModel';
import type { SeriesPoint } from '../../lib/qecPlotPoints';
import { nearestPoint } from '../../lib/qecPlotPoints';
import { makeLogScale } from '../../lib/qecPlotTicks';
import {
  FIGURE_PAD, FONT, LEGEND_SWATCH_GAP, LEGEND_SWATCH_WIDTH, NOTE_LINE_HEIGHT, TICK_LENGTH,
  fitAxisTitle, layoutFigure, type FigureLayout,
} from '../../lib/qecPlotLayout';
import type { LegendGroup } from '../../lib/qecPlotStyle';
import { Marker, UpperLimitMarker } from './QecPlotMarks';

/** The few theme colours the figure paints with; the export swaps in a fixed print set. */
export type FigureColors = Pick<ThemeColors, 'bg' | 'text' | 'textMuted' | 'textDim'>;

export const FIGURE_FONT = "'Geist Sans', 'Helvetica Neue', Arial, sans-serif";
const HIT_RADIUS = 12;
const CAP = 2.5;

export interface HoverTarget {
  seriesKey: string;
  point: SeriesPoint;
  upper: boolean;
  /** Pixel position inside the figure. */
  x: number;
  y: number;
}

export interface QecPlotFigureProps {
  model: PlotModel;
  colors: FigureColors;
  width: number;
  /** Total height (live panel). Exactly one of height / plotHeight is used; plotHeight wins. */
  height?: number;
  /** Fixed plot-area height (export); total height follows. */
  plotHeight?: number;
  footerLines?: readonly string[];
  /** Serialized provenance JSON (<metadata>). */
  metadata?: string;
  title?: string;
  description?: string;
  idPrefix?: string;
  hover?: HoverTarget | null;
  onHover?: (target: HoverTarget | null) => void;
}

interface Scales { sx: (v: number) => number; sy: (v: number) => number }

function scalesFor(model: PlotModel, layout: FigureLayout): Scales {
  const { plot } = layout;
  return {
    sx: makeLogScale(model.xAxis, plot.x, plot.x + plot.w),
    sy: makeLogScale(model.yAxis, plot.y + plot.h, plot.y),
  };
}

export function QecPlotFigure(props: QecPlotFigureProps) {
  const { model, colors, width, footerLines = [], idPrefix = 'qec', hover = null, onHover } = props;
  const layout = useMemo(() => layoutFigure({
    width, height: props.height, plotHeight: props.plotHeight,
    yLabels: model.yAxis.labeled.map((t) => t.label),
    xLabels: model.xAxis.labeled.map((t) => t.label),
    legend: model.legend, noteLines: model.notes, footerLines,
  }), [width, props.height, props.plotHeight, model, footerLines]);
  const scales = useMemo(() => scalesFor(model, layout), [model, layout]);
  const targets = useMemo(() => hitTargets(model, scales), [model, scales]);
  const { plot } = layout;
  const clipId = `${idPrefix}-clip`;

  const onMove = (e: MouseEvent<SVGRectElement>) => {
    if (!onHover) return;
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + plot.x;
    const py = e.clientY - box.top + plot.y;
    const hit = nearestPoint(targets, px, py, HIT_RADIUS);
    onHover(hit ? { seriesKey: hit.seriesKey, point: hit.point, upper: hit.upper, x: hit.x, y: hit.y } : null);
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img" aria-labelledby={`${idPrefix}-title ${idPrefix}-desc`}
      style={{ display: 'block' }} fontFamily={FIGURE_FONT}
    >
      <title id={`${idPrefix}-title`}>{props.title ?? 'Logical error vs physical error'}</title>
      <desc id={`${idPrefix}-desc`}>{props.description ?? `${model.yTitle} versus physical error p, log-log.`}</desc>
      {props.metadata && <metadata id="qec-fig-metadata">{props.metadata}</metadata>}
      <defs>
        <clipPath id={clipId}><rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} /></clipPath>
      </defs>
      <rect data-export-bg x={0} y={0} width={layout.width} height={layout.height} fill={colors.bg} />
      <Axes model={model} layout={layout} scales={scales} colors={colors} />
      <g clipPath={`url(#${clipId})`}>
        <SeriesLayer model={model} scales={scales} colors={colors} />
        {hover && <circle cx={hover.x} cy={hover.y} r={8} fill="none" stroke={colors.text} strokeWidth={1.2} />}
      </g>
      <Legend groups={model.legend} layout={layout} colors={colors} />
      <TextBlock lines={layout.noteLines} x={FIGURE_PAD} y={layout.noteY} fill={colors.textMuted} testId="qec-svg-notes" />
      <TextBlock lines={layout.footerLines} x={FIGURE_PAD} y={layout.footerY} fill={colors.textMuted} testId="qec-svg-footer" />
      {onHover && (
        <rect
          x={plot.x} y={plot.y} width={plot.w} height={plot.h} fill="transparent"
          onMouseMove={onMove} onMouseLeave={() => onHover(null)} style={{ cursor: 'crosshair' }}
        />
      )}
    </svg>
  );
}

interface Hit extends HoverTarget { id: string }

function hitTargets(model: PlotModel, { sx, sy }: Scales): Hit[] {
  return model.parts.flatMap((s) => [
    ...s.normal.map((point) => ({ point, upper: false })),
    ...s.upper.map((point) => ({ point, upper: true })),
  ].map(({ point, upper }, i) => ({
    id: `${s.source.key}|${i}|${upper ? 'u' : 'n'}`, seriesKey: s.source.key, point, upper,
    x: sx(point.noise), y: sy(upper ? point.rate.hi : point.rate.p),
  })));
}

interface AxesProps { model: PlotModel; layout: FigureLayout; scales: Scales; colors: FigureColors }

function Axes({ model, layout, scales, colors }: AxesProps) {
  const { plot } = layout;
  const bottom = plot.y + plot.h;
  const grid = (key: string, x1: number, y1: number, x2: number, y2: number, major: boolean) => (
    <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={colors.textDim} strokeOpacity={major ? 0.3 : 0.12} strokeWidth={1} />
  );
  return (
    <g>
      {model.xAxis.minors.map((v) => grid(`xm${v}`, scales.sx(v), plot.y, scales.sx(v), bottom, false))}
      {model.yAxis.minors.map((v) => grid(`ym${v}`, plot.x, scales.sy(v), plot.x + plot.w, scales.sy(v), false))}
      {model.xAxis.labeled.map((t) => grid(`xM${t.value}`, scales.sx(t.value), plot.y, scales.sx(t.value), bottom, true))}
      {model.yAxis.labeled.map((t) => grid(`yM${t.value}`, plot.x, scales.sy(t.value), plot.x + plot.w, scales.sy(t.value), true))}
      <line x1={plot.x} y1={plot.y} x2={plot.x} y2={bottom} stroke={colors.textMuted} strokeWidth={1} />
      <line x1={plot.x} y1={bottom} x2={plot.x + plot.w} y2={bottom} stroke={colors.textMuted} strokeWidth={1} />
      {model.xAxis.labeled.map((t) => (
        <g key={`xt${t.value}`}>
          <line x1={scales.sx(t.value)} y1={bottom} x2={scales.sx(t.value)} y2={bottom + TICK_LENGTH} stroke={colors.textMuted} />
          <text x={scales.sx(t.value)} y={bottom + TICK_LENGTH + 4 + 9} fontSize={FONT.tick} fill={colors.textMuted} textAnchor="middle">{t.label}</text>
        </g>
      ))}
      {model.yAxis.labeled.map((t) => (
        <g key={`yt${t.value}`}>
          <line x1={plot.x - TICK_LENGTH} y1={scales.sy(t.value)} x2={plot.x} y2={scales.sy(t.value)} stroke={colors.textMuted} />
          <text x={plot.x - TICK_LENGTH - 4} y={scales.sy(t.value)} dy="0.35em" fontSize={FONT.tick} fill={colors.textMuted} textAnchor="end">{t.label}</text>
        </g>
      ))}
      <text x={plot.x + plot.w / 2} y={bottom + layout.margins.bottom - 7} fontSize={FONT.axisTitle} fill={colors.text} textAnchor="middle">{model.xTitle}</text>
      <text
        x={FIGURE_PAD + FONT.axisTitle * 0.8} y={plot.y + plot.h / 2} fontSize={FONT.axisTitle} fill={colors.text} textAnchor="middle"
        transform={`rotate(-90 ${FIGURE_PAD + FONT.axisTitle * 0.8} ${plot.y + plot.h / 2})`}
      >
        {fitAxisTitle(model.yTitle, model.yTitleShort, plot.h)}
      </text>
    </g>
  );
}

function SeriesLayer({ model, scales, colors }: { model: PlotModel; scales: Scales; colors: FigureColors }) {
  const { sx, sy } = scales;
  return (
    <g>
      {model.parts.map((s) => {
        const st = model.style.get(s.source.key);
        if (!st) return null;
        const bar = (p: SeriesPoint, key: string) => {
          const low = whiskerLow(p.rate.lo, model.yAxis);
          const x = sx(p.noise);
          const cap = (y: number) => `M${x - CAP} ${y}h${2 * CAP}`;
          return (
            <path
              key={key} stroke={st.color} strokeWidth={1.2} strokeOpacity={0.85} fill="none"
              d={`M${x} ${sy(p.rate.hi)}V${sy(low.value)}${cap(sy(p.rate.hi))}${low.open ? '' : cap(sy(low.value))}`}
            />
          );
        };
        return (
          <g key={s.source.key} data-series={s.source.key}>
            {s.normal.map((p, i) => bar(p, `b${i}`))}
            {s.normal.length > 0 && (
              <polyline
                points={s.normal.map((p) => `${sx(p.noise)},${sy(p.rate.p)}`).join(' ')}
                fill="none" stroke={st.color} strokeWidth={1.6} strokeDasharray={st.dash} strokeLinejoin="round"
              />
            )}
            {s.normal.map((p, i) => <Marker key={`m${i}`} shape={st.shape} cx={sx(p.noise)} cy={sy(p.rate.p)} color={st.color} />)}
            {s.upper.map((p, i) => (
              <UpperLimitMarker key={`u${i}`} cx={sx(p.noise)} cy={sy(p.rate.hi)} color={st.color} fill={colors.bg} />
            ))}
          </g>
        );
      })}
    </g>
  );
}

function Legend({ groups, layout, colors }: { groups: LegendGroup[]; layout: FigureLayout; colors: FigureColors }) {
  if (layout.legend.items.length === 0) return null;
  return (
    <g data-testid="qec-svg-legend" transform={`translate(${FIGURE_PAD} ${layout.legendY})`} fontSize={FONT.legend}>
      {layout.legend.items.map((it) => {
        const cy = it.y + 8;
        if (it.type === 'header') {
          return <text key={`h${it.group}`} x={it.x} y={it.y + 12} fill={colors.textMuted} fontSize={FONT.legend - 1}>{it.text}</text>;
        }
        const entry = groups[it.group].entries[it.entry];
        const mid = it.x + LEGEND_SWATCH_WIDTH / 2;
        return (
          <g key={`e${it.group}-${it.entry}`}>
            <line x1={it.x} y1={cy} x2={it.x + LEGEND_SWATCH_WIDTH} y2={cy} stroke={entry.color} strokeWidth={1.6} strokeDasharray={entry.dash} />
            <Marker shape={entry.shape} cx={mid} cy={cy} color={entry.color} />
            <text x={it.x + LEGEND_SWATCH_WIDTH + LEGEND_SWATCH_GAP} y={it.y + 12} fill={colors.text}>{it.text}</text>
          </g>
        );
      })}
    </g>
  );
}

function TextBlock({ lines, x, y, fill, testId }: { lines: string[]; x: number; y: number; fill: string; testId: string }) {
  if (lines.length === 0) return null;
  return (
    <g data-testid={testId} fontSize={FONT.note}>
      {lines.map((line, i) => (
        <text key={`${i}-${line}`} x={x} y={y + 10 + i * NOTE_LINE_HEIGHT} fill={fill}>{line}</text>
      ))}
    </g>
  );
}
