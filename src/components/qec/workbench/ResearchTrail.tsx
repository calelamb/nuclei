import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { ReactElement } from 'react';
import { qecEntityRefKey, useResearchSelectionStore } from '../../../stores/researchSelectionStore';
import type { QecEntityRef, ResearchSelection } from '../../../types/qecSelection';
import { IconButton } from '../../ui';
import { useQecStudyStore, type DiscoveredQecStudy } from '../../../services/qecStudyStore';
import { entityLabel } from './qecEntityLabel';
import { ICON_SIZE, ICON_STROKE } from '../../../styles/tokens';

interface TrailEntry { key: string; label: string; kind: string; mono: boolean; }

function buildTrailEntries(selection: ResearchSelection, studies: readonly DiscoveredQecStudy[]): readonly TrailEntry[] {
  const toEntry = (ref: QecEntityRef): TrailEntry => {
    const { text, mono } = entityLabel(ref, studies);
    return { key: qecEntityRefKey(ref), label: text, kind: ref.kind.replaceAll('-', ' '), mono };
  };
  const refs = selection.primary ? [selection.primary, ...selection.scope].map(toEntry) : [];
  const window = selection.timeWindow;
  const windowEntry: TrailEntry | null = window
    ? { key: `window:${window.domain}`, kind: 'time window', label: `${window.start}–${window.end} ${window.domain}`, mono: true }
    : null;
  return windowEntry ? [...refs, windowEntry] : refs;
}

function TrailList({ entries }: { entries: readonly TrailEntry[] }): ReactElement {
  return (
    <ol>
      {entries.length > 0
        ? entries.map((entry) => <li key={entry.key} title={entry.kind}><span className={entry.mono ? 'qec-mono' : undefined}>{entry.label}</span></li>)
        : <li className="qec-research-trail__empty">No active selection</li>}
    </ol>
  );
}

interface TrailButtonsProps { canBack: boolean; canForward: boolean; onBack(): void; onForward(): void; }

function TrailButtons({ canBack, canForward, onBack, onForward }: TrailButtonsProps): ReactElement {
  return (
    <>
      <IconButton size="sm" aria-label="Back in research trail" title="Back" disabled={!canBack} onClick={onBack}><ChevronLeft aria-hidden="true" size={ICON_SIZE.md} strokeWidth={ICON_STROKE} /></IconButton>
      <IconButton size="sm" aria-label="Forward in research trail" title="Forward" disabled={!canForward} onClick={onForward}><ChevronRight aria-hidden="true" size={ICON_SIZE.md} strokeWidth={ICON_STROKE} /></IconButton>
    </>
  );
}

export function ResearchTrail(): ReactElement {
  const state = useResearchSelectionStore();
  const studies = useQecStudyStore((s) => s.studies);
  const entries = buildTrailEntries(state.present, studies);
  return (
    <nav className="qec-research-trail" aria-label="Research trail">
      <span className="qec-research-trail__label">Trail</span>
      <TrailButtons canBack={state.past.length > 0} canForward={state.future.length > 0} onBack={state.back} onForward={state.forward} />
      <TrailList entries={entries} />
      <IconButton size="sm" aria-label="Clear research trail" title="Clear trail" disabled={entries.length === 0} onClick={state.clear}><X aria-hidden="true" size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} /></IconButton>
    </nav>
  );
}
