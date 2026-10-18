import { useEffect, useRef, type MouseEvent } from 'react';
import { Play, Loader2, Rocket, AlertTriangle, Square } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useHardwareStore } from '../../stores/hardwareStore';
import { useRunQueueStore } from '../../stores/runQueueStore';
import { getExecute } from '../../App';
import { canStopKernelRun, stopKernelRun } from '../../lib/kernelControl';
import { shortcutLabel } from '../../config/keybindings';
import { useUiFeatures } from '../../hooks/useUiFeatures';
import { Button, Tooltip } from '../ui';
import { usePlatform } from '../../platform/PlatformProvider';
import { getRunButtonState, isAccidentalStop } from './runButtonState';
import type { TabBarDensity } from './tabBarLayout';

/**
 * The toolbar's Launch + Run slot. Run is one control with one truthful label per
 * kernel state; while a run is in flight it becomes Stop in place, which is why a
 * Stop click inside the first moments of a run (the second half of a double-click)
 * is ignored.
 */
/** Wide enough for the longest boot label ("Starting 3/3", "Queued · 3/3") so Run does not resize as Python boots. */
export const RUN_SLOT_MIN_WIDTH = 116;

export function RunControls({ density }: { density: TabBarDensity }) {
  const kernelReady = useEditorStore((s) => s.kernelReady);
  const kernelStatus = useEditorStore((s) => s.kernelStatus);
  const kernelError = useEditorStore((s) => s.kernelError);
  const kernelProgress = useEditorStore((s) => s.kernelProgress);
  const isRunning = useSimulationStore((s) => s.isRunning);
  const runQueued = useRunQueueStore((s) => s.queued);
  const features = useUiFeatures();
  const compact = density !== 'full';
  const tight = density === 'tight';

  const runStartedAt = useRef(0);
  useEffect(() => {
    if (isRunning) runStartedAt.current = performance.now();
  }, [isRunning]);

  const platform = usePlatform();
  const runState = getRunButtonState({ kernelReady, kernelStatus, kernelProgress, kernelError, isRunning, runQueued, canStop: canStopKernelRun(), engine: platform.getPlatform() === 'web' ? 'Python' : 'Kernel' });
  const canRun = runState.kind === 'ready';
  const showFailed = runState.kind === 'failed';

  const handleRun = (e: MouseEvent<HTMLButtonElement>) => {
    if (runState.stoppable) {
      if (isAccidentalStop(e.detail, runStartedAt.current, performance.now())) return;
      stopKernelRun();
      return;
    }
    if (runState.queueable) {
      // Still starting: the first click queues the run (the same path as the shortcut), the second cancels it.
      if (runState.queued) useRunQueueStore.getState().setQueued(false);
      else getExecute()?.();
      return;
    }
    if (!canRun) return;
    getExecute()?.();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      {features.launchHardware && (
        <Tooltip label="Launch on hardware" shortcut={shortcutLabel('launch')}>
          <Button
            variant="secondary"
            onClick={() => useHardwareStore.getState().openLaunch()}
            aria-label="Launch on hardware"
            icon={<Rocket size={12} />}
          >
            {!compact && <span>Launch</span>}
            {!compact && <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 2 }}>{shortcutLabel('launch')}</span>}
          </Button>
        </Tooltip>
      )}
      <Tooltip label={runState.title} shortcut={canRun ? shortcutLabel('run') : undefined}>
        <Button
          variant={canRun ? 'primary' : 'secondary'}
          onClick={handleRun}
          disabled={runState.disabled}
          // The visible label names the control (WCAG 2.5.3); the sentence lives in the tooltip.
          // Only the icon-only tight layout needs an explicit name.
          aria-label={tight ? runState.label : undefined}
          aria-pressed={runState.queueable ? runState.queued === true : undefined}
          style={{ fontWeight: 600, padding: tight ? '0 8px' : compact ? '0 10px' : '0 14px', gap: 7, minWidth: tight ? undefined : RUN_SLOT_MIN_WIDTH, justifyContent: 'center' }}
        >
          {runState.stoppable ? (
            <Square size={12} fill="currentColor" />
          ) : isRunning || runState.kind === 'loading' ? (
            <Loader2 size={14} className="nuclei-spin" />
          ) : showFailed ? (
            <AlertTriangle size={12} />
          ) : (
            <Play size={12} fill="currentColor" />
          )}
          {!tight && <span>{runState.label}</span>}
          {canRun && !compact && (
            <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.75, marginLeft: 2, letterSpacing: 0.3 }}>
              {shortcutLabel('run')}
            </span>
          )}
        </Button>
      </Tooltip>
    </div>
  );
}
