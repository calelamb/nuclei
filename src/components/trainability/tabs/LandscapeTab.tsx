import { useEffect, useRef } from 'react';
import { LabKpi, LabKpiStrip, RampLegend, formatSci, readSeqRamp } from '../../lab';
import { axisTicks, centerPercent, drawLandscape } from './landscapeDraw';
import { useThemeStore } from '../../../stores/themeStore';
import type { LandscapeResult } from '../../../types/trainability';

export function LandscapeTab({ data }: { data: LandscapeResult }) {
  const c = centerPercent(data.axis);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const themeMode = useThemeStore((s) => s.mode);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawLandscape(canvas, data, readSeqRamp(canvas));
  }, [data, themeMode]);

  const ticks = axisTicks(data.axis);
  const summary = `Loss landscape slice, ${data.resolution} by ${data.resolution} points over ±${formatSci(data.span, 3)} radians along two random orthonormal directions. Cost ranges from ${formatSci(data.min)} to ${formatSci(data.max)}; the value at the center is ${formatSci(data.center_value)}.`;

  return (
    <div className="lab-stack">
      <LabKpiStrip label="Landscape summary">
        <LabKpi label="Center value" value={formatSci(data.center_value)} detail="marker at the slice origin" />
        <LabKpi label="Min" value={formatSci(data.min)} />
        <LabKpi label="Max" value={formatSci(data.max)} />
        <LabKpi label="Span" value={`±${formatSci(data.span, 3)}`} detail={`${data.resolution}×${data.resolution} grid`} />
      </LabKpiStrip>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto minmax(0, 1fr)',
          gridTemplateRows: 'auto auto auto',
          columnGap: 'var(--space-2)',
          rowGap: 'var(--space-1)',
          width: '100%',
          maxWidth: 720,
        }}
      >
      <div
        className="lab-chart__axis-label lab-muted"
        style={{ gridColumn: 1, gridRow: 1, writingMode: 'vertical-rl', transform: 'rotate(180deg)', textAlign: 'center', fontSize: 11 }}
      >
        direction 2 (rad)
      </div>
      <div
        className="lab-mono lab-muted"
        aria-hidden
        style={{ gridColumn: 2, gridRow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', textAlign: 'right', fontSize: 10.5 }}
      >
        {ticks.slice().reverse().map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <figure style={{ margin: 0, position: 'relative', gridColumn: 3, gridRow: 1, minWidth: 0 }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Loss landscape heatmap"
          aria-describedby="trainability-landscape-summary"
          style={{
            width: '100%',
            aspectRatio: '1 / 1',
            display: 'block',
            borderRadius: 'var(--radius-soft)',
            border: '1px solid var(--lab-hairline)',
            background: 'var(--lab-surface-3)',
          }}
        />
        <svg
          viewBox="0 0 100 100"
          aria-hidden
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          <circle cx={c} cy={100 - c} r={3.2} style={{ fill: 'none', stroke: 'var(--color-text-primary)', strokeWidth: 0.9 }} />
          <circle cx={c} cy={100 - c} r={4.6} style={{ fill: 'none', stroke: 'var(--lab-surface-1)', strokeWidth: 0.5 }} />
          <line x1={c} x2={c} y1={100 - c - 8} y2={100 - c + 8} style={{ stroke: 'var(--color-text-primary)', strokeWidth: 0.5 }} />
          <line x1={c - 8} x2={c + 8} y1={100 - c} y2={100 - c} style={{ stroke: 'var(--color-text-primary)', strokeWidth: 0.5 }} />
        </svg>
        <figcaption id="trainability-landscape-summary" className="lab-sr-only">{summary}</figcaption>
      </figure>
      <div
        className="lab-mono lab-muted"
        aria-hidden
        style={{ gridColumn: 3, gridRow: 2, display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}
      >
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className="lab-chart__axis-label lab-muted" style={{ gridColumn: 3, gridRow: 3, textAlign: 'center', fontSize: 11 }}>
        direction 1 (rad)
      </div>
      </div>
      <RampLegend label="cost" low={formatSci(data.min)} high={formatSci(data.max)} />
      <p className="lab-muted" style={{ margin: 0 }}>
        2D slice of the cost along two random orthonormal parameter directions through the center point (marked). Flat regions
        away from the center suggest vanishing gradients.
      </p>
    </div>
  );
}
