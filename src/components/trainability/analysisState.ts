import type { TrainabilityAnalysis, TrainabilityJobRecord, TrainabilityResults } from '../../types/trainability';

export type AnalysisView<K extends TrainabilityAnalysis> =
  | { kind: 'empty' }
  | { kind: 'skipped' }
  | { kind: 'loading'; fraction: number | null; message: string | null }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'ready'; data: NonNullable<TrainabilityResults[K]>; running: boolean };

/** What a tab should render for one analysis of a job (pure; unit-testable). */
export function analysisView<K extends TrainabilityAnalysis>(
  job: TrainabilityJobRecord | null,
  analysis: K,
): AnalysisView<K> {
  if (!job) return { kind: 'empty' };
  const data = job.results[analysis] as TrainabilityResults[K];
  const running = job.status === 'starting' || job.status === 'running' || job.status === 'cancelling';
  if (data) return { kind: 'ready', data: data as NonNullable<TrainabilityResults[K]>, running };
  const analysisError = job.errors[analysis];
  if (analysisError) return { kind: 'error', code: analysisError.code, message: analysisError.message };
  if (!job.analyses.includes(analysis)) return { kind: 'skipped' };
  if (job.error) return { kind: 'error', code: job.error.code, message: job.error.message };
  if (running) {
    const progress = job.progress[analysis];
    return { kind: 'loading', fraction: progress?.fraction ?? null, message: progress?.message ?? null };
  }
  if (job.status === 'cancelled') return { kind: 'error', code: 'cancelled', message: 'The job was cancelled before this analysis finished.' };
  return { kind: 'error', code: 'missing', message: 'The kernel finished without returning this analysis.' };
}
