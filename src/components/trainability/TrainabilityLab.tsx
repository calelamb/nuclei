import { Microscope, MonitorOff } from 'lucide-react';
import {
  LabCallout,
  LabCard,
  LabEmptyState,
  LabPill,
  LabShell,
  LabShellBody,
  LabToolbar,
  formatDuration,
  type LabTone,
} from '../lab';
import { useCircuitStore } from '../../stores/circuitStore';
import { useEditorStore } from '../../stores/editorStore';
import { useTrainabilityStore } from '../../stores/trainabilityStore';
import { codeKey } from '../../services/trainability/hash';
import type { TrainabilityJobStatus } from '../../types/trainability';
import { AnalysisTabs } from './AnalysisTabs';
import { GradientHeatmapCircuit } from './GradientHeatmapCircuit';
import { TargetBar } from './TargetBar';
import { VerdictRail } from './VerdictRail';
import { runTrainabilityAnalyses, useTrainabilityTarget } from './useTrainabilityTarget';

const STATUS_TONE: Record<TrainabilityJobStatus, LabTone> = {
  starting: 'quantum',
  running: 'quantum',
  cancelling: 'warning',
  complete: 'success',
  cancelled: 'warning',
  failed: 'danger',
};

export function TrainabilityUnavailable({ message }: { message: string }) {
  return (
    <LabShellBody>
      <LabEmptyState
        icon={MonitorOff}
        title="The Trainability Lab needs the desktop kernel"
        body={`${message} Open Nuclei on the desktop to measure gradient variance, Lie algebras and loss landscapes. The web build cannot run these native analyses.`}
      />
    </LabShellBody>
  );
}

export function TrainabilityLab() {
  useTrainabilityTarget();
  const unavailable = useTrainabilityStore((s) => s.unavailable);
  const jobs = useTrainabilityStore((s) => s.jobs);
  const selectedJobId = useTrainabilityStore((s) => s.selectedJobId);
  const jobOrder = useTrainabilityStore((s) => s.jobOrder);
  const inspection = useTrainabilityStore((s) => s.inspect.data);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const code = useEditorStore((s) => s.code);
  const framework = useEditorStore((s) => s.framework);

  const displayedId = selectedJobId ?? jobOrder[0] ?? null;
  const job = displayedId ? (jobs[displayedId] ?? null) : null;
  const stale = !!job && job.codeKey !== codeKey(`${framework}\n${code}`);
  const running = !!job && (job.status === 'starting' || job.status === 'running' || job.status === 'cancelling');

  return (
    <LabShell label="Trainability Lab">
      <LabToolbar icon={Microscope} title="Trainability Lab" subtitle="Gradient microscope">
        {job && (
          <>
            <LabPill tone={STATUS_TONE[job.status]} live={running} dot={!running}>
              {job.status}
            </LabPill>
            {job.elapsedMs !== null && <span className="lab-mono lab-muted">{formatDuration(job.elapsedMs)}</span>}
          </>
        )}
      </LabToolbar>
      {unavailable ? (
        <TrainabilityUnavailable message={unavailable.message} />
      ) : (
        <LabShellBody>
          <div className="lab-grid lab-grid--split">
            <div className="lab-stack">
              <TargetBar onRun={runTrainabilityAnalyses} />
              {job?.error && (
                <LabCallout tone="danger" title="The job did not finish">
                  <span className="lab-mono">{job.error.code}</span>: {job.error.message}
                </LabCallout>
              )}
              {stale && !running && (
                <LabCallout tone="warning" title="The code changed after this analysis">
                  The results below describe an earlier version of the file. Run the analyses again to refresh them.
                </LabCallout>
              )}
              <LabCard title="Gradient heatmap" subtitle="Per-gate variance of ∂C/∂θ on the circuit">
                <GradientHeatmapCircuit snapshot={snapshot} inspection={inspection} gradients={job?.results.gradients} loading={running} />
              </LabCard>
              <LabCard title="Analyses" flush bodyClassName="lab-card__body">
                <AnalysisTabs job={job} />
              </LabCard>
            </div>
            <VerdictRail job={job} />
          </div>
        </LabShellBody>
      )}
    </LabShell>
  );
}
