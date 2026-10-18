import type { SimulationResult } from '../types/quantum';

/** One dim Terminal line closing a run: "Done · 2 qubits · 1024 shots · 2 ms". */
export function runSummary(result: SimulationResult): string {
  const qubits = result.bloch_coords.length;
  const parts = ['Done'];
  if (qubits > 0) parts.push(`${qubits} ${qubits === 1 ? 'qubit' : 'qubits'}`);
  if (result.shot_count > 0) parts.push(`${result.shot_count.toLocaleString('en-US')} ${result.shot_count === 1 ? 'shot' : 'shots'}`);
  parts.push(`${Math.max(0, Math.round(result.execution_time_ms))} ms`);
  return parts.join(' · ');
}
