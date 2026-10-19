import { useCallback, useMemo } from 'react';
import { ChartFrame, LabEmptyState, LabTooltip, LegendItem, TooltipRows, catColor, formatSci, paddedDomain, type ChartScales } from '../lab';
import { allElites, paretoFront, uniqueByCandidate } from '../../services/discovery/archive';
import type { ArchiveElite, ArchiveState } from '../../types/discovery';
import { useChartHover } from './useChartHover';

function axisFor(archive: ArchiveState, index: 0 | 1, elites: readonly ArchiveElite[]) {
  const def = archive.objectives[index];
  const values = elites.map((e) => e.objectives[def.key]).filter((v): v is number => Number.isFinite(v));
  const positive = values.length > 0 && values.every((v) => v > 0);
  const log = positive && Math.max(...values) / Math.min(...values) > 100;
  return { def, log, domain: paddedDomain(values, { log }) };
}

/** Global Pareto front over the evaluator's first two objectives. */
export function ParetoChart({ archive, championId, onSelect }: { archive: ArchiveState; championId: string | null; onSelect: (id: string) => void }) {
  const elites = useMemo(() => uniqueByCandidate(allElites(archive)), [archive]);
  const front = useMemo(() => new Set(paretoFront(archive).map((e) => e.candidateId)), [archive]);
  const enough = archive.objectives.length >= 2 && elites.length > 0;
  const xa = useMemo(() => (enough ? axisFor(archive, 0, elites) : null), [archive, elites, enough]);
  const ya = useMemo(() => (enough ? axisFor(archive, 1, elites) : null), [archive, elites, enough]);
  const xSpec = useMemo(() => (xa ? { type: xa.log ? ('log' as const) : ('linear' as const), domain: xa.domain, label: `${xa.def.label} (${xa.def.direction})` } : null), [xa]);
  const ySpec = useMemo(() => (ya ? { type: ya.log ? ('log' as const) : ('linear' as const), domain: ya.domain, label: `${ya.def.label} (${ya.def.direction})` } : null), [ya]);

  const position = useCallback(
    (e: ArchiveElite, s: ChartScales) => [s.x(e.objectives[archive.objectives[0].key]), s.y(e.objectives[archive.objectives[1]?.key ?? ''])] as const,
    [archive.objectives],
  );
  const describe = useCallback(
    (e: ArchiveElite) => (
      <TooltipRows
        title={e.candidateId}
        rows={[
          { label: 'Fitness', value: formatSci(e.fitness) },
          ...archive.objectives.slice(0, 2).map((o) => ({ label: o.label, value: formatSci(e.objectives[o.key]) })),
          { label: 'On the front', value: front.has(e.candidateId) ? 'yes' : 'no' },
        ]}
      />
    ),
    [archive.objectives, front],
  );
  const { hover, onPointer, sink } = useChartHover(elites, position, describe);

  if (!enough || !xSpec || !ySpec) {
    return <LabEmptyState compact title="No Pareto front yet" body={archive.objectives.length < 2 ? 'This evaluator reports a single objective, so there is no trade-off to plot.' : 'Elites appear here once candidates enter the archive.'} />;
  }
  const [firstKey, secondKey] = [archive.objectives[0].key, archive.objectives[1].key];
  const frontPoints = elites.filter((e) => front.has(e.candidateId));
  const summary = `Pareto front of ${frontPoints.length} of ${elites.length} archived candidates, ${archive.objectives[0].label} against ${archive.objectives[1].label}.`;
  return (
    <div onClick={() => hover && onSelect(hover.item.candidateId)} style={{ cursor: hover ? 'pointer' : undefined }}>
      <ChartFrame
        x={xSpec}
        y={ySpec}
        height={260}
        ariaLabel="Pareto front"
        summary={summary}
        onPointer={onPointer}
        legend={
          <>
            <LegendItem shape="dot" color={catColor(2)} label="Non-dominated" />
            <LegendItem shape="ring" color="var(--color-text-tertiary)" label="Dominated" />
            <LegendItem shape="ring" color="var(--color-warning)" label="Champion" />
          </>
        }
      >
        {(scales) => {
          const pts = [...frontPoints].sort((a, b) => a.objectives[firstKey] - b.objectives[firstKey]);
          return (
            <>
              {sink(scales)}
              <polyline
                points={pts.map((e) => `${scales.x(e.objectives[firstKey])},${scales.y(e.objectives[secondKey])}`).join(' ')}
                fill="none"
                stroke={catColor(2)}
                strokeWidth={1.4}
                strokeDasharray="4 3"
                aria-hidden
              />
              {elites.map((e) => {
                const onFront = front.has(e.candidateId);
                const [cx, cy] = position(e, scales);
                return (
                  <g key={e.candidateId}>
                    <circle cx={cx} cy={cy} r={onFront ? 4.5 : 3.5} fill={onFront ? catColor(2) : 'none'} stroke={onFront ? 'var(--lab-surface-2)' : 'var(--color-text-tertiary)'} strokeWidth={onFront ? 1 : 1.4} />
                    {e.candidateId === championId && <circle cx={cx} cy={cy} r={8} fill="none" stroke="var(--color-warning)" strokeWidth={1.8} />}
                  </g>
                );
              })}
            </>
          );
        }}
      </ChartFrame>
      <LabTooltip state={hover?.tooltip ?? null} />
    </div>
  );
}
