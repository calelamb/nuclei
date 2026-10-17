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
import { QecCsvDropZone, QecCsvOpenButton } from './QecCsvDropZone';
import { QecEmptyState } from './QecEmptyState';
import { QEC_PLOT_CSV_DOCS } from '../../config/docsLinks';
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
export function QecAnalysisView({ embedded = false }: { embedded?: boolean } = {}) {
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
  const hasData = useQecCampaignStore((s) => Object.keys(s.rowsByStrongId).length > 0);

  const webOnly = isWebBuild(); // no kernel to run campaigns in the browser
  const canRun = Boolean(experiment && projectRoot && experiment.spec.type === 'qec_campaign');
  // Inside the workbench a Run button with nothing to run would be dead weight.
  const showRun = !webOnly && (!embedded || canRun || running);
  // Inside the workbench the card heading already says "Campaign Center"; a generic fallback would repeat it.
  const title = csvSource ?? experiment?.spec.name ?? (embedded ? null : 'Campaign');

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
        {title && (
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
        )}
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
        {!showRun ? null : running ? (
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
      {embedded && !hasData ? (
        <QecEmptyState
          title="No campaign results yet"
          body={webOnly
            ? 'Open or drop a sinter stats CSV to see logical error rate vs physical error and compare decoders.'
            : 'Open or drop a sinter stats CSV, or run a QEC campaign from Experiments, to see logical error rate vs physical error and compare decoders.'}
          docsHref={QEC_PLOT_CSV_DOCS}
        >
          {!csvSource && <QecCsvDropZone />}
        </QecEmptyState>
      ) : (
        /* The plot keeps a usable height; on short windows the page scrolls
           instead of squeezing the plot and the decoder table to slivers. */
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: '2 1 0', minHeight: PLOT_MIN_HEIGHT, borderBottom: `1px solid ${colors.border}` }}>
            <ThresholdPanel />
          </div>
          <div style={{ flex: '1 1 0', minHeight: TABLE_MIN_HEIGHT }}>
            <DecoderWorkbench />
          </div>
        </div>
      )}
    </div>
  );
}
