/**
 * Module-level bridge for the Circuit Explain panel. `useKernel` registers a
 * sender (it owns the WebSocket); the panel calls `requestQecExplain` without
 * the socket threaded through props. Mirrors qecDecodeSender.
 */
export type QecExplainAnalysis = 'both' | 'nondeterministic' | 'min_weight';
export type QecExplainSender = (circuitText: string, analysis: QecExplainAnalysis) => void;

let sender: QecExplainSender | null = null;

export function setQecExplainSender(next: QecExplainSender | null): void {
  sender = next;
}

/** Returns false when no kernel sender is registered (web build / not mounted). */
export function requestQecExplain(circuitText: string, analysis: QecExplainAnalysis = 'both'): boolean {
  if (!sender) return false;
  sender(circuitText, analysis);
  return true;
}
