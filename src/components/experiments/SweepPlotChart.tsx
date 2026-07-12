import { extent, line as d3Line, scaleLinear } from 'd3';
import type { RefObject } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { seriesColor } from '../../lib/seriesPalette';
import type { SweepSeries } from '../../services/sweepPlot';

const MARGIN = { top: 16, right: 20, bottom: 40, left: 56 };
const WIDTH = 640;
const HEIGHT = 320;

interface SweepPlotChartProps {
  series: SweepSeries[];
  xLabel: string;
  yLabel: string;
  svgRef?: RefObject<SVGSVGElement | null>;
}

/**
 * PRD 09 Phase E (E2) — the sweep plot's SVG rendering. Uses d3-scale
 * (`scaleLinear`) and d3-shape (`line`) purely to compute pixel coordinates
 * and path strings; the actual DOM is plain React-rendered SVG (no
 * `d3.select` DOM manipulation), keeping this a normal, testable React
 * component consistent with the rest of the app's "functional components +
 * hooks only" convention.
 */
export function SweepPlotChart({ series, xLabel, yLabel, svgRef }: SweepPlotChartProps) {
  const colors = useThemeStore((s) => s.colors);
  const allPoints = series.flatMap((s) => s.points);

  if (allPoints.length === 0) {
    return (
      <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
        No data points for this selection.
      </div>
    );
  }

  const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const [xMin, xMax] = extent(allPoints, (p) => p.x) as [number, number];
  const [yMin, yMax] = extent(allPoints, (p) => p.y) as [number, number];
  const xPad = xMin === xMax ? Math.abs(xMin || 1) * 0.1 || 1 : (xMax - xMin) * 0.05;
  const yPad = yMin === yMax ? Math.abs(yMin || 1) * 0.1 || 1 : (yMax - yMin) * 0.1;

  const xScale = scaleLinear().domain([xMin - xPad, xMax + xPad]).range([0, innerWidth]);
  const yScale = scaleLinear().domain([yMin - yPad, yMax + yPad]).range([innerHeight, 0]);

  const lineGenerator = d3Line<{ x: number; y: number }>()
    .x((p) => xScale(p.x))
    .y((p) => yScale(p.y));

  const xTicks = xScale.ticks(5);
  const yTicks = yScale.ticks(5);
  const tickFont = { fontSize: 10, fontFamily: "'Fira Code', monospace", fill: colors.textDim };
  const labelFont = { fontSize: 11, fontFamily: "'Geist Sans', sans-serif", fill: colors.textMuted };

  return (
    <svg
      ref={svgRef}
      width="100%"
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Sweep plot of ${yLabel} vs ${xLabel}`}
    >
      <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        {yTicks.map((tick) => (
          <g key={`y-${tick}`} transform={`translate(0,${yScale(tick)})`}>
            <line x2={innerWidth} stroke={colors.border} strokeOpacity={0.5} />
            <text x={-8} dy="0.32em" textAnchor="end" {...tickFont}>{tick}</text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={`x-${tick}`} transform={`translate(${xScale(tick)},${innerHeight})`}>
            <line y2={6} stroke={colors.border} />
            <text y={18} textAnchor="middle" {...tickFont}>{tick}</text>
          </g>
        ))}
        <text x={innerWidth / 2} y={innerHeight + 32} textAnchor="middle" {...labelFont}>{xLabel}</text>
        <text
          transform={`translate(${-40},${innerHeight / 2}) rotate(-90)`}
          textAnchor="middle"
          {...labelFont}
        >
          {yLabel}
        </text>

        {series.map((s, i) => {
          const color = seriesColor(colors, i);
          const path = lineGenerator(s.points) ?? '';
          return (
            <g key={s.group ?? '__ungrouped__'}>
              {s.points.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth={2} />}
              {s.points.map((p) => (
                <circle key={p.dir} cx={xScale(p.x)} cy={yScale(p.y)} r={3.5} fill={color} />
              ))}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
