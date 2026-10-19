import { useMemo, useState } from 'react';
import { LabCard, LabEmptyState, LabSegmented, RampLegend, formatPct, formatSci, seqColor } from '../../lab';
import { archiveCoverage, cellKey, sortElites } from '../../../services/discovery/archive';
import type { ArchiveElite, ArchiveState } from '../../../types/discovery';

const MAX_CELL_PX = 72;

type IslandChoice = 'merged' | `${number}`;

function gridFor(archive: ArchiveState, choice: IslandChoice): Record<string, ArchiveElite> {
  if (choice !== 'merged') return { ...(archive.islands[Number(choice)] ?? {}) };
  // Merged view: the best elite per cell across islands.
  const merged: Record<string, ArchiveElite> = {};
  for (const elite of sortElites(archive.islands.flatMap((g) => Object.values(g)))) {
    const key = cellKey(elite.cell);
    if (!merged[key]) merged[key] = elite;
  }
  return merged;
}

function axisTick(axis: ArchiveState['axes'][number], bin: number): string {
  const lo = axis.min + ((axis.max - axis.min) * bin) / axis.bins;
  return formatSci(lo, 2);
}

/** MAP-Elites grid over the two descriptors: cell color is fitness, empty cells are hatched. */
export function ArchiveTab({ archive, onOpen }: { archive: ArchiveState; onOpen: (id: string) => void }) {
  const [choice, setChoice] = useState<IslandChoice>('merged');
  const [axisX, axisY] = archive.axes;
  const grid = useMemo(() => gridFor(archive, choice), [archive, choice]);
  const elites = Object.values(grid);
  const range = useMemo(() => {
    const all = archive.islands.flatMap((g) => Object.values(g)).map((e) => e.fitness);
    return all.length > 0 ? ([Math.min(...all), Math.max(...all)] as const) : null;
  }, [archive]);
  const total = axisX.bins * axisY.bins;
  const tickStep = axisX.bins > 10 ? 2 : 1;
  const coverage = choice === 'merged' ? (total === 0 ? 0 : elites.length / total) : archiveCoverage(archive, Number(choice));
  const items = [
    { id: 'merged' as IslandChoice, label: 'All islands' },
    ...archive.islands.map((_, i) => ({ id: `${i}` as IslandChoice, label: `Island ${i + 1}` })),
  ];
  const level = (fitness: number) => (range && range[1] > range[0] ? (fitness - range[0]) / (range[1] - range[0]) : 0.5);
  const summary = `MAP-Elites archive over ${axisX.label} and ${axisY.label}: ${elites.length} of ${total} cells filled (${formatPct(coverage, 0)})${range ? `, fitness from ${formatSci(range[0])} to ${formatSci(range[1])}` : ''}.`;

  return (
    <LabCard
      title="Archive"
      subtitle={`Best candidate per ${axisX.label.toLowerCase()} × ${axisY.label.toLowerCase()} cell`}
      actions={<LabSegmented label="Island" items={items} value={choice} onChange={setChoice} />}
    >
      {elites.length === 0 && archive.islands.every((g) => Object.keys(g).length === 0) ? (
        <LabEmptyState compact title="The archive is empty" body="A cell fills when a scored candidate reaches the full evaluation stage. Screen-only estimates never enter." />
      ) : (
        <div className="lab-stack">
          <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="lab-mono" role="status">Coverage {formatPct(coverage, 0)} · {elites.length}/{total} cells</span>
            {range && range[0] === range[1]
              ? <span className="lab-muted" style={{ fontSize: 12 }}>Fitness {formatSci(range[0])} in every filled cell</span>
              : <RampLegend low={range ? formatSci(range[0]) : '—'} high={range ? formatSci(range[1]) : '—'} label="Fitness" />}
          </div>
          <figure style={{ margin: 0 }} aria-label="Archive grid" aria-describedby="archive-summary">
            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto minmax(0, 1fr)', gap: 'var(--space-2)', width: '100%', maxWidth: Math.max(1, axisX.bins) * MAX_CELL_PX + 90 }}>
              <div className="lab-chart__axis-label lab-muted" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', textAlign: 'center' }}>{axisY.label} →</div>
              <div className="lab-chart__tick lab-mono lab-dim" aria-hidden style={{ display: 'grid', gridTemplateRows: `repeat(${axisY.bins}, minmax(0, 1fr))`, gap: 2, textAlign: 'right' }}>
                {Array.from({ length: axisY.bins }, (_, i) => (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>{axisTick(axisY, axisY.bins - 1 - i)}</span>
                ))}
              </div>
              <div>
                <div className="disc-archive" style={{ gridTemplateColumns: `repeat(${axisX.bins}, minmax(0, 1fr))` }}>
                  {Array.from({ length: axisX.bins * axisY.bins }, (_, i) => {
                    const row = axisY.bins - 1 - Math.floor(i / axisX.bins);
                    const col = i % axisX.bins;
                    const elite = grid[cellKey([col, row])];
                    const where = `${axisX.label} from ${axisTick(axisX, col)}, ${axisY.label} from ${axisTick(axisY, row)}`;
                    if (!elite) return <div key={i} className="disc-archive__cell disc-archive__cell--empty" aria-hidden title={`Empty · ${where}`} />;
                    return (
                      <button
                        key={i}
                        type="button"
                        className="disc-archive__cell"
                        style={{ background: seqColor(level(elite.fitness)) }}
                        title={`${elite.candidateId} · fitness ${formatSci(elite.fitness)} · island ${elite.island + 1}\n${where}`}
                        aria-label={`${elite.candidateId}, fitness ${formatSci(elite.fitness)}, island ${elite.island + 1}, ${where}`}
                        onClick={() => onOpen(elite.candidateId)}
                      />
                    );
                  })}
                </div>
                <div className="lab-chart__tick lab-mono lab-dim" aria-hidden style={{ display: 'grid', gridTemplateColumns: `repeat(${axisX.bins}, minmax(0, 1fr))`, gap: 2, marginTop: 4 }}>
                  {Array.from({ length: axisX.bins }, (_, i) => (
                    <span key={i} style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>{i % tickStep === 0 ? axisTick(axisX, i) : ''}</span>
                  ))}
                </div>
                <div className="lab-chart__axis-label lab-muted" aria-hidden style={{ textAlign: 'center', marginTop: 2 }}>{axisX.label} → (bin lower edge)</div>
              </div>
            </div>
            <figcaption id="archive-summary" className="lab-sr-only">{summary}</figcaption>
          </figure>
        </div>
      )}
    </LabCard>
  );
}
