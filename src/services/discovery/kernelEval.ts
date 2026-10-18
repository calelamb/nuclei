/**
 * Kernel evaluation client for the runner: `discovery_evaluate` over a Lab
 * session, correlated by (run_id, candidate_id). Never rejects; transport
 * problems come back as a synthetic `failed` evaluation so the runner can
 * record them like any other failure.
 */

import { EVOLVE_END_MARKER, EVOLVE_START_MARKER } from '../../types/discovery';
import type {
  AstMutation,
  DiscoveryEvaluation,
  DiscoveryEvaluatorInfo,
  DiscoveryEvaluatorKind,
  DiscoveryStage,
} from '../../types/discovery';
import type { KernelMessage, KernelResponse } from '../../types/quantum';
import type { RunnerKernelSession } from '../experimentRunner';
import { newRequestId, replyMatches } from './requestId';

export interface EvalRequest {
  runId: string;
  /** Wire id; unique among in-flight evaluations of the run. */
  wireId: string;
  evaluator: { kind: DiscoveryEvaluatorKind; config: Record<string, unknown> };
  program: string;
  entry: string;
  seed: number;
  stage: DiscoveryStage;
}

export type MutateResult = { ok: true; mutations: AstMutation[] } | { ok: false; message: string };
export type ProgramKeyResult = { ok: true; key: string } | { ok: false; unsupported: boolean; message: string };
export const MUTATE_TIMEOUT_MS = 60_000;
export const PROGRAM_KEY_TIMEOUT_MS = 10_000;

export interface KernelEvaluator {
  /** AST baseline mutation (`discovery_mutate`). Sync calls are serialized and matched by `request_id`. */
  mutate(program: string, seed: number, count?: number): Promise<MutateResult>;
  /**
   * The kernel's AST-normalised dedup key for a program (`discovery_program_key`), so a duplicate
   * is caught before a screen evaluation is spent. `unsupported` means an older kernel: the
   * caller falls back to keying results after evaluation.
   */
  programKey(program: string): Promise<ProgramKeyResult>;
  evaluate(request: EvalRequest): Promise<DiscoveryEvaluation>;
  /** Ask the kernel to cancel everything of the run; pending promises resolve as cancelled. */
  cancelRun(runId: string): void;
  /**
   * Called once when the session closes or a send fails: the run cannot go on.
   * Fires before the affected promises settle.
   */
  onFatal(handler: (message: string) => void): () => void;
  dispose(): void;
}

export const DEFAULT_EVAL_TIMEOUT_MS = 20 * 60_000;
export const BUSY_RETRIES = 5;
export const BUSY_BACKOFF_MS = 500;
export const CANCELLED_CODE = 'cancelled';

export function isCancelled(evaluation: DiscoveryEvaluation): boolean {
  return evaluation.status === 'failed' && evaluation.failure?.code === CANCELLED_CODE;
}

/** The kernel connection itself is gone (CR-H7): not a verdict about the candidate. */
export const TRANSPORT_FAILURE_CODES = ['session_closed', 'send_failed'] as const;

export function isTransportFailure(evaluation: DiscoveryEvaluation): boolean {
  return evaluation.status === 'failed' && TRANSPORT_FAILURE_CODES.some((code) => code === evaluation.failure?.code);
}

export function syntheticFailure(
  request: Pick<EvalRequest, 'runId' | 'wireId' | 'seed' | 'stage'>,
  info: Pick<DiscoveryEvaluatorInfo, 'kind' | 'version'>,
  code: string,
  message: string,
): DiscoveryEvaluation {
  return {
    candidate_id: request.wireId,
    run_id: request.runId,
    status: 'failed',
    fitness: null,
    objectives: {},
    descriptors: {},
    metrics: {},
    guardrails: [],
    rejection: null,
    failure: { stage: 'sandbox', code, message },
    stdout: '',
    stderr: '',
    timings_ms: { total: 0 },
    evaluator: { kind: info.kind, version: info.version, fingerprint: '' },
    seed: request.seed,
    stage: request.stage,
  };
}

interface Options {
  session: RunnerKernelSession & { onClose?: (handler: () => void) => () => void };
  info: Pick<DiscoveryEvaluatorInfo, 'kind' | 'version'>;
  sleep: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

type KernelError = Extract<KernelResponse, { type: 'error' }>;

/** One in-flight sync request (mutate or program key); at most one at a time per evaluator. */
interface SyncCall {
  id: string;
  reply(message: KernelResponse): void;
  error(message: KernelError): void;
  close(message: string): void;
}

/** Evaluations in flight per session, by correlation key and kind, so an error cannot settle the wrong waiter. */
const inFlightKinds = new WeakMap<object, Map<string, Set<'eval' | 'audit'>>>();

export function trackInFlight(session: object, key: string, kind: 'eval' | 'audit'): () => void {
  const byKey = inFlightKinds.get(session) ?? new Map<string, Set<'eval' | 'audit'>>();
  inFlightKinds.set(session, byKey);
  const kinds = byKey.get(key) ?? new Set<'eval' | 'audit'>();
  kinds.add(kind);
  byKey.set(key, kinds);
  return () => {
    kinds.delete(kind);
    if (kinds.size === 0) byKey.delete(key);
  };
}

/** Both an evaluation and an audit wait on this id: a bare error cannot be told apart, so neither takes it. */
export function isAmbiguousError(session: object, key: string): boolean {
  return (inFlightKinds.get(session)?.get(key)?.size ?? 0) > 1;
}

export function createKernelEvaluator({ session, info, sleep, timeoutMs = DEFAULT_EVAL_TIMEOUT_MS }: Options): KernelEvaluator {
  type Waiter = { request: EvalRequest; settle: (e: DiscoveryEvaluation) => void };
  const waiters = new Map<string, Waiter>();
  const keyOf = (runId: string, wireId: string) => `${runId}\u0000${wireId}`;

  let pendingSync: SyncCall | null = null;
  let syncTail: Promise<unknown> = Promise.resolve();
  /** Set once any reply carries a request_id: from then on an id-less error is not trusted for a sync call. */
  let kernelEchoesIds = false;
  /** Cached after the first `invalid_request` / timeout for `discovery_program_key`. */
  let programKeyUnsupported = false;
  const fatalHandlers = new Set<(message: string) => void>();
  let fatalMessage: string | null = null;
  const raiseFatal = (message: string) => {
    if (fatalMessage !== null) return;
    fatalMessage = message;
    for (const handler of [...fatalHandlers]) handler(message);
  };

  const unsubscribe = session.subscribe((message: KernelResponse) => {
    if (typeof (message as { request_id?: unknown }).request_id === 'string') kernelEchoesIds = true;
    if (message.type === 'discovery_mutations' || message.type === 'discovery_program_key_result') {
      pendingSync?.reply(message);
    } else if (message.type === 'error' && message.phase === 'discovery' && !message.candidate_id) {
      if (message.request_id !== undefined ? message.request_id === pendingSync?.id : !kernelEchoesIds) pendingSync?.error(message);
    } else if (message.type === 'discovery_evaluation') {
      const waiter = waiters.get(keyOf(message.run_id, message.candidate_id));
      waiter?.settle(message.evaluation);
    } else if (message.type === 'error' && message.phase === 'discovery' && message.run_id && message.candidate_id) {
      const key = keyOf(message.run_id, message.candidate_id);
      if (isAmbiguousError(session, key)) return;
      const waiter = waiters.get(key);
      waiter?.settle(syntheticFailure(waiter.request, info, message.code ?? 'kernel_error', message.message));
    }
  });
  const offClose = session.onClose?.(() => {
    raiseFatal('The kernel session closed.');
    pendingSync?.close('The kernel session closed.');
    for (const waiter of [...waiters.values()]) {
      waiter.settle(syntheticFailure(waiter.request, info, 'session_closed', 'The kernel session closed.'));
    }
  });

  function attempt(request: EvalRequest): Promise<DiscoveryEvaluation> {
    const key = keyOf(request.runId, request.wireId);
    if (fatalMessage !== null) return Promise.resolve(syntheticFailure(request, info, 'session_closed', fatalMessage));
    return new Promise((resolve) => {
      const untrack = trackInFlight(session, key, 'eval');
      const timer = setTimeout(
        () => {
          settle(syntheticFailure(request, info, 'eval_timeout', `No answer from the kernel within ${Math.round(timeoutMs / 1000)} s.`));
          // The kernel may still be working on it: stop it so it does not hold a slot (CR low).
          try {
            void Promise.resolve(session.send({ type: 'discovery_cancel', run_id: request.runId, candidate_id: request.wireId })).catch(() => undefined);
          } catch {
            /* session already closed */
          }
        },
        timeoutMs,
      );
      function settle(evaluation: DiscoveryEvaluation) {
        if (waiters.get(key)?.settle !== settle) return;
        waiters.delete(key);
        untrack();
        clearTimeout(timer);
        resolve(evaluation);
      }
      waiters.set(key, { request, settle });
      try {
        void Promise.resolve(
          session.send({
            type: 'discovery_evaluate',
            run_id: request.runId,
            candidate_id: request.wireId,
            evaluator: request.evaluator,
            program: request.program,
            entry: request.entry,
            seed: request.seed,
            stage: request.stage,
          }),
        ).catch((e: unknown) => sendFailed(e));
      } catch (e) {
        sendFailed(e);
      }
      function sendFailed(e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        raiseFatal(`Could not reach the kernel: ${message}`);
        settle(syntheticFailure(request, info, 'send_failed', message));
      }
    });
  }

  /**
   * Send one correlated sync request and resolve with its reply. Replies and errors that carry
   * a different `request_id` are dropped (CR-M4); ones with no id are accepted, as an older
   * kernel sends none.
   */
  function syncRequest<T>(
    label: string,
    timeout: number,
    build: (requestId: string) => KernelMessage,
    accept: (message: KernelResponse) => T | null,
    failure: (message: string, error?: KernelError) => T,
  ): Promise<T> {
    return new Promise((resolve) => {
      const id = newRequestId(label);
      const timer = setTimeout(() => finish(failure(`No answer to ${label}.`)), timeout);
      const call: SyncCall = {
        id,
        reply(message) {
          if (!replyMatches(id, (message as { request_id?: unknown }).request_id)) return;
          const value = accept(message);
          if (value !== null) finish(value);
        },
        error: (message) => finish(failure(message.message, message)),
        close: (message) => finish(failure(message)),
      };
      const finish = (value: T) => {
        if (pendingSync !== call) return;
        pendingSync = null;
        clearTimeout(timer);
        resolve(value);
      };
      pendingSync = call;
      const bail = (e: unknown) => finish(failure(e instanceof Error ? e.message : String(e)));
      try {
        void Promise.resolve(session.send(build(id))).catch(bail);
      } catch (e) {
        bail(e);
      }
    });
  }

  const serialized = <T,>(task: () => Promise<T>): Promise<T> => {
    const result = syncTail.then(task);
    syncTail = result;
    return result;
  };

  function mutateOnce(program: string, seed: number, count: number): Promise<MutateResult> {
    return syncRequest<MutateResult>(
      'discovery_mutate',
      MUTATE_TIMEOUT_MS,
      (request_id) => ({ type: 'discovery_mutate', program, start_marker: EVOLVE_START_MARKER, end_marker: EVOLVE_END_MARKER, seed, count, request_id }),
      (m) => (m.type === 'discovery_mutations' ? { ok: true, mutations: m.mutations } : null),
      (message) => ({ ok: false, message }),
    );
  }

  function programKeyOnce(program: string): Promise<ProgramKeyResult> {
    if (programKeyUnsupported) return Promise.resolve({ ok: false, unsupported: true, message: 'The kernel does not support discovery_program_key.' });
    return syncRequest<ProgramKeyResult>(
      'discovery_program_key',
      PROGRAM_KEY_TIMEOUT_MS,
      (request_id) => ({ type: 'discovery_program_key', program, request_id }),
      (m) => (m.type === 'discovery_program_key_result' ? { ok: true, key: m.program_key } : null),
      (message, error) => {
        // An older kernel answers `invalid_request` (or says nothing): ask no more, key after evaluation instead.
        const unsupported = error ? error.code === 'invalid_request' : /No answer/.test(message);
        if (unsupported) programKeyUnsupported = true;
        return { ok: false, unsupported, message };
      },
    );
  }

  return {
    mutate(program, seed, count = 1) {
      return serialized(() => mutateOnce(program, seed, count));
    },
    programKey(program) {
      return serialized(() => programKeyOnce(program));
    },
    async evaluate(request) {
      for (let tries = 0; ; tries += 1) {
        const evaluation = await attempt(request);
        // `discovery_busy` means the kernel queue is full: back off and resend.
        if (evaluation.failure?.code !== 'discovery_busy' || tries >= BUSY_RETRIES) return evaluation;
        await sleep(BUSY_BACKOFF_MS * (tries + 1));
      }
    },
    onFatal(handler) {
      fatalHandlers.add(handler);
      if (fatalMessage !== null) handler(fatalMessage);
      return () => fatalHandlers.delete(handler);
    },
    cancelRun(runId) {
      for (const waiter of [...waiters.values()]) {
        if (waiter.request.runId === runId) {
          waiter.settle(syntheticFailure(waiter.request, info, CANCELLED_CODE, 'Cancelled.'));
        }
      }
      try {
        void Promise.resolve(session.send({ type: 'discovery_cancel', run_id: runId })).catch(() => undefined);
      } catch {
        /* session already closed: nothing left to cancel */
      }
    },
    dispose() {
      unsubscribe();
      offClose?.();
      for (const waiter of [...waiters.values()]) {
        waiter.settle(syntheticFailure(waiter.request, info, CANCELLED_CODE, 'The run was disposed.'));
      }
    },
  };
}
