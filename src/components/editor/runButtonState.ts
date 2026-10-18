import type { KernelProgress, KernelStatus } from '../../stores/editorStore';
import { kernelStartFailureTitle } from '../../lib/kernelErrors';

export type RunButtonKind = 'ready' | 'running' | 'loading' | 'failed';

export interface RunButtonState {
  kind: RunButtonKind;
  label: string;
  title: string;
  /** The failed kernel slot is a neutral status: the banner under the toolbar owns Retry. */
  disabled: boolean;
  /** Clicking stops the running program instead of starting a run. */
  stoppable?: boolean;
  /** Still starting: a click queues a run that fires the moment the kernel is ready. */
  queueable?: boolean;
  /** A run is already queued; a second click cancels it. */
  queued?: boolean;
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
  /** A run was requested (button or shortcut) while the kernel was still starting. */
  runQueued?: boolean;
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
      label: kernelStartFailureTitle(input.engine === 'Python'),
      title: `${(input.kernelError ?? 'The kernel did not start').replace(/[.\s]+$/, '')}. Use Retry in the banner below.`,
      disabled: true,
    };
  }
  return loadingState(input);
}

/** Still starting: Run is clickable (it queues), and shows what it is waiting on once queued. */
function loadingState(input: RunButtonInput): RunButtonState {
  const queued = Boolean(input.runQueued);
  // The toolbar is narrow, so the button carries the step count and the full
  // stage text lives in the tooltip and the status bar chip.
  const progress = input.kernelProgress;
  // Desktop connect retries are not stages; keep the count out of the label.
  const counted = progress && progress.kind !== 'attempts' ? progress : null;
  const ready = 'as soon as Python is ready';
  if (queued) {
    return {
      kind: 'loading',
      label: counted ? `Queued · ${counted.step}/${counted.total}` : 'Queued',
      title: `Runs ${ready}. Click to cancel.`,
      disabled: false,
      queueable: true,
      queued: true,
    };
  }
  const stage = counted
    ? `${counted.label} (step ${counted.step} of ${counted.total})`
    : progress?.label ?? 'Waiting for the Python kernel';
  return {
    kind: 'loading',
    label: counted ? `Loading ${counted.step}/${counted.total}` : progress ? 'Starting kernel…' : 'Starting…',
    title: `${stage}. Click to run ${ready}.`,
    disabled: false,
    queueable: true,
    queued: false,
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
