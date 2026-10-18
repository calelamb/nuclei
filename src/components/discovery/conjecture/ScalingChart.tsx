import { useMemo } from 'react';
import { ChartFrame, formatSci } from '../../lab';
import type { EvidenceRow } from '../../../types/conjecture';

const STROKE = { meets: 'var(--color-success)', violates: 'var(--color-danger)', indeterminate: 'var(--color-warning)' } as const;

/** Variance against qubit count for every held-out circuit; violating circuits are drawn on top. */
export function ScalingChart({ rows }: { rows: EvidenceRow[] }) {
  const series = useMemo(() => rows.map((r) => ({ ...r, pts: r.points.filter((p) => p.variance > 0) })).filter((r) => r.pts.length >= 2), [rows]);
  const domains = useMemo(() => {
    const ns = series.flatMap((s) => s.pts.map((p) => p.n));
    const vs = series.flatMap((s) => s.pts.map((p) => p.variance));
    return ns.length ? { n: [Math.min(...ns), Math.max(...ns)] as [number, number], v: [Math.min(...vs) / 2, Math.max(...vs) * 2] as [number, number] } : null;
  }, [series]);
  if (!domains) return null;
  const ordered = [...series].sort((a, b) => Number(a.outcome === 'violates') - Number(b.outcome === 'violates'));
  const violating = series.filter((s) => s.outcome === 'violates').length;
  const summary = `Gradient variance against qubit count for ${series.length} held-out circuits, from n = ${domains.n[0]} to n = ${domains.n[1]}, variance between ${formatSci(domains.v[0], 2)} and ${formatSci(domains.v[1], 2)}. ${violating} circuits violate the prediction.`;
  return (
    <ChartFrame
      x={{ domain: domains.n, nice: false, label: 'Qubits n', format: (v) => String(Math.round(v)) }}
      y={{ type: 'log', domain: domains.v, label: 'Gradient variance' }}
      height={220}
      ariaLabel="Gradient variance scaling per held-out circuit"
      summary={summary}
    >
      {({ x, y }) => (
        <g>
          {ordered.map((s) => (
            <path
              key={s.circuitIndex}
              d={s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.n).toFixed(1)},${y(p.variance).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={STROKE[s.outcome]}
              strokeOpacity={s.outcome === 'violates' ? 1 : 0.55}
              strokeWidth={s.outcome === 'violates' ? 2 : 1.3}
            />
          ))}
        </g>
      )}
    </ChartFrame>
  );
}
