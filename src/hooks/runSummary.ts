import { installNote } from '../components/layout/kernelStatusModel';
import type { SimulationResult } from '../types/quantum';

export const SAMPLE_LABEL = 'Nuclei sample';
export const SAMPLE_EXPLAINER = "Nuclei draws its own sample of the circuit's final state (shot count is in Settings). Counts your code prints come from its own sampler and can differ.";

/** One dim Terminal line closing a run: "Done · 2 qubits · Nuclei sample · 1,024 shots · 2 ms". */
export function runSummary(result: SimulationResult, installMs?: number | null): string {
  const qubits = result.bloch_coords.length;
  const parts = ['Done'];
  if (qubits > 0) parts.push(`${qubits} ${qubits === 1 ? 'qubit' : 'qubits'}`);
  // These shots are the app's own sample of the final state, never the code's sampler (shots= in the user's code is separate).
  if (result.shot_count > 0) parts.push(`${SAMPLE_LABEL} · ${result.shot_count.toLocaleString('en-US')} ${result.shot_count === 1 ? 'shot' : 'shots'}`);
  parts.push(`${Math.max(0, Math.round(result.execution_time_ms))} ms${installNote(installMs)}`);
  return parts.join(' · ');
}
