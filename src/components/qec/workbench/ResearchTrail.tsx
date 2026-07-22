import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { ReactElement } from 'react';
import { useResearchSelectionStore } from '../../../stores/researchSelectionStore';
import type { QecEntityRef, ResearchSelection } from '../../../types/qecSelection';

interface TrailEntry { key: string; label: string; kind: string; }

function toTrailEntry(ref: QecEntityRef): TrailEntry {
  return { key: `${ref.kind}:${ref.id}`, label: ref.id, kind: ref.kind.replaceAll('-', ' ') };
}

function buildTrailEntries(selection: ResearchSelection): readonly TrailEntry[] {
  const refs = selection.primary ? [selection.primary, ...selection.scope].map(toTrailEntry) : [];
  const window = selection.timeWindow;
  const windowEntry = window
    ? { key: `window:${window.domain}`, kind: 'time window', label: `${window.start}–${window.end} ${window.domain}` }
    : null;
  return windowEntry ? [...refs, windowEntry] : refs;
}

function TrailList({ entries }: { entries: readonly TrailEntry[] }): ReactElement {
  return (
    <ol>
      {entries.length > 0
        ? entries.map((entry) => <li key={entry.key} title={entry.kind}><span aria-hidden="true">/</span><span className="qec-mono">{entry.label}</span></li>)
        : <li className="qec-research-trail__empty">No active selection</li>}
    </ol>
  );
}

interface TrailButtonsProps { canBack: boolean; canForward: boolean; onBack(): void; onForward(): void; }

function TrailButtons({ canBack, canForward, onBack, onForward }: TrailButtonsProps): ReactElement {
  return (
    <>
      <button type="button" aria-label="Back in research trail" title="Back" disabled={!canBack} onClick={onBack}><ChevronLeft aria-hidden="true" size={15} /></button>
      <button type="button" aria-label="Forward in research trail" title="Forward" disabled={!canForward} onClick={onForward}><ChevronRight aria-hidden="true" size={15} /></button>
    </>
  );
}

export function ResearchTrail(): ReactElement {
  const state = useResearchSelectionStore();
  const entries = buildTrailEntries(state.present);
  return (
    <nav className="qec-research-trail" aria-label="Research trail">
      <span className="qec-research-trail__label">Trail</span>
      <TrailButtons canBack={state.past.length > 0} canForward={state.future.length > 0} onBack={state.back} onForward={state.forward} />
      <TrailList entries={entries} />
      <button type="button" aria-label="Clear research trail" title="Clear trail" disabled={entries.length === 0} onClick={state.clear}><X aria-hidden="true" size={14} /></button>
    </nav>
  );
}
