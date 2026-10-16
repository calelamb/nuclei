import { useQecExplainStore } from '../stores/qecExplainStore';
import { parseQecExplainData } from '../types/qecExplain';

/** `qec_explain_result` → store. A malformed payload becomes a visible error. */
export function applyQecExplainResult(raw: unknown): void {
  const parsed = parseQecExplainData(raw);
  const store = useQecExplainStore.getState();
  if (parsed.ok) store.setResult(parsed.data);
  else store.setError(parsed.error);
}

/** `error` with phase `qec_explain` → the panel (never swallowed, never the terminal). */
export function applyQecExplainError(message: string): void {
  useQecExplainStore.getState().setError(message);
}
