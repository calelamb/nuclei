import { Database, FileCode2, FlaskConical, FolderTree, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { QEC_PANEL_REGISTRY } from '../../../layout/qecPanelRegistry';
import { useQecStudyStore, type QecStudyValidationError } from '../../../services/qecStudyStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { useResearchSelectionStore } from '../../../stores/researchSelectionStore';
import type { QecStudy, QecStudySource, QecWorkspacePreset } from '../../../types/qecStudy';

const SOURCE_ICONS: Readonly<Record<QecStudySource['kind'], LucideIcon>> = {
  stim: FileCode2, python: FileCode2, dem: Database,
  experiment: FlaskConical, noise: Database, session: Database,
};

function SourcesHeading(): ReactElement {
  return (
    <header className="qec-zone-heading">
      <div><span className="qec-zone-heading__eyebrow">Study workspace</span><h2>Sources / Data</h2></div>
      <FolderTree aria-hidden="true" size={18} strokeWidth={1.7} />
    </header>
  );
}

function LoadingStudies(): ReactElement {
  return <div className="qec-zone-empty" role="status" aria-label="Loading QEC Studies"><LoaderCircle aria-hidden="true" size={24} /><strong>Loading Studies…</strong><span>Parsing and validating Study manifests.</span></div>;
}

function EmptyStudies(): ReactElement {
  return <div className="qec-zone-empty"><FolderTree aria-hidden="true" size={24} /><strong>No Studies found</strong><span>Create a Study manifest in the studies folder to organize QEC sources and evidence.</span></div>;
}

function ChooseStudy(): ReactElement {
  return <div className="qec-zone-empty"><FlaskConical aria-hidden="true" size={24} /><strong>Choose a Study</strong><span>Use the Study control in the research bar to inspect its referenced sources.</span></div>;
}

function ValidationDetails({ errors }: { errors: readonly QecStudyValidationError[] }): ReactElement {
  return (
    <section className="qec-study-errors" role="alert" aria-label="Study validation issues">
      <header>
        <TriangleAlert aria-hidden="true" size={17} />
        <div><strong>Study manifests need attention</strong><span>Fix these fields and save the files to retry validation.</span></div>
      </header>
      <ul>{errors.map((entry) => (
        <li key={entry.fileName}>
          <strong className="qec-mono">{entry.fileName}</strong>
          <ul>{entry.errors.map((error) => <li key={error}>{error}</li>)}</ul>
        </li>
      ))}</ul>
    </section>
  );
}

function StudyOverview({ study }: { study: QecStudy }): ReactElement {
  const selected = useResearchSelectionStore((state) => state.present.primary);
  const select = useResearchSelectionStore((state) => state.selectPrimary);
  const current = selected?.kind === 'study' && selected.id === study.id;
  return (
    <section className="qec-source-group" aria-labelledby="study-overview-heading">
      <h3 id="study-overview-heading">Overview</h3>
      <button type="button" className="qec-source-row" aria-current={current ? 'true' : undefined} onClick={() => select({ kind: 'study', id: study.id }, 'user')}>
        <FlaskConical aria-hidden="true" size={16} />
        <span><strong>{study.name}</strong><small>{study.question}</small></span>
      </button>
    </section>
  );
}

function SourceFileRow({ source }: { source: QecStudySource }): ReactElement {
  const selected = useResearchSelectionStore((state) => state.present.primary);
  const select = useResearchSelectionStore((state) => state.selectPrimary);
  const Icon = SOURCE_ICONS[source.kind];
  const current = selected?.kind === 'source' && selected.id === source.id;
  return (
    <button type="button" className="qec-source-row" aria-current={current ? 'true' : undefined} onClick={() => select({ kind: 'source', id: source.id }, 'user')}>
      <Icon aria-hidden="true" size={16} />
      <span><strong>{source.id}</strong><small className="qec-mono">{source.path}</small></span>
      <span className="qec-source-row__kind">{source.kind}</span>
    </button>
  );
}

function ReferencedFiles({ sources }: { sources: readonly QecStudySource[] }): ReactElement {
  return (
    <section className="qec-source-group" aria-labelledby="study-sources-heading">
      <h3 id="study-sources-heading">Referenced files</h3>
      {sources.length > 0 ? sources.map((source) => <SourceFileRow key={source.id} source={source} />) : <p className="qec-source-group__empty">No files referenced by this Study.</p>}
    </section>
  );
}

function SourceInstruments({ preset }: { preset: QecWorkspacePreset }): ReactElement | null {
  const panels = QEC_PANEL_REGISTRY.filter((panel) => panel.zone === 'sources' && panel.presets.includes(preset));
  if (panels.length === 0) return null;
  return (
    <section className="qec-source-group" aria-labelledby="source-instruments-heading">
      <h3 id="source-instruments-heading">Build instruments</h3>
      {panels.map((panel) => (
        <div className="qec-source-instrument" key={panel.id}>
          <span className="qec-source-instrument__mark" aria-hidden="true" />
          <span>{panel.title}</span><span className="qec-mono">ready</span>
        </div>
      ))}
    </section>
  );
}

function SourcesContent({ study, preset, errors, hasStudies }: { study: QecStudy | null; preset: QecWorkspacePreset; errors: readonly QecStudyValidationError[]; hasStudies: boolean }): ReactElement {
  if (!study && !hasStudies && errors.length === 0) return <EmptyStudies />;
  return (
    <div className="qec-sources__scroll">
      {!study && hasStudies && <ChooseStudy />}
      {study && <><StudyOverview study={study} /><ReferencedFiles sources={study.sources} /><SourceInstruments preset={preset} /></>}
      {errors.length > 0 && <ValidationDetails errors={errors} />}
    </div>
  );
}

function SourcesFooter({ count, issueCount, active }: { count: number; issueCount: number; active: boolean }): ReactElement {
  const issueLabel = `${issueCount} validation ${issueCount === 1 ? 'issue' : 'issues'}`;
  const status = issueCount > 0 ? issueLabel : active ? 'Manifest valid' : 'Not evaluated';
  const statusClass = issueCount > 0 ? 'qec-status qec-status--warning' : active
    ? 'qec-status qec-status--ready'
    : 'qec-status qec-status--neutral';
  return <footer className="qec-sources__footer"><span>{count} referenced files</span><span className={statusClass}>{status}</span></footer>;
}

function validationIssueCount(errors: readonly QecStudyValidationError[]): number {
  return errors.reduce((total, entry) => total + entry.errors.length, 0);
}

export function QecSourcesPanel(): ReactElement {
  const studies = useQecStudyStore((state) => state.studies);
  const errors = useQecStudyStore((state) => state.validationErrors);
  const loading = useQecStudyStore((state) => state.loading);
  const activeStudyId = useQecStudyUiStore((state) => state.activeStudyId);
  const preset = useQecWorkbenchStore((state) => state.preset);
  const study = studies.find((entry) => entry.study.id === activeStudyId)?.study ?? null;
  return (
    <nav className="qec-sources" aria-label="QEC sources and data">
      <SourcesHeading />
      {loading ? <LoadingStudies /> : <SourcesContent study={study} preset={preset} errors={errors} hasStudies={studies.length > 0} />}
      {!loading && <SourcesFooter count={study?.sources.length ?? 0} issueCount={validationIssueCount(errors)} active={study !== null} />}
    </nav>
  );
}
