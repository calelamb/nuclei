import { Database, ExternalLink, FileCode2, FlaskConical, FolderInput, FolderTree, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { KeyboardEvent, ReactElement } from 'react';
import { resolveQecPanels } from '../../../layout/qecPanelRegistry';
import { useQecStudyStore, type QecStudyValidationError } from '../../../services/qecStudyStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useQecJobStore } from '../../../stores/qecJobStore';
import { useQecSessionCatalogStore } from '../../../stores/qecSessionCatalogStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { useResearchSelectionStore } from '../../../stores/researchSelectionStore';
import type { QecStudy, QecStudySource, QecWorkspacePreset } from '../../../types/qecStudy';
import type { QecSession } from '../../../types/qecData';
import { QecPanelPinButton } from './QecPanelPinButton';
import { Badge, IconButton } from '../../ui';
import { isOpenableSource, useOpenSource } from './useOpenSource';
import { ICON_SIZE, ICON_STROKE } from '../../../styles/tokens';

const SOURCE_ICONS: Readonly<Record<QecStudySource['kind'], LucideIcon>> = {
  stim: FileCode2, python: FileCode2, dem: Database,
  experiment: FlaskConical, noise: Database, session: Database,
};

function SourcesHeading(): ReactElement {
  return (
    <header className="qec-zone-heading">
      <div><span className="qec-zone-heading__eyebrow">Study workspace</span><h2>Sources / Data</h2></div>
      <FolderTree aria-hidden="true" size={16} strokeWidth={1.7} />
    </header>
  );
}

function LoadingStudies(): ReactElement {
  return <div className="qec-zone-empty" role="status" aria-label="Loading QEC Studies"><LoaderCircle aria-hidden="true" size={20} /><strong>Loading Studies…</strong><span>Parsing and validating Study manifests.</span></div>;
}

function EmptyStudies(): ReactElement {
  const projectRoot = useProjectStore((state) => state.projectRoot);
  const body = projectRoot
    ? 'Create a Study manifest in the studies folder to organize QEC sources and evidence.'
    : 'Open a project folder to create Studies. Analyze works without one: drop a sinter stats CSV there.';
  return <div className="qec-zone-empty"><FolderTree aria-hidden="true" size={20} /><strong>No Studies found</strong><span>{body}</span></div>;
}

function ChooseStudy(): ReactElement {
  return <div className="qec-zone-empty"><FlaskConical aria-hidden="true" size={20} /><strong>Choose a Study</strong><span>Use the Study control in the research bar to inspect its referenced sources.</span></div>;
}

function ValidationDetails({ errors }: { errors: readonly QecStudyValidationError[] }): ReactElement {
  return (
    <section className="qec-study-errors" role="alert" aria-label="Study validation issues">
      <header>
        <TriangleAlert aria-hidden="true" size={16} />
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

function SourceFileRow({ source, onOpen }: { source: QecStudySource; onOpen: (source: QecStudySource) => void }): ReactElement {
  const selected = useResearchSelectionStore((state) => state.present.primary);
  const select = useResearchSelectionStore((state) => state.selectPrimary);
  const Icon = SOURCE_ICONS[source.kind];
  const current = selected?.kind === 'source' && selected.id === source.id;
  const openImport = useQecJobStore((state) => state.openImport);
  const projectRoot = useProjectStore((state) => state.projectRoot);
  const jobProjectRoot = useQecJobStore((state) => state.projectRoot);
  const setTrayCollapsed = useQecWorkbenchStore((state) => state.setTrayCollapsed);
  const importButtonId = `qec-import-${source.id.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`;
  const openable = isOpenableSource(source);
  const launchImport = (): void => {
    if (!projectRoot || jobProjectRoot !== projectRoot) return;
    openImport(projectRoot, source.path, importButtonId);
    setTrayCollapsed(false);
  };
  const selectSource = (): void => select({ kind: 'source', id: source.id }, 'user');
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'Enter' || !openable) return;
    event.preventDefault();
    selectSource();
    onOpen(source);
  };
  return (
    <div className="qec-source-row-shell" aria-current={current ? 'true' : undefined} data-openable={openable ? 'true' : undefined}>
      <button
        type="button"
        className="qec-source-row"
        title={openable ? 'Double-click or press Enter to open in the editor' : undefined}
        onClick={selectSource}
        onDoubleClick={openable ? () => onOpen(source) : undefined}
        onKeyDown={onKeyDown}
      >
        <Icon aria-hidden="true" size={16} />
        <span><strong>{source.id}</strong><small className="qec-mono">{source.path}</small></span>
        <Badge className="qec-source-row__kind">{source.kind}</Badge>
      </button>
      <span className="qec-source-row__actions">
        {openable && (
          <IconButton aria-label={`Open ${source.id}`} title="Open in the editor" onClick={() => onOpen(source)}>
            <ExternalLink aria-hidden="true" size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
          </IconButton>
        )}
        <IconButton id={importButtonId} className="qec-source-row__import" aria-label={`Import ${source.id}`} title={projectRoot ? 'Import into canonical QEC data' : 'Open a project before importing QEC data'} disabled={!projectRoot || jobProjectRoot !== projectRoot} onClick={launchImport}>
          <FolderInput aria-hidden="true" size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
        </IconButton>
      </span>
    </div>
  );
}

function ReferencedFiles({ sources }: { sources: readonly QecStudySource[] }): ReactElement {
  const { open, error } = useOpenSource();
  return (
    <section className="qec-source-group" aria-labelledby="study-sources-heading">
      <h3 id="study-sources-heading">Referenced files</h3>
      {error && <p className="qec-source-group__empty qec-source-group__error" role="alert">{error}</p>}
      {sources.length > 0 ? sources.map((source) => <SourceFileRow key={source.id} source={source} onOpen={(entry) => { void open(entry); }} />) : <p className="qec-source-group__empty">No files referenced by this Study.</p>}
    </section>
  );
}

function sessionKindLabel(kind: QecSession['kind']): string {
  return kind.replaceAll('_', ' ');
}

function CanonicalSessionRow({ session }: { session: QecSession }): ReactElement {
  const selected = useResearchSelectionStore((state) => state.present.primary);
  const select = useResearchSelectionStore((state) => state.selectPrimary);
  const current = selected?.kind === 'session' && selected.sessionId === session.session_id;
  return (
    <button
      type="button"
      aria-current={current ? 'true' : undefined}
      className="qec-source-row qec-session-row"
      onClick={() => select({ kind: 'session', id: session.session_id, sessionId: session.session_id }, 'user')}
    >
      <Database aria-hidden="true" size={16} />
      <span>
        <strong>{session.session_id}</strong>
        <small>{sessionKindLabel(session.kind)} · {session.status}</small>
        <small className="qec-mono">{session.provenance_id}</small>
      </span>
      <span className={`qec-session-row__status qec-session-row__status--${session.status}`}>{session.status}</span>
    </button>
  );
}

function CanonicalSessions(): ReactElement | null {
  const sessions = useQecSessionCatalogStore((state) => state.sessions);
  const status = useQecSessionCatalogStore((state) => state.status);
  const error = useQecSessionCatalogStore((state) => state.error);
  const catalogProjectRoot = useQecSessionCatalogStore((state) => state.projectRoot);
  const projectRoot = useProjectStore((state) => state.projectRoot);
  if (catalogProjectRoot !== projectRoot) return null;
  if (status === 'idle' && sessions.length === 0) return null;
  return (
    <section className="qec-source-group" aria-labelledby="canonical-sessions-heading">
      <h3 id="canonical-sessions-heading">Canonical sessions</h3>
      {status === 'loading' && sessions.length === 0 && <p className="qec-source-group__empty" role="status">Loading engine sessions…</p>}
      {status === 'error' && <p className="qec-source-group__empty" role="alert">{error}</p>}
      {status === 'ready' && sessions.length === 0 && <p className="qec-source-group__empty">No canonical sessions yet.</p>}
      {sessions.length > 0 && <ul className="qec-session-tree" aria-label="Canonical sessions">
        {sessions.map((session) => <li key={session.session_id}><CanonicalSessionRow session={session} /></li>)}
      </ul>}
    </section>
  );
}

function SourceInstruments({ preset }: { preset: QecWorkspacePreset }): ReactElement | null {
  const pinnedPanelIds = useQecWorkbenchStore((state) => state.pinnedPanelIds);
  const panels = resolveQecPanels(preset, 'sources', pinnedPanelIds);
  if (panels.length === 0) return null;
  return (
    <section className="qec-source-group" aria-labelledby="source-instruments-heading">
      <h3 id="source-instruments-heading">Build instruments</h3>
      {panels.map((panel) => (
        <div className="qec-source-instrument" key={panel.id}>
          <span className="qec-source-instrument__mark" aria-hidden="true" />
          <span>{panel.title}</span><span className="qec-source-instrument__state">ready</span><QecPanelPinButton panel={panel} />
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
      {study && <><StudyOverview study={study} /><ReferencedFiles sources={study.sources} /><CanonicalSessions /><SourceInstruments preset={preset} /></>}
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
  return <footer className="qec-sources__footer"><span>{count} referenced {count === 1 ? 'file' : 'files'}</span><span className={statusClass}>{status}</span></footer>;
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
