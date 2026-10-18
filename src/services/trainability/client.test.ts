import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTrainabilityClient } from './client';
import { createFakeSession } from './fakeSession';
import {
  gradientsFixture,
  inspectionFixture,
  lintDiagnosticsFixture,
  lintSummaryFixture,
  provenanceFixture,
  resultsFixture,
} from './fixtures';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const START = {
  code: 'x',
  observable: 'preset:local_z',
  analyses: ['gradients' as const],
};

describe('trainability client: sync requests', () => {
  it('inspects and strips the response type', async () => {
    const session = createFakeSession((m, s) => {
      if (m.type === 'trainability_inspect') s.emit({ type: 'trainability_inspected', ...inspectionFixture });
    });
    const client = createTrainabilityClient(session);
    const result = await client.inspect({ code: 'x', language: 'python' });
    expect(result).toEqual({ ok: true, value: inspectionFixture });
    expect(session.sent[0]).toMatchObject({ type: 'trainability_inspect', code: 'x', language: 'python' });
  });

  it('lints and returns diagnostics with the summary', async () => {
    const session = createFakeSession((m, s) => {
      if (m.type === 'trainability_lint') {
        s.emit({ type: 'trainability_lint_result', diagnostics: lintDiagnosticsFixture, summary: lintSummaryFixture });
      }
    });
    const client = createTrainabilityClient(session);
    const result = await client.lint({ code: 'x', observable: 'preset:global_z' });
    expect(result.ok && result.value.diagnostics).toHaveLength(lintDiagnosticsFixture.length);
    expect(result.ok && result.value.summary.n_qubits).toBe(4);
  });

  it('resolves the error envelope as a value, with the observable column', async () => {
    const session = createFakeSession((m, s) => {
      if (m.type === 'trainability_lint') {
        s.emit({ type: 'error', phase: 'trainability', code: 'observable_error', message: 'Unexpected "Q" at column 4', column: 4 } as never);
      }
    });
    const result = await createTrainabilityClient(session).lint({ code: 'x', observable: 'Z0 Q1' });
    expect(result).toEqual({ ok: false, error: { code: 'observable_error', message: 'Unexpected "Q" at column 4', column: 4 } });
  });

  it('ignores unrelated errors and unrelated phases', async () => {
    const session = createFakeSession();
    const client = createTrainabilityClient(session, { inspectTimeoutMs: 1000 });
    const pending = client.inspect({ code: 'x' });
    await vi.advanceTimersByTimeAsync(0);
    session.emit({ type: 'error', phase: 'parse', message: 'other feature' });
    session.emit({ type: 'trainability_inspected', ...inspectionFixture });
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  it('serializes sync requests (one in flight)', async () => {
    const session = createFakeSession();
    const client = createTrainabilityClient(session);
    const a = client.inspect({ code: 'a' });
    const b = client.lint({ code: 'b' });
    await Promise.resolve();
    expect(session.sent.map((m) => m.type)).toEqual(['trainability_inspect']);
    session.emit({ type: 'trainability_inspected', ...inspectionFixture });
    await a;
    await vi.advanceTimersByTimeAsync(0);
    expect(session.sent.map((m) => m.type)).toEqual(['trainability_inspect', 'trainability_lint']);
    session.emit({ type: 'trainability_lint_result', diagnostics: [], summary: lintSummaryFixture });
    await expect(b).resolves.toMatchObject({ ok: true });
  });

  it('times out with a timeout code', async () => {
    const session = createFakeSession();
    const client = createTrainabilityClient(session, { lintTimeoutMs: 500 });
    const pending = client.lint({ code: 'x' });
    await vi.advanceTimersByTimeAsync(600);
    const result = await pending;
    expect(result).toMatchObject({ ok: false, error: { code: 'timeout' } });
  });

  it('reports a disconnect while waiting', async () => {
    const session = createFakeSession();
    const client = createTrainabilityClient(session);
    const pending = client.inspect({ code: 'x' });
    await vi.advanceTimersByTimeAsync(0);
    session.drop();
    expect(await pending).toMatchObject({ ok: false, error: { code: 'disconnected' } });
    expect(client.closed).toBe(true);
  });
});

describe('trainability client: jobs', () => {
  it('streams started, progress, partial and the final result', async () => {
    const session = createFakeSession();
    const client = createTrainabilityClient(session, { newJobId: () => 'job-1' });
    const events: string[] = [];
    const handle = client.start(START, (e) => events.push(e.kind));
    expect(session.sent[0]).toMatchObject({ type: 'trainability_start', job_id: 'job-1', observable: 'preset:local_z' });

    session.emit({ type: 'trainability_started', job_id: 'job-1' });
    session.emit({ type: 'trainability_progress', job_id: 'job-1', analysis: 'gradients', fraction: 0.5, message: 'half' });
    session.emit({ type: 'trainability_progress', job_id: 'other', analysis: 'gradients', fraction: 0.9, message: 'not mine' });
    session.emit({ type: 'trainability_partial', job_id: 'job-1', analysis: 'gradients', result: gradientsFixture });
    session.emit({
      type: 'trainability_result',
      job_id: 'job-1',
      status: 'complete',
      results: resultsFixture,
      errors: {},
      elapsed_ms: 1234,
      provenance: provenanceFixture,
    });
    const end = await handle.done;
    expect(events).toEqual(['started', 'progress', 'partial']);
    expect(end).toMatchObject({ kind: 'result', status: 'complete', elapsedMs: 1234, provenance: provenanceFixture });
  });

  it('cancels through trainability_cancel and reports acceptance', async () => {
    const session = createFakeSession((m, s) => {
      if (m.type === 'trainability_cancel') s.emit({ type: 'trainability_cancelled', job_id: m.job_id, accepted: true });
    });
    const client = createTrainabilityClient(session, { newJobId: () => 'job-2' });
    const handle = client.start(START, () => undefined);
    session.emit({ type: 'trainability_started', job_id: 'job-2' });
    await expect(handle.cancel()).resolves.toBe(true);
    session.emit({ type: 'trainability_result', job_id: 'job-2', status: 'cancelled', results: {}, errors: {}, elapsed_ms: 10 });
    expect(await handle.done).toMatchObject({ kind: 'result', status: 'cancelled' });
    await expect(handle.cancel()).resolves.toBe(false);
  });

  it('turns a busy error before the ack into a job error', async () => {
    const session = createFakeSession();
    const client = createTrainabilityClient(session, { newJobId: () => 'job-3' });
    const handle = client.start(START, () => undefined);
    session.emit({ type: 'error', phase: 'trainability', code: 'trainability_busy', message: 'Too many jobs' });
    expect(await handle.done).toEqual({ kind: 'error', error: { code: 'trainability_busy', message: 'Too many jobs' } });
  });

  it('turns a job-correlated error mid-run into a job error', async () => {
    const session = createFakeSession();
    const client = createTrainabilityClient(session, { newJobId: () => 'job-4' });
    const handle = client.start(START, () => undefined);
    session.emit({ type: 'trainability_started', job_id: 'job-4' });
    session.emit({ type: 'error', phase: 'trainability', code: 'job_crashed', message: 'worker died', job_id: 'job-4' });
    expect(await handle.done).toMatchObject({ kind: 'error', error: { code: 'job_crashed' } });
  });

  it('fails when the kernel never acknowledges', async () => {
    const session = createFakeSession();
    const client = createTrainabilityClient(session, { ackTimeoutMs: 100 });
    const handle = client.start(START, () => undefined);
    await vi.advanceTimersByTimeAsync(150);
    expect(await handle.done).toMatchObject({ kind: 'error', error: { code: 'timeout' } });
  });

  it('does not time out once acknowledged', async () => {
    const session = createFakeSession();
    const client = createTrainabilityClient(session, { ackTimeoutMs: 100, newJobId: () => 'job-5' });
    const handle = client.start(START, () => undefined);
    session.emit({ type: 'trainability_started', job_id: 'job-5' });
    await vi.advanceTimersByTimeAsync(10_000);
    session.emit({ type: 'trainability_result', job_id: 'job-5', status: 'complete', results: {}, errors: {}, elapsed_ms: 1 });
    expect(await handle.done).toMatchObject({ kind: 'result' });
  });

  it('resolves disconnected when the socket drops mid-job', async () => {
    const session = createFakeSession();
    const client = createTrainabilityClient(session, { newJobId: () => 'job-6' });
    const handle = client.start(START, () => undefined);
    session.emit({ type: 'trainability_started', job_id: 'job-6' });
    session.drop();
    expect(await handle.done).toEqual({ kind: 'disconnected' });
  });

  it('fails fast when the session is already closed', async () => {
    const session = createFakeSession();
    session.close();
    const handle = createTrainabilityClient(session).start(START, () => undefined);
    expect(await handle.done).toMatchObject({ kind: 'error' });
  });
});
