/**
 * Conjecture test client over a dedicated `LabSession`.
 *
 * - `schema` is a sync request (one in flight; no correlation id on the wire).
 * - `start` streams `started`, `progress`, per-circuit `evidence` and a final
 *   `result`, all correlated by `job_id`. `done` never rejects: it resolves
 *   with the result, a kernel error (`invalid_conjecture`, `conjecture_busy`,
 *   `conjecture_internal`), a timeout or a disconnect.
 * - `cancel` is a sync request correlated by `job_id`.
 */

import type { Conjecture, ConjectureResponse, ConjectureResult, ConjectureSchemaInfo } from '../../types/conjecture';
import type { KernelResponse } from '../../types/quantum';
import { request, type LabSession } from '../lab/labSession';
import { newRequestId, replyMatches } from '../discovery/requestId';
import { normalizeSchemaResult } from './schema';

export interface TesterError {
  code: string;
  message: string;
  /** Path into the conjecture for `invalid_conjecture`. */
  path?: string;
}

export type TestEvent =
  | { kind: 'started' }
  | { kind: 'progress'; fraction: number; message: string; circuitIndex: number }
  | { kind: 'evidence'; item: unknown };

export type TestEnd =
  | { kind: 'result'; status: 'complete' | 'cancelled' | 'failed'; result: ConjectureResult | null }
  | { kind: 'error'; error: TesterError }
  | { kind: 'disconnected' };

export interface TestHandle {
  jobId: string;
  done: Promise<TestEnd>;
  /** Resolves true when the kernel accepted the cancel. */
  cancel(): Promise<boolean>;
}

export interface ConjectureTester {
  schema(): Promise<{ ok: true; value: ConjectureSchemaInfo } | { ok: false; error: TesterError }>;
  start(input: { jobId?: string; conjecture: Conjecture; seed: number }, onEvent: (event: TestEvent) => void): TestHandle;
  close(): void;
  readonly closed: boolean;
  onClose(handler: () => void): () => void;
}

export interface TesterOptions {
  schemaTimeoutMs?: number;
  ackTimeoutMs?: number;
  cancelTimeoutMs?: number;
  newJobId?: () => string;
}

const DEFAULTS = { schemaTimeoutMs: 15_000, ackTimeoutMs: 20_000, cancelTimeoutMs: 10_000 };

export function newConjectureJobId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `cjt-${c.randomUUID()}`;
  return `cjt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type KernelError = Extract<KernelResponse, { type: 'error' }>;

function fromKernelError(error: KernelError): TesterError {
  const path = (error as { path?: unknown }).path;
  return { code: error.code ?? 'conjecture_internal', message: error.message, ...(typeof path === 'string' ? { path } : {}) };
}

function toError(error: unknown): TesterError {
  const message = error instanceof Error ? error.message : String(error);
  if (/closed/i.test(message)) return { code: 'disconnected', message };
  if (/did not answer/i.test(message)) return { code: 'timeout', message };
  return { code: 'conjecture_internal', message };
}

const CONJECTURE_ERROR_CODES = ['invalid_conjecture', 'conjecture_busy', 'conjecture_internal'];
const isDiscoveryError = (e: KernelError) => e.phase === 'discovery';
const isConjectureMessage = (m: KernelResponse): m is ConjectureResponse =>
  typeof m.type === 'string' && m.type.startsWith('discovery_conjecture_');

export function createConjectureTester(session: LabSession, options: TesterOptions = {}): ConjectureTester {
  const opts = { ...DEFAULTS, ...options };
  const newJobId = options.newJobId ?? newConjectureJobId;
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };

  return {
    schema() {
      return enqueue(async () => {
        try {
          // Matched by request_id (CR-M4); an older kernel echoes none and is matched as before.
          const requestId = newRequestId('discovery_conjecture_schema');
          const out = await request(
            session,
            { type: 'discovery_conjecture_schema', request_id: requestId },
            (m): m is Extract<ConjectureResponse, { type: 'discovery_conjecture_schema_result' }> =>
              m.type === 'discovery_conjecture_schema_result' && replyMatches(requestId, (m as { request_id?: unknown }).request_id),
            { timeoutMs: opts.schemaTimeoutMs, matchError: (e) => isDiscoveryError(e) && e.job_id === undefined && replyMatches(requestId, e.request_id) },
          );
          if (!out.ok) return { ok: false as const, error: fromKernelError(out.error) };
          const info = normalizeSchemaResult(out.value);
          return info
            ? { ok: true as const, value: info }
            : { ok: false as const, error: { code: 'conjecture_internal', message: 'The kernel returned an incomplete conjecture schema.' } };
        } catch (error) {
          return { ok: false as const, error: toError(error) };
        }
      });
    },

    start(input, onEvent) {
      const jobId = input.jobId ?? newJobId();
      let finished = false;
      let acked = false;
      let resolveDone: (end: TestEnd) => void = () => undefined;
      const done = new Promise<TestEnd>((resolve) => {
        resolveDone = resolve;
      });
      const finish = (end: TestEnd) => {
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
          const uncorrelated =
            message.job_id === undefined && !acked && isDiscoveryError(message) && CONJECTURE_ERROR_CODES.includes(message.code ?? '');
          const mine = message.job_id === jobId || uncorrelated;
          if (mine) finish({ kind: 'error', error: fromKernelError(message) });
          return;
        }
        if (!isConjectureMessage(message) || !('job_id' in message) || message.job_id !== jobId) return;
        switch (message.type) {
          case 'discovery_conjecture_started':
            acked = true;
            clearTimeout(ackTimer);
            onEvent({ kind: 'started' });
            return;
          case 'discovery_conjecture_progress':
            acked = true;
            clearTimeout(ackTimer);
            onEvent({ kind: 'progress', fraction: message.fraction, message: message.message, circuitIndex: message.circuit_index });
            return;
          case 'discovery_conjecture_evidence':
            acked = true;
            onEvent({ kind: 'evidence', item: message.item });
            return;
          case 'discovery_conjecture_result':
            finish({ kind: 'result', status: message.status, result: message.result ?? null });
            return;
          default:
            return;
        }
      });
      const offClose = session.onClose(() => finish({ kind: 'disconnected' }));
      const ackTimer = setTimeout(() => {
        if (acked) return;
        finish({ kind: 'error', error: { code: 'timeout', message: `Kernel did not acknowledge the test within ${opts.ackTimeoutMs} ms` } });
      }, opts.ackTimeoutMs);

      try {
        void Promise.resolve(
          session.send({ type: 'discovery_conjecture_test', job_id: jobId, conjecture: input.conjecture, seed: input.seed }),
        ).catch((error: unknown) => finish({ kind: 'error', error: toError(error) }));
      } catch (error) {
        finish({ kind: 'error', error: toError(error) });
      }

      return {
        jobId,
        done,
        async cancel() {
          if (finished) return false;
          try {
            const out = await enqueue(() =>
              request(
                session,
                { type: 'discovery_conjecture_cancel', job_id: jobId },
                (m): m is Extract<ConjectureResponse, { type: 'discovery_conjecture_cancelled' }> =>
                  m.type === 'discovery_conjecture_cancelled' && m.job_id === jobId,
                { timeoutMs: opts.cancelTimeoutMs, matchError: (e) => e.job_id === jobId },
              ),
            );
            return out.ok ? out.value.accepted : false;
          } catch {
            return false;
          }
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
