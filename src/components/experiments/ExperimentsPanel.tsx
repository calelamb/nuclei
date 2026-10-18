import { useEffect, useRef, useState } from 'react';
import { Pencil, FlaskConical, Plus, Waves } from 'lucide-react';
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
import { BrokenExperimentCard } from './BrokenExperimentCard';
import { NewQecExperimentMenu } from './NewQecExperimentMenu';
import { NoiseModelLibrary } from './NoiseModelLibrary';
import { RunButton } from './RunButton';
import { RunFeedback } from './RunFeedback';
import { TYPOGRAPHY, ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button, EmptyState, IconButton, useConfirm } from '../ui';
import { DesktopOnlyState } from '../hardware/DesktopOnlyState';
import './experiments.css';

/**
 * PRD 09 Phase D (D1) — Research-mode left-rail Experiments panel. Replaces
 * the Phase A placeholder in `Sidebar.tsx`. Lists the open project's
 * `experiments/*.experiment.yaml`, surfaces malformed files as validation
 * cards (never a crash — matches `experimentStore`'s contract), and opens
 * `NewExperimentForm` for creating (or editing) an experiment.
 */

/** The experiment list never collapses below this, however tall the open form is. */
const LIST_MIN_HEIGHT = 120;

function formatLastRun(experiment: DiscoveredExperiment, runsByExperiment: Record<string, { manifest: { started_at: string } }[]>): ReturnType<typeof describeLastRun> {
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
  const setActiveView = useNavigationStore((s) => s.setActiveView);
  return (
    <DesktopOnlyState
      title="Experiments live in the desktop app"
      alternative={<Button size="sm" onClick={() => setActiveView('qec')}>Open QEC Workbench</Button>}
    >
      Experiments are parameter sweeps saved as files in a project folder. In the browser you can still analyse QEC data and edit and simulate circuits.
    </DesktopOnlyState>
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
  lastRun: { label: string; title: string; summary: string };
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
          tooltip={{ label: 'Edit experiment' }}
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
        >
          <Pencil size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />
        </IconButton>
      </div>
      <div style={{ color: colors.textDim, fontSize: 11, fontFamily: TYPOGRAPHY.fontMono, display: 'flex', flexDirection: 'column' }}>
        {/* One fact per line: a wrapped " · " separator would dangle at the end of the first line. */}
        {(spec.type === 'qec_campaign'
          ? [`${'generate' in spec.source ? spec.source.generate.code : spec.source.entry}`, `${spec.noise.model} · ${spec.decoders.join('+')}`]
          : [spec.entry, [spec.backend.provider, spec.backend.target].filter(Boolean).join('/')]
        ).filter(Boolean).map((line) => <span key={line} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line}</span>)}
      </div>
      <div
        className="nuclei-experiment-row__meta"
        title={lastRun.title}
        style={{ color: colors.textDim, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans }}
      >
        {spec.type === 'qec_campaign'
          ? `campaign · ${gridSizeLabel(experiment)} task${gridSizeLabel(experiment) === '1' ? '' : 's'} · ${lastRun.summary}`
          : `${gridSizeLabel(experiment)} point${gridSizeLabel(experiment) === '1' ? '' : 's'} · ${lastRun.summary}`}
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
  const { confirm, confirmDialog } = useConfirm();
  const openForm = async (target: DiscoveredExperiment | undefined) => {
    const switching = formOpen && (editing?.fileName ?? 'new') !== (target?.fileName ?? 'new');
    if (switching && formDirtyRef.current) {
      const discard = await confirm({
        title: 'Discard your unsaved changes?',
        description: 'The experiment you are editing has edits that have not been saved.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      });
      if (!discard) return;
    }
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
  const listEmpty = experiments.length === 0 && validationErrors.length === 0;

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
      <div style={{ padding: '8px 10px', display: 'flex', gap: 6, alignItems: 'center', justifyContent: listEmpty ? 'flex-end' : undefined, borderBottom: `1px solid ${colors.border}` }}>
        {/* While the list is empty the empty state carries the one New experiment action. */}
        {!listEmpty && (
          <Button
            variant="secondary"
            className="nuclei-experiment-new"
            aria-pressed={formOpen && editing === undefined}
            onClick={() => { void openForm(undefined); }}
            style={{ flex: 1, minWidth: 0 }}
            icon={<Plus size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />}
          >
            New experiment
          </Button>
        )}
        <NewQecExperimentMenu projectRoot={projectRoot} />
        <IconButton variant="secondary" aria-label="Noise models" title="Noise models" onClick={() => setNoiseLibOpen(true)}>
          <Waves size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
        </IconButton>
      </div>
      <RunFeedback compact />

      <div style={{ flex: 1, minHeight: LIST_MIN_HEIGHT, overflow: 'auto' }}>
        {listEmpty && (
          <EmptyState
            icon={<FlaskConical size={ICON_SIZE.lg} strokeWidth={ICON_STROKE} />}
            title="No experiments yet"
            action={<Button size="sm" variant="primary" onClick={() => { void openForm(undefined); }}>New experiment</Button>}
          >
            An experiment declares a parameter sweep over your circuit.
          </EmptyState>
        )}

        {experiments.map((experiment) => (
          <ExperimentRow
            key={experiment.fileName}
            experiment={experiment}
            projectRoot={projectRoot}
            lastRun={formatLastRun(experiment, runsByExperiment)}
            selected={selectedFileName === experiment.fileName}
            onSelect={() => selectExperiment(experiment.fileName)}
            onEdit={() => { void openForm(experiment); }}
          />
        ))}

        {validationErrors.map((err) => (
          <BrokenExperimentCard key={err.fileName} projectRoot={projectRoot} fileName={err.fileName} errors={err.errors} />
        ))}
      </div>

      {formOpen && (
        <div className="nuclei-experiment-form-region">
        <NewExperimentForm
          key={editing?.fileName ?? 'new'}
          projectRoot={projectRoot}
          existing={editing}
          dirtyRef={formDirtyRef}
          onClose={() => { formDirtyRef.current = false; setFormOpen(false); setEditing(undefined); }}
        />
        </div>
      )}

      {noiseLibOpen && (
        <NoiseModelLibrary projectRoot={projectRoot} onClose={() => setNoiseLibOpen(false)} />
      )}
      {confirmDialog}
    </div>
  );
}
