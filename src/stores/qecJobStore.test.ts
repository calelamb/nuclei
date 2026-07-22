import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImportJobEvent, ImportStartInput } from '../types/qecDataProtocol';
import { useQecJobStore, type QecJobClient } from './qecJobStore';

const INPUT: ImportStartInput = {
  source: 'captures/run.csv', adapterId: 'sinter-csv', mapping: { fields: {}, options: {} },
  sessionId: 'session-1', sessionKind: 'hardware_import',
};

beforeEach(() => useQecJobStore.getState().reset());

describe('useQecJobStore', () => {
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
    useQecJobStore.getState().openImport('captures/run.csv');

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
    useQecJobStore.getState().openImport('capture.csv');
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
});
