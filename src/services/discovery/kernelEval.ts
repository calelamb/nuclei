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
import type { KernelResponse } from '../../types/quantum';
import type { RunnerKernelSession } from '../experimentRunner';

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
export const MUTATE_TIMEOUT_MS = 60_000;

export interface KernelEvaluator {
  /** AST baseline mutation (`discovery_mutate`). Calls are serialized: the reply carries no id. */
  mutate(program: string, seed: number, count?: number): Promise<MutateResult>;
  evaluate(request: EvalRequest): Promise<DiscoveryEvaluation>;
  /** Ask the kernel to cancel everything of the run; pending promises resolve as cancelled. */
  cancelRun(runId: string): void;
  dispose(): void;
}

export const DEFAULT_EVAL_TIMEOUT_MS = 20 * 60_000;
export const BUSY_RETRIES = 5;
export const BUSY_BACKOFF_MS = 500;
export const CANCELLED_CODE = 'cancelled';

export function isCancelled(evaluation: DiscoveryEvaluation): boolean {
  return evaluation.status === 'failed' && evaluation.failure?.code === CANCELLED_CODE;
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

export function createKernelEvaluator({ session, info, sleep, timeoutMs = DEFAULT_EVAL_TIMEOUT_MS }: Options): KernelEvaluator {
  type Waiter = { request: EvalRequest; settle: (e: DiscoveryEvaluation) => void };
  const waiters = new Map<string, Waiter>();
  const keyOf = (runId: string, wireId: string) => `${runId}\u0000${wireId}`;

  let pendingMutate: ((result: MutateResult) => void) | null = null;
  let mutateTail: Promise<unknown> = Promise.resolve();

  const unsubscribe = session.subscribe((message: KernelResponse) => {
    if (message.type === 'discovery_mutations') {
      pendingMutate?.({ ok: true, mutations: message.mutations });
    } else if (message.type === 'error' && message.phase === 'discovery' && !message.candidate_id) {
      pendingMutate?.({ ok: false, message: message.message });
    } else if (message.type === 'discovery_evaluation') {
      const waiter = waiters.get(keyOf(message.run_id, message.candidate_id));
      waiter?.settle(message.evaluation);
    } else if (message.type === 'error' && message.phase === 'discovery' && message.run_id && message.candidate_id) {
      const key = keyOf(message.run_id, message.candidate_id);
      const waiter = waiters.get(key);
      waiter?.settle(syntheticFailure(waiter.request, info, message.code ?? 'kernel_error', message.message));
    }
  });
  const offClose = session.onClose?.(() => {
    for (const waiter of [...waiters.values()]) {
      waiter.settle(syntheticFailure(waiter.request, info, 'session_closed', 'The kernel session closed.'));
    }
  });

  function attempt(request: EvalRequest): Promise<DiscoveryEvaluation> {
    const key = keyOf(request.runId, request.wireId);
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => settle(syntheticFailure(request, info, 'eval_timeout', `No answer from the kernel within ${Math.round(timeoutMs / 1000)} s.`)),
        timeoutMs,
      );
      function settle(evaluation: DiscoveryEvaluation) {
        if (waiters.get(key)?.settle !== settle) return;
        waiters.delete(key);
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
        ).catch((e: unknown) => settle(syntheticFailure(request, info, 'send_failed', e instanceof Error ? e.message : String(e))));
      } catch (e) {
        settle(syntheticFailure(request, info, 'send_failed', e instanceof Error ? e.message : String(e)));
      }
    });
  }

  function mutateOnce(program: string, seed: number, count: number): Promise<MutateResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish({ ok: false, message: 'No answer to discovery_mutate.' }), MUTATE_TIMEOUT_MS);
      const finish = (result: MutateResult) => {
        if (pendingMutate !== finish) return;
        pendingMutate = null;
        clearTimeout(timer);
        resolve(result);
      };
      pendingMutate = finish;
      try {
        void Promise.resolve(
          session.send({ type: 'discovery_mutate', program, start_marker: EVOLVE_START_MARKER, end_marker: EVOLVE_END_MARKER, seed, count }),
        ).catch((e: unknown) => finish({ ok: false, message: e instanceof Error ? e.message : String(e) }));
      } catch (e) {
        finish({ ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    });
  }

  return {
    mutate(program, seed, count = 1) {
      const result = mutateTail.then(() => mutateOnce(program, seed, count));
      mutateTail = result;
      return result;
    },
    async evaluate(request) {
      for (let tries = 0; ; tries += 1) {
        const evaluation = await attempt(request);
        // `discovery_busy` means the kernel queue is full: back off and resend.
        if (evaluation.failure?.code !== 'discovery_busy' || tries >= BUSY_RETRIES) return evaluation;
        await sleep(BUSY_BACKOFF_MS * (tries + 1));
      }
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
