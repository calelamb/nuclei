import { Info, Pin, X } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type ReactElement } from 'react';
import { resolveQecPanels } from '../../../layout/qecPanelRegistry';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { qecEntityRefKey, useResearchSelectionStore } from '../../../stores/researchSelectionStore';
import type { ResearchSelection } from '../../../types/qecSelection';
import { QecPanelPinButton } from './QecPanelPinButton';
import { useQecStudyStore } from '../../../services/qecStudyStore';
import { entityLabel } from './qecEntityLabel';
import { ICON_SIZE, ICON_STROKE } from '../../../styles/tokens';
import { Button, IconButton } from '../../ui';

export const QEC_RESEARCH_INSPECTOR_ID = 'qec-research-inspector';

function InspectorHeading({ onClose }: { onClose(): void }): ReactElement {
  return (
    <header className="qec-zone-heading">
      <div>
        <span className="qec-zone-heading__eyebrow">Contextual detail</span>
        <h2 tabIndex={-1} className="qec-inspector__title">Inspector</h2>
      </div>
      <IconButton className="qec-inspector__close" aria-label="Close research inspector" tooltip={{ label: 'Close inspector', placement: 'below' }} onClick={onClose}>
        <X aria-hidden="true" size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
      </IconButton>
    </header>
  );
}

function SelectionDetails({ selection }: { selection: ResearchSelection }): ReactElement {
  const studies = useQecStudyStore((state) => state.studies);
  const refs = selection.primary ? [selection.primary, ...selection.scope] : [];
  if (refs.length === 0) {
    return (
      <div className="qec-zone-empty qec-zone-empty--compact">
        <Info aria-hidden="true" size={20} />
        <strong>Nothing selected</strong>
        <span>Select a source to inspect its values and lineage.</span>
      </div>
    );
  }
  return (
    <section className="qec-inspector__section" aria-labelledby="selection-heading">
      <h3 id="selection-heading">Active selection</h3>
      <dl>
        {refs.map((ref) => {
          const { text, mono } = entityLabel(ref, studies);
          return (
            <div key={qecEntityRefKey(ref)}>
              <dt>{ref.kind.replaceAll('-', ' ')}</dt><dd className={mono ? 'qec-mono' : undefined}>{text}</dd>
            </div>
          );
        })}
        {selection.timeWindow && (
          <div><dt>Window</dt><dd className="qec-mono">{selection.timeWindow.start}–{selection.timeWindow.end} {selection.timeWindow.domain}</dd></div>
        )}
      </dl>
    </section>
  );
}

function InspectorTools(): ReactElement | null {
  const preset = useQecWorkbenchStore((state) => state.preset);
  const pinnedPanelIds = useQecWorkbenchStore((state) => state.pinnedPanelIds);
  // The inspector is the surface you are looking at; listing it as an instrument you could pin is circular.
  const panels = resolveQecPanels(preset, 'inspector', pinnedPanelIds).filter((panel) => panel.id !== 'research-inspector');
  if (panels.length === 0) return null;
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
        <span className="qec-lineage-state__mark" data-state="not-evaluated" aria-hidden="true" />
        <div><strong>Provenance not evaluated</strong><span>No source lineage check has run.</span></div>
      </div>
    </section>
  );
}

interface QecResearchInspectorProps { open: boolean; onClose(): void; }

/**
 * Moves focus to the inspector's heading when it is opened by the person, so
 * Escape (handled on the panel) works. Only a closed -> open change counts:
 * mounting already open (or React re-running the effect) must not take focus.
 */
function useFocusOnOpen(open: boolean) {
  const ref = useRef<HTMLElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) ref.current?.querySelector<HTMLElement>('.qec-inspector__title')?.focus();
    wasOpen.current = open;
  }, [open]);
  return ref;
}

export function QecResearchInspector({ open, onClose }: QecResearchInspectorProps): ReactElement {
  const selection = useResearchSelectionStore((state) => state.present);
  const ref = useFocusOnOpen(open);
  // Escape closes the inspector only while focus is inside it; a global
  // listener would also fire from form fields, Monaco and dialogs.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape' && !event.defaultPrevented) onClose();
  };
  return (
    <aside ref={ref} id={QEC_RESEARCH_INSPECTOR_ID} className="qec-inspector" aria-label="Research inspector" hidden={!open} onKeyDown={onKeyDown}>
      <InspectorHeading onClose={onClose} />
      <div className="qec-inspector__content">
        <SelectionDetails selection={selection} /><InspectorTools /><LineageState />
      </div>
      <footer className="qec-inspector__footer">
        <Button disabled title="Select evidence before pinning a Finding" icon={<Pin aria-hidden="true" size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />}>
          Pin finding
        </Button>
      </footer>
    </aside>
  );
}
