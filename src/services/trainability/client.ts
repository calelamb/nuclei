/**
 * PRD 14 §5.6 — Trainability kernel client. Wraps a dedicated `LabSession`:
 *
 * - `inspect` / `lint` are sync request/response. The v1.3 messages carry no
 *   correlation id, and the kernel answers one message at a time per socket,
 *   so the client serializes them (one in flight) and matches by response
 *   type. Kernel `error` envelopes with `phase: 'trainability'` resolve as
 *   values, never throws.
 * - `start` acks at once and streams `progress`/`partial`/`result`, all
 *   correlated by `job_id`. The returned `done` promise never rejects: it
 *   resolves with the result, a kernel error, a timeout or a disconnect.
 * - `cancel` is a sync request correlated by `job_id`.
 */

import { request, type LabSession } from '../lab/labSession';
import type { KernelResponse } from '../../types/quantum';
import type {
  TrainabilityAnalysis,
  TrainabilityDiagnostic,
  TrainabilityInspection,
  TrainabilityLintSummary,
  TrainabilityProvenance,
  TrainabilityRequest,
  TrainabilityResponse,
  TrainabilityResults,
  TrainabilitySettings,
} from '../../types/trainability';
import type { KernelLanguage } from '../../types/quantum';

export interface TrainabilityError {
  code: string;
  message: string;
  /** Observable parse errors may carry the offending column. */
  column?: number;
}

export type ClientResult<T> = { ok: true; value: T } | { ok: false; error: TrainabilityError };

export interface CodeInput {
  code: string;
  language?: KernelLanguage;
  params?: Record<string, number>;
}

export interface LintInput extends CodeInput {
  observable?: string;
}

export interface StartInput extends CodeInput {
  observable: string;
  analyses: TrainabilityAnalysis[];
  settings?: TrainabilitySettings;
}

export type JobEvent =
  | { kind: 'started' }
  | { kind: 'progress'; analysis: TrainabilityAnalysis; fraction: number; message: string }
  | { kind: 'partial'; analysis: TrainabilityAnalysis; result: NonNullable<TrainabilityResults[TrainabilityAnalysis]> };

export type JobEnd =
  | {
      kind: 'result';
      status: 'complete' | 'cancelled' | 'failed';
      results: TrainabilityResults;
      errors: Partial<Record<TrainabilityAnalysis, { code: string; message: string }>>;
      elapsedMs: number;
      provenance: TrainabilityProvenance | null;
    }
  | { kind: 'error'; error: TrainabilityError }
  | { kind: 'disconnected' };

export interface JobHandle {
  jobId: string;
  done: Promise<JobEnd>;
  /** Resolves true when the kernel accepted the cancel. */
  cancel(): Promise<boolean>;
}

export interface TrainabilityClient {
  inspect(input: CodeInput): Promise<ClientResult<TrainabilityInspection>>;
  lint(input: LintInput): Promise<ClientResult<{ diagnostics: TrainabilityDiagnostic[]; summary: TrainabilityLintSummary }>>;
  start(input: StartInput, onEvent: (event: JobEvent) => void): JobHandle;
  close(): void;
  /** True once the underlying session has closed. */
  readonly closed: boolean;
  onClose(handler: () => void): () => void;
}

export interface ClientOptions {
  inspectTimeoutMs?: number;
  lintTimeoutMs?: number;
  /** How long to wait for `trainability_started` after sending start. */
  ackTimeoutMs?: number;
  cancelTimeoutMs?: number;
  newJobId?: () => string;
}

const DEFAULTS = {
  inspectTimeoutMs: 30_000,
  lintTimeoutMs: 5_000,
  ackTimeoutMs: 15_000,
  cancelTimeoutMs: 10_000,
};

function defaultJobId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `trn-${c.randomUUID()}`;
  return `trn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toError(error: unknown, fallbackCode = 'trainability_failed'): TrainabilityError {
  if (error instanceof Error) {
    const code = /closed/i.test(error.message)
      ? 'disconnected'
      : /did not answer/i.test(error.message)
        ? 'timeout'
        : fallbackCode;
    return { code, message: error.message };
  }
  return { code: fallbackCode, message: String(error) };
}

type KernelError = Extract<KernelResponse, { type: 'error' }>;

function fromKernelError(error: KernelError): TrainabilityError {
  const column = (error as { column?: unknown }).column;
  return {
    code: error.code ?? 'trainability_failed',
    message: error.message,
    ...(typeof column === 'number' ? { column } : {}),
  };
}

function isTrainabilityError(error: KernelError): boolean {
  return error.phase === 'trainability' && error.job_id === undefined;
}

function isTrainabilityResponse(message: KernelResponse): message is TrainabilityResponse {
  return typeof message.type === 'string' && message.type.startsWith('trainability_');
}

export function createTrainabilityClient(session: LabSession, options: ClientOptions = {}): TrainabilityClient {
  const opts = { ...DEFAULTS, ...options };
  const newJobId = options.newJobId ?? defaultJobId;
  // Serialize sync requests: no correlation id on the wire.
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };

  async function sync<T extends TrainabilityResponse>(
    message: TrainabilityRequest,
    match: (response: KernelResponse) => response is T,
    timeoutMs: number,
  ): Promise<ClientResult<T>> {
    return enqueue(async () => {
      try {
        const outcome = await request(session, message, match, {
          timeoutMs,
          matchError: isTrainabilityError,
        });
        return outcome.ok
          ? { ok: true as const, value: outcome.value }
          : { ok: false as const, error: fromKernelError(outcome.error) };
      } catch (error) {
        return { ok: false as const, error: toError(error) };
      }
    });
  }

  return {
    async inspect(input) {
      const result = await sync(
        { type: 'trainability_inspect', ...input },
        (m): m is Extract<TrainabilityResponse, { type: 'trainability_inspected' }> => m.type === 'trainability_inspected',
        opts.inspectTimeoutMs,
      );
      if (!result.ok) return result;
      const { type: _type, ...inspection } = result.value;
      void _type;
      return { ok: true, value: inspection };
    },

    async lint(input) {
      const result = await sync(
        { type: 'trainability_lint', ...input },
        (m): m is Extract<TrainabilityResponse, { type: 'trainability_lint_result' }> => m.type === 'trainability_lint_result',
        opts.lintTimeoutMs,
      );
      if (!result.ok) return result;
      return { ok: true, value: { diagnostics: result.value.diagnostics, summary: result.value.summary } };
    },

    start(input, onEvent) {
      const jobId = newJobId();
      let finished = false;
      let acked = false;
      let resolveDone: (end: JobEnd) => void = () => undefined;
      const done = new Promise<JobEnd>((resolve) => {
        resolveDone = resolve;
      });

      const finish = (end: JobEnd) => {
        if (finished) return;
        finished = true;
        unsubscribe();
        offClose();
        clearTimeout(ackTimer);
        resolveDone(end);
      };

      const unsubscribe = session.subscribe((message) => {
        if (finished) return;
        if (message.type === 'error') {
          // Job-correlated errors, or an uncorrelated trainability error
          // (e.g. `trainability_busy`) before the ack.
          const mine = message.job_id === jobId || (message.job_id === undefined && !acked && isTrainabilityError(message));
          if (mine) finish({ kind: 'error', error: fromKernelError(message) });
          return;
        }
        if (!isTrainabilityResponse(message)) return;
        switch (message.type) {
          case 'trainability_started':
            if (message.job_id !== jobId) return;
            acked = true;
            clearTimeout(ackTimer);
            onEvent({ kind: 'started' });
            return;
          case 'trainability_progress':
            if (message.job_id !== jobId) return;
            acked = true;
            onEvent({ kind: 'progress', analysis: message.analysis, fraction: message.fraction, message: message.message });
            return;
          case 'trainability_partial':
            if (message.job_id !== jobId || message.result === undefined) return;
            acked = true;
            onEvent({ kind: 'partial', analysis: message.analysis, result: message.result });
            return;
          case 'trainability_result':
            if (message.job_id !== jobId) return;
            finish({
              kind: 'result',
              status: message.status,
              results: message.results ?? {},
              errors: message.errors ?? {},
              elapsedMs: message.elapsed_ms,
              provenance: message.provenance ?? null,
            });
            return;
          default:
            return;
        }
      });
      const offClose = session.onClose(() => finish({ kind: 'disconnected' }));
      const ackTimer = setTimeout(() => {
        if (acked) return;
        finish({
          kind: 'error',
          error: { code: 'timeout', message: `Kernel did not acknowledge the job within ${opts.ackTimeoutMs} ms` },
        });
      }, opts.ackTimeoutMs);

      try {
        void Promise.resolve(
          session.send({
            type: 'trainability_start',
            job_id: jobId,
            code: input.code,
            language: input.language,
            observable: input.observable,
            analyses: input.analyses,
            settings: input.settings,
            params: input.params,
          }),
        ).catch((error: unknown) => finish({ kind: 'error', error: toError(error) }));
      } catch (error) {
        finish({ kind: 'error', error: toError(error) });
      }

      return {
        jobId,
        done,
        async cancel() {
          if (finished) return false;
          const result = await sync(
            { type: 'trainability_cancel', job_id: jobId },
            (m): m is Extract<TrainabilityResponse, { type: 'trainability_cancelled' }> =>
              m.type === 'trainability_cancelled' && m.job_id === jobId,
            opts.cancelTimeoutMs,
          );
          return result.ok ? result.value.accepted : false;
        },
      };
    },

    close() {
      session.close();
    },
    get closed() {
      return session.closed;
    },
    onClose(handler) {
      return session.onClose(handler);
    },
  };
}
