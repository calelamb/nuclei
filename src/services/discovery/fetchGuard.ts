/**
 * Abort + timeout guard for the Anthropic fetches (CR-H6). Every request gets
 * its own AbortController: it fires when the caller's signal (run stop) is
 * aborted or when the timeout elapses, whichever is first, and it stays armed
 * until the response body has been read.
 */

export const LLM_REQUEST_TIMEOUT_MS = 5 * 60_000;
export const LLM_BATCH_REQUEST_TIMEOUT_MS = 90_000;

export type GuardKind = 'aborted' | 'timeout';

export class GuardError extends Error {
  readonly kind: GuardKind;

  constructor(kind: GuardKind, message: string) {
    super(message);
    this.name = 'GuardError';
    this.kind = kind;
  }
}

export async function withGuard<T>(
  outer: AbortSignal | undefined,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (outer?.aborted) throw new GuardError('aborted', 'The request was cancelled.');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = () => controller.abort();
  outer?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    return await fn(controller.signal);
  } catch (e) {
    if (controller.signal.aborted) {
      throw timedOut
        ? new GuardError('timeout', `No answer within ${Math.round(timeoutMs / 1000)} s.`)
        : new GuardError('aborted', 'The request was cancelled.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}
