import type { TrainabilityAnalysis } from '../../types/trainability';

export const RUN_SHORTCUT_LABEL = '⌘⇧↵';

export function overallFraction(
  analyses: readonly TrainabilityAnalysis[],
  progress: Partial<Record<TrainabilityAnalysis, { fraction: number }>>,
): number | null {
  if (analyses.length === 0) return null;
  const sum = analyses.reduce((total, a) => total + Math.min(1, Math.max(0, progress[a]?.fraction ?? 0)), 0);
  return sum / analyses.length;
}


export interface RunGateInput {
  unavailable: boolean;
  running: boolean;
  chosenCount: number;
  scalingInvalid: boolean;
  inspecting: boolean;
  /** The inspection found zero free parameters (m = 0). */
  noParameters: boolean;
}

/**
 * Why "Run analyses" is disabled, in words, or null when it is enabled. A
 * disabled button with no explanation reads as broken.
 */
export function runDisabledReason(input: RunGateInput): string | null {
  if (input.unavailable) return 'The Lab cannot reach a kernel.';
  if (input.running) return null;
  if (input.noParameters) return 'This circuit has no free parameters (m = 0), so there is nothing to train and no barren-plateau risk to measure.';
  if (input.inspecting) return 'Inspecting the circuit…';
  if (input.chosenCount === 0) return 'Select at least one analysis to run.';
  if (input.scalingInvalid) return 'Fix the scaling qubit and layer lists first.';
  return null;
}
