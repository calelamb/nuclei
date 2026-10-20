import { useQecExplainStore } from '../stores/qecExplainStore';
import { parseQecExplainData } from '../types/qecExplain';

/**
 * The kernel socket closes any message over 1 MiB (kernel/server.py
 * MAX_MESSAGE_SIZE), which would strand the panel on "Analysing…". Mirror the
 * handler's byte cap (kernel/qec/explain_handler.py MAX_CIRCUIT_BYTES).
 */
export const MAX_EXPLAIN_BYTES = 1_000_000;

/** A visible message when the circuit cannot be sent, else null. */
export function explainSizeError(circuitText: string): string | null {
  const bytes = new TextEncoder().encode(circuitText).length;
  if (bytes <= MAX_EXPLAIN_BYTES) return null;
  return `This circuit is ${bytes.toLocaleString()} bytes, too large to explain (limit ${MAX_EXPLAIN_BYTES.toLocaleString()}).`;
}

/** `qec_explain_result` → store. A malformed payload becomes a visible error. */
export function applyQecExplainResult(raw: unknown, requestId?: string | null): void {
  const parsed = parseQecExplainData(raw);
  const store = useQecExplainStore.getState();
  if (parsed.ok) store.setResult(parsed.data, requestId);
  else store.setError(parsed.error, requestId);
}

/** `error` with phase `qec_explain` → the panel (never swallowed, never the terminal). */
export function applyQecExplainError(message: string, requestId?: string | null): void {
  useQecExplainStore.getState().setError(message, requestId);
}
