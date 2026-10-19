import { kernelStartFailureTitle } from '../../lib/kernelErrors';
import type { KernelProgress, KernelStatus } from '../../stores/editorStore';

export interface BootStepLabel {
  /** The Run slot: narrow, no engine name. */
  short: string;
  /** The results placeholder heading. */
  long: string;
  /** The status bar item. */
  status: string;
  /** The stage being worked on ("Downloading Python"), for tooltips and detail only. */
  stage: string | null;
  /** True when the step count is a real n-of-m stage (not desktop connect retries). */
  counted: boolean;
}

/**
 * The one vocabulary for "the engine is booting". The Run slot, the results
 * placeholder and the status bar all derive from it, so they say the same
 * thing in the same words; the stage name (Downloading, NumPy) lives only in
 * tooltips and detail text.
 */
export function bootStepLabel(progress: KernelProgress | null, options: { isWeb: boolean }): BootStepLabel {
  const engine = options.isWeb ? 'Python' : 'kernel';
  const counted = progress !== null && progress.kind !== 'attempts' && progress.total > 0;
  const stage = progress?.label ?? null;
  if (counted && progress) {
    return {
      short: `Starting ${progress.step}/${progress.total}`,
      long: `Starting ${engine} ${progress.step}/${progress.total}`,
      status: `Starting ${engine} ${progress.step}/${progress.total}`,
      stage,
      counted: true,
    };
  }
  return { short: 'Starting…', long: `Starting ${engine}…`, status: `Starting ${engine}…`, stage, counted: false };
}

/** A lazy package install (the 60 MB Cirq download) is a kernel phase with one wording everywhere. */
export function installStepLabel(pkg: string): { short: string; long: string; status: string } {
  const text = `Installing ${pkg}…`;
  return { short: text, long: text, status: text };
}

/** Installs shorter than this are not worth a caveat on the run time. */
const INSTALL_NOTE_MIN_MS = 1000;

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
  /** The most recent run finished but defined no circuit (plain Python): a clean finish, not a failure. */
  lastRunNoCircuit?: boolean;
  /** The most recent run was stopped by the user before it finished. */
  lastRunStopped?: boolean;
  isWeb: boolean;
  /** The package a lazy install is fetching right now, if any. */
  kernelInstalling?: string | null;
  /** How long the last run waited behind a lazy install (the kernel's own time excludes it). */
  installMs?: number | null;
}

/**
 * One item for kernel + simulation state, driven by the kernel first so the
 * bar can never say "Ready" while Python is still loading.
 */
export function getKernelStatusModel(input: KernelStatusInput): KernelStatusModel {
  const engine = input.isWeb ? 'Python' : 'Kernel';

  if (input.kernelStatus === 'failed' && !input.kernelReady) {
    return {
      label: kernelStartFailureTitle(input.isWeb),
      tone: 'error',
      detail: `${input.kernelError ?? (input.isWeb ? 'Python did not start.' : 'The kernel did not start.')} Click to retry.`,
    };
  }

  if (!input.kernelReady) {
    if (input.kernelStatus === 'connecting') {
      const step = bootStepLabel(input.kernelProgress, { isWeb: input.isWeb });
      const stage = step.stage ? ` ${step.stage}.` : '';
      return { label: step.status, tone: 'busy', detail: `${engine} is starting up.${stage}` };
    }
    return { label: `${engine} idle`, tone: 'idle', detail: `${engine} has not started.` };
  }

  if (input.kernelInstalling) {
    return {
      label: installStepLabel(input.kernelInstalling).status,
      tone: 'busy',
      detail: `${input.kernelInstalling} is a one-time download of about 60 MB. Your run starts when it finishes.`,
    };
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
  if (input.lastRunStopped) {
    return { label: 'Run stopped', tone: 'idle', detail: `${engine} is ready. You stopped the last run before it finished.` };
  }
  if (input.lastRunNoCircuit) {
    return {
      label: 'Done · no circuit',
      tone: 'ok',
      detail: 'The code ran as plain Python. It did not define a circuit, so there was nothing to simulate.',
    };
  }
  if (input.executionTimeMs !== null) {
    return {
      label: `Done · ${Math.round(input.executionTimeMs)} ms${installNote(input.installMs)}`,
      tone: 'ok',
      detail: input.installMs && input.installMs >= INSTALL_NOTE_MIN_MS
        ? 'The last run finished. The time shown excludes the one-time package install it waited for.'
        : 'The last run finished.',
    };
  }
  return { label: `${engine} ready`, tone: 'ok', detail: `${engine} is ready to run.` };
}

/** " (+10 s install)" when a run waited behind a lazy install long enough to matter, else "". */
export function installNote(installMs: number | null | undefined): string {
  if (!installMs || installMs < INSTALL_NOTE_MIN_MS) return '';
  return ` (+${Math.round(installMs / 1000)} s install)`;
}
