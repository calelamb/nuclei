import type { KernelLanguage } from '../../types/quantum';

// ---------------------------------------------------------------------------
// Hardware submission port — the ONLY channel through which a job can reach
// real, paid quantum hardware. This file defines the interface plus a
// deterministic in-memory fake for tests. There is no live/socket
// implementation here; that is out of scope for this task.
// ---------------------------------------------------------------------------

export interface SubmitRequest {
  provider: string;
  backend: string;
  shots: number;
  code: string;
  language: KernelLanguage;
}

export type SubmitResult = { ok: true; jobId: string } | { ok: false; error: string };

export interface JobStatus {
  jobId: string;
  status: string;
  queuePosition?: number | null;
}

export type JobResultsOutcome =
  | { jobId: string; probabilities: Record<string, number>; raw?: unknown }
  | { error: string };

export interface SubmitPort {
  submit(req: SubmitRequest): Promise<SubmitResult>;
  status(jobId: string): Promise<JobStatus>;
  results(jobId: string): Promise<JobResultsOutcome>;
  cancel(jobId: string): Promise<boolean>;
}

interface FakeJob {
  request: SubmitRequest;
  status: string;
  queuePosition: number | null;
}

/**
 * In-memory, deterministic SubmitPort for tests. Records every submission
 * (so tests can assert exactly how many real submissions happened — the
 * core safety invariant this task exists to prove), and lets tests script a
 * job's status/results ahead of time via `setStatus`/`setResult`.
 */
export class FakeSubmitPort implements SubmitPort {
  readonly submissions: SubmitRequest[] = [];
  private readonly jobs = new Map<string, FakeJob>();
  private readonly scriptedResults = new Map<string, JobResultsOutcome>();
  private readonly idGen: () => string;

  constructor(idGen?: () => string) {
    if (idGen) {
      this.idGen = idGen;
    } else {
      let counter = 0;
      this.idGen = () => `job_${++counter}`;
    }
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    this.submissions.push(req);
    const jobId = this.idGen();
    this.jobs.set(jobId, { request: req, status: 'queued', queuePosition: 0 });
    return { ok: true, jobId };
  }

  async status(jobId: string): Promise<JobStatus> {
    const job = this.jobs.get(jobId);
    if (!job) return { jobId, status: 'unknown', queuePosition: null };
    return { jobId, status: job.status, queuePosition: job.queuePosition };
  }

  async results(jobId: string): Promise<JobResultsOutcome> {
    const scripted = this.scriptedResults.get(jobId);
    if (scripted) return scripted;

    const job = this.jobs.get(jobId);
    if (!job) return { error: `Unknown job: ${jobId}` };
    if (job.status !== 'complete') return { error: `Job ${jobId} is not complete (status: ${job.status}).` };
    return { jobId, probabilities: {} };
  }

  async cancel(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.status = 'cancelled';
    return true;
  }

  /** Test helper: script a job's status ahead of a poll. */
  setStatus(jobId: string, status: string, queuePosition: number | null = null): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = status;
      job.queuePosition = queuePosition;
    }
  }

  /** Test helper: script a job's results ahead of an analyze call. */
  setResult(jobId: string, result: JobResultsOutcome): void {
    this.scriptedResults.set(jobId, result);
  }
}
