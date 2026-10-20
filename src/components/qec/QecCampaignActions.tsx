import { Download, Play, Square } from 'lucide-react';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentStore } from '../../services/experimentStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { useQecCampaignRun } from '../../hooks/useQecCampaignRun';
import { isWebBuild } from '../../platform/buildTarget';
import { downloadCsv } from '../../services/experimentExport';
import { Button } from '../ui/Button';
import { QecCsvOpenButton } from './QecCsvDropZone';
import { ICON_SIZE, ICON_STROKE } from '../../styles/tokens';

/**
 * Open CSV / Export stats.csv / Run campaign. One component so the analysis
 * view's own toolbar and the workbench's Campaign Center card header show
 * exactly the same actions.
 *
 * `embedded` hides Run when there is nothing to run (the workbench has no
 * experiment picker, so a dead button would only add noise).
 */
export function QecCampaignActions({ embedded = false }: { embedded?: boolean }) {
  const running = useQecCampaignStore((s) => s.running);
  const resumable = useQecCampaignStore((s) => s.resumable);
  const hasData = useQecCampaignStore((s) => Object.keys(s.rowsByStrongId).length > 0);
  const hasCsvSource = useQecCampaignStore((s) => s.csvImport !== null);
  // Before any data the empty state's drop zone is the one way in; a header button would be a second.
  const showOpenCsv = hasData || hasCsvSource || running || Boolean(resumable);
  const statsCsv = useQecCampaignStore((s) => s.statsCsv);
  const projectRoot = useProjectStore((s) => s.projectRoot);
  const selectedFileName = useExperimentUiStore((s) => s.selectedExperimentFileName);
  const experiment = useExperimentStore((s) => s.experiments.find((e) => e.fileName === selectedFileName));
  const { run, cancel } = useQecCampaignRun();

  const webOnly = isWebBuild(); // no kernel to run campaigns in the browser
  const canRun = Boolean(experiment && projectRoot && experiment.spec.type === 'qec_campaign');
  const showRun = !webOnly && (!embedded || canRun || running);

  return (
    <>
      {showOpenCsv && <QecCsvOpenButton />}
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
    </>
  );
}
