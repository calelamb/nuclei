import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImportJobEvent } from '../types/qecDataProtocol';
import { useQecJobStore, type QecImportJobInput, type QecJobClient } from './qecJobStore';

const INPUT: QecImportJobInput = {
  source: 'captures/run.csv', adapterId: 'sinter-csv', mapping: { fields: {}, options: {} },
  sessionId: 'session-1', sessionKind: 'hardware_import',
  sourceHash: null, provenanceId: null, sourceByteSize: null,
};

beforeEach(() => {
  useQecJobStore.getState().reset();
  useQecJobStore.getState().setProjectScope('/project');
});

describe('useQecJobStore', () => {
  it('invalidates old-project sources, jobs, and late import callbacks', async () => {
    let emit: ((event: ImportJobEvent) => void) | undefined;
    let finish: ((event: Extract<ImportJobEvent, { type: 'job_complete' }>) => void) | undefined;
    const client: QecJobClient = {
      startImport: vi.fn((_input, onEvent) => {
        emit = onEvent;
        onEvent({ type: 'job_started', requestId: 'old', jobId: 'old', jobKind: 'import', sourcePolicy: 'copy' });
        return new Promise((resolve) => { finish = resolve; });
      }),
      cancel: vi.fn(async () => true),
    };
    useQecJobStore.getState().openImport('/project', 'captures/run.csv');
    const oldImport = useQecJobStore.getState().runImport(client, INPUT);

    expect(useQecJobStore.getState().activeOperationIds()).toEqual(['old']);
    const oldEpoch = useQecJobStore.getState().scopeEpoch;
    useQecJobStore.getState().setProjectScope('/replacement');
    emit?.({ type: 'job_complete', requestId: 'old', jobId: 'old', recordsWritten: 4, partitionsWritten: 1, sourcePolicy: 'copy' });
    finish?.({ type: 'job_complete', requestId: 'old', jobId: 'old', recordsWritten: 4, partitionsWritten: 1, sourcePolicy: 'copy' });
    await oldImport;

    expect(useQecJobStore.getState()).toMatchObject({
      projectRoot: '/replacement', importSource: null, activeJobId: null, jobs: {}, launching: false,
    });
    expect(useQecJobStore.getState().scopeEpoch).toBeGreaterThan(oldEpoch);
  });

  it('keeps the selected import source durable across job events', async () => {
    let emit: ((event: ImportJobEvent) => void) | undefined;
    const client: QecJobClient = {
      startImport: vi.fn(async (_input, onEvent) => {
        emit = onEvent;
        onEvent({
          type: 'job_started', requestId: 'import-1', jobId: 'import-1',
          jobKind: 'import', sourcePolicy: 'copy',
        });
        return {
          type: 'job_complete', requestId: 'import-1', jobId: 'import-1',
          recordsWritten: 12, partitionsWritten: 2, sourcePolicy: 'copy',
        };
      }),
      cancel: vi.fn(async () => true),
    };
    useQecJobStore.getState().openImport('/project', 'captures/run.csv');

    await useQecJobStore.getState().runImport(client, INPUT);
    emit?.({
      type: 'job_complete', requestId: 'import-1', jobId: 'import-1', recordsWritten: 12,
      partitionsWritten: 2, sourcePolicy: 'copy',
    });

    expect(useQecJobStore.getState()).toMatchObject({
      importSource: 'captures/run.csv', activeJobId: 'import-1',
      jobs: { 'import-1': { status: 'complete', recordsWritten: 12 } },
    });
  });

  it('cancels imports with job_cancel and queries with query_cancel', async () => {
    const cancel = vi.fn(async () => true);
    const client: QecJobClient = { startImport: vi.fn(), cancel };
    useQecJobStore.setState({
      jobs: {
        import: { id: 'import', kind: 'import', status: 'running', message: 'Importing' },
        query: { id: 'query', kind: 'query', status: 'running', message: 'Querying' },
      },
    });

    await useQecJobStore.getState().cancelJob(client, 'import');
    await useQecJobStore.getState().cancelJob(client, 'query');

    expect(cancel).toHaveBeenNthCalledWith(1, 'import', 'import');
    expect(cancel).toHaveBeenNthCalledWith(2, 'query', 'query');
  });

  it('records launch and cancellation failures without losing durable source state', async () => {
    const client: QecJobClient = {
      startImport: vi.fn(async (_input, onEvent) => {
        onEvent({ type: 'job_started', requestId: 'failed', jobId: 'failed', jobKind: 'import', sourcePolicy: 'copy' });
        throw new Error('import failed');
      }),
      cancel: vi.fn(async () => { throw new Error('cancel failed'); }),
    };
    useQecJobStore.getState().openImport('/project', 'capture.csv');
    await expect(useQecJobStore.getState().runImport(client, INPUT)).resolves.toBeNull();
    expect(useQecJobStore.getState()).toMatchObject({
      importSource: 'capture.csv', launchError: 'import failed',
      jobs: { failed: { status: 'failed', error: 'import failed' } },
    });

    useQecJobStore.setState({ jobs: { query: { id: 'query', kind: 'query', status: 'running', message: 'Querying' } } });
    await useQecJobStore.getState().cancelJob(client, 'query');
    expect(useQecJobStore.getState().jobs.query).toMatchObject({ status: 'failed', error: 'cancel failed' });
    await useQecJobStore.getState().cancelJob(client, 'missing');
  });

  it('restores running state when the engine cannot cancel a job', async () => {
    const client: QecJobClient = { startImport: vi.fn(), cancel: vi.fn(async () => false) };
    useQecJobStore.setState({ jobs: { import: { id: 'import', kind: 'import', status: 'running', message: 'Running' } } });
    await useQecJobStore.getState().cancelJob(client, 'import');
    expect(useQecJobStore.getState().jobs.import).toMatchObject({ status: 'running', message: 'Could not cancel' });
    useQecJobStore.getState().closeImport();
    expect(useQecJobStore.getState().importSource).toBeNull();
  });

  it('does not overwrite terminal completion when cancellation resolves late', async () => {
    let finishCancel: ((value: boolean) => void) | undefined;
    const client: QecJobClient = {
      startImport: vi.fn(),
      cancel: vi.fn(() => new Promise<boolean>((resolve) => { finishCancel = resolve; })),
    };
    useQecJobStore.setState({
      jobs: { import: { id: 'import', kind: 'import', status: 'running', message: 'Running', source: 'capture.csv', adapterId: 'tabular', sessionId: 's', sessionKind: 'hardware_import', sourceHash: null, provenanceId: null, sourceByteSize: null } },
    });
    const cancelling = useQecJobStore.getState().cancelJob(client, 'import');
    useQecJobStore.setState((state) => ({ jobs: { ...state.jobs, import: { ...state.jobs.import, status: 'complete' } } }));
    finishCancel?.(true);
    await cancelling;
    expect(useQecJobStore.getState().jobs.import.status).toBe('complete');
  });

  it('persists scientific source and destination context on durable jobs', async () => {
    const client: QecJobClient = {
      startImport: vi.fn(async (_input, onEvent) => {
        onEvent({ type: 'job_started', requestId: 'context', jobId: 'context', jobKind: 'import', sourcePolicy: 'copy' });
        return { type: 'job_complete', requestId: 'context', jobId: 'context', recordsWritten: 2, partitionsWritten: 1, sourcePolicy: 'copy' };
      }),
      cancel: vi.fn(),
    };
    await useQecJobStore.getState().runImport(client, {
      ...INPUT, sourceHash: 'a'.repeat(64), provenanceId: 'prov-1', sourceByteSize: 2048,
    });
    expect(useQecJobStore.getState().jobs.context).toMatchObject({
      source: 'captures/run.csv', adapterId: 'sinter-csv', sessionId: 'session-1',
      sourceHash: 'a'.repeat(64), provenanceId: 'prov-1', sourceByteSize: 2048,
    });
  });

  it('attributes an import failure to its own job when another source becomes active', async () => {
    let rejectFirst: ((error: unknown) => void) | undefined;
    let finishSecond: ((value: ImportJobEvent & { type: 'job_complete' }) => void) | undefined;
    const firstClient: QecJobClient = {
      startImport: vi.fn((_input, onEvent) => {
        onEvent({ type: 'job_started', requestId: 'first', jobId: 'first', jobKind: 'import', sourcePolicy: 'copy' });
        return new Promise((_, reject) => { rejectFirst = reject; });
      }), cancel: vi.fn(),
    };
    const secondClient: QecJobClient = {
      startImport: vi.fn((_input, onEvent) => {
        onEvent({ type: 'job_started', requestId: 'second', jobId: 'second', jobKind: 'import', sourcePolicy: 'copy' });
        return new Promise((resolve) => { finishSecond = resolve; });
      }), cancel: vi.fn(),
    };
    const first = useQecJobStore.getState().runImport(firstClient, INPUT);
    const second = useQecJobStore.getState().runImport(secondClient, { ...INPUT, source: 'captures/second.csv' });
    rejectFirst?.(new Error('first failed'));
    await first;
    expect(useQecJobStore.getState().jobs).toMatchObject({ first: { status: 'failed' }, second: { status: 'running' } });
    finishSecond?.({ type: 'job_complete', requestId: 'second', jobId: 'second', recordsWritten: 1, partitionsWritten: 1, sourcePolicy: 'copy' });
    await second;
  });
});
