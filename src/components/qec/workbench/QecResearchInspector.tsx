import { Info, Pin } from 'lucide-react';
import type { ReactElement } from 'react';
import { QEC_PANEL_REGISTRY } from '../../../layout/qecPanelRegistry';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { useResearchSelectionStore } from '../../../stores/researchSelectionStore';

export function QecResearchInspector(): ReactElement {
  const preset = useQecWorkbenchStore((state) => state.preset);
  const selection = useResearchSelectionStore((state) => state.present);
  const inspectorPanels = QEC_PANEL_REGISTRY.filter(
    (panel) => panel.zone === 'inspector' && panel.presets.includes(preset),
  );
  const selectedRefs = selection.primary
    ? [selection.primary, ...selection.scope]
    : [];

  return (
    <aside className="qec-inspector" aria-label="Research inspector">
      <header className="qec-zone-heading">
        <div>
          <span className="qec-zone-heading__eyebrow">Contextual detail</span>
          <h2>Inspector</h2>
        </div>
        <Info aria-hidden="true" size={18} strokeWidth={1.7} />
      </header>

      <div className="qec-inspector__content">
        {selectedRefs.length > 0 ? (
          <section className="qec-inspector__section" aria-labelledby="selection-heading">
            <h3 id="selection-heading">Active selection</h3>
            <dl>
              {selectedRefs.map((ref) => (
                <div key={`${ref.kind}:${ref.id}`}>
                  <dt>{ref.kind.replaceAll('-', ' ')}</dt>
                  <dd className="qec-mono">{ref.id}</dd>
                </div>
              ))}
              {selection.timeWindow && (
                <div>
                  <dt>Window</dt>
                  <dd className="qec-mono">
                    {selection.timeWindow.start}–{selection.timeWindow.end} {selection.timeWindow.domain}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        ) : (
          <div className="qec-zone-empty qec-zone-empty--compact">
            <Info aria-hidden="true" size={22} />
            <strong>Nothing selected</strong>
            <span>Select a source or canvas object to inspect values and lineage.</span>
          </div>
        )}

        <section className="qec-inspector__section" aria-labelledby="inspector-tools-heading">
          <h3 id="inspector-tools-heading">Available instruments</h3>
          <ul className="qec-inspector__tools">
            {inspectorPanels.map((panel) => <li key={panel.id}>{panel.title}</li>)}
          </ul>
        </section>

        <section className="qec-inspector__section" aria-labelledby="lineage-heading">
          <h3 id="lineage-heading">Lineage</h3>
          <div className="qec-lineage-state">
            <span className="qec-lineage-state__mark" aria-hidden="true" />
            <div>
              <strong>Source-backed</strong>
              <span>No derived result is active.</span>
            </div>
          </div>
        </section>
      </div>

      <footer className="qec-inspector__footer">
        <button type="button" disabled title="Select evidence before pinning a Finding">
          <Pin aria-hidden="true" size={15} />
          Pin Finding
        </button>
      </footer>
    </aside>
  );
}
