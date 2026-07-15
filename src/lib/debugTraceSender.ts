/**
 * Dev tools Phase 3 — module-level bridge for the Quantum Debugger.
 *
 * `useKernel` registers a sender (it owns the WebSocket); the step-mode effect
 * calls `requestDebugTrace(code)` to fetch the trajectory. Mirrors
 * `transpileSender` / `qecDecodeSender`.
 */
export type DebugTraceSender = (code: string) => void;

let sender: DebugTraceSender | null = null;

export function setDebugTraceSender(next: DebugTraceSender | null): void {
  sender = next;
}

/** Request the per-gate state trajectory for `code`. Returns false when no
 * kernel sender is registered (web build / socket closed). */
export function requestDebugTrace(code: string): boolean {
  if (!sender) return false;
  sender(code);
  return true;
}
