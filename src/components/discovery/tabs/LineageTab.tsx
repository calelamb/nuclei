import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { select, zoom, zoomIdentity, type ZoomBehavior } from 'd3';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { LabButton, LabCard, LabEmptyState, RampLegend, formatSci, seqColor, useElementWidth } from '../../lab';
import {
  CANDIDATE_KIND_LABEL,
  candidateFitness,
  candidateKind,
  fitnessExtent,
  indexById,
  isImprovement,
  normalizeFitness,
} from '../../../services/discovery/candidateView';
import { buildLineageLayout, lineageNeighbor, lineageSignature, type LineageKey, type LineageLayout } from '../../../services/discovery/lineageLayout';
import type { RunView } from '../../../services/discovery/runView';
import { useCandidateList } from '../useCandidateList';
import type { CandidateRecord } from '../../../types/discovery';

const HEIGHT = 460;
const PAD = 28;

interface NodeLayerProps {
  layout: LineageLayout;
  byId: Map<string, CandidateRecord>;
  extent: [number, number] | null;
  championId: string | null;
  selectedId: string | null;
  cursorId: string | null;
}

function nodeStyle(c: CandidateRecord, extent: [number, number] | null) {
  const kind = candidateKind(c);
  const fitness = candidateFitness(c);
  switch (kind) {
    case 'seed':
    case 'scored':
      return { r: kind === 'seed' ? 8 : 6, fill: fitness === null ? 'var(--lab-surface-2)' : seqColor(normalizeFitness(fitness, extent)), stroke: kind === 'seed' ? 'var(--color-text-primary)' : 'var(--lab-surface-2)', width: kind === 'seed' ? 2 : 1, dash: undefined };
    case 'rejected':
      return { r: 6, fill: 'var(--lab-surface-2)', stroke: 'var(--color-danger)', width: 1.8, dash: undefined };
    case 'failed':
      return { r: 6, fill: 'var(--lab-surface-2)', stroke: 'var(--color-warning)', width: 1.8, dash: '2 2' };
    case 'screened_out':
      return { r: 5, fill: 'var(--lab-surface-2)', stroke: 'var(--color-text-tertiary)', width: 1.4, dash: '2 2' };
    case 'duplicate':
    case 'invalid':
      return { r: 3, fill: 'var(--color-text-tertiary)', stroke: 'none', width: 0, dash: undefined };
    case 'pending':
      return { r: 5, fill: 'var(--lab-surface-2)', stroke: 'var(--color-accent-quantum)', width: 1.6, dash: undefined };
  }
}

const NodeLayer = memo(function NodeLayer({ layout, byId, extent, championId, selectedId, cursorId }: NodeLayerProps) {
  return (
    <g>
      {layout.links.map((l) => {
        const a = layout.byId.get(l.source);
        const b = layout.byId.get(l.target);
        if (!a || !b) return null;
        const mid = (a.x + b.x) / 2;
        return <path key={`${l.source}-${l.target}`} className="disc-lineage__link" d={`M${a.x},${a.y}C${mid},${a.y} ${mid},${b.y} ${b.x},${b.y}`} />;
      })}
      {layout.nodes.map((n) => {
        const c = byId.get(n.id);
        if (!c) return null;
        const s = nodeStyle(c, extent);
        const improved = isImprovement(c, byId);
        const fitness = candidateFitness(c);
        return (
          <g key={n.id} className="disc-lineage__node" data-id={n.id} transform={`translate(${n.x},${n.y})`}>
            <title>{`${n.id} · ${CANDIDATE_KIND_LABEL[candidateKind(c)]}${fitness === null ? '' : ` · fitness ${formatSci(fitness)}`}${improved ? ' · beat its parent' : ''}`}</title>
            {improved && <circle className="disc-lineage__ring" r={s.r + 3.5} />}
            {n.id === championId && <circle r={s.r + 6.5} fill="none" stroke="var(--color-warning)" strokeWidth={1.8} />}
            <circle r={s.r} fill={s.fill} stroke={s.stroke} strokeWidth={s.width} strokeDasharray={s.dash} />
            {(n.id === selectedId || n.id === cursorId) && <circle className="disc-lineage__selected" r={s.r + 9} strokeDasharray={n.id === selectedId ? undefined : '3 2'} />}
          </g>
        );
      })}
    </g>
  );
});

/** Lineage tree (root = seed): pan and zoom, click or Enter opens the drawer, arrow keys walk the tree. */
export function LineageTab({ view, selectedId, onOpen }: { view: RunView; selectedId: string | null; onOpen: (id: string) => void }) {
  const all = useCandidateList(view);
  const [showNoise, setShowNoise] = useState(false);
  // Duplicates and invalid proposals never have children; hiding them keeps big trees readable.
  const noise = useMemo(() => all.filter((c) => ['duplicate', 'invalid'].includes(candidateKind(c))).length, [all]);
  const list = useMemo(() => (showNoise ? all : all.filter((c) => !['duplicate', 'invalid'].includes(candidateKind(c)))), [all, showNoise]);
  const signature = lineageSignature(list);
  // The layout depends on structure only; fitness updates never re-run it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => buildLineageLayout(list), [signature]);
  const byId = useMemo(() => indexById(list), [list]);
  const extent = useMemo(() => fitnessExtent(list), [list]);
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(720);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const extentWidth = useRef(width);
  useEffect(() => {
    extentWidth.current = width;
  }, [width]);
  const [cursorId, setCursorId] = useState<string | null>(view.run.champion_id ?? list[0]?.id ?? null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // An explicit extent avoids d3 reading the SVG's viewBox, which not every DOM implements.
    const behavior = zoom<SVGSVGElement, unknown>()
      .extent((): [[number, number], [number, number]] => [[0, 0], [extentWidth.current, HEIGHT]])
      .scaleExtent([0.15, 4])
      .on('zoom', (event) => gRef.current?.setAttribute('transform', event.transform.toString()));
    zoomRef.current = behavior;
    select(svg).call(behavior);
    return () => {
      select(svg).on('.zoom', null);
    };
  }, []);

  const fit = useCallback(() => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (!svg || !behavior) return;
    const k = Math.min(1.2, Math.max(0.15, Math.min((width - PAD * 2) / Math.max(1, layout.width), (HEIGHT - PAD * 2) / Math.max(1, layout.height))));
    select(svg).call(behavior.transform, zoomIdentity.translate(PAD, HEIGHT / 2 - (layout.height / 2) * k).scale(k));
  }, [layout.height, layout.width, width]);

  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || layout.nodes.length === 0) return;
    fitted.current = true;
    fit();
  }, [fit, layout.nodes.length]);

  const zoomBy = (factor: number) => {
    if (svgRef.current && zoomRef.current) select(svgRef.current).call(zoomRef.current.scaleBy, factor);
  };

  const describeNode = (id: string) => {
    const c = byId.get(id);
    if (!c) return id;
    const f = candidateFitness(c);
    return `${id}, ${CANDIDATE_KIND_LABEL[candidateKind(c)]}${f === null ? '' : `, fitness ${formatSci(f)}`}${c.parent_id ? `, child of ${c.parent_id}` : ', root'}`;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && cursorId) {
      event.preventDefault();
      onOpen(cursorId);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) || !cursorId) return;
    event.preventDefault();
    const next = lineageNeighbor(layout, cursorId, event.key as LineageKey);
    if (next) {
      setCursorId(next);
      setAnnouncement(describeNode(next));
    }
  };

  const onClick = (event: React.MouseEvent<SVGGElement>) => {
    const id = (event.target as Element).closest('[data-id]')?.getAttribute('data-id');
    if (id) {
      setCursorId(id);
      onOpen(id);
    }
  };

  if (list.length === 0) {
    return <LabCard title="Lineage"><LabEmptyState compact title="No lineage yet" body="The tree starts at the seed program and grows as candidates are proposed." /></LabCard>;
  }

  const improvements = list.filter((c) => isImprovement(c, byId)).length;
  const summary = `Lineage tree of ${list.length} candidates${noise > 0 && !showNoise ? ` (${noise} duplicates and invalid proposals hidden)` : ''} rooted at the seed, ${improvements} of which beat their parent. Use the arrow keys to move between parents, children and siblings, and Enter to open a candidate. The Candidates tab lists the same data as a table.`;

  return (
    <LabCard
      title="Lineage"
      subtitle="Root is the seed. Color is fitness, a green ring marks an improvement, hollow red is rejected."
      actions={<RampLegend low="low fitness" high="high fitness" label="Fitness" />}
    >
      {noise > 0 && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 28, fontSize: 12, marginBottom: 'var(--space-2)' }}>
          <input type="checkbox" checked={showNoise} onChange={(e) => setShowNoise(e.target.checked)} />
          Show {noise} duplicate / invalid
        </label>
      )}
      <div ref={wrapRef} className="disc-lineage">
        <div className="disc-lineage__controls">
          <LabButton size="sm" variant="secondary" iconOnly icon={Plus} aria-label="Zoom in" onClick={() => zoomBy(1.4)} />
          <LabButton size="sm" variant="secondary" iconOnly icon={Minus} aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)} />
          <LabButton size="sm" variant="secondary" iconOnly icon={Maximize2} aria-label="Fit tree to view" onClick={fit} />
        </div>
        <div role="group" aria-label="Lineage tree" aria-describedby="lineage-summary" tabIndex={0} onKeyDown={onKeyDown}>
          <svg ref={svgRef} width="100%" height={HEIGHT} aria-hidden>
            <g ref={gRef} onClick={onClick}>
              <NodeLayer layout={layout} byId={byId} extent={extent} championId={view.run.champion_id} selectedId={selectedId} cursorId={cursorId} />
            </g>
          </svg>
          <p id="lineage-summary" className="lab-sr-only">{summary}</p>
          <p className="lab-sr-only" role="status" aria-live="polite">{announcement}</p>
        </div>
      </div>
    </LabCard>
  );
}
