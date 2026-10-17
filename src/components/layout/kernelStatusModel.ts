import type { KernelProgress, KernelStatus } from '../../stores/editorStore';

export type KernelTone = 'idle' | 'busy' | 'running' | 'ok' | 'warn' | 'error';

export interface KernelStatusModel {
  label: string;
  tone: KernelTone;
  /** Full sentence for the tooltip / accessible description. */
  detail: string;
}

interface KernelStatusInput {
  kernelStatus: KernelStatus;
  kernelReady: boolean;
  kernelError: string | null;
  kernelProgress: KernelProgress | null;
  isRunning: boolean;
  executionTimeMs: number | null;
  /** The most recent run ended in an error (the kernel itself is fine). */
  lastRunFailed: boolean;
  isWeb: boolean;
}

/**
 * One item for kernel + simulation state, driven by the kernel first so the
 * bar can never say "Ready" while Python is still loading.
 */
export function getKernelStatusModel(input: KernelStatusInput): KernelStatusModel {
  const engine = input.isWeb ? 'Python' : 'Kernel';

  if (input.kernelStatus === 'failed' && !input.kernelReady) {
    return {
      label: `${engine} failed`,
      tone: 'error',
      detail: `${input.kernelError ?? 'The kernel did not start.'} Click to retry.`,
    };
  }

  if (!input.kernelReady) {
    if (input.kernelStatus === 'connecting') {
      const stage = input.kernelProgress?.label ?? (input.isWeb ? 'Loading Python' : 'Starting kernel');
      return { label: `${stage}…`, tone: 'busy', detail: `${engine} is starting up.` };
    }
    return { label: `${engine} idle`, tone: 'idle', detail: `${engine} has not started.` };
  }

  if (input.isRunning) {
    return { label: 'Running…', tone: 'running', detail: 'A simulation is running.' };
  }
  if (input.lastRunFailed) {
    return {
      label: 'Last run failed',
      tone: 'warn',
      detail: `${engine} is ready. The last run ended with an error; see the Terminal.`,
    };
  }
  if (input.executionTimeMs !== null) {
    return {
      label: `Done · ${Math.round(input.executionTimeMs)} ms`,
      tone: 'ok',
      detail: 'The last run finished.',
    };
  }
  return { label: `${engine} ready`, tone: 'ok', detail: `${engine} is ready to run.` };
}
