import type { SimulationResult } from '../../types/quantum';

export type DistributionKind = 'sampled' | 'ideal';

/** Observed frequencies (count / shots) from a run, or null when it had no shots. */
export function sampledProbabilities(
  result: Pick<SimulationResult, 'measurements' | 'shot_count'>,
): Record<string, number> | null {
  const total = Object.values(result.measurements ?? {}).reduce((sum, n) => sum + n, 0);
  if (total <= 0) return null;
  return Object.fromEntries(
    Object.entries(result.measurements).map(([state, count]) => [state, count / total]),
  );
}

/** "1 qubit · depth 1", the same wording the lesson rail uses. */
export function formatCircuitMeta(qubits: number, depth: number): string {
  return `${qubits} ${qubits === 1 ? 'qubit' : 'qubits'} · depth ${depth}`;
}
