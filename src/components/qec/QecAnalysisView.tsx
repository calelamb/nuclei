import { Play, Square } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentStore } from '../../services/experimentStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { useQecCampaignRun } from '../../hooks/useQecCampaignRun';
import { ThresholdPanel } from './ThresholdPanel';
import { DecoderWorkbench } from './DecoderWorkbench';

/**
 * PRD 10 Phase E — the campaign analysis surface, shown in the experiments
 * main area when a QEC campaign experiment is selected. Stacks the threshold/Λ
 * plot over the decoder workbench; a slim progress strip on top reflects the
 * live campaign (or a resumable prior run).
 */
export function QecAnalysisView() {
  const colors = useThemeStore((s) => s.colors);
  const running = useQecCampaignStore((s) => s.running);
  const progress = useQecCampaignStore((s) => s.progress);
  const resumable = useQecCampaignStore((s) => s.resumable);
  const projectRoot = useProjectStore((s) => s.projectRoot);
  const selectedFileName = useExperimentUiStore((s) => s.selectedExperimentFileName);
  const experiment = useExperimentStore((s) =>
    s.experiments.find((e) => e.fileName === selectedFileName),
  );
  const { run, cancel } = useQecCampaignRun();

  const canRun = Boolean(experiment && projectRoot && experiment.spec.type === 'qec_campaign');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
          borderBottom: `1px solid ${colors.border}`, fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
          {experiment?.spec.name ?? 'Campaign'}
        </span>
        <div style={{ flex: 1 }} />
        {running ? (
          <button
            onClick={cancel}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, background: 'transparent',
              border: `1px solid ${colors.border}`, borderRadius: 5, color: colors.error,
              cursor: 'pointer', fontSize: 12, padding: '5px 12px', fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            <Square size={12} /> Cancel
          </button>
        ) : (
          <button
            onClick={() => { if (experiment && projectRoot) void run(experiment, projectRoot); }}
            disabled={!canRun}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, background: colors.dirac, color: '#fff',
              border: 'none', borderRadius: 5, cursor: canRun ? 'pointer' : 'default',
              opacity: canRun ? 1 : 0.5, fontSize: 12, fontWeight: 600, padding: '5px 12px',
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            <Play size={12} /> Run campaign
          </button>
        )}
      </div>
      {(running || resumable) && (
        <div
          aria-live="polite"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
            borderBottom: `1px solid ${colors.border}`, fontSize: 11,
            color: running ? colors.accent : colors.warning, fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          {running && progress ? (
            <>
              <span
                style={{
                  width: 6, height: 6, borderRadius: 3, background: colors.accent,
                  animation: 'nuclei-heartbeat 1.5s ease infinite',
                }}
              />
              Running · {progress.tasksComplete}/{progress.tasksTotal} tasks ·{' '}
              {progress.sampledShots.toLocaleString()} shots
              {progress.statusMessage ? ` · ${progress.statusMessage}` : ''}
            </>
          ) : resumable ? (
            <>Campaign “{resumable.name}” was interrupted — its results are resumable.</>
          ) : null}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1.3, minHeight: 0, borderBottom: `1px solid ${colors.border}` }}>
          <ThresholdPanel />
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <DecoderWorkbench />
        </div>
      </div>
    </div>
  );
}
