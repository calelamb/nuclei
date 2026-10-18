import { ChevronDown, ChevronUp, CircleAlert, CircleDot, ListChecks, LoaderCircle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { resolveQecPanels } from '../../../layout/qecPanelRegistry';
import { usePlatform } from '../../../platform/PlatformProvider';
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
import { QecImportSheet } from '../import/QecImportSheet';
import { useQecTrayIdle } from './useQecTrayIdle';
import { describeEngineFailure } from './qecEngineMessage';
import { Button, IconButton } from '../../ui';
import { ICON_SIZE, ICON_STROKE } from '../../../styles/tokens';

interface TrayHeaderProps { expanded: boolean; importing: boolean; idle: boolean; onToggle(): void; }

function TrayHeader({ expanded, importing, idle, onToggle }: TrayHeaderProps): ReactElement {
  const preset = useQecWorkbenchStore((state) => state.preset);
  const pinnedPanelIds = useQecWorkbenchStore((state) => state.pinnedPanelIds);
  const panels = resolveQecPanels(preset, 'tray', pinnedPanelIds);
  return (
    <header className="qec-tray__header">
      <div className="qec-tray__tabs" aria-label="Operational instruments">
        {importing && <span className="qec-tray__active-instrument"><ListChecks aria-hidden="true" size={16} />Import</span>}
        {!importing && panels.map((panel) => <span className="qec-tray__active-instrument" key={panel.id}><ListChecks aria-hidden="true" size={16} />{panel.title}</span>)}
      </div>
      {idle && expanded && <span className="qec-tray__idle-note"><CircleDot aria-hidden="true" size={ICON_SIZE.xs} />No active jobs</span>}
      <IconButton className="qec-tray__toggle" aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} jobs and streams`} tooltip={{ label: `${expanded ? 'Collapse' : 'Expand'} jobs and streams`, placement: 'above' }} onClick={onToggle}>
        {expanded ? <ChevronDown aria-hidden="true" size={ICON_SIZE.md} strokeWidth={ICON_STROKE} /> : <ChevronUp aria-hidden="true" size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />}
      </IconButton>
    </header>
  );
}

function TrayContent({ client, projectRoot }: { client: QecImportClient | null; projectRoot: string | null }): ReactElement | null {
  const jobsById = useQecJobStore((state) => state.jobs);
  const cancelJob = useQecJobStore((state) => state.cancelJob);
  const jobs = Object.values(jobsById).filter((job) => job.projectRoot === projectRoot);
  const running = jobs.filter((job) => ['starting', 'running', 'cancelling'].includes(job.status)).length;
  const queued = jobs.filter((job) => job.status === 'starting').length;
  // Nothing to report: the header's "No active jobs" is the whole tray.
  if (jobs.length === 0) return null;
  return (
    <div className="qec-tray__content">
      <div className="qec-tray__empty"><ListChecks aria-hidden="true" size={16} /><div><strong>{jobs.length} durable {jobs.length === 1 ? 'job' : 'jobs'}</strong><span>Completion and cancellation state remain available in this tray.</span></div></div>
      <dl className="qec-tray__summary">
        <div><dt>Queued</dt><dd className="qec-mono">{queued}</dd></div>
        <div><dt>Running</dt><dd className="qec-mono">{running}</dd></div>
        <div><dt>Streams</dt><dd className="qec-mono">0</dd></div>
      </dl>
      {jobs.length > 0 && <ul className="qec-tray__jobs" aria-label="Durable QEC jobs">{jobs.map((job) => (
        <li key={job.id}>
          <div><strong>{job.kind} · {job.status}</strong><span className="qec-mono">{job.id}</span></div>
          <dl><div><dt>Source</dt><dd className="qec-mono">{job.source ?? 'Not recorded'}</dd></div><div><dt>Adapter</dt><dd className="qec-mono">{job.adapterId ?? 'Not recorded'}</dd></div><div><dt>Session</dt><dd className="qec-mono">{job.sessionId ?? 'Not recorded'}</dd></div><div><dt>Size</dt><dd className="qec-mono">{job.sourceByteSize ?? 'Pending'}</dd></div><div><dt>Hash</dt><dd className="qec-mono">{job.sourceHash ?? 'Pending'}</dd></div><div><dt>Provenance</dt><dd className="qec-mono">{job.provenanceId ?? 'Pending'}</dd></div></dl>
          {client && ['running', 'starting'].includes(job.status) && <Button size="sm" aria-label={`Cancel ${job.kind} ${job.id}`} onClick={() => void cancelJob(client, job.id)}>Cancel</Button>}
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

interface ProjectOperationIds {
  readonly importIds: readonly string[];
  readonly queryIds: readonly string[];
}

function captureProjectOperations(): ProjectOperationIds {
  return Object.freeze({
    importIds: useQecJobStore.getState().activeOperationIds(),
    queryIds: useQecQueryStore.getState().activeRequestIds(),
  });
}

function cancelProjectOperations(
  client: QecWorkbenchClient,
  operationIds: ProjectOperationIds,
): Promise<void> {
  const cancellations = [
    ...operationIds.importIds.map((id) => client.cancel('import', id)),
    ...operationIds.queryIds.map((id) => client.cancel('query', id)),
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

async function retireOwnedClient(
  client: QecWorkbenchClient,
  stopEngine: () => Promise<void>,
  operationIds: ProjectOperationIds,
): Promise<void> {
  try {
    await cancelProjectOperations(client, operationIds);
  } finally {
    client.disconnect?.();
    await stopEngine();
  }
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
    return () => { void cancelProjectOperations(client, captureProjectOperations()); };
  }, [client, projectRoot]);
}

function useImportEngine(
  enabled: boolean,
  provided: QecWorkbenchClient | undefined,
  connectClient: ConnectQecWorkbenchClient,
  stopEngine: (() => Promise<void>) | null,
): EngineState {
  const projectRoot = useProjectStore((state) => state.projectRoot);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<EngineState>({ client: null, loading: false, error: null, scope: null, retry: null, disconnected: false });
  const retryInFlight = useRef(false);
  const retirement = useRef<Promise<void>>(Promise.resolve());
  const retry = useCallback((): void => {
    if (retryInFlight.current) return;
    retryInFlight.current = true;
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
    let unsubscribe: (() => void) | null = null;
    const connection = retirement.current.then(() => connectClient(projectRoot));
    void connection.then(
      (client) => {
        if (current) {
          retryInFlight.current = false;
          unsubscribe = client.subscribeDisconnect?.((error) => {
            if (current) {
              retryInFlight.current = false;
              setState({ client: null, loading: false, error: error.message, scope: projectRoot, retry, disconnected: true });
            }
          }) ?? null;
          setState({ client, loading: false, error: null, scope: projectRoot, retry, disconnected: false });
        }
      },
      (error: unknown) => {
        if (current) {
          retryInFlight.current = false;
          setState({ client: null, loading: false, error: error instanceof Error ? error.message : 'QEC Data Engine could not start.', scope: projectRoot, retry, disconnected: false });
        }
      },
    );
    return () => {
      current = false;
      unsubscribe?.();
      if (!stopEngine) return;
      const operationIds = captureProjectOperations();
      const pendingRetirement = connection.then(
        (client) => retireOwnedClient(client, stopEngine, operationIds),
        () => stopEngine(),
      );
      void pendingRetirement.catch(() => undefined);
      retirement.current = pendingRetirement;
    };
  }, [attempt, connectClient, enabled, projectRoot, provided, retry, stopEngine]);
  if (provided) return { client: provided, loading: false, error: null, scope: projectRoot, retry: null, disconnected: false };
  if (!enabled) return { client: null, loading: false, error: null, scope: projectRoot, retry: null, disconnected: false };
  if (!projectRoot) return { client: null, loading: false, error: 'Open a project to start the QEC Data Engine.', scope: null, retry: null, disconnected: false };
  if (__BUILD_TARGET__ === 'web') return { client: null, loading: false, error: 'Canonical QEC import requires the desktop app.', scope: projectRoot, retry: null, disconnected: false };
  return state.scope === projectRoot ? state : { client: null, loading: true, error: null, scope: projectRoot, retry: null, disconnected: false };
}

function EngineNotice({ state }: { state: EngineState }): ReactElement {
  if (state.loading) return <div className="qec-tray__engine" role="status"><LoaderCircle className="nuclei-spin" aria-hidden="true" size={ICON_SIZE.lg} /><span>Starting authenticated QEC Data Engine…</span></div>;
  const copy = describeEngineFailure(state.error, state.disconnected);
  return (
    <div className="qec-tray__engine qec-tray__engine--error" role="alert">
      <CircleAlert aria-hidden="true" size={ICON_SIZE.lg} />
      <div className="qec-tray__engine-text">
        <strong>{copy.headline}</strong>
        <span>Sessions are unavailable until it is running.</span>
        {copy.detail && <details><summary>Technical details</summary><code>{copy.detail}</code></details>}
      </div>
      {state.retry && <Button size="sm" aria-label="Retry QEC Data Engine" icon={<RefreshCw aria-hidden="true" size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />} onClick={state.retry}>Retry</Button>}
    </div>
  );
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

export function QecWorkbenchTray({ client: providedClient, connectClient }: QecWorkbenchTrayProps = {}): ReactElement {
  const platform = usePlatform();
  const collapsed = useQecWorkbenchStore((state) => state.trayCollapsed);
  const toggleCollapsed = useQecWorkbenchStore((state) => state.toggleTrayCollapsed);
  const source = useQecJobStore((state) => state.importSource);
  const returnFocusId = useQecJobStore((state) => state.importReturnFocusId);
  const jobProjectRoot = useQecJobStore((state) => state.projectRoot);
  const projectRoot = useProjectStore((state) => state.projectRoot);
  const closeImport = useQecJobStore((state) => state.closeImport);
  const connectOwnedClient = useCallback(
    (root: string) => {
      if (!platform.startQecDataEngine) {
        return Promise.reject(new Error('QEC Data Engine is unavailable on this platform.'));
      }
      return connectQecDataClient(root, { launch: platform.startQecDataEngine });
    },
    [platform],
  );
  const stopOwnedEngine = useCallback(async (): Promise<void> => {
    await platform.stopQecDataEngine?.();
  }, [platform]);
  useProjectScope(projectRoot);
  const ownsEngine = !providedClient && !connectClient
    && Boolean(platform.startQecDataEngine && platform.stopQecDataEngine);
  const engineEnabled = Boolean(providedClient || connectClient || ownsEngine);
  const engine = useImportEngine(
    engineEnabled,
    providedClient,
    connectClient ?? connectOwnedClient,
    ownsEngine ? stopOwnedEngine : null,
  );
  useProvidedClientCleanup(providedClient, projectRoot);
  useSessionCatalog(engine.client, projectRoot);
  const engineOffline = !engine.client && !engine.loading && engine.error !== null;
  useEffect(() => {
    if (engineOffline && projectRoot) useQecSessionCatalogStore.getState().markUnavailable(projectRoot);
  }, [engineOffline, projectRoot]);
  const scopedSource = jobProjectRoot === projectRoot ? source : null;
  const closeAndRestoreFocus = (): void => {
    const targetId = returnFocusId;
    closeImport();
    if (targetId) queueMicrotask(() => document.getElementById(targetId)?.focus());
  };
  const expanded = !collapsed;
  const idle = useQecTrayIdle();
  const engineNotice = !engine.client && (engine.loading || engine.retry || engine.disconnected);
  return (
    <section className={`qec-tray qec-tray--${expanded ? 'expanded' : 'collapsed'}${scopedSource ? ' qec-tray--import' : ''}${expanded && idle ? ' qec-tray--idle' : ''}`} aria-label="QEC jobs and streams">
      <TrayHeader expanded={expanded} importing={scopedSource !== null} idle={idle && !engineNotice} onToggle={toggleCollapsed} />
      {!scopedSource && expanded && (engineNotice
        ? <EngineNotice state={engine} />
        : <TrayContent client={engine.client} projectRoot={projectRoot} />)}
      {scopedSource && engine.client && (
        <QecImportSheet source={scopedSource} onDismiss={closeAndRestoreFocus}>
          <QecImportWizard source={scopedSource} client={engine.client} onClose={closeAndRestoreFocus} hosted />
        </QecImportSheet>
      )}
      {scopedSource && !engine.client && <div className="qec-tray__import-host" hidden={!expanded}><EngineNotice state={engine} /></div>}
    </section>
  );
}
