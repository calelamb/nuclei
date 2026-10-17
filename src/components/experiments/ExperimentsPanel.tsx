import { useEffect, useRef, useState } from 'react';
import { Pencil, FlaskConical, Waves } from 'lucide-react';
import { isWebBuild } from '../../platform/buildTarget';
import { useNavigationStore } from '../../stores/navigationStore';
import { useThemeStore } from '../../stores/themeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentStore, type DiscoveredExperiment } from '../../services/experimentStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { createTauriExperimentFs } from '../../services/experimentFs';
import { campaignTaskCount, expandGrid } from '../../types/experiment';
import { describeLastRun } from './runDetailFormat';
import { NewExperimentForm } from './NewExperimentForm';
import { NewQecExperimentMenu } from './NewQecExperimentMenu';
import { NoiseModelLibrary } from './NoiseModelLibrary';
import { RunButton } from './RunButton';
import { RunFeedback } from './RunFeedback';
import { TYPOGRAPHY, ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button, IconButton } from '../ui';
import './experiments.css';

/**
 * PRD 09 Phase D (D1) — Research-mode left-rail Experiments panel. Replaces
 * the Phase A placeholder in `Sidebar.tsx`. Lists the open project's
 * `experiments/*.experiment.yaml`, surfaces malformed files as validation
 * cards (never a crash — matches `experimentStore`'s contract), and opens
 * `NewExperimentForm` for creating (or editing) an experiment.
 */

function formatLastRun(experiment: DiscoveredExperiment, runsByExperiment: Record<string, { manifest: { started_at: string } }[]>): { label: string; title: string } {
  // Runs are stored newest-first by directory name.
  return describeLastRun(runsByExperiment[experiment.fileName]?.[0]?.manifest.started_at);
}

function gridSizeLabel(experiment: DiscoveredExperiment): string {
  const { spec } = experiment;
  if (spec.type === 'qec_campaign') {
    const count = campaignTaskCount(spec);
    return count === null ? '?' : String(count);
  }
  try {
    return String(expandGrid(spec.sweep).length);
  } catch {
    // Discovered experiments already passed grid validation at parse time;
    // this only guards against a future schema change surfacing here first.
    return '—';
  }
}

function WebExperimentsEmptyState() {
  const colors = useThemeStore((s) => s.colors);
  const setActiveView = useNavigationStore((s) => s.setActiveView);
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, fontFamily: TYPOGRAPHY.fontSans }}>
      <FlaskConical size={ICON_SIZE.lg} strokeWidth={ICON_STROKE} style={{ color: colors.textDim }} />
      <div style={{ color: colors.text, fontSize: 13, fontWeight: 600 }}>Experiments live in the desktop app</div>
      <div style={{ color: colors.textMuted, fontSize: 12, lineHeight: 1.55 }}>
        Experiments are parameter sweeps saved as files in a project folder, so they need the desktop app.
        In the browser you can still analyse QEC data and edit and simulate circuits.
      </div>
      <Button variant="primary" size="lg" onClick={() => setActiveView('qec')} style={{ width: '100%' }}>
        Open QEC Workbench
      </Button>
      <a
        href="https://getnuclei.dev"
        target="_blank"
        rel="noreferrer"
        className="nuclei-btn nuclei-btn--secondary nuclei-btn--lg"
        style={{ width: '100%', textDecoration: 'none' }}
      >
        Download Nuclei
      </a>
    </div>
  );
}

function ExperimentRow({
  experiment,
  projectRoot,
  lastRun,
  selected,
  onSelect,
  onEdit,
}: {
  experiment: DiscoveredExperiment;
  projectRoot: string;
  lastRun: { label: string; title: string };
  selected: boolean;
  onSelect(): void;
  onEdit(): void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const { spec } = experiment;

  return (
    <div
      className="nuclei-experiment-row"
      data-testid={`experiment-row-${experiment.fileName}`}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          className="nuclei-experiment-row__name"
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          title={`Open ${spec.name}`}
        >
          {spec.name}
        </button>
        <IconButton
          size="sm"
          aria-label={`Edit ${spec.name}`}
          title="Edit experiment"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
        >
          <Pencil size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />
        </IconButton>
      </div>
      <div style={{ color: colors.textDim, fontSize: 11, fontFamily: TYPOGRAPHY.fontMono }}>
        {spec.type === 'qec_campaign'
          ? `${'generate' in spec.source ? spec.source.generate.code : spec.source.entry} · ${spec.noise.model} · ${spec.decoders.join('+')}`
          : `${spec.entry} · ${spec.backend.provider}/${spec.backend.target}`}
      </div>
      <div
        className="nuclei-experiment-row__meta"
        title={lastRun.title}
        style={{ color: colors.textDim, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans }}
      >
        {spec.type === 'qec_campaign'
          ? `campaign · ${gridSizeLabel(experiment)} task${gridSizeLabel(experiment) === '1' ? '' : 's'} · last run ${lastRun.label}`
          : `${gridSizeLabel(experiment)} point${gridSizeLabel(experiment) === '1' ? '' : 's'} · last run ${lastRun.label}`}
      </div>
      {spec.type !== 'qec_campaign' && (
        <div onClick={(e) => e.stopPropagation()}>
          <RunButton experiment={experiment} projectRoot={projectRoot} pointCount={Number(gridSizeLabel(experiment)) || 0} variant="ghost" />
        </div>
      )}
    </div>
  );
}

export function ExperimentsPanel() {
  const colors = useThemeStore((s) => s.colors);
  const projectRoot = useProjectStore((s) => s.projectRoot);
  const experiments = useExperimentStore((s) => s.experiments);
  const validationErrors = useExperimentStore((s) => s.validationErrors);
  const runsByExperiment = useExperimentStore((s) => s.runsByExperiment);
  const reload = useExperimentStore((s) => s.reload);
  const scanRuns = useExperimentStore((s) => s.scanRuns);
  const startWatching = useExperimentStore((s) => s.startWatching);
  const stopWatching = useExperimentStore((s) => s.stopWatching);
  const selectExperiment = useExperimentUiStore((s) => s.selectExperiment);
  const selectedFileName = useExperimentUiStore((s) => s.selectedExperimentFileName);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DiscoveredExperiment | undefined>(undefined);
  const [noiseLibOpen, setNoiseLibOpen] = useState(false);
  const formDirtyRef = useRef(false);

  /** Opens the form on `target` (undefined = blank), asking first if the open form has unsaved edits. */
  const openForm = (target: DiscoveredExperiment | undefined) => {
    const switching = formOpen && (editing?.fileName ?? 'new') !== (target?.fileName ?? 'new');
    if (switching && formDirtyRef.current && !window.confirm('Discard your unsaved changes to this experiment?')) return;
    formDirtyRef.current = false;
    setEditing(target);
    setFormOpen(true);
  };

  useEffect(() => {
    if (!projectRoot) return;
    const fs = createTauriExperimentFs();
    void reload(projectRoot, fs);
    void startWatching(projectRoot, fs);
    return () => stopWatching();
  }, [projectRoot, reload, startWatching, stopWatching]);

  // "Last run" needs each experiment's runs scanned at least once — cheap
  // (manifest.json + metrics.json reads only) and re-triggered whenever the
  // discovered experiment set changes.
  useEffect(() => {
    if (!projectRoot) return;
    const fs = createTauriExperimentFs();
    for (const experiment of experiments) {
      void scanRuns(experiment, projectRoot, fs);
    }
  }, [projectRoot, experiments, scanRuns]);

  if (isWebBuild()) return <WebExperimentsEmptyState />;

  if (!projectRoot) {
    return (
      <div style={{ padding: 16, color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans, textAlign: 'center' }}>
        <FlaskConical size={ICON_SIZE.lg} strokeWidth={ICON_STROKE} style={{ opacity: 0.6, marginBottom: 8 }} />
        <div>Open a folder to start experimenting.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 10px', display: 'flex', gap: 6, alignItems: 'center', borderBottom: `1px solid ${colors.border}` }}>
        <Button variant="secondary" onClick={() => openForm(undefined)} style={{ flex: 1, minWidth: 0 }}>
          + New experiment
        </Button>
        <NewQecExperimentMenu projectRoot={projectRoot} />
        <IconButton variant="secondary" aria-label="Noise models" title="Noise models" onClick={() => setNoiseLibOpen(true)}>
          <Waves size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
        </IconButton>
      </div>
      <RunFeedback compact />

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {experiments.length === 0 && validationErrors.length === 0 && (
          <div style={{ padding: 16, color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>
            No experiments yet. Create one to declare a parameter sweep.
          </div>
        )}

        {experiments.map((experiment) => (
          <ExperimentRow
            key={experiment.fileName}
            experiment={experiment}
            projectRoot={projectRoot}
            lastRun={formatLastRun(experiment, runsByExperiment)}
            selected={selectedFileName === experiment.fileName}
            onSelect={() => selectExperiment(experiment.fileName)}
            onEdit={() => openForm(experiment)}
          />
        ))}

        {validationErrors.map((err) => (
          <div
            key={err.fileName}
            role="alert"
            style={{
              margin: 8, padding: 10, border: `1px solid ${colors.error}`, borderRadius: 'var(--radius-soft)',
              background: `${colors.error}12`,
            }}
          >
            <div style={{ color: colors.error, fontSize: 11, fontWeight: 600, marginBottom: 4, fontFamily: TYPOGRAPHY.fontMono }}>
              {err.fileName}
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, color: colors.textMuted, fontSize: 11 }}>
              {err.errors.map((msg) => <li key={msg}>{msg}</li>)}
            </ul>
          </div>
        ))}
      </div>

      {formOpen && (
        <NewExperimentForm
          key={editing?.fileName ?? 'new'}
          projectRoot={projectRoot}
          existing={editing}
          dirtyRef={formDirtyRef}
          onClose={() => { formDirtyRef.current = false; setFormOpen(false); setEditing(undefined); }}
        />
      )}

      {noiseLibOpen && (
        <NoiseModelLibrary projectRoot={projectRoot} onClose={() => setNoiseLibOpen(false)} />
      )}
    </div>
  );
}
