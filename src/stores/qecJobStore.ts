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
  source?: string;
  adapterId?: string;
  sessionId?: string;
  sessionKind?: ImportStartInput['sessionKind'];
  sourceHash?: string | null;
  provenanceId?: string | null;
  sourceByteSize?: number | null;
}

export interface QecImportJobInput extends ImportStartInput {
  sourceHash: string | null;
  provenanceId: string | null;
  sourceByteSize: number | null;
}

export interface QecJobClient {
  startImport(input: ImportStartInput, onEvent: (event: ImportJobEvent) => void): Promise<ImportJobComplete>;
  cancel(kind: QecJobKind, id: string): Promise<boolean>;
}

interface QecJobState {
  importSource: string | null;
  importReturnFocusId: string | null;
  activeJobId: string | null;
  launching: boolean;
  launchError: string | null;
  jobs: Readonly<Record<string, QecJobRecord>>;
  openImport(source: string, returnFocusId?: string): void;
  closeImport(): void;
  runImport(client: QecJobClient, input: QecImportJobInput): Promise<ImportJobComplete | null>;
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

function applyImportEvent(event: ImportJobEvent, input: QecImportJobInput): void {
  if (event.type === 'job_started') {
    const job: QecJobRecord = {
      id: event.jobId, kind: 'import', status: 'running', message: 'Import running',
      source: input.source, adapterId: input.adapterId, sessionId: input.sessionId,
      sessionKind: input.sessionKind, sourceHash: input.sourceHash,
      provenanceId: input.provenanceId, sourceByteSize: input.sourceByteSize,
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
  input: QecImportJobInput,
): Promise<ImportJobComplete | null> {
  useQecJobStore.setState({ launching: true, launchError: null });
  let ownedJobId: string | null = null;
  const onEvent = (event: ImportJobEvent): void => {
    if (event.type === 'job_started') ownedJobId = event.jobId;
    applyImportEvent(event, input);
  };
  try {
    const result = await client.startImport(input, onEvent);
    applyImportEvent(result, input);
    useQecJobStore.setState({ launching: false });
    return result;
  } catch (error: unknown) {
    if (ownedJobId) {
      mergeJob(ownedJobId, (job) => {
        if (['cancelled', 'complete'].includes(job.status)) return job;
        const cancelled = error instanceof Error && 'code' in error && error.code === 'request_cancelled';
        return { ...job, status: cancelled ? 'cancelled' : 'failed', message: cancelled ? 'Cancelled' : 'Import failed', error: cancelled ? undefined : messageFor(error) };
      });
    }
    const cancelled = error instanceof Error && 'code' in error && error.code === 'request_cancelled';
    useQecJobStore.setState({ launching: false, launchError: cancelled ? null : messageFor(error) });
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
      ...(current.status === 'cancelling' ? {
        status: cancelled ? 'cancelled' as const : 'running' as const,
        message: cancelled ? 'Cancelled' : 'Could not cancel',
      } : {}),
    }));
  } catch (error: unknown) {
    mergeJob(jobId, (current) => current.status === 'cancelling'
      ? { ...current, status: 'failed', message: 'Cancellation failed', error: messageFor(error) }
      : current);
  }
}

export const useQecJobStore = create<QecJobState>(() => ({
  importSource: null,
  importReturnFocusId: null,
  activeJobId: null,
  launching: false,
  launchError: null,
  jobs: EMPTY_JOBS,
  openImport: (importSource, importReturnFocusId = '') => useQecJobStore.setState({ importSource, importReturnFocusId, launchError: null }),
  closeImport: () => useQecJobStore.setState({ importSource: null, importReturnFocusId: null }),
  runImport,
  cancelJob,
  reset: () => useQecJobStore.setState({
    importSource: null, importReturnFocusId: null, activeJobId: null, launching: false, launchError: null, jobs: EMPTY_JOBS,
  }),
}));
