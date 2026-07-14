import type { JobHandle } from '../types/hardware';

/** A job still occupying the queue/runner — a fresh submission to the same
 * backend would just fabricate a duplicate. */
export function isJobActive(job: JobHandle): boolean {
  return job.status === 'queued' || job.status === 'running';
}

/** True when there's already an in-flight job for `backend`. Used to stop
 * "Run on Hardware" from queuing duplicate jobs on repeated clicks. */
export function hasActiveJobForBackend(jobs: readonly JobHandle[], backend: string | null): boolean {
  if (!backend) return false;
  return jobs.some((job) => job.backend === backend && isJobActive(job));
}
