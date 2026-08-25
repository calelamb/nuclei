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
  projectRoot?: string;
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
  projectRoot: string | null;
  scopeEpoch: number;
  importSource: string | null;
  importReturnFocusId: string | null;
  activeJobId: string | null;
  launching: boolean;
  launchError: string | null;
  jobs: Readonly<Record<string, QecJobRecord>>;
  openImport(projectRoot: string, source: string, returnFocusId?: string): void;
  closeImport(): void;
  runImport(client: QecJobClient, input: QecImportJobInput): Promise<ImportJobComplete | null>;
  cancelJob(client: QecJobClient, jobId: string): Promise<void>;
  activeOperationIds(): readonly string[];
  setProjectScope(projectRoot: string | null): void;
  reset(): void;
}

const EMPTY_JOBS: Readonly<Record<string, QecJobRecord>> = Object.freeze({});

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'QEC job failed.';
}

interface ProjectOwner {
  projectRoot: string;
  scopeEpoch: number;
}

function ownsProject(state: Pick<QecJobState, 'projectRoot' | 'scopeEpoch'>, owner: ProjectOwner): boolean {
  return state.projectRoot === owner.projectRoot && state.scopeEpoch === owner.scopeEpoch;
}

function mergeJob(jobId: string, owner: ProjectOwner, update: (job: QecJobRecord) => QecJobRecord): void {
  useQecJobStore.setState((state) => {
    if (!ownsProject(state, owner)) return state;
    const current = state.jobs[jobId];
    if (!current) return state;
    return { jobs: Object.freeze({ ...state.jobs, [jobId]: update(current) }) };
  });
}

function applyImportEvent(event: ImportJobEvent, input: QecImportJobInput, owner: ProjectOwner): void {
  if (event.type === 'job_started') {
    const job: QecJobRecord = {
      id: event.jobId, kind: 'import', status: 'running', message: 'Import running',
      source: input.source, adapterId: input.adapterId, sessionId: input.sessionId,
      sessionKind: input.sessionKind, sourceHash: input.sourceHash,
      provenanceId: input.provenanceId, sourceByteSize: input.sourceByteSize,
      projectRoot: owner.projectRoot,
    };
    useQecJobStore.setState((state) => ownsProject(state, owner) ? ({
      activeJobId: event.jobId,
      jobs: Object.freeze({ ...state.jobs, [event.jobId]: job }),
    }) : state);
    return;
  }
  mergeJob(event.jobId, owner, (job) => ({
    ...job, status: 'complete', message: 'Import complete',
    recordsWritten: event.recordsWritten, partitionsWritten: event.partitionsWritten,
  }));
}

async function runImport(
  client: QecJobClient,
  input: QecImportJobInput,
): Promise<ImportJobComplete | null> {
  const current = useQecJobStore.getState();
  if (!current.projectRoot) {
    useQecJobStore.setState({ launchError: 'Open a project before importing QEC data.' });
    return null;
  }
  const owner: ProjectOwner = { projectRoot: current.projectRoot, scopeEpoch: current.scopeEpoch };
  useQecJobStore.setState((state) => ownsProject(state, owner)
    ? { launching: true, launchError: null }
    : state);
  let ownedJobId: string | null = null;
  const onEvent = (event: ImportJobEvent): void => {
    if (event.type === 'job_started') ownedJobId = event.jobId;
    applyImportEvent(event, input, owner);
  };
  try {
    const result = await client.startImport(input, onEvent);
    applyImportEvent(result, input, owner);
    useQecJobStore.setState((state) => ownsProject(state, owner) ? { launching: false } : state);
    return result;
  } catch (error: unknown) {
    if (ownedJobId) {
      mergeJob(ownedJobId, owner, (job) => {
        if (['cancelled', 'complete'].includes(job.status)) return job;
        const cancelled = error instanceof Error && 'code' in error && error.code === 'request_cancelled';
        return { ...job, status: cancelled ? 'cancelled' : 'failed', message: cancelled ? 'Cancelled' : 'Import failed', error: cancelled ? undefined : messageFor(error) };
      });
    }
    const cancelled = error instanceof Error && 'code' in error && error.code === 'request_cancelled';
    useQecJobStore.setState((state) => ownsProject(state, owner)
      ? { launching: false, launchError: cancelled ? null : messageFor(error) }
      : state);
    return null;
  }
}

async function cancelJob(client: QecJobClient, jobId: string): Promise<void> {
  const state = useQecJobStore.getState();
  const job = state.jobs[jobId];
  if (!job || !['running', 'starting'].includes(job.status)) return;
  if (!state.projectRoot || (job.projectRoot && job.projectRoot !== state.projectRoot)) return;
  const owner: ProjectOwner = { projectRoot: state.projectRoot, scopeEpoch: state.scopeEpoch };
  mergeJob(jobId, owner, (current) => ({ ...current, status: 'cancelling', message: 'Cancelling' }));
  try {
    const cancelled = await client.cancel(job.kind, job.id);
    mergeJob(jobId, owner, (current) => ({
      ...current,
      ...(current.status === 'cancelling' ? {
        status: cancelled ? 'cancelled' as const : 'running' as const,
        message: cancelled ? 'Cancelled' : 'Could not cancel',
      } : {}),
    }));
  } catch (error: unknown) {
    mergeJob(jobId, owner, (current) => current.status === 'cancelling'
      ? { ...current, status: 'failed', message: 'Cancellation failed', error: messageFor(error) }
      : current);
  }
}

export const useQecJobStore = create<QecJobState>()(() => ({
  projectRoot: null,
  scopeEpoch: 0,
  importSource: null,
  importReturnFocusId: null,
  activeJobId: null,
  launching: false,
  launchError: null,
  jobs: EMPTY_JOBS,
  openImport: (projectRoot, importSource, importReturnFocusId = '') => useQecJobStore.setState((state) => (
    state.projectRoot === projectRoot
      ? { importSource, importReturnFocusId, launchError: null }
      : state
  )),
  closeImport: () => useQecJobStore.setState({ importSource: null, importReturnFocusId: null }),
  runImport,
  cancelJob,
  activeOperationIds: (): readonly string[] => {
    const state = useQecJobStore.getState();
    return Object.freeze(Object.values(state.jobs)
      .filter((job) => job.kind === 'import'
        && (!job.projectRoot || job.projectRoot === state.projectRoot)
        && ['starting', 'running', 'cancelling'].includes(job.status))
      .map((job) => job.id));
  },
  setProjectScope: (projectRoot) => useQecJobStore.setState((state) => state.projectRoot === projectRoot
    ? state
    : {
      projectRoot,
      scopeEpoch: state.scopeEpoch + 1,
      importSource: null,
      importReturnFocusId: null,
      activeJobId: null,
      launching: false,
      launchError: null,
      jobs: EMPTY_JOBS,
    }),
  reset: () => useQecJobStore.setState((state) => ({
    projectRoot: null, scopeEpoch: state.scopeEpoch + 1,
    importSource: null, importReturnFocusId: null, activeJobId: null, launching: false, launchError: null, jobs: EMPTY_JOBS,
  })),
}));
