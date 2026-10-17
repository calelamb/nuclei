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
  const progress = input.kernelProgress;
  return {
    kind: 'loading',
    label: progress ? `${progress.label} · ${progress.step}/${progress.total}` : 'Starting kernel…',
    title: 'Waiting for the Python kernel',
    disabled: true,
  };
}
