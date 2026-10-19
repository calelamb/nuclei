/**
 * PRD 14 — Quantum AI Lab chart kit. Plain React SVG over d3 scales (the
 * house pattern from SweepPlotChart): recessive grid/axes, mono tabular ticks,
 * log scales, a crosshair + hover callback, and an accessible name + text
 * summary on every chart. Colors come from lab.css roles only.
 */

import { useId, useMemo, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { scaleLinear, scaleLog, type ScaleLinear, type ScaleLogarithmic } from 'd3';
import { useElementWidth } from './hooks';
import { formatTick } from './chartUtils';

// ── Chart frame ───────────────────────────────────────────────────────────

export interface AxisSpec {
  type?: 'linear' | 'log';
  domain: [number, number];
  label?: string;
  ticks?: number;
  format?: (value: number) => string;
  /** Round the domain to nice values (linear only). Default true. */
  nice?: boolean;
  /** Explicit tick values (overrides `ticks`). */
  tickValues?: number[];
}

export type AnyScale = ScaleLinear<number, number> | ScaleLogarithmic<number, number>;

export interface ChartScales {
  x: (value: number) => number;
  y: (value: number) => number;
  xScale: AnyScale;
  yScale: AnyScale;
  innerWidth: number;
  innerHeight: number;
}

export interface ChartPointer {
  /** Data-space coordinates under the pointer. */
  dataX: number;
  dataY: number;
  /** Plot-space pixel coordinates (inside the margins). */
  px: number;
  py: number;
  clientX: number;
  clientY: number;
}

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function buildScale(spec: AxisSpec, range: [number, number]): AnyScale {
  if (spec.type === 'log') {
    const lo = Math.max(spec.domain[0], Number.MIN_VALUE);
    const hi = Math.max(spec.domain[1], lo * 10);
    return scaleLog().domain([lo, hi]).range(range).clamp(true);
  }
  const s = scaleLinear().domain(spec.domain).range(range);
  return spec.nice === false ? s : s.nice(spec.ticks ?? 5);
}

function ticksFor(spec: AxisSpec, scale: AnyScale): number[] {
  if (spec.tickValues) return spec.tickValues;
  if (spec.type === 'log') {
    const [lo, hi] = scale.domain() as [number, number];
    const out: number[] = [];
    const start = Math.floor(Math.log10(lo));
    const end = Math.ceil(Math.log10(hi));
    const span = end - start;
    const stride = span > 8 ? Math.ceil(span / 6) : 1;
    for (let e = start; e <= end; e += stride) {
      const v = Number(`1e${e}`);
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
    }
    return out.length >= 2 ? out : (scale as ScaleLogarithmic<number, number>).ticks(4);
  }
  return (scale as ScaleLinear<number, number>).ticks(spec.ticks ?? 5);
}

export function ChartFrame({
  x,
  y,
  height = 260,
  margin: marginOverride,
  ariaLabel,
  summary,
  children,
  onPointer,
  crosshair = false,
  legend,
  overlay,
}: {
  x: AxisSpec;
  y: AxisSpec;
  height?: number;
  margin?: Partial<ChartMargin>;
  /** Accessible chart name. */
  ariaLabel: string;
  /** Text alternative read by screen readers (what the chart shows). */
  summary: string;
  children: (scales: ChartScales) => ReactNode;
  onPointer?: (pointer: ChartPointer | null) => void;
  crosshair?: boolean;
  legend?: ReactNode;
  /** Absolutely positioned HTML layered over the plot area (annotations). */
  overlay?: (scales: ChartScales) => ReactNode;
}) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(640);
  const summaryId = useId();
  const pointerRef = useRef<{ px: number; py: number } | null>(null);
  const crossRef = useRef<SVGGElement | null>(null);
  const margin: ChartMargin = {
    top: 12,
    right: 16,
    bottom: x.label ? 40 : 26,
    left: y.label ? 62 : 48,
    ...marginOverride,
  };
  const innerWidth = Math.max(40, width - margin.left - margin.right);
  const innerHeight = Math.max(40, height - margin.top - margin.bottom);

  const scales = useMemo<ChartScales>(() => {
    const xScale = buildScale(x, [0, innerWidth]);
    const yScale = buildScale(y, [innerHeight, 0]);
    return {
      xScale,
      yScale,
      x: (v: number) => xScale(v) as number,
      y: (v: number) => yScale(v) as number,
      innerWidth,
      innerHeight,
    };
  }, [x, y, innerWidth, innerHeight]);

  const xTicks = ticksFor(x, scales.xScale);
  const yTicks = ticksFor(y, scales.yScale);
  const xFormat = x.format ?? ((v: number) => formatTick(v, x.type === 'log'));
  const yFormat = y.format ?? ((v: number) => formatTick(v, y.type === 'log'));

  const handleMove = (event: ReactPointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = Math.min(innerWidth, Math.max(0, event.clientX - rect.left));
    const py = Math.min(innerHeight, Math.max(0, event.clientY - rect.top));
    pointerRef.current = { px, py };
    if (crosshair && crossRef.current) {
      crossRef.current.setAttribute('transform', `translate(${px},0)`);
      crossRef.current.style.display = '';
    }
    onPointer?.({
      dataX: scales.xScale.invert(px),
      dataY: scales.yScale.invert(py),
      px,
      py,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };

  const handleLeave = () => {
    pointerRef.current = null;
    if (crossRef.current) crossRef.current.style.display = 'none';
    onPointer?.(null);
  };

  return (
    <figure className="lab-chart" ref={wrapRef} style={{ margin: 0 }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        aria-describedby={summaryId}
      >
        <g transform={`translate(${margin.left},${margin.top})`}>
          <g className="lab-chart__grid" aria-hidden>
            {yTicks.map((t) => (
              <line key={`gy-${t}`} x1={0} x2={innerWidth} y1={scales.y(t)} y2={scales.y(t)} />
            ))}
          </g>
          <g className="lab-chart__axis" aria-hidden>
            <line x1={0} x2={innerWidth} y1={innerHeight} y2={innerHeight} />
            {xTicks.map((t) => (
              <g key={`tx-${t}`} transform={`translate(${scales.x(t)},${innerHeight})`}>
                <line y2={4} />
                <text className="lab-chart__tick" y={16} textAnchor="middle">
                  {xFormat(t)}
                </text>
              </g>
            ))}
            {yTicks.map((t) => (
              <text
                key={`ty-${t}`}
                className="lab-chart__tick"
                x={-8}
                y={scales.y(t)}
                textAnchor="end"
                dominantBaseline="central"
              >
                {yFormat(t)}
              </text>
            ))}
            {x.label && (
              <text className="lab-chart__axis-label" x={innerWidth / 2} y={innerHeight + 34} textAnchor="middle">
                {x.label}
              </text>
            )}
            {y.label && (
              <text
                className="lab-chart__axis-label"
                transform={`translate(${-margin.left + 14},${innerHeight / 2}) rotate(-90)`}
                textAnchor="middle"
              >
                {y.label}
              </text>
            )}
          </g>
          <g>{children(scales)}</g>
          {crosshair && (
            <g ref={crossRef} style={{ display: 'none' }} aria-hidden>
              <line className="lab-chart__crosshair" y1={0} y2={innerHeight} />
            </g>
          )}
          {onPointer && (
            <rect
              width={innerWidth}
              height={innerHeight}
              fill="transparent"
              onPointerMove={handleMove}
              onPointerLeave={handleLeave}
              style={{ cursor: 'crosshair' }}
            />
          )}
        </g>
      </svg>
      {overlay && (
        <div
          style={{
            position: 'absolute',
            left: margin.left,
            top: margin.top,
            width: innerWidth,
            height: innerHeight,
            pointerEvents: 'none',
          }}
        >
          {overlay(scales)}
        </div>
      )}
      <figcaption id={summaryId} className="lab-sr-only">
        {summary}
      </figcaption>
      {legend && <div className="lab-chart__legend">{legend}</div>}
    </figure>
  );
}

export function LegendItem({
  color,
  label,
  shape = 'line',
}: {
  color: string;
  label: ReactNode;
  shape?: 'line' | 'dot' | 'square' | 'cross' | 'ring';
}) {
  return (
    <span className="lab-chart__legend-item">
      <svg width={14} height={10} aria-hidden>
        {shape === 'line' && <line x1={0} x2={14} y1={5} y2={5} stroke={color} strokeWidth={2} strokeLinecap="round" />}
        {shape === 'dot' && <circle cx={7} cy={5} r={4} fill={color} />}
        {shape === 'square' && <rect x={2} y={0.5} width={9} height={9} rx={2} fill={color} />}
        {shape === 'ring' && <circle cx={7} cy={5} r={3.5} fill="none" stroke={color} strokeWidth={1.6} />}
        {shape === 'cross' && (
          <g stroke={color} strokeWidth={1.6} strokeLinecap="round">
            <line x1={4} x2={10} y1={2} y2={8} />
            <line x1={10} x2={4} y1={2} y2={8} />
          </g>
        )}
      </svg>
      {label}
    </span>
  );
}

/** A labeled sequential ramp legend (low → high). */
export function RampLegend({ low, high, label }: { low: string; high: string; label?: string }) {
  return (
    <div className="lab-legend-ramp" aria-label={label ? `${label}: ${low} to ${high}` : undefined}>
      {label && <span style={{ fontFamily: 'var(--font-sans)' }}>{label}</span>}
      <span>{low}</span>
      <span className="lab-legend-ramp__bar" aria-hidden />
      <span>{high}</span>
    </div>
  );
}
