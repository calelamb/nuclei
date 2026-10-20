import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { extent, line as d3Line, scaleLinear } from 'd3';
import { useThemeStore } from '../../stores/themeStore';
import { seriesColor } from '../../lib/seriesPalette';
import { hasRepeatedX, splitAtFailures, type FailedMarker, type SweepPoint, type SweepSeries } from '../../services/sweepPlot';
import { TYPOGRAPHY } from '../../styles/tokens';

const MARGIN = { top: 16, right: 20, bottom: 44, left: 60 };
const DEFAULT_WIDTH = 640;
const MIN_HEIGHT = 280;
const MAX_HEIGHT = 520;
const HIT_RADIUS = 28;

interface SweepPlotChartProps {
  series: SweepSeries[];
  xLabel: string;
  yLabel: string;
  /** Name of the grouping parameter, for tooltips. */
  groupLabel?: string;
  /** Failed runs per group key (`''` when ungrouped), drawn as hollow markers. */
  failed?: ReadonlyMap<string, FailedMarker[]>;
  /** Clicking a plotted point opens that run. */
  onSelectRun?(dir: string): void;
  svgRef?: RefObject<SVGSVGElement | null>;
}

interface Hover {
  point: SweepPoint;
  seriesIndex: number;
  px: number;
  py: number;
}

function chartHeight(): number {
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(vh * 0.5)));
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(4)));
}

/**
 * The sweep plot's SVG rendering, sized to its container (ResizeObserver) with
 * a nearest-point hover tooltip and click-through to the run. d3 is used only
 * for scales / path strings; the DOM is plain React SVG.
 */
export function SweepPlotChart({ series, xLabel, yLabel, groupLabel, failed, onSelectRun, svgRef }: SweepPlotChartProps) {
  const colors = useThemeStore((s) => s.colors);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [height, setHeight] = useState(chartHeight);
  const [hover, setHover] = useState<Hover | null>(null);

  const attach = useCallback((el: HTMLDivElement | null) => {
    wrapRef.current = el;
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
      setHeight(chartHeight());
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [series.length]);

  const allPoints = series.flatMap((s) => s.points);

  if (allPoints.length === 0) {
    return (
      <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>
        No data points for this selection.
      </div>
    );
  }

  const innerWidth = Math.max(120, width - MARGIN.left - MARGIN.right);
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const [xMin, xMax] = extent(allPoints, (p) => p.x) as [number, number];
  const [yMin, yMax] = extent(allPoints, (p) => p.y) as [number, number];
  const xPad = xMin === xMax ? Math.abs(xMin || 1) * 0.1 || 1 : (xMax - xMin) * 0.05;
  const yPad = yMin === yMax ? Math.abs(yMin || 1) * 0.1 || 1 : (yMax - yMin) * 0.1;

  const xScale = scaleLinear().domain([xMin - xPad, xMax + xPad]).range([0, innerWidth]);
  const yScale = scaleLinear().domain([yMin - yPad, yMax + yPad]).range([innerHeight, 0]);

  const lineGenerator = d3Line<SweepPoint>().x((p) => xScale(p.x)).y((p) => yScale(p.y));
  // An ungrouped line through points that share an x would zig-zag: markers only.
  const drawLines = !series.some((s) => s.group === null && hasRepeatedX(s.points));

  const xTicks = xScale.ticks(Math.max(3, Math.floor(innerWidth / 90)));
  const yTicks = yScale.ticks(Math.max(3, Math.floor(innerHeight / 50)));
  const tickFont = { fontSize: 11, fontFamily: TYPOGRAPHY.fontMono, fill: colors.textDim };
  const labelFont = { fontSize: 12, fontFamily: TYPOGRAPHY.fontSans, fill: colors.textMuted };

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left - MARGIN.left;
    const my = e.clientY - rect.top - MARGIN.top;
    let best: Hover | null = null;
    let bestDist = HIT_RADIUS;
    series.forEach((s, seriesIndex) => {
      for (const point of s.points) {
        const px = xScale(point.x);
        const py = yScale(point.y);
        const dist = Math.hypot(px - mx, py - my);
        if (dist < bestDist) {
          bestDist = dist;
          best = { point, seriesIndex, px, py };
        }
      }
    });
    setHover(best);
  };

  const hovered = hover;
  const hoveredSeries = hovered ? series[hovered.seriesIndex] : null;

  return (
    <div ref={attach} style={{ position: 'relative', width: '100%' }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Sweep plot of ${yLabel} vs ${xLabel}`}
        style={{ display: 'block', cursor: hovered ? 'pointer' : 'default' }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        onClick={() => { if (hovered && onSelectRun) onSelectRun(hovered.point.dir); }}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          <line x1={0} x2={0} y1={0} y2={innerHeight} stroke={colors.border} />
          <line x1={0} x2={innerWidth} y1={innerHeight} y2={innerHeight} stroke={colors.border} />
          {yTicks.map((tick) => (
            <g key={`y-${tick}`} transform={`translate(0,${yScale(tick)})`}>
              <line x2={innerWidth} stroke={colors.border} strokeOpacity={0.5} />
              <text x={-8} dy="0.32em" textAnchor="end" {...tickFont}>{tick}</text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <g key={`x-${tick}`} transform={`translate(${xScale(tick)},${innerHeight})`}>
              <line y2={6} stroke={colors.border} />
              <text y={20} textAnchor="middle" {...tickFont}>{tick}</text>
            </g>
          ))}
          <text x={innerWidth / 2} y={innerHeight + 38} textAnchor="middle" {...labelFont}>{xLabel}</text>
          <text transform={`translate(${-44},${innerHeight / 2}) rotate(-90)`} textAnchor="middle" {...labelFont}>
            {yLabel}
          </text>

          {series.map((s, i) => {
            const color = seriesColor(colors, i);
            const failedMarks = failed?.get(s.group ?? '') ?? [];
            const segments = splitAtFailures(s.points, failedMarks.map((m) => m.x));
            return (
              <g key={s.group ?? '__ungrouped__'}>
                {drawLines && segments.map((segment) => segment.length > 1 && (
                  <path key={segment[0].dir} d={lineGenerator(segment) ?? ''} fill="none" stroke={color} strokeWidth={2} />
                ))}
                {s.points.map((p) => (
                  <circle key={p.dir} cx={xScale(p.x)} cy={yScale(p.y)} r={hovered?.point.dir === p.dir ? 5.5 : 3.5} fill={color} />
                ))}
                {failedMarks.map((m) => (
                  <circle
                    key={m.dir} cx={xScale(m.x)} cy={innerHeight - 8} r={4}
                    fill="none" stroke={colors.error} strokeWidth={1.5}
                  >
                    <title>{`${xLabel} = ${formatNumber(m.x)}: run failed`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
        </g>
      </svg>
      {hovered && hoveredSeries && (
        <div
          role="tooltip"
          style={{
            position: 'absolute', pointerEvents: 'none', zIndex: 3,
            left: Math.min(hovered.px + MARGIN.left + 12, Math.max(0, width - 170)),
            top: Math.max(0, hovered.py + MARGIN.top - 52),
            background: colors.bgElevated, border: `1px solid ${colors.border}`, borderRadius: 'var(--radius-soft)',
            padding: '6px 8px', fontSize: 11, lineHeight: 1.45, color: colors.text,
            fontFamily: TYPOGRAPHY.fontMono, boxShadow: 'var(--shadow-md)', whiteSpace: 'nowrap',
          }}
        >
          <div>{xLabel} = {formatNumber(hovered.point.x)}</div>
          <div>{yLabel} = {formatNumber(hovered.point.y)}</div>
          {hoveredSeries.group !== null && <div style={{ color: colors.textDim }}>{groupLabel ? `${groupLabel} = ` : 'group '}{hoveredSeries.group}</div>}
          <div style={{ color: colors.textDim }}>{hovered.point.dir.split('-').slice(-1)[0]} - click to open</div>
        </div>
      )}
    </div>
  );
}
