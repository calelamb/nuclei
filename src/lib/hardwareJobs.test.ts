import { describe, it, expect } from 'vitest';
import { hasActiveJobForBackend, isJobActive } from './hardwareJobs';
import type { JobHandle } from '../types/hardware';

function job(backend: string, status: JobHandle['status']): JobHandle {
  return { id: `${backend}-${status}`, provider: 'ibm', backend, submittedAt: '', status, queuePosition: null, shots: 1024 };
}

describe('hardwareJobs', () => {
  it('isJobActive is true only for queued/running', () => {
    expect(isJobActive(job('a', 'queued'))).toBe(true);
    expect(isJobActive(job('a', 'running'))).toBe(true);
    expect(isJobActive(job('a', 'complete'))).toBe(false);
    expect(isJobActive(job('a', 'failed'))).toBe(false);
    expect(isJobActive(job('a', 'stale'))).toBe(false);
    expect(isJobActive(job('a', 'unknown'))).toBe(false);
  });

  it('detects an in-flight job for the selected backend (the double-submit guard)', () => {
    const jobs = [job('ibm_kyoto', 'queued'), job('ibm_osaka', 'complete')];
    expect(hasActiveJobForBackend(jobs, 'ibm_kyoto')).toBe(true); // queued → block
    expect(hasActiveJobForBackend(jobs, 'ibm_osaka')).toBe(false); // completed → allow
    expect(hasActiveJobForBackend(jobs, 'ibm_sherbrooke')).toBe(false); // no job → allow
    expect(hasActiveJobForBackend(jobs, null)).toBe(false);
    expect(hasActiveJobForBackend([], 'ibm_kyoto')).toBe(false);
  });
});
