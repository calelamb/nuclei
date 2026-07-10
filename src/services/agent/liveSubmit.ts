import type { KernelMessage, KernelResponse } from '../../types/quantum';
import type { KernelTransport } from './liveKernel';
import type { JobResultsOutcome, JobStatus, SubmitPort, SubmitRequest, SubmitResult } from './submitPort';

// ---------------------------------------------------------------------------
// SocketSubmitPort: the live implementation of SubmitPort, backed by the
// same kernel WebSocket the desktop UI already uses for hardware jobs (see
// useKernel.ts's `hardware_*` handling). This is the ONLY live channel a
// Dirac agent run can use to reach real, paid quantum hardware — everything
// upstream of this file (policy.ts, hardwareSubmitExecutors.ts) decides
// WHETHER to call it; this file only decides HOW to correlate the kernel's
// replies once a call is made. It never throws — every failure path
// resolves with an error-shaped result instead.
//
// Unlike SessionKernel's `agent_execute` protocol, the hardware_* wire
// messages carry no per-request correlation id:
//   - submit() is matched FIFO against the next `hardware_job_submitted` (or
//     a generic `error` while a submit is outstanding). This is acceptable
//     because an agent run only ever has one submission in flight at a time
//     (submit_hardware_job is invoked once, awaited, before the next tool
//     call) — see the small pending-submit queue below.
//   - status()/results()/cancel() ARE matched by the job_id already present
//     on their responses, so concurrent polls for different jobs are safe
//     even though submits are not.
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;

interface PendingSubmit {
  resolve: (result: SubmitResult) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

interface PendingByJob<T> {
  jobId: string;
  resolve: (value: T) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

function countsToProbabilities(counts: Record<string, number>): Record<string, number> {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0) || 1;
  const probabilities: Record<string, number> = {};
  for (const [state, count] of Object.entries(counts)) {
    probabilities[state] = count / total;
  }
  return probabilities;
}

function removeFirst<T>(list: T[], predicate: (item: T) => boolean): T | undefined {
  const index = list.findIndex(predicate);
  if (index < 0) return undefined;
  return list.splice(index, 1)[0];
}

export class SocketSubmitPort implements SubmitPort {
  private readonly transport: KernelTransport;
  private readonly timeoutMs: number;
  private readonly unsubscribe: () => void;
  private readonly pendingSubmits: PendingSubmit[] = [];
  private readonly pendingStatus: PendingByJob<JobStatus>[] = [];
  private readonly pendingResults: PendingByJob<JobResultsOutcome>[] = [];
  private readonly pendingCancel: PendingByJob<boolean>[] = [];

  constructor(transport: KernelTransport, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.unsubscribe = transport.onMessage((message) => this.handleMessage(message));
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    return new Promise((resolve) => {
      const entry: PendingSubmit = {
        resolve,
        timeoutHandle: setTimeout(() => {
          removeFirst(this.pendingSubmits, (p) => p === entry);
          resolve({ ok: false, error: 'Timed out waiting for the kernel to submit the job.' });
        }, this.timeoutMs),
      };
      this.pendingSubmits.push(entry);

      const message: KernelMessage = {
        type: 'hardware_submit',
        provider: req.provider,
        backend: req.backend,
        code: req.code,
        shots: req.shots,
        language: req.language,
      };
      this.transport.send(message);
    });
  }

  async status(jobId: string): Promise<JobStatus> {
    return new Promise((resolve) => {
      const entry: PendingByJob<JobStatus> = {
        jobId,
        resolve,
        timeoutHandle: setTimeout(() => {
          removeFirst(this.pendingStatus, (p) => p === entry);
          resolve({ jobId, status: 'unknown', queuePosition: null });
        }, this.timeoutMs),
      };
      this.pendingStatus.push(entry);

      const message: KernelMessage = { type: 'hardware_status', job_id: jobId };
      this.transport.send(message);
    });
  }

  async results(jobId: string): Promise<JobResultsOutcome> {
    return new Promise((resolve) => {
      const entry: PendingByJob<JobResultsOutcome> = {
        jobId,
        resolve,
        timeoutHandle: setTimeout(() => {
          removeFirst(this.pendingResults, (p) => p === entry);
          resolve({ error: `Timed out waiting for results for job ${jobId}.` });
        }, this.timeoutMs),
      };
      this.pendingResults.push(entry);

      const message: KernelMessage = { type: 'hardware_results', job_id: jobId };
      this.transport.send(message);
    });
  }

  async cancel(jobId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const entry: PendingByJob<boolean> = {
        jobId,
        resolve,
        timeoutHandle: setTimeout(() => {
          removeFirst(this.pendingCancel, (p) => p === entry);
          resolve(false);
        }, this.timeoutMs),
      };
      this.pendingCancel.push(entry);

      const message: KernelMessage = { type: 'hardware_cancel', job_id: jobId };
      this.transport.send(message);
    });
  }

  /** Detach from the transport. Safe to call once; further kernel messages
   * are ignored after disposal. */
  dispose(): void {
    this.unsubscribe();
  }

  private settleSubmit(result: SubmitResult): void {
    const entry = this.pendingSubmits.shift();
    if (!entry) return;
    clearTimeout(entry.timeoutHandle);
    entry.resolve(result);
  }

  private settleByJob<T>(list: PendingByJob<T>[], jobId: string, value: T): void {
    const entry = removeFirst(list, (p) => p.jobId === jobId);
    if (!entry) return;
    clearTimeout(entry.timeoutHandle);
    entry.resolve(value);
  }

  private handleMessage(message: unknown): void {
    if (message === null || typeof message !== 'object') return;
    const response = message as KernelResponse;

    switch (response.type) {
      case 'hardware_job_submitted':
        this.settleSubmit({ ok: true, jobId: response.job.id });
        return;

      case 'hardware_job_update':
        this.settleByJob(this.pendingStatus, response.job.id, {
          jobId: response.job.id,
          status: response.job.status,
          queuePosition: response.job.queue_position ?? null,
        });
        return;

      case 'hardware_result': {
        if (response.data.error) {
          this.settleByJob(this.pendingResults, response.job_id, { error: response.data.error });
          return;
        }
        const probabilities = countsToProbabilities(response.data.measurements ?? {});
        this.settleByJob(this.pendingResults, response.job_id, {
          jobId: response.job_id,
          probabilities,
          raw: response.data,
        });
        return;
      }

      case 'hardware_job_cancelled':
        this.settleByJob(this.pendingCancel, response.job_id, response.success);
        return;

      case 'error':
        // No job id is carried on a generic error, so it can only be
        // attributed to the oldest outstanding submit (submits are serial
        // per agent run — see the class doc comment above).
        if (this.pendingSubmits.length > 0) {
          this.settleSubmit({ ok: false, error: response.message });
        }
        return;

      default:
        return;
    }
  }
}
