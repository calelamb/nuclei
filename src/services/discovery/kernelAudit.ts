/**
 * Kernel audit client: `discovery_audit` over a Lab session, correlated by
 * (run_id, candidate_id). Like the evaluation client it never rejects: the
 * outcome is `ok`, `cancelled` or an error with the kernel's code.
 */

import type { DiscoveryAudit, DiscoveryEvaluation, DiscoveryEvaluatorKind } from '../../types/discovery';
import type { KernelResponse } from '../../types/quantum';
import type { RunnerKernelSession } from '../experimentRunner';
import { isAmbiguousError, trackInFlight } from './kernelEval';

interface AuditRequest {
  runId: string;
  candidateId: string;
  evaluator: { kind: DiscoveryEvaluatorKind; config: Record<string, unknown> };
  program: string;
  entry: string;
  seed: number;
  evaluation: DiscoveryEvaluation;
}

type AuditOutcome =
  | { status: 'ok'; audit: DiscoveryAudit }
  | { status: 'cancelled' }
  | { status: 'error'; code: string; message: string };

export interface AuditClient {
  audit(request: AuditRequest): Promise<AuditOutcome>;
  /** Cancel one candidate's audit, or every audit of the run. Pending promises resolve as cancelled. */
  cancel(runId: string, candidateId?: string): void;
  dispose(): void;
}

const DEFAULT_AUDIT_TIMEOUT_MS = 30 * 60_000;
const AUDIT_BUSY_RETRIES = 5;
const AUDIT_BUSY_BACKOFF_MS = 500;

interface Options {
  session: RunnerKernelSession & { onClose?: (handler: () => void) => () => void };
  sleep: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const keyOf = (runId: string, candidateId: string) => `${runId}\u0000${candidateId}`;
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createAuditClient({ session, sleep, timeoutMs = DEFAULT_AUDIT_TIMEOUT_MS }: Options): AuditClient {
  const waiters = new Map<string, { runId: string; candidateId: string; settle: (o: AuditOutcome) => void }>();

  const unsubscribe = session.subscribe((message: KernelResponse) => {
    if (message.type === 'discovery_audit_result') {
      waiters.get(keyOf(message.run_id, message.candidate_id))?.settle({ status: 'ok', audit: message.audit });
    } else if (message.type === 'error' && message.phase === 'discovery' && message.run_id && message.candidate_id) {
      const key = keyOf(message.run_id, message.candidate_id);
      // An evaluation of the same candidate is also waiting: a bare error cannot be told apart, so neither takes it.
      if (isAmbiguousError(session, key)) return;
      waiters.get(key)?.settle({
        status: 'error', code: message.code ?? 'kernel_error', message: message.message,
      });
    }
  });
  const offClose = session.onClose?.(() => {
    for (const w of [...waiters.values()]) w.settle({ status: 'error', code: 'session_closed', message: 'The kernel session closed.' });
  });

  function attempt(request: AuditRequest): Promise<AuditOutcome> {
    const key = keyOf(request.runId, request.candidateId);
    return new Promise((resolve) => {
      const untrack = trackInFlight(session, key, 'audit');
      const timer = setTimeout(
        () => settle({ status: 'error', code: 'audit_timeout', message: `No audit answer from the kernel within ${Math.round(timeoutMs / 1000)} s.` }),
        timeoutMs,
      );
      function settle(outcome: AuditOutcome) {
        if (waiters.get(key)?.settle !== settle) return;
        waiters.delete(key);
        untrack();
        clearTimeout(timer);
        resolve(outcome);
      }
      waiters.set(key, { runId: request.runId, candidateId: request.candidateId, settle });
      const fail = (e: unknown) => settle({ status: 'error', code: 'send_failed', message: messageOf(e) });
      try {
        void Promise.resolve(
          session.send({
            type: 'discovery_audit',
            run_id: request.runId,
            candidate_id: request.candidateId,
            evaluator: request.evaluator,
            program: request.program,
            entry: request.entry,
            seed: request.seed,
            evaluation: request.evaluation,
          }),
        ).catch(fail);
      } catch (e) {
        fail(e);
      }
    });
  }

  return {
    async audit(request) {
      for (let tries = 0; ; tries += 1) {
        const outcome = await attempt(request);
        // `discovery_busy` means the audit queue is full: back off and resend.
        if (outcome.status !== 'error' || outcome.code !== 'discovery_busy' || tries >= AUDIT_BUSY_RETRIES) return outcome;
        await sleep(AUDIT_BUSY_BACKOFF_MS * (tries + 1));
      }
    },
    cancel(runId, candidateId) {
      for (const w of [...waiters.values()]) {
        if (w.runId === runId && (candidateId === undefined || w.candidateId === candidateId)) w.settle({ status: 'cancelled' });
      }
      try {
        void Promise.resolve(
          session.send({ type: 'discovery_audit_cancel', run_id: runId, ...(candidateId === undefined ? {} : { candidate_id: candidateId }) }),
        ).catch(() => undefined);
      } catch {
        /* session already closed: nothing left to cancel */
      }
    },
    dispose() {
      unsubscribe();
      offClose?.();
      for (const w of [...waiters.values()]) w.settle({ status: 'cancelled' });
    },
  };
}
