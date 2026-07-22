import { ChevronDown, ChevronUp, CircleDot, ListChecks, LoaderCircle, Radio } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';

import { QEC_PANEL_REGISTRY } from '../../../layout/qecPanelRegistry';
import {
  QecDataClient,
  connectQecDataClient,
  type QecImportClient,
} from '../../../services/qecDataClient';
import { useProjectStore } from '../../../stores/projectStore';
import { useQecJobStore } from '../../../stores/qecJobStore';
import {
  useQecSessionCatalogStore,
  type QecSessionCatalogClient,
} from '../../../stores/qecSessionCatalogStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { QecImportWizard } from '../import/QecImportWizard';

interface TrayHeaderProps { expanded: boolean; importing: boolean; onToggle(): void; }

function TrayHeader({ expanded, importing, onToggle }: TrayHeaderProps): ReactElement {
  const preset = useQecWorkbenchStore((state) => state.preset);
  const panels = QEC_PANEL_REGISTRY.filter((panel) => panel.zone === 'tray' && panel.presets.includes(preset));
  return (
    <header className="qec-tray__header">
      <div className="qec-tray__tabs" aria-label="Operational instruments">
        {importing && <span className="qec-tray__active-instrument"><ListChecks aria-hidden="true" size={15} />Import</span>}
        {!importing && panels.map((panel) => <span className="qec-tray__active-instrument" key={panel.id}><ListChecks aria-hidden="true" size={15} />{panel.title}</span>)}
        <span><Radio aria-hidden="true" size={14} /> Streams</span><span>Logs</span><span>Comparisons</span>
      </div>
      <button type="button" className="qec-tray__toggle" aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} jobs and streams`} onClick={onToggle}>
        {expanded ? <ChevronDown aria-hidden="true" size={17} /> : <ChevronUp aria-hidden="true" size={17} />}
      </button>
    </header>
  );
}

function TrayContent({ client }: { client: QecImportClient | null }): ReactElement {
  const jobsById = useQecJobStore((state) => state.jobs);
  const cancelJob = useQecJobStore((state) => state.cancelJob);
  const jobs = Object.values(jobsById);
  const running = jobs.filter((job) => ['starting', 'running', 'cancelling'].includes(job.status)).length;
  const queued = jobs.filter((job) => job.status === 'starting').length;
  return (
    <div className="qec-tray__content">
      {jobs.length === 0
        ? <div className="qec-tray__empty"><CircleDot aria-hidden="true" size={18} /><div><strong>No active jobs</strong><span>Campaign, import, and stream lifecycle will remain visible here.</span></div></div>
        : <div className="qec-tray__empty"><ListChecks aria-hidden="true" size={18} /><div><strong>{jobs.length} durable {jobs.length === 1 ? 'job' : 'jobs'}</strong><span>Completion and cancellation state remain available in this tray.</span></div></div>}
      <dl className="qec-tray__summary">
        <div><dt>Queued</dt><dd className="qec-mono">{queued}</dd></div>
        <div><dt>Running</dt><dd className="qec-mono">{running}</dd></div>
        <div><dt>Streams</dt><dd className="qec-mono">0</dd></div>
      </dl>
      {jobs.length > 0 && <ul className="qec-tray__jobs" aria-label="Durable QEC jobs">{jobs.map((job) => (
        <li key={job.id}>
          <div><strong>{job.kind} · {job.status}</strong><span className="qec-mono">{job.id}</span></div>
          <dl><div><dt>Source</dt><dd className="qec-mono">{job.source ?? 'Not recorded'}</dd></div><div><dt>Adapter</dt><dd className="qec-mono">{job.adapterId ?? 'Not recorded'}</dd></div><div><dt>Session</dt><dd className="qec-mono">{job.sessionId ?? 'Not recorded'}</dd></div><div><dt>Size</dt><dd className="qec-mono">{job.sourceByteSize ?? 'Pending'}</dd></div><div><dt>Hash</dt><dd className="qec-mono">{job.sourceHash ?? 'Pending'}</dd></div><div><dt>Provenance</dt><dd className="qec-mono">{job.provenanceId ?? 'Pending'}</dd></div></dl>
          {client && ['running', 'starting'].includes(job.status) && <button type="button" aria-label={`Cancel ${job.kind} ${job.id}`} onClick={() => void cancelJob(client, job.id)}>Cancel</button>}
        </li>
      ))}</ul>}
    </div>
  );
}

type QecWorkbenchClient = QecImportClient & Partial<QecSessionCatalogClient>;

interface EngineState {
  client: QecWorkbenchClient | null;
  loading: boolean;
  error: string | null;
  scope: string | null;
}

function useImportEngine(enabled: boolean, provided?: QecWorkbenchClient): EngineState {
  const projectRoot = useProjectStore((state) => state.projectRoot);
  const [state, setState] = useState<EngineState>({ client: null, loading: false, error: null, scope: null });
  useEffect(() => {
    if (provided) {
      return undefined;
    }
    if (!enabled) return undefined;
    if (!projectRoot || __BUILD_TARGET__ === 'web') return undefined;
    let current = true;
    let connected: QecDataClient | null = null;
    void connectQecDataClient(projectRoot).then(
      (client) => {
        connected = client;
        if (current) setState({ client, loading: false, error: null, scope: projectRoot });
        else client.disconnect();
      },
      (error: unknown) => {
        if (current) setState({ client: null, loading: false, error: error instanceof Error ? error.message : 'QEC Data Engine could not start.', scope: projectRoot });
      },
    );
    return () => { current = false; connected?.disconnect(); };
  }, [enabled, projectRoot, provided]);
  if (provided) return { client: provided, loading: false, error: null, scope: projectRoot };
  if (!enabled) return { client: null, loading: false, error: null, scope: projectRoot };
  if (!projectRoot) return { client: null, loading: false, error: 'Open a project to start the QEC Data Engine.', scope: null };
  if (__BUILD_TARGET__ === 'web') return { client: null, loading: false, error: 'Canonical QEC import requires the desktop app.', scope: projectRoot };
  return state.scope === projectRoot ? state : { client: null, loading: true, error: null, scope: projectRoot };
}

function EngineNotice({ state }: { state: EngineState }): ReactElement {
  if (state.loading) return <div className="qec-tray__engine" role="status"><LoaderCircle aria-hidden="true" size={18} /><span>Starting authenticated QEC Data Engine…</span></div>;
  return <div className="qec-tray__engine" role="alert"><CircleDot aria-hidden="true" size={18} /><span>{state.error}</span></div>;
}

function supportsSessionCatalog(client: QecWorkbenchClient): client is QecWorkbenchClient & QecSessionCatalogClient {
  return typeof client.listSessions === 'function';
}

function completedSessionKey(jobs: ReturnType<typeof useQecJobStore.getState>['jobs']): string {
  return Object.values(jobs)
    .filter((job) => job.kind === 'import' && job.status === 'complete' && job.sessionId)
    .map((job) => job.sessionId)
    .sort()
    .join('\n');
}

function useSessionCatalog(client: QecWorkbenchClient | null, projectRoot: string | null): void {
  const jobs = useQecJobStore((state) => state.jobs);
  const load = useQecSessionCatalogStore((state) => state.load);
  const reset = useQecSessionCatalogStore((state) => state.reset);
  const catalogProject = useQecSessionCatalogStore((state) => state.projectRoot);
  const completionKey = completedSessionKey(jobs);
  useEffect(() => {
    if (!projectRoot || (catalogProject && catalogProject !== projectRoot)) reset();
  }, [catalogProject, projectRoot, reset]);
  useEffect(() => {
    if (projectRoot && client && supportsSessionCatalog(client)) void load(client, projectRoot);
  }, [client, completionKey, load, projectRoot]);
}

interface QecWorkbenchTrayProps { client?: QecWorkbenchClient; }

export function QecWorkbenchTray({ client: providedClient }: QecWorkbenchTrayProps = {}): ReactElement {
  const collapsed = useQecWorkbenchStore((state) => state.trayCollapsed);
  const toggleCollapsed = useQecWorkbenchStore((state) => state.toggleTrayCollapsed);
  const source = useQecJobStore((state) => state.importSource);
  const returnFocusId = useQecJobStore((state) => state.importReturnFocusId);
  const projectRoot = useProjectStore((state) => state.projectRoot);
  const closeImport = useQecJobStore((state) => state.closeImport);
  const engine = useImportEngine(true, providedClient);
  useSessionCatalog(engine.client, projectRoot);
  const closeAndRestoreFocus = (): void => {
    const targetId = returnFocusId;
    closeImport();
    if (targetId) queueMicrotask(() => document.getElementById(targetId)?.focus());
  };
  const expanded = !collapsed;
  return (
    <section className={`qec-tray qec-tray--${expanded ? 'expanded' : 'collapsed'}${source ? ' qec-tray--import' : ''}`} aria-label="QEC jobs and streams">
      <TrayHeader expanded={expanded} importing={source !== null} onToggle={toggleCollapsed} />
      {!source && expanded && <TrayContent client={engine.client} />}
      {source && <div className="qec-tray__import-host" hidden={!expanded}>
        {engine.client
          ? <QecImportWizard source={source} client={engine.client} onClose={closeAndRestoreFocus} />
          : <EngineNotice state={engine} />}
      </div>}
    </section>
  );
}
