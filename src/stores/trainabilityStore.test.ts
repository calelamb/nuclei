import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTrainabilityClientFactory, isTrainabilityJobActive, useTrainabilityStore } from './trainabilityStore';
import { createTrainabilityClient } from '../services/trainability/client';
import { createFakeSession, type FakeLabSession } from '../services/trainability/fakeSession';
import {
  FIXTURE_CODE,
  gradientsFixture,
  inspectionFixture,
  lintDiagnosticsFixture,
  lintSummaryFixture,
  provenanceFixture,
  resultsFixture,
} from '../services/trainability/fixtures';
import type { PlatformBridge } from '../platform/bridge';

const target = { code: FIXTURE_CODE, framework: 'qiskit' as const, filePath: '/proj/ansatz/hea.py' };
const store = () => useTrainabilityStore.getState();

let session: FakeLabSession;
let cancelAccepted = true;
let lintError: Record<string, unknown> | null = null;

function installKernel(handler?: (m: Parameters<NonNullable<Parameters<typeof createFakeSession>[0]>>[0], s: FakeLabSession) => void) {
  session = createFakeSession((message, s) => {
    if (message.type === 'trainability_inspect') s.emit({ type: 'trainability_inspected', ...inspectionFixture });
    if (message.type === 'trainability_lint') {
      if (lintError) s.emit(lintError as never);
      else s.emit({ type: 'trainability_lint_result', diagnostics: lintDiagnosticsFixture, summary: lintSummaryFixture });
    }
    if (message.type === 'trainability_start') s.emit({ type: 'trainability_started', job_id: message.job_id });
    if (message.type === 'trainability_cancel') s.emit({ type: 'trainability_cancelled', job_id: message.job_id, accepted: cancelAccepted });
    handler?.(message, s);
  });
  setTrainabilityClientFactory(async () => createTrainabilityClient(session));
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  store().reset();
  cancelAccepted = true;
  lintError = null;
  installKernel();
});

afterEach(() => {
  vi.useRealTimers();
  setTrainabilityClientFactory(null);
});

describe('availability', () => {
  it('shows the unavailable state on the web build and refuses to start', async () => {
    store().setPlatform('web');
    expect(store().unavailable?.reason).toBe('web_build');
    expect(await store().start(target)).toBeNull();
    expect(session.sent).toHaveLength(0);
  });

  it('is available on desktop', () => {
    store().setPlatform('desktop');
    expect(store().unavailable).toBeNull();
  });

  it('flags a connect failure as unavailable instead of throwing', async () => {
    setTrainabilityClientFactory(async () => {
      throw new Error('Could not connect to the kernel');
    });
    expect(await store().start(target)).toBeNull();
    expect(store().unavailable).toMatchObject({ reason: 'connect_failed', message: expect.stringContaining('Could not connect') });
  });
});

describe('inspect and lint', () => {
  it('stores the inspection and does not re-ask for unchanged code', async () => {
    const first = store().refreshInspection(target);
    await flush();
    expect((await first).status).toBe('ready');
    expect(store().inspect.data?.n_qubits).toBe(4);
    await store().refreshInspection(target);
    expect(session.sent.filter((m) => m.type === 'trainability_inspect')).toHaveLength(1);
  });

  it('keeps only the latest inspection when requests overlap', async () => {
    const stale = store().refreshInspection({ ...target, code: 'old' });
    const fresh = store().refreshInspection({ ...target, code: 'new' });
    await flush();
    await flush();
    await Promise.all([stale, fresh]);
    expect(store().inspect.codeKey).toMatch(/:10$/);
  });

  it('stores lint diagnostics and clears them', async () => {
    void store().refreshLint(target);
    await flush();
    expect(store().lint.status).toBe('ready');
    expect(store().lint.diagnostics).toHaveLength(lintDiagnosticsFixture.length);
    store().clearLint();
    expect(store().lint.status).toBe('idle');
    expect(store().lint.diagnostics).toEqual([]);
  });

  it('surfaces an observable parse error with its column', async () => {
    lintError = { type: 'error', phase: 'trainability', code: 'observable_error', message: 'Unexpected token', column: 5 };
    store().setObservable('Z0 Q1');
    void store().refreshLint(target);
    await flush();
    expect(store().lint.status).toBe('error');
    expect(store().observableError).toEqual({ message: 'Unexpected token', column: 5 });
    store().setObservable('preset:local_z');
    expect(store().observableError).toBeNull();
  });
});

describe('jobs', () => {
  async function startJob() {
    void store().refreshInspection(target);
    await flush();
    const id = await store().start(target);
    await flush();
    return id as string;
  }

  it('streams progress and partial results into the job record', async () => {
    const id = await startJob();
    expect(id).toMatch(/^trn-/);
    expect(store().jobs[id].status).toBe('running');
    expect(isTrainabilityJobActive(store())).toBe(true);

    session.emit({ type: 'trainability_progress', job_id: id, analysis: 'gradients', fraction: 0.4, message: 'sampling' });
    expect(store().jobs[id].progress.gradients).toEqual({ fraction: 0.4, message: 'sampling' });
    session.emit({ type: 'trainability_partial', job_id: id, analysis: 'gradients', result: gradientsFixture });
    expect(store().jobs[id].results.gradients).toBe(gradientsFixture);
    expect(store().jobs[id].progress.gradients?.fraction).toBe(1);
  });

  it('completes with the final results, provenance and timing', async () => {
    const id = await startJob();
    session.emit({
      type: 'trainability_result',
      job_id: id,
      status: 'complete',
      results: resultsFixture,
      errors: { landscape: { code: 'oom', message: 'too big' } },
      elapsed_ms: 900,
      provenance: provenanceFixture,
    });
    await flush();
    const job = store().jobs[id];
    expect(job.status).toBe('complete');
    expect(job.results.lie).toBe(resultsFixture.lie);
    expect(job.errors.landscape?.code).toBe('oom');
    expect(job.provenance).toBe(provenanceFixture);
    expect(job.elapsedMs).toBe(900);
    expect(store().activeJobId).toBeNull();
    expect(isTrainabilityJobActive(store())).toBe(false);
  });

  it('survives with no component mounted (state lives in the store)', async () => {
    const id = await startJob();
    // No subscribers other than the store itself: events still land.
    session.emit({ type: 'trainability_partial', job_id: id, analysis: 'lie', result: resultsFixture.lie! });
    expect(useTrainabilityStore.getState().jobs[id].results.lie).toBeDefined();
  });

  it('cancels a running job', async () => {
    const id = await startJob();
    const cancelling = store().cancel();
    expect(store().jobs[id].status).toBe('cancelling');
    await flush();
    await cancelling;
    session.emit({ type: 'trainability_result', job_id: id, status: 'cancelled', results: {}, errors: {}, elapsed_ms: 5 });
    await flush();
    expect(store().jobs[id].status).toBe('cancelled');
    expect(store().activeJobId).toBeNull();
    expect(session.sent.some((m) => m.type === 'trainability_cancel')).toBe(true);
  });

  it('restores running when the kernel does not accept the cancel', async () => {
    cancelAccepted = false;
    const id = await startJob();
    const pending = store().cancel();
    await flush();
    await pending;
    expect(store().jobs[id].status).toBe('running');
  });

  it('records kernel errors and the observable column on the job', async () => {
    const id = await startJob();
    session.emit({ type: 'error', phase: 'trainability', code: 'observable_error', message: 'bad observable', job_id: id, column: 2 } as never);
    await flush();
    expect(store().jobs[id].status).toBe('failed');
    expect(store().jobs[id].error).toEqual({ code: 'observable_error', message: 'bad observable' });
    expect(store().observableError?.column).toBe(2);
  });

  it('fails the job on disconnect and reopens the session next time', async () => {
    const id = await startJob();
    session.drop();
    await flush();
    expect(store().jobs[id].status).toBe('failed');
    expect(store().jobs[id].error?.code).toBe('disconnected');
    installKernel();
    const next = await store().start(target);
    expect(next).not.toBeNull();
  });

  it('runs one job at a time and requires analyses', async () => {
    await startJob();
    expect(await store().start(target)).toBeNull();
  });

  it('does not start with invalid scaling input', async () => {
    void store().refreshInspection(target);
    await flush();
    store().setSettings({ scalingQubitsText: 'abc' });
    expect(await store().start(target)).toBeNull();
    store().toggleAnalysis('scaling');
    expect(store().effectiveAnalyses()).not.toContain('scaling');
  });

  it('keeps only the most recent jobs', async () => {
    for (let i = 0; i < 14; i += 1) {
      const id = (await startJob()) as string;
      session.emit({ type: 'trainability_result', job_id: id, status: 'complete', results: {}, errors: {}, elapsed_ms: 1 });
      await flush();
    }
    expect(store().jobOrder.length).toBe(12);
    expect(Object.keys(store().jobs)).toHaveLength(12);
  });

  it('never mutates a previous job record', async () => {
    const id = await startJob();
    const before = store().jobs[id];
    session.emit({ type: 'trainability_progress', job_id: id, analysis: 'gradients', fraction: 0.1, message: 'x' });
    expect(store().jobs[id]).not.toBe(before);
    expect(before.progress).toEqual({});
  });
});

describe('selection, reveal and export', () => {
  function bridge(overrides: Partial<PlatformBridge> = {}) {
    const files = new Map<string, string>();
    const api = {
      createDirectory: vi.fn(async (path: string) => ({ path })),
      createFileExclusive: vi.fn(async (path: string, content: string) => {
        if (files.has(path)) return 'exists' as const;
        files.set(path, content);
        return 'created' as const;
      }),
      createFile: vi.fn(),
      saveFile: vi.fn(async (path: string, content: string) => {
        files.set(path, content);
      }),
      ...overrides,
    } as unknown as PlatformBridge;
    return { api, files };
  }

  async function finishedJob() {
    void store().refreshInspection(target);
    await flush();
    const id = (await store().start(target)) as string;
    await flush();
    session.emit({ type: 'trainability_result', job_id: id, status: 'complete', results: resultsFixture, errors: {}, elapsed_ms: 10, provenance: provenanceFixture });
    await flush();
    return id;
  }

  it('writes the .trainability.json and .md under experiments/', async () => {
    await finishedJob();
    const { api, files } = bridge();
    await store().exportCertificate(api, '/proj');
    expect(store().exportState.status).toBe('saved');
    expect([...files.keys()].sort()).toEqual([
      '/proj/experiments/hea.trainability.json',
      '/proj/experiments/hea.trainability.md',
    ]);
    const json = JSON.parse(files.get('/proj/experiments/hea.trainability.json') as string);
    expect(json.schema).toBe('nuclei.trainability.certificate/1');
    expect(store().savedCertificates[0].jsonPath).toBe('/proj/experiments/hea.trainability.json');
  });

  it('replaces an existing certificate', async () => {
    await finishedJob();
    const { api, files } = bridge();
    await store().exportCertificate(api, '/proj');
    await store().exportCertificate(api, '/proj');
    expect(api.saveFile).toHaveBeenCalledTimes(2);
    expect(files.size).toBe(2);
    expect(store().savedCertificates).toHaveLength(1);
  });

  it('reports a missing project folder and write failures', async () => {
    await finishedJob();
    await store().exportCertificate(bridge().api, null);
    expect(store().exportState).toMatchObject({ status: 'error', message: expect.stringContaining('project folder') });
    const failing = bridge({ createFileExclusive: vi.fn(async () => null) } as Partial<PlatformBridge>);
    await store().exportCertificate(failing.api, '/proj');
    expect(store().exportState.status).toBe('error');
  });

  it('does nothing without a finished job', async () => {
    const { api } = bridge();
    await store().exportCertificate(api, '/proj');
    expect(api.createDirectory).not.toHaveBeenCalled();
  });

  it('issues unique reveal requests per click', () => {
    store().requestReveal(12);
    store().requestReveal(12);
    expect(store().revealRequest).toEqual({ line: 12, nonce: 2 });
  });

  it('selects a job and resets export state', async () => {
    const id = await finishedJob();
    store().selectJob(id);
    expect(store().displayedJob()?.id).toBe(id);
    expect(store().exportState.status).toBe('idle');
  });
});
