import type { DebugStep, DebugTrace } from '../types/quantum';

/**
 * The debugger step to display for a given circuit cursor.
 *
 * `circuitStore.stepIndex` is a 0-based gate index ("gates up to here applied").
 * The trace's `steps[0]` is the initial state and `steps[k+1]` is the state
 * after gate `k`, so the state to show at cursor `stepIndex` is
 * `steps[stepIndex + 1]`. Returns null when there is no trace or the index is
 * out of range (e.g. the trace is stale relative to a just-edited circuit).
 */
export function activeDebugStep(
  trace: DebugTrace | null,
  stepIndex: number,
): DebugStep | null {
  if (!trace) return null;
  const idx = stepIndex + 1;
  if (idx < 0 || idx >= trace.steps.length) return null;
  return trace.steps[idx];
}
