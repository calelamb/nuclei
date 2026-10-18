import { memo, useCallback, useMemo } from 'react';
import { ChartFrame, LabTooltip, LegendItem, TooltipRows, catColor, formatSci, type ChartScales } from '../lab';
import { stepPath, trajectorySummary, type Trajectory, type TrajectoryPoint } from '../../services/discovery/trajectory';
import { CANDIDATE_KIND_LABEL } from '../../services/discovery/candidateView';
import type { CandidateMutator } from '../../types/discovery';
import { useChartHover } from './useChartHover';

const ISLAND_SLOT_OFFSET = 2;
const ISLAND_DASH = ['', '6 3', '2 3', '8 3 2 3'];
const MUTATOR_COLOR: Record<CandidateMutator, string> = { llm: catColor(0), ast: catColor(1), seed: 'var(--color-text-primary)' };
const MUTATOR_LABEL: Record<CandidateMutator, string> = { llm: 'LLM', ast: 'AST', seed: 'Seed' };

const Marks = memo(function Marks({ trajectory, scales }: { trajectory: Trajectory; scales: ChartScales }) {
  const { x, y, innerWidth } = scales;
  const lane = y(trajectory.laneY);
  return (
    <g>
      <line x1={0} x2={innerWidth} y1={lane - 10} y2={lane - 10} stroke="var(--lab-axis)" strokeDasharray="2 4" aria-hidden />
      <text x={4} y={lane - 14} className="lab-chart__tick" aria-hidden>rejected / failed</text>
      {trajectory.islands.map((series) => (
        <path
          key={series.island}
          d={stepPath(series.steps, trajectory.xMax, x, y)}
          fill="none"
          stroke={catColor(ISLAND_SLOT_OFFSET + series.island)}
          strokeWidth={1.8}
          strokeDasharray={ISLAND_DASH[series.island % ISLAND_DASH.length]}
          aria-hidden
        />
      ))}
      {trajectory.points.map((p) => {
        const cx = x(p.index);
        if (p.kind === 'rejected' || p.kind === 'failed') {
          const color = p.kind === 'rejected' ? 'var(--color-danger)' : 'var(--color-warning)';
          return <path key={p.id} d={`M${cx - 3.5},${lane - 3.5}l7,7m0,-7l-7,7`} stroke={color} strokeWidth={1.6} strokeLinecap="round" fill="none" />;
        }
        const cy = y(p.y);
        if (p.kind === 'screened_out') {
          return <rect key={p.id} x={cx - 3} y={cy - 3} width={6} height={6} transform={`rotate(45 ${cx} ${cy})`} fill="none" stroke="var(--color-text-tertiary)" strokeWidth={1.2} strokeDasharray="2 1.5" />;
        }
        const seed = p.mutator === 'seed';
        return (
          <circle
            key={p.id}
            cx={cx}
            cy={cy}
            r={p.improved ? 4.2 : 3.4}
            fill={seed ? 'var(--lab-surface-2)' : MUTATOR_COLOR[p.mutator]}
            stroke={seed ? MUTATOR_COLOR.seed : p.improved ? 'var(--color-text-primary)' : 'var(--lab-surface-2)'}
            strokeWidth={seed || p.improved ? 1.6 : 1}
          />
        );
      })}
    </g>
  );
});

/** Fitness over candidates: best-so-far per island, every candidate by mutator, failures on a baseline lane. */
export function TrajectoryChart({ trajectory, onSelect }: { trajectory: Trajectory; onSelect: (id: string) => void }) {
  const xSpec = useMemo(() => ({ domain: [0, trajectory.xMax] as [number, number], label: 'Candidate (creation order)', format: (v: number) => String(Math.round(v)) }), [trajectory.xMax]);
  const ySpec = useMemo(() => {
    const span = trajectory.yMax - trajectory.yMin || 1;
    return { domain: [trajectory.laneY - span * 0.08, trajectory.yMax + span * 0.06] as [number, number], label: 'Fitness (higher is better)', nice: false };
  }, [trajectory.laneY, trajectory.yMax, trajectory.yMin]);

  const position = useCallback((p: TrajectoryPoint, s: ChartScales) => [s.x(p.index), s.y(p.kind === 'rejected' || p.kind === 'failed' ? trajectory.laneY : p.y)] as const, [trajectory.laneY]);
  const describe = useCallback((p: TrajectoryPoint) => (
    <TooltipRows
      title={p.id}
      rows={[
        { label: 'Outcome', value: p.kind === 'scored' ? (p.mutator === 'seed' ? 'Seed' : CANDIDATE_KIND_LABEL.scored) : CANDIDATE_KIND_LABEL[p.kind === 'screened_out' ? 'screened_out' : p.kind] },
        { label: 'Mutator', value: MUTATOR_LABEL[p.mutator] },
        { label: 'Island', value: p.island + 1 },
        ...(p.kind === 'rejected' || p.kind === 'failed' ? [] : [{ label: p.kind === 'screened_out' ? 'Screen fitness' : 'Fitness', value: formatSci(p.y) }]),
        ...(p.improved ? [{ label: 'Beat its parent', value: 'yes' }] : []),
      ]}
    />
  ), []);
  const { hover, onPointer, sink } = useChartHover(trajectory.points, position, describe);

  const legend = (
    <>
      <LegendItem shape="dot" color={MUTATOR_COLOR.llm} label="LLM candidate" />
      <LegendItem shape="dot" color={MUTATOR_COLOR.ast} label="AST candidate" />
      <LegendItem shape="ring" color={MUTATOR_COLOR.seed} label="Seed" />
      <LegendItem shape="cross" color="var(--color-danger)" label="Rejected" />
      <LegendItem shape="cross" color="var(--color-warning)" label="Failed" />
      <LegendItem shape="ring" color="var(--color-text-tertiary)" label="Screened out (screen estimate)" />
      {trajectory.islands.map((s) => (
        <LegendItem key={s.island} color={catColor(ISLAND_SLOT_OFFSET + s.island)} label={`Island ${s.island + 1} best so far`} />
      ))}
    </>
  );
  return (
    <div onClick={() => hover && onSelect(hover.item.id)} style={{ cursor: hover ? 'pointer' : undefined }}>
      <ChartFrame x={xSpec} y={ySpec} height={300} ariaLabel="Fitness trajectory" summary={trajectorySummary(trajectory)} legend={legend} onPointer={onPointer} crosshair>
        {(scales) => (
          <>
            {sink(scales)}
            <Marks trajectory={trajectory} scales={scales} />
            {hover && (
              <circle cx={position(hover.item, scales)[0]} cy={position(hover.item, scales)[1]} r={7} fill="none" stroke="var(--lab-focus)" strokeWidth={1.6} pointerEvents="none" />
            )}
          </>
        )}
      </ChartFrame>
      <LabTooltip state={hover?.tooltip ?? null} />
    </div>
  );
}
