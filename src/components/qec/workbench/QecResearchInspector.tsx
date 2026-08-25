import { Info, Pin, X } from 'lucide-react';
import type { ReactElement } from 'react';
import { resolveQecPanels } from '../../../layout/qecPanelRegistry';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { qecEntityRefKey, useResearchSelectionStore } from '../../../stores/researchSelectionStore';
import type { ResearchSelection } from '../../../types/qecSelection';
import { QecPanelPinButton } from './QecPanelPinButton';

export const QEC_RESEARCH_INSPECTOR_ID = 'qec-research-inspector';

function InspectorHeading({ onClose }: { onClose(): void }): ReactElement {
  return (
    <header className="qec-zone-heading">
      <div>
        <span className="qec-zone-heading__eyebrow">Contextual detail</span>
        <h2>Inspector</h2>
      </div>
      <button type="button" className="qec-inspector__close" aria-label="Close research inspector" onClick={onClose}>
        <X aria-hidden="true" size={17} />
      </button>
    </header>
  );
}

function SelectionDetails({ selection }: { selection: ResearchSelection }): ReactElement {
  const refs = selection.primary ? [selection.primary, ...selection.scope] : [];
  if (refs.length === 0) {
    return (
      <div className="qec-zone-empty qec-zone-empty--compact">
        <Info aria-hidden="true" size={22} />
        <strong>Nothing selected</strong>
        <span>Select a source or canvas object to inspect values and lineage.</span>
      </div>
    );
  }
  return (
    <section className="qec-inspector__section" aria-labelledby="selection-heading">
      <h3 id="selection-heading">Active selection</h3>
      <dl>
        {refs.map((ref) => (
          <div key={qecEntityRefKey(ref)}>
            <dt>{ref.kind.replaceAll('-', ' ')}</dt><dd className="qec-mono">{ref.id}</dd>
          </div>
        ))}
        {selection.timeWindow && (
          <div><dt>Window</dt><dd className="qec-mono">{selection.timeWindow.start}–{selection.timeWindow.end} {selection.timeWindow.domain}</dd></div>
        )}
      </dl>
    </section>
  );
}

function InspectorTools(): ReactElement {
  const preset = useQecWorkbenchStore((state) => state.preset);
  const pinnedPanelIds = useQecWorkbenchStore((state) => state.pinnedPanelIds);
  const panels = resolveQecPanels(preset, 'inspector', pinnedPanelIds);
  return (
    <section className="qec-inspector__section" aria-labelledby="inspector-tools-heading">
      <h3 id="inspector-tools-heading">Available instruments</h3>
      <ul className="qec-inspector__tools">
        {panels.map((panel) => <li key={panel.id}><span>{panel.title}</span><QecPanelPinButton panel={panel} /></li>)}
      </ul>
    </section>
  );
}

function LineageState(): ReactElement {
  return (
    <section className="qec-inspector__section" aria-labelledby="lineage-heading">
      <h3 id="lineage-heading">Lineage</h3>
      <div className="qec-lineage-state">
        <span className="qec-lineage-state__mark" aria-hidden="true" />
        <div><strong>Provenance not evaluated</strong><span>No source lineage check has run.</span></div>
      </div>
    </section>
  );
}

interface QecResearchInspectorProps { open: boolean; onClose(): void; }

export function QecResearchInspector({ open, onClose }: QecResearchInspectorProps): ReactElement {
  const selection = useResearchSelectionStore((state) => state.present);
  return (
    <aside id={QEC_RESEARCH_INSPECTOR_ID} className="qec-inspector" aria-label="Research inspector" hidden={!open}>
      <InspectorHeading onClose={onClose} />
      <div className="qec-inspector__content">
        <SelectionDetails selection={selection} /><InspectorTools /><LineageState />
      </div>
      <footer className="qec-inspector__footer">
        <button type="button" disabled title="Select evidence before pinning a Finding">
          <Pin aria-hidden="true" size={15} />Pin Finding
        </button>
      </footer>
    </aside>
  );
}
