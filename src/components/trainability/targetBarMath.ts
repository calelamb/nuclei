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

