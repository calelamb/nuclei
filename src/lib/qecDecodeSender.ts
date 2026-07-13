/**
 * PRD 10 Phase D — module-level bridge for the detector graph's "Sample a
 * shot" action. `useKernel` registers a sender (it owns the WebSocket);
 * the DetectorGraphPanel, deep in the tree, calls `requestQecDecodeSample`
 * without threading the socket through props. Mirrors App's `getExecute()`.
 */
export type QecDecodeSender = (circuitText: string, decoder: string, seed: number) => void;

let sender: QecDecodeSender | null = null;

export function setQecDecodeSender(next: QecDecodeSender | null): void {
  sender = next;
}

/** Request one decoded shot. Returns the seed used (so the caller can label
 * the overlay), or null when no kernel sender is registered. */
export function requestQecDecodeSample(
  circuitText: string,
  decoder = 'pymatching',
  seed?: number,
): number | null {
  if (!sender) return null;
  // A varying seed each click surfaces different syndromes; deterministic
  // per-seed on the kernel side (fixture-tested).
  const usedSeed = seed ?? Math.floor(Date.now() % 1_000_000_007);
  sender(circuitText, decoder, usedSeed);
  return usedSeed;
}

/** Re-request the qec_snapshot at a higher DEM edge cap — the detector
 * graph's "Render anyway" when the default 5,000-edge cap truncated it. */
export type QecSnapshotSender = (maxEdges: number) => void;

let snapshotSender: QecSnapshotSender | null = null;

export function setQecSnapshotSender(next: QecSnapshotSender | null): void {
  snapshotSender = next;
}

export function requestQecSnapshot(maxEdges: number): void {
  snapshotSender?.(maxEdges);
}

/** Request a resource estimate for the given source (PRD 10 Phase F). */
export type QecEstimateLanguage = 'qsharp' | 'qasm3' | 'qiskit';

export type QecEstimateSender = (
  code: string,
  language: QecEstimateLanguage,
  options?: Record<string, unknown>,
) => void;

let estimateSender: QecEstimateSender | null = null;

export function setQecEstimateSender(next: QecEstimateSender | null): void {
  estimateSender = next;
}

export function requestQecEstimate(
  code: string,
  language: QecEstimateLanguage,
  options?: Record<string, unknown>,
): boolean {
  if (!estimateSender) return false;
  estimateSender(code, language, options);
  return true;
}
