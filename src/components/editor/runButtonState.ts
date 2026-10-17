import type { KernelProgress, KernelStatus } from '../../stores/editorStore';

export type RunButtonKind = 'ready' | 'running' | 'loading' | 'failed';

export interface RunButtonState {
  kind: RunButtonKind;
  label: string;
  title: string;
  /** Failed stays clickable: the button becomes the Retry action. */
  disabled: boolean;
}

interface RunButtonInput {
  kernelReady: boolean;
  kernelStatus: KernelStatus;
  kernelProgress: KernelProgress | null;
  kernelError: string | null;
  isRunning: boolean;
}

/** One truthful label for the toolbar's Run slot across every kernel state. */
export function getRunButtonState(input: RunButtonInput): RunButtonState {
  if (input.isRunning) {
    return { kind: 'running', label: 'Running…', title: 'Simulation running', disabled: true };
  }
  if (input.kernelReady) {
    return { kind: 'ready', label: 'Run', title: 'Run simulation (⌘+Enter)', disabled: false };
  }
  if (input.kernelStatus === 'failed') {
    return {
      kind: 'failed',
      label: 'Kernel failed · Retry',
      title: `${input.kernelError ?? 'The kernel did not start'} — click to retry`,
      disabled: false,
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
