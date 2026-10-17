import { Download, Play, Square } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentStore } from '../../services/experimentStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { useQecCampaignRun } from '../../hooks/useQecCampaignRun';
import { Button } from '../ui/Button';
import { ThresholdPanel } from './ThresholdPanel';
import { DecoderWorkbench } from './DecoderWorkbench';
import { isWebBuild } from '../../platform/buildTarget';
import { CsvMappingPreview } from './CsvMappingPreview';
import { QecCsvOpenButton } from './QecCsvDropZone';
import { useCsvDrop } from './useCsvDrop';
import { downloadCsv } from '../../services/experimentExport';

import { ICON_SIZE, ICON_STROKE, TYPOGRAPHY } from '../../styles/tokens';
const PLOT_MIN_HEIGHT = 300;
const TABLE_MIN_HEIGHT = 170;

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
  const csvSource = useQecCampaignStore((s) => s.csvImport?.sourceName ?? null);
  const csvError = useQecCampaignStore((s) => s.csvError);
  const csvLoading = useQecCampaignStore((s) => s.csvLoading);
  const statsCsv = useQecCampaignStore((s) => s.statsCsv);
  const { over, handlers } = useCsvDrop();

  const webOnly = isWebBuild(); // no kernel to run campaigns in the browser
  const canRun = Boolean(experiment && projectRoot && experiment.spec.type === 'qec_campaign');

  return (
    <div
      {...handlers}
      style={{
        height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg,
        outline: over ? `2px dashed ${colors.accent}` : 'none', outlineOffset: -2,
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
          borderBottom: `1px solid ${colors.border}`, fontFamily: TYPOGRAPHY.fontSans,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
          {csvSource ?? experiment?.spec.name ?? 'Campaign'}
        </span>
        <div style={{ flex: 1 }} />
        <QecCsvOpenButton />
        {statsCsv ? (
          <Button
            size="sm"
            title="sinter-native stats.csv: shots, errors, discards, seconds, decoder, strong_id, json_metadata, custom_counts"
            onClick={() => downloadCsv(statsCsv, 'stats.csv')}
            icon={<Download size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />}
          >
            Export stats.csv
          </Button>
        ) : null}
        {webOnly ? null : running ? (
          <Button size="sm" variant="danger" onClick={cancel} icon={<Square size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}>
            Cancel
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={() => { if (experiment && projectRoot) void run(experiment, projectRoot); }}
            disabled={!canRun}
            icon={<Play size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}
          >
            Run campaign
          </Button>
        )}
      </div>
      {csvLoading && (
        <div role="status" aria-live="polite" style={{ padding: '6px 12px', fontSize: 12, color: colors.textMuted, borderBottom: `1px solid ${colors.border}`, fontFamily: TYPOGRAPHY.fontSans }}>
          {`Reading ${csvLoading}…`}
        </div>
      )}
      {csvError && (
        <div role="alert" style={{ padding: '6px 12px', fontSize: 12, color: colors.error, borderBottom: `1px solid ${colors.border}`, fontFamily: TYPOGRAPHY.fontSans }}>
          {csvError}
          {csvSource ? ` Still showing ${csvSource}.` : ''}
        </div>
      )}
      <CsvMappingPreview />
      {(running || resumable) && (
        <div
          aria-live="polite"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
            borderBottom: `1px solid ${colors.border}`, fontSize: 11,
            color: running ? colors.accent : colors.warning, fontFamily: TYPOGRAPHY.fontSans,
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
      {/* The plot keeps a usable height; on short windows the page scrolls
          instead of squeezing the plot and the decoder table to slivers. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: '2 1 0', minHeight: PLOT_MIN_HEIGHT, borderBottom: `1px solid ${colors.border}` }}>
          <ThresholdPanel />
        </div>
        <div style={{ flex: '1 1 0', minHeight: TABLE_MIN_HEIGHT }}>
          <DecoderWorkbench />
        </div>
      </div>
    </div>
  );
}
