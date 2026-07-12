import { useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useExperimentRun } from '../../hooks/useExperimentRun';
import { useExperimentRunStore } from '../../stores/experimentRunStore';
import { HardwareSweepGuard } from './HardwareSweepGuard';
import type { DiscoveredExperiment } from '../../services/experimentStore';

/**
 * PRD 09 Phase D — shared "Run" affordance for both the Experiments panel
 * list (D1) and the runs table header (D2/D4): starts a sweep via
 * `useExperimentRun`, gates non-simulator backends behind
 * `HardwareSweepGuard`, disables while ANY sweep is active (v1 runs one
 * sweep app-wide), and swaps to a live completed/total + cancel readout
 * when this experiment is the one currently running.
 */
interface RunButtonProps {
  experiment: DiscoveredExperiment;
  projectRoot: string;
  pointCount: number;
}

export function RunButton({ experiment, projectRoot, pointCount }: RunButtonProps) {
  const colors = useThemeStore((s) => s.colors);
  const { run } = useExperimentRun();
  const active = useExperimentRunStore((s) => s.active);
  const [showGuard, setShowGuard] = useState(false);

  // Campaign runs get their UI with QEC Studio's visualization phases
  // (PRD 10 D — gated on PRD 11 Phase C); the runner service already
  // exists (qecCampaignRunner.ts). Sweep semantics below are unchanged.
  if (experiment.spec.type === 'qec_campaign') return null;

  const isThisActive = active?.experimentFileName === experiment.fileName;
  const anyActive = active !== null;
  const isHardware = experiment.spec.backend.provider !== 'simulator';

  const startRun = () => {
    void run(experiment, projectRoot);
  };

  const handleClick = () => {
    if (anyActive) return;
    if (isHardware) setShowGuard(true);
    else startRun();
  };

  if (isThisActive) {
    const { progress } = active;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: "'Geist Sans', sans-serif" }}>
        <span style={{ color: colors.accent }}>
          {progress.completed}/{progress.total}
          {progress.failures > 0 ? ` (${progress.failures} failed)` : ''}
        </span>
        <button
          onClick={active.cancel}
          style={{
            padding: '3px 10px', background: 'transparent', color: colors.error,
            border: `1px solid ${colors.error}`, borderRadius: 4, cursor: 'pointer', fontSize: 11,
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); handleClick(); }}
        disabled={anyActive}
        title={anyActive ? 'A sweep is already running' : 'Run this experiment'}
        style={{
          padding: '4px 12px',
          background: anyActive ? colors.border : colors.accent,
          color: anyActive ? colors.textDim : '#0a1220',
          border: 'none', borderRadius: 4,
          cursor: anyActive ? 'not-allowed' : 'pointer',
          fontSize: 11, fontWeight: 600, fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        Run
      </button>
      {showGuard && (
        <HardwareSweepGuard
          experimentName={experiment.spec.name}
          backendLabel={`${experiment.spec.backend.provider}/${experiment.spec.backend.target}`}
          pointCount={pointCount}
          shots={experiment.spec.shots}
          onConfirm={() => { setShowGuard(false); startRun(); }}
          onCancel={() => setShowGuard(false)}
        />
      )}
    </>
  );
}
