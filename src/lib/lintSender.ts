/**
 * Dev tools Phase 4 — module-level bridge for editor lint + format.
 *
 * `useKernel` registers the senders (it owns the WebSocket). Lint is
 * fire-and-forget (results arrive via `lint_result` → lintStore). Format is
 * request/response: the Monaco formatting provider awaits the formatted text,
 * so `requestFormat` returns a Promise resolved by the `format_result` dispatch.
 */
export type LintSender = (code: string) => void;
export type FormatSender = (code: string) => void;

let lintSender: LintSender | null = null;
let formatSender: FormatSender | null = null;

export function setLintSender(next: LintSender | null): void {
  lintSender = next;
}

export function setFormatSender(next: FormatSender | null): void {
  formatSender = next;
}

/** Fire-and-forget lint request; the result lands in lintStore. */
export function requestLint(code: string): void {
  lintSender?.(code);
}

// --- format request/response correlation ------------------------------------

let pendingFormat: ((formatted: string | null) => void) | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

const FORMAT_TIMEOUT_MS = 8000;

/** Request a format and resolve with the formatted text (or null if the kernel
 * isn't connected, the format failed, or it timed out — the provider then makes
 * no edit). Only one format is in flight at a time (Monaco calls on demand). */
export function requestFormat(code: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!formatSender) {
      resolve(null);
      return;
    }
    // Resolve any prior in-flight request as a no-op before starting a new one.
    resolveFormat(null);
    pendingFormat = resolve;
    pendingTimer = setTimeout(() => resolveFormat(null), FORMAT_TIMEOUT_MS);
    formatSender(code);
  });
}

/** Called by the `format_result` dispatch (and on error/timeout with null). */
export function resolveFormat(formatted: string | null): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  const resolve = pendingFormat;
  pendingFormat = null;
  resolve?.(formatted);
}
