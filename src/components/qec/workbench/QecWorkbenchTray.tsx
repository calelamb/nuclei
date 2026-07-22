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

function TrayContent(): ReactElement {
  const jobsById = useQecJobStore((state) => state.jobs);
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
    </div>
  );
}

interface EngineState {
  client: QecImportClient | null;
  loading: boolean;
  error: string | null;
  scope: string | null;
}

function useImportEngine(source: string | null, provided?: QecImportClient): EngineState {
  const projectRoot = useProjectStore((state) => state.projectRoot);
  const [state, setState] = useState<EngineState>({ client: null, loading: false, error: null, scope: null });
  const enabled = source !== null;
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

interface QecWorkbenchTrayProps { client?: QecImportClient; }

export function QecWorkbenchTray({ client: providedClient }: QecWorkbenchTrayProps = {}): ReactElement {
  const collapsed = useQecWorkbenchStore((state) => state.trayCollapsed);
  const toggleCollapsed = useQecWorkbenchStore((state) => state.toggleTrayCollapsed);
  const source = useQecJobStore((state) => state.importSource);
  const closeImport = useQecJobStore((state) => state.closeImport);
  const engine = useImportEngine(source, providedClient);
  const expanded = !collapsed;
  return (
    <section className={`qec-tray qec-tray--${expanded ? 'expanded' : 'collapsed'}${source ? ' qec-tray--import' : ''}`} aria-label="QEC jobs and streams">
      <TrayHeader expanded={expanded} importing={source !== null} onToggle={toggleCollapsed} />
      {!source && expanded && <TrayContent />}
      {source && <div className="qec-tray__import-host" hidden={!expanded}>
        {engine.client
          ? <QecImportWizard source={source} client={engine.client} onClose={closeImport} />
          : <EngineNotice state={engine} />}
      </div>}
    </section>
  );
}
