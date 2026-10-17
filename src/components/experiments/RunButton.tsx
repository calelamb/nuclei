import { useState } from 'react';
import { Play } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useExperimentRun } from '../../hooks/useExperimentRun';
import { useExperimentRunStore } from '../../stores/experimentRunStore';
import { HardwareSweepGuard } from './HardwareSweepGuard';
import type { DiscoveredExperiment } from '../../services/experimentStore';
import { TYPOGRAPHY, ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button } from '../ui';

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
  /** `ghost` = quiet icon button for list rows; `solid` = primary CTA (runs header). */
  variant?: 'solid' | 'ghost';
}

export function RunButton({ experiment, projectRoot, pointCount, variant = 'solid' }: RunButtonProps) {
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans }}>
        <span style={{ color: colors.accent, fontVariantNumeric: 'tabular-nums' }}>
          {progress.completed}/{progress.total}
          {progress.failures > 0 ? ` (${progress.failures} failed)` : ''}
        </span>
        <Button variant="danger" size="sm" onClick={active.cancel}>Cancel</Button>
      </div>
    );
  }

  return (
    <>
      <Button
        variant={variant === 'ghost' ? 'secondary' : 'primary'}
        size="sm"
        onClick={(e) => { e.stopPropagation(); handleClick(); }}
        disabled={anyActive}
        title={anyActive ? 'A sweep is already running' : 'Run this experiment'}
        icon={variant === 'ghost' ? <Play size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} /> : undefined}
      >
        Run
      </Button>
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
