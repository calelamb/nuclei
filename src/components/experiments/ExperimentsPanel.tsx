import { useEffect, useState } from 'react';
import { Pencil, FlaskConical } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentStore, type DiscoveredExperiment } from '../../services/experimentStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { createTauriExperimentFs } from '../../services/experimentFs';
import { campaignTaskCount, expandGrid } from '../../types/experiment';
import { NewExperimentForm } from './NewExperimentForm';
import { RunButton } from './RunButton';

/**
 * PRD 09 Phase D (D1) — Research-mode left-rail Experiments panel. Replaces
 * the Phase A placeholder in `Sidebar.tsx`. Lists the open project's
 * `experiments/*.experiment.yaml`, surfaces malformed files as validation
 * cards (never a crash — matches `experimentStore`'s contract), and opens
 * `NewExperimentForm` for creating (or editing) an experiment.
 */

function formatLastRun(experiment: DiscoveredExperiment, runsByExperiment: Record<string, { manifest: { started_at: string } }[]>): string {
  const runs = runsByExperiment[experiment.fileName];
  if (!runs || runs.length === 0) return 'never run';
  // Runs are stored newest-first by directory name.
  const latest = runs[0].manifest.started_at;
  const date = new Date(latest);
  return Number.isNaN(date.getTime()) ? latest : date.toLocaleString();
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

function ExperimentRow({
  experiment,
  projectRoot,
  lastRun,
  onSelect,
  onEdit,
}: {
  experiment: DiscoveredExperiment;
  projectRoot: string;
  lastRun: string;
  onSelect(): void;
  onEdit(): void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const { spec } = experiment;

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(); }}
      style={{
        padding: '8px 10px', borderBottom: `1px solid ${colors.border}`,
        cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = colors.bgElevated; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: colors.text, fontSize: 12, fontWeight: 600, fontFamily: "'Geist Sans', sans-serif", flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {spec.name}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          title="Edit experiment"
          aria-label={`Edit ${spec.name}`}
          style={{ background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer', display: 'flex' }}
        >
          <Pencil size={12} />
        </button>
      </div>
      <div style={{ color: colors.textDim, fontSize: 10, fontFamily: "'Fira Code', monospace" }}>
        {spec.type === 'qec_campaign'
          ? `${'generate' in spec.source ? spec.source.generate.code : spec.source.entry} · ${spec.noise.model} · ${spec.decoders.join('+')}`
          : `${spec.entry} · ${spec.backend.provider}/${spec.backend.target}`}
      </div>
      <div style={{ color: colors.textDim, fontSize: 10, fontFamily: "'Geist Sans', sans-serif" }}>
        {spec.type === 'qec_campaign'
          ? `campaign · ${gridSizeLabel(experiment)} task${gridSizeLabel(experiment) === '1' ? '' : 's'} · last run: ${lastRun}`
          : `${gridSizeLabel(experiment)} point${gridSizeLabel(experiment) === '1' ? '' : 's'} · last run: ${lastRun}`}
      </div>
      {spec.type !== 'qec_campaign' && (
        <div onClick={(e) => e.stopPropagation()}>
          <RunButton experiment={experiment} projectRoot={projectRoot} pointCount={Number(gridSizeLabel(experiment)) || 0} />
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

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DiscoveredExperiment | undefined>(undefined);

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

  if (!projectRoot) {
    return (
      <div style={{ padding: 16, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif", textAlign: 'center' }}>
        <FlaskConical size={20} style={{ opacity: 0.4, marginBottom: 8 }} />
        <div>Open a folder to start experimenting.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 10px', display: 'flex', justifyContent: 'flex-end', borderBottom: `1px solid ${colors.border}` }}>
        <button
          onClick={() => { setEditing(undefined); setFormOpen((v) => !v); }}
          style={{
            padding: '4px 10px', background: 'transparent', border: `1px solid ${colors.accent}`,
            borderRadius: 4, color: colors.accent, cursor: 'pointer', fontSize: 11, fontWeight: 600,
            fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          + New experiment
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {experiments.length === 0 && validationErrors.length === 0 && (
          <div style={{ padding: 16, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
            No experiments yet. Create one to declare a parameter sweep.
          </div>
        )}

        {experiments.map((experiment) => (
          <ExperimentRow
            key={experiment.fileName}
            experiment={experiment}
            projectRoot={projectRoot}
            lastRun={formatLastRun(experiment, runsByExperiment)}
            onSelect={() => selectExperiment(experiment.fileName)}
            onEdit={() => { setEditing(experiment); setFormOpen(true); }}
          />
        ))}

        {validationErrors.map((err) => (
          <div
            key={err.fileName}
            role="alert"
            style={{
              margin: 8, padding: 10, border: `1px solid ${colors.error}`, borderRadius: 6,
              background: `${colors.error}12`,
            }}
          >
            <div style={{ color: colors.error, fontSize: 11, fontWeight: 600, marginBottom: 4, fontFamily: "'Fira Code', monospace" }}>
              {err.fileName}
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, color: colors.textMuted, fontSize: 10 }}>
              {err.errors.map((msg) => <li key={msg}>{msg}</li>)}
            </ul>
          </div>
        ))}
      </div>

      {formOpen && (
        <NewExperimentForm
          projectRoot={projectRoot}
          existing={editing}
          onClose={() => { setFormOpen(false); setEditing(undefined); }}
        />
      )}
    </div>
  );
}
