import { Database, FileCode2, FlaskConical, FolderTree } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { QEC_PANEL_REGISTRY } from '../../../layout/qecPanelRegistry';
import { useQecStudyStore } from '../../../services/qecStudyStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { useResearchSelectionStore } from '../../../stores/researchSelectionStore';
import type { QecStudySource } from '../../../types/qecStudy';

const SOURCE_ICONS: Readonly<Record<QecStudySource['kind'], LucideIcon>> = {
  stim: FileCode2,
  python: FileCode2,
  dem: Database,
  experiment: FlaskConical,
  noise: Database,
  session: Database,
};

export function QecSourcesPanel(): ReactElement {
  const studies = useQecStudyStore((state) => state.studies);
  const validationErrors = useQecStudyStore((state) => state.validationErrors);
  const activeStudyId = useQecStudyUiStore((state) => state.activeStudyId);
  const preset = useQecWorkbenchStore((state) => state.preset);
  const selected = useResearchSelectionStore((state) => state.present.primary);
  const selectPrimary = useResearchSelectionStore((state) => state.selectPrimary);
  const activeStudy = studies.find(({ study }) => study.id === activeStudyId)?.study ?? null;
  const sourceInstruments = QEC_PANEL_REGISTRY.filter(
    (panel) => panel.zone === 'sources' && panel.presets.includes(preset),
  );

  return (
    <nav className="qec-sources" aria-label="QEC sources and data">
      <header className="qec-zone-heading">
        <div>
          <span className="qec-zone-heading__eyebrow">Study workspace</span>
          <h2>Sources / Data</h2>
        </div>
        <FolderTree aria-hidden="true" size={18} strokeWidth={1.7} />
      </header>

      {activeStudy ? (
        <div className="qec-sources__scroll">
          <section className="qec-source-group" aria-labelledby="study-overview-heading">
            <h3 id="study-overview-heading">Overview</h3>
            <button
              type="button"
              className="qec-source-row"
              aria-current={selected?.kind === 'study' && selected.id === activeStudy.id ? 'true' : undefined}
              onClick={() => selectPrimary({ kind: 'study', id: activeStudy.id }, 'user')}
            >
              <FlaskConical aria-hidden="true" size={16} />
              <span>
                <strong>{activeStudy.name}</strong>
                <small>{activeStudy.question}</small>
              </span>
            </button>
          </section>

          <section className="qec-source-group" aria-labelledby="study-sources-heading">
            <h3 id="study-sources-heading">Referenced files</h3>
            {activeStudy.sources.map((source) => {
              const Icon = SOURCE_ICONS[source.kind];
              const isSelected = selected?.kind === 'source' && selected.id === source.id;
              return (
                <button
                  key={source.id}
                  type="button"
                  className="qec-source-row"
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => selectPrimary({ kind: 'source', id: source.id }, 'user')}
                >
                  <Icon aria-hidden="true" size={16} />
                  <span>
                    <strong>{source.id}</strong>
                    <small className="qec-mono">{source.path}</small>
                  </span>
                  <span className="qec-source-row__kind">{source.kind}</span>
                </button>
              );
            })}
          </section>

          {sourceInstruments.length > 0 && (
            <section className="qec-source-group" aria-labelledby="source-instruments-heading">
              <h3 id="source-instruments-heading">Build instruments</h3>
              {sourceInstruments.map((panel) => (
                <div className="qec-source-instrument" key={panel.id}>
                  <span className="qec-source-instrument__mark" aria-hidden="true" />
                  <span>{panel.title}</span>
                  <span className="qec-mono">ready</span>
                </div>
              ))}
            </section>
          )}
        </div>
      ) : (
        <div className="qec-zone-empty">
          <FolderTree aria-hidden="true" size={24} />
          <strong>No Study selected</strong>
          <span>Choose a Study from the research bar to reveal its sources.</span>
        </div>
      )}

      <footer className="qec-sources__footer">
        <span>{activeStudy?.sources.length ?? 0} referenced files</span>
        <span className={validationErrors.length > 0 ? 'qec-status qec-status--warning' : 'qec-status qec-status--ready'}>
          {validationErrors.length > 0 ? `${validationErrors.length} validation issues` : 'Validated'}
        </span>
      </footer>
    </nav>
  );
}
