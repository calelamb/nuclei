/**
 * Dev tools Phase 1 — module-level bridge for the Transpiler Explorer.
 *
 * `useKernel` registers a sender (it owns the WebSocket); the explorer's
 * controls call `requestTranspile` without threading the socket through props.
 * Mirrors `qecDecodeSender` / App's `getExecute()`.
 */
export interface TranspileTarget {
  /** Restrict the output to these basis gates. Omit / null for no constraint
   * (the all-to-all simulator target). */
  basisGates?: string[] | null;
  /** Device connectivity as directed edges. Omit / null for all-to-all. */
  couplingMap?: Array<[number, number]> | null;
  optimizationLevel: 0 | 1 | 2 | 3;
}

export type TranspileSender = (code: string, target: TranspileTarget) => void;

let sender: TranspileSender | null = null;

export function setTranspileSender(next: TranspileSender | null): void {
  sender = next;
}

/** Request a transpile. Returns false when no kernel sender is registered
 * (web build / socket closed) so the caller can surface it instead of
 * spinning on `pending` forever. */
export function requestTranspile(code: string, target: TranspileTarget): boolean {
  if (!sender) return false;
  sender(code, target);
  return true;
}
