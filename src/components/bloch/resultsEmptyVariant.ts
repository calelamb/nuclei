export type ResultsEmptyVariant = 'idle' | 'running' | 'failed' | 'no-circuit' | 'stopped';

/** What the results zone says when there is nothing to draw, from the run state alone. */
export function resultsEmptyVariant(run: { isRunning: boolean; lastRunFailed: boolean; lastRunNoCircuit: boolean; lastRunStopped?: boolean }): ResultsEmptyVariant {
  if (run.isRunning) return 'running';
  if (run.lastRunFailed) return 'failed';
  if (run.lastRunNoCircuit) return 'no-circuit';
  if (run.lastRunStopped) return 'stopped';
  return 'idle';
}
