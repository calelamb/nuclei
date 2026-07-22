import { ChevronDown, ChevronUp, CircleDot, ListChecks, LoaderCircle, Radio } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { resolveQecPanels } from '../../../layout/qecPanelRegistry';
import {
  connectQecDataClient,
  type QecImportClient,
  type QecDataDisconnectListener,
} from '../../../services/qecDataClient';
import { useProjectStore } from '../../../stores/projectStore';
import { useQecJobStore } from '../../../stores/qecJobStore';
import { useQecQueryStore } from '../../../stores/qecQueryStore';
import {
  useQecSessionCatalogStore,
  type QecSessionCatalogClient,
} from '../../../stores/qecSessionCatalogStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { QecImportWizard } from '../import/QecImportWizard';

interface TrayHeaderProps { expanded: boolean; importing: boolean; onToggle(): void; }

function TrayHeader({ expanded, importing, onToggle }: TrayHeaderProps): ReactElement {
  const preset = useQecWorkbenchStore((state) => state.preset);
  const pinnedPanelIds = useQecWorkbenchStore((state) => state.pinnedPanelIds);
  const panels = resolveQecPanels(preset, 'tray', pinnedPanelIds);
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

function TrayContent({ client, projectRoot }: { client: QecImportClient | null; projectRoot: string | null }): ReactElement {
  const jobsById = useQecJobStore((state) => state.jobs);
  const cancelJob = useQecJobStore((state) => state.cancelJob);
  const jobs = Object.values(jobsById).filter((job) => job.projectRoot === projectRoot);
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

type QecWorkbenchClient = QecImportClient & Partial<QecSessionCatalogClient> & Partial<{
  disconnect(): void;
  subscribeDisconnect(listener: QecDataDisconnectListener): () => void;
}>;
type ConnectQecWorkbenchClient = (projectRoot: string) => Promise<QecWorkbenchClient>;
const CLIENT_RETIRE_TIMEOUT_MS = 750;

interface EngineState {
  client: QecWorkbenchClient | null;
  loading: boolean;
  error: string | null;
  scope: string | null;
  retry: (() => void) | null;
  disconnected: boolean;
}

function cancelProjectOperations(client: QecWorkbenchClient): Promise<void> {
  const importIds = useQecJobStore.getState().activeOperationIds();
  const queryIds = useQecQueryStore.getState().activeRequestIds();
  const cancellations = [
    ...importIds.map((id) => client.cancel('import', id)),
    ...queryIds.map((id) => client.cancel('query', id)),
  ];
  if (cancellations.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, CLIENT_RETIRE_TIMEOUT_MS);
    void Promise.allSettled(cancellations).then(() => {
      window.clearTimeout(timeout);
      resolve();
    });
  });
}

function useProjectScope(projectRoot: string | null): void {
  useEffect(() => {
    useQecJobStore.getState().setProjectScope(projectRoot);
    useQecQueryStore.getState().setProjectScope(projectRoot);
    useQecSessionCatalogStore.getState().setProjectScope(projectRoot);
  }, [projectRoot]);
}

function useProvidedClientCleanup(client: QecWorkbenchClient | undefined, projectRoot: string | null): void {
  useEffect(() => {
    if (!client || !projectRoot) return undefined;
    return () => { void cancelProjectOperations(client); };
  }, [client, projectRoot]);
}

function useImportEngine(
  enabled: boolean,
  provided: QecWorkbenchClient | undefined,
  connectClient: ConnectQecWorkbenchClient,
): EngineState {
  const projectRoot = useProjectStore((state) => state.projectRoot);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<EngineState>({ client: null, loading: false, error: null, scope: null, retry: null, disconnected: false });
  const retry = useCallback((): void => {
    setState((current) => ({ ...current, client: null, loading: true, error: null, disconnected: false }));
    setAttempt((value) => value + 1);
  }, []);
  useEffect(() => {
    if (provided) {
      return undefined;
    }
    if (!enabled) return undefined;
    if (!projectRoot || __BUILD_TARGET__ === 'web') return undefined;
    let current = true;
    let connected: QecWorkbenchClient | null = null;
    let unsubscribe: (() => void) | null = null;
    void connectClient(projectRoot).then(
      (client) => {
        connected = client;
        if (current) {
          unsubscribe = client.subscribeDisconnect?.((error) => {
            if (current) setState({ client: null, loading: false, error: error.message, scope: projectRoot, retry, disconnected: true });
          }) ?? null;
          setState({ client, loading: false, error: null, scope: projectRoot, retry, disconnected: false });
        } else client.disconnect?.();
      },
      (error: unknown) => {
        if (current) setState({ client: null, loading: false, error: error instanceof Error ? error.message : 'QEC Data Engine could not start.', scope: projectRoot, retry, disconnected: false });
      },
    );
    return () => {
      current = false;
      unsubscribe?.();
      const retiringClient = connected;
      if (!retiringClient) return;
      void cancelProjectOperations(retiringClient).finally(() => retiringClient.disconnect?.());
    };
  }, [attempt, connectClient, enabled, projectRoot, provided, retry]);
  if (provided) return { client: provided, loading: false, error: null, scope: projectRoot, retry: null, disconnected: false };
  if (!enabled) return { client: null, loading: false, error: null, scope: projectRoot, retry: null, disconnected: false };
  if (!projectRoot) return { client: null, loading: false, error: 'Open a project to start the QEC Data Engine.', scope: null, retry: null, disconnected: false };
  if (__BUILD_TARGET__ === 'web') return { client: null, loading: false, error: 'Canonical QEC import requires the desktop app.', scope: projectRoot, retry: null, disconnected: false };
  return state.scope === projectRoot ? state : { client: null, loading: true, error: null, scope: projectRoot, retry: null, disconnected: false };
}

function EngineNotice({ state }: { state: EngineState }): ReactElement {
  if (state.loading) return <div className="qec-tray__engine" role="status"><LoaderCircle aria-hidden="true" size={18} /><span>Starting authenticated QEC Data Engine…</span></div>;
  return <div className="qec-tray__engine" role="alert"><CircleDot aria-hidden="true" size={18} /><span>{state.error}</span>{state.retry && <button type="button" onClick={state.retry}>Retry QEC Data Engine</button>}</div>;
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
  const catalogProject = useQecSessionCatalogStore((state) => state.projectRoot);
  const completionKey = completedSessionKey(jobs);
  useEffect(() => {
    if (projectRoot && catalogProject === projectRoot && client && supportsSessionCatalog(client)) void load(client, projectRoot);
  }, [catalogProject, client, completionKey, load, projectRoot]);
}

interface QecWorkbenchTrayProps {
  client?: QecWorkbenchClient;
  connectClient?: ConnectQecWorkbenchClient;
}

export function QecWorkbenchTray({ client: providedClient, connectClient = connectQecDataClient }: QecWorkbenchTrayProps = {}): ReactElement {
  const collapsed = useQecWorkbenchStore((state) => state.trayCollapsed);
  const toggleCollapsed = useQecWorkbenchStore((state) => state.toggleTrayCollapsed);
  const source = useQecJobStore((state) => state.importSource);
  const returnFocusId = useQecJobStore((state) => state.importReturnFocusId);
  const jobProjectRoot = useQecJobStore((state) => state.projectRoot);
  const projectRoot = useProjectStore((state) => state.projectRoot);
  const closeImport = useQecJobStore((state) => state.closeImport);
  useProjectScope(projectRoot);
  const engine = useImportEngine(true, providedClient, connectClient);
  useProvidedClientCleanup(providedClient, projectRoot);
  useSessionCatalog(engine.client, projectRoot);
  const scopedSource = jobProjectRoot === projectRoot ? source : null;
  const closeAndRestoreFocus = (): void => {
    const targetId = returnFocusId;
    closeImport();
    if (targetId) queueMicrotask(() => document.getElementById(targetId)?.focus());
  };
  const expanded = !collapsed;
  return (
    <section className={`qec-tray qec-tray--${expanded ? 'expanded' : 'collapsed'}${scopedSource ? ' qec-tray--import' : ''}`} aria-label="QEC jobs and streams">
      <TrayHeader expanded={expanded} importing={scopedSource !== null} onToggle={toggleCollapsed} />
      {!scopedSource && expanded && (engine.disconnected
        ? <EngineNotice state={engine} />
        : <TrayContent client={engine.client} projectRoot={projectRoot} />)}
      {scopedSource && <div className="qec-tray__import-host" hidden={!expanded}>
        {engine.client
          ? <QecImportWizard source={scopedSource} client={engine.client} onClose={closeAndRestoreFocus} />
          : <EngineNotice state={engine} />}
      </div>}
    </section>
  );
}
