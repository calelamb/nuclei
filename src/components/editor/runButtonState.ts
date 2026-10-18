import type { KernelProgress, KernelStatus } from '../../stores/editorStore';

export type RunButtonKind = 'ready' | 'running' | 'loading' | 'failed';

export interface RunButtonState {
  kind: RunButtonKind;
  label: string;
  title: string;
  /** The failed kernel slot is a neutral status: the banner under the toolbar owns Retry. */
  disabled: boolean;
  /** Clicking stops the running program instead of starting a run. */
  stoppable?: boolean;
}

interface RunButtonInput {
  kernelReady: boolean;
  kernelStatus: KernelStatus;
  kernelProgress: KernelProgress | null;
  kernelError: string | null;
  isRunning: boolean;
  /** The runtime can interrupt a run (browser worker). */
  canStop?: boolean;
  /** Names the engine in the failed label so the pill, status bar and banner share one name. */
  engine?: 'Python' | 'Kernel';
}

/** One truthful label for the toolbar's Run slot across every kernel state. */
export function getRunButtonState(input: RunButtonInput): RunButtonState {
  if (input.isRunning && input.canStop) {
    return {
      kind: 'running',
      label: 'Stop',
      title: 'Stop the running program',
      disabled: false,
      stoppable: true,
    };
  }
  if (input.isRunning) {
    return { kind: 'running', label: 'Running…', title: 'Simulation running', disabled: true };
  }
  if (input.kernelReady) {
    return { kind: 'ready', label: 'Run', title: 'Run simulation', disabled: false };
  }
  if (input.kernelStatus === 'failed') {
    return {
      kind: 'failed',
      label: `${input.engine ?? 'Kernel'} failed`,
      title: `${(input.kernelError ?? 'The kernel did not start').replace(/[.\s]+$/, '')}. Use Retry in the banner below.`,
      disabled: true,
    };
  }
  // The toolbar is narrow, so the button carries the step count and the full
  // stage text lives in the tooltip and the status bar chip.
  const progress = input.kernelProgress;
  if (progress?.kind === 'attempts') {
    // Desktop connect retries are not stages; keep the count out of the label.
    return { kind: 'loading', label: 'Starting kernel…', title: progress.label, disabled: true };
  }
  return {
    kind: 'loading',
    label: progress ? `Loading ${progress.step}/${progress.total}` : 'Starting…',
    title: progress ? `${progress.label} (step ${progress.step} of ${progress.total})` : 'Waiting for the Python kernel',
    disabled: true,
  };
}

/** A Stop click this soon after a run starts is almost certainly the second half of a double-click. */
export const STOP_GRACE_MS = 500;

/**
 * True when a click on the in-place Stop button should be ignored: the run began
 * moments ago (the button swapped under the cursor mid double-click), or the click
 * is itself part of a multi-click gesture.
 */
export function isAccidentalStop(clickDetail: number, runStartedAt: number, now: number): boolean {
  return clickDetail > 1 || now - runStartedAt < STOP_GRACE_MS;
}
