import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { ReactElement } from 'react';
import { useResearchSelectionStore } from '../../../stores/researchSelectionStore';
import type { QecEntityRef } from '../../../types/qecSelection';

interface TrailEntry {
  key: string;
  label: string;
  kind: string;
}

function toTrailEntry(ref: QecEntityRef): TrailEntry {
  return {
    key: `${ref.kind}:${ref.id}`,
    label: ref.id,
    kind: ref.kind.replaceAll('-', ' '),
  };
}

export function ResearchTrail(): ReactElement {
  const past = useResearchSelectionStore((state) => state.past);
  const selection = useResearchSelectionStore((state) => state.present);
  const future = useResearchSelectionStore((state) => state.future);
  const back = useResearchSelectionStore((state) => state.back);
  const forward = useResearchSelectionStore((state) => state.forward);
  const clear = useResearchSelectionStore((state) => state.clear);
  const entries = selection.primary
    ? [selection.primary, ...selection.scope].map(toTrailEntry)
    : [];

  if (selection.timeWindow) {
    entries.push({
      key: `window:${selection.timeWindow.domain}`,
      kind: 'time window',
      label: `${selection.timeWindow.start}–${selection.timeWindow.end} ${selection.timeWindow.domain}`,
    });
  }

  return (
    <nav className="qec-research-trail" aria-label="Research trail">
      <span className="qec-research-trail__label">Trail</span>
      <button
        type="button"
        aria-label="Back in research trail"
        title="Back"
        disabled={past.length === 0}
        onClick={back}
      >
        <ChevronLeft aria-hidden="true" size={15} />
      </button>
      <button
        type="button"
        aria-label="Forward in research trail"
        title="Forward"
        disabled={future.length === 0}
        onClick={forward}
      >
        <ChevronRight aria-hidden="true" size={15} />
      </button>
      <ol>
        {entries.length > 0 ? entries.map((entry) => (
          <li key={entry.key} title={entry.kind}>
            <span aria-hidden="true">/</span>
            <span className="qec-mono">{entry.label}</span>
          </li>
        )) : <li className="qec-research-trail__empty">No active selection</li>}
      </ol>
      <button
        type="button"
        aria-label="Clear research trail"
        title="Clear trail"
        disabled={entries.length === 0}
        onClick={clear}
      >
        <X aria-hidden="true" size={14} />
      </button>
    </nav>
  );
}
