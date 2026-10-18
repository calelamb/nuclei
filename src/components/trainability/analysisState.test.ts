import { describe, expect, it } from 'vitest';
import { analysisView } from './analysisState';
import { jobFixture } from '../../services/trainability/fixtures';

describe('analysisView', () => {
  it('is empty without a job', () => {
    expect(analysisView(null, 'gradients')).toEqual({ kind: 'empty' });
  });

  it('is ready when the result exists, flagging a still-running job', () => {
    const view = analysisView(jobFixture({ status: 'running' }), 'lie');
    expect(view).toMatchObject({ kind: 'ready', running: true });
  });

  it('is loading with progress while the analysis is pending', () => {
    const job = jobFixture({ status: 'running', results: {}, progress: { scaling: { fraction: 0.25, message: 'n = 4' } } });
    expect(analysisView(job, 'scaling')).toEqual({ kind: 'loading', fraction: 0.25, message: 'n = 4' });
    expect(analysisView(job, 'lie')).toEqual({ kind: 'loading', fraction: null, message: null });
  });

  it('is skipped for analyses that were not requested', () => {
    const job = jobFixture({ analyses: ['gradients'], results: {}, status: 'complete' });
    expect(analysisView(job, 'landscape')).toEqual({ kind: 'skipped' });
  });

  it('prefers the per-analysis error, then the job error', () => {
    const job = jobFixture({ results: {}, errors: { lie: { code: 'x', message: 'lie failed' } }, status: 'complete' });
    expect(analysisView(job, 'lie')).toEqual({ kind: 'error', code: 'x', message: 'lie failed' });
    const failed = jobFixture({ results: {}, status: 'failed', error: { code: 'disconnected', message: 'gone' } });
    expect(analysisView(failed, 'gradients')).toEqual({ kind: 'error', code: 'disconnected', message: 'gone' });
  });

  it('explains cancelled and silently missing analyses', () => {
    expect(analysisView(jobFixture({ results: {}, status: 'cancelled' }), 'gradients')).toMatchObject({ kind: 'error', code: 'cancelled' });
    expect(analysisView(jobFixture({ results: {}, status: 'complete' }), 'gradients')).toMatchObject({ kind: 'error', code: 'missing' });
  });
});
