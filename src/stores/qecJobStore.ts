import { create } from 'zustand';

import type {
  ImportJobComplete,
  ImportJobEvent,
  ImportStartInput,
} from '../types/qecDataProtocol';

export type QecJobKind = 'import' | 'query';
export type QecJobStatus = 'starting' | 'running' | 'cancelling' | 'cancelled' | 'complete' | 'failed';

export interface QecJobRecord {
  id: string;
  kind: QecJobKind;
  status: QecJobStatus;
  message: string;
  recordsWritten?: number;
  partitionsWritten?: number;
  error?: string;
}

export interface QecJobClient {
  startImport(input: ImportStartInput, onEvent: (event: ImportJobEvent) => void): Promise<ImportJobComplete>;
  cancel(kind: QecJobKind, id: string): Promise<boolean>;
}

interface QecJobState {
  importSource: string | null;
  activeJobId: string | null;
  launching: boolean;
  launchError: string | null;
  jobs: Readonly<Record<string, QecJobRecord>>;
  openImport(source: string): void;
  closeImport(): void;
  runImport(client: QecJobClient, input: ImportStartInput): Promise<ImportJobComplete | null>;
  cancelJob(client: QecJobClient, jobId: string): Promise<void>;
  reset(): void;
}

const EMPTY_JOBS: Readonly<Record<string, QecJobRecord>> = Object.freeze({});

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'QEC job failed.';
}

function mergeJob(jobId: string, update: (job: QecJobRecord) => QecJobRecord): void {
  useQecJobStore.setState((state) => {
    const current = state.jobs[jobId];
    if (!current) return state;
    return { jobs: Object.freeze({ ...state.jobs, [jobId]: update(current) }) };
  });
}

function applyImportEvent(event: ImportJobEvent): void {
  if (event.type === 'job_started') {
    const job: QecJobRecord = {
      id: event.jobId, kind: 'import', status: 'running', message: 'Import running',
    };
    useQecJobStore.setState((state) => ({
      activeJobId: event.jobId,
      jobs: Object.freeze({ ...state.jobs, [event.jobId]: job }),
    }));
    return;
  }
  mergeJob(event.jobId, (job) => ({
    ...job, status: 'complete', message: 'Import complete',
    recordsWritten: event.recordsWritten, partitionsWritten: event.partitionsWritten,
  }));
}

async function runImport(
  client: QecJobClient,
  input: ImportStartInput,
): Promise<ImportJobComplete | null> {
  useQecJobStore.setState({ launching: true, launchError: null });
  try {
    const result = await client.startImport(input, applyImportEvent);
    applyImportEvent(result);
    useQecJobStore.setState({ launching: false });
    return result;
  } catch (error: unknown) {
    const state = useQecJobStore.getState();
    if (state.activeJobId) {
      mergeJob(state.activeJobId, (job) => ({
        ...job, status: 'failed', message: 'Import failed', error: messageFor(error),
      }));
    }
    useQecJobStore.setState({ launching: false, launchError: messageFor(error) });
    return null;
  }
}

async function cancelJob(client: QecJobClient, jobId: string): Promise<void> {
  const job = useQecJobStore.getState().jobs[jobId];
  if (!job || !['running', 'starting'].includes(job.status)) return;
  mergeJob(jobId, (current) => ({ ...current, status: 'cancelling', message: 'Cancelling' }));
  try {
    const cancelled = await client.cancel(job.kind, job.id);
    mergeJob(jobId, (current) => ({
      ...current,
      status: cancelled ? 'cancelled' : 'running',
      message: cancelled ? 'Cancelled' : 'Could not cancel',
    }));
  } catch (error: unknown) {
    mergeJob(jobId, (current) => ({
      ...current, status: 'failed', message: 'Cancellation failed', error: messageFor(error),
    }));
  }
}

export const useQecJobStore = create<QecJobState>(() => ({
  importSource: null,
  activeJobId: null,
  launching: false,
  launchError: null,
  jobs: EMPTY_JOBS,
  openImport: (importSource) => useQecJobStore.setState({ importSource, launchError: null }),
  closeImport: () => useQecJobStore.setState({ importSource: null }),
  runImport,
  cancelJob,
  reset: () => useQecJobStore.setState({
    importSource: null, activeJobId: null, launching: false, launchError: null, jobs: EMPTY_JOBS,
  }),
}));
