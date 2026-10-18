import { describe, expect, it } from 'vitest';
import type { KernelMessage } from '../../types/quantum';
import { createFakeSession } from '../trainability/fakeSession';
import { fixtureConjecture, fixtureEvidenceItem, fixtureResult, FIXTURE_SCHEMA_REPLY } from './fixtures';
import { createConjectureTester, type TestEvent } from './tester';

const ids = () => 'job-1';

describe('conjecture tester', () => {
  it('fetches and normalises the kernel schema', async () => {
    const session = createFakeSession((m, s) => {
      if (m.type === 'discovery_conjecture_schema') s.emit(FIXTURE_SCHEMA_REPLY);
    });
    const res = await createConjectureTester(session).schema();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.features.map((f) => f.key)).toContain('entangler_pattern');
  });

  it('returns a schema error as a value', async () => {
    const session = createFakeSession((m, s) => {
      if (m.type === 'discovery_conjecture_schema') s.emit({ type: 'error', phase: 'discovery', code: 'conjecture_internal', message: 'boom' });
    });
    const res = await createConjectureTester(session).schema();
    expect(res).toEqual({ ok: false, error: { code: 'conjecture_internal', message: 'boom' } });
  });

  it('correlates the schema request by request_id and drops mismatched replies and errors (CR-M4)', async () => {
    const session = createFakeSession();
    const pending = createConjectureTester(session).schema();
    await new Promise((r) => setTimeout(r, 0));
    const id = (session.sent[0] as { request_id?: string }).request_id;
    expect(id).toBeTruthy();
    session.emit({ type: 'error', phase: 'discovery', code: 'conjecture_internal', message: 'not mine', request_id: 'other' });
    session.emit({ ...FIXTURE_SCHEMA_REPLY, request_id: 'stale' });
    session.emit({ ...FIXTURE_SCHEMA_REPLY, request_id: id });
    const res = await pending;
    expect(res.ok).toBe(true);
  });

  it('streams started, progress, evidence and the result in order', async () => {
    const session = createFakeSession();
    const tester = createConjectureTester(session, { newJobId: ids });
    const events: TestEvent[] = [];
    const handle = tester.start({ conjecture: fixtureConjecture(), seed: 7 }, (e) => events.push(e));
    expect(session.sent[0]).toMatchObject({ type: 'discovery_conjecture_test', job_id: 'job-1', seed: 7 });
    session.emit({ type: 'discovery_conjecture_started', job_id: 'other' });
    session.emit({ type: 'discovery_conjecture_started', job_id: 'job-1' });
    session.emit({ type: 'discovery_conjecture_progress', job_id: 'job-1', fraction: 0.25, message: 'circuit 1 of 4', circuit_index: 0 });
    session.emit({ type: 'discovery_conjecture_evidence', job_id: 'job-1', item: fixtureEvidenceItem(0) });
    session.emit({ type: 'discovery_conjecture_result', job_id: 'job-1', status: 'complete', result: fixtureResult('supported') });
    const end = await handle.done;
    expect(events.map((e) => e.kind)).toEqual(['started', 'progress', 'evidence']);
    expect(end).toMatchObject({ kind: 'result', status: 'complete' });
    if (end.kind === 'result') expect(end.result?.verdict).toBe('supported');
  });

  it('cancels through the kernel and reports acceptance', async () => {
    const session = createFakeSession((m: KernelMessage, s) => {
      if (m.type === 'discovery_conjecture_cancel') s.emit({ type: 'discovery_conjecture_cancelled', job_id: m.job_id, accepted: true });
    });
    const handle = createConjectureTester(session, { newJobId: ids }).start({ conjecture: fixtureConjecture(), seed: 1 }, () => undefined);
    session.emit({ type: 'discovery_conjecture_started', job_id: 'job-1' });
    expect(await handle.cancel()).toBe(true);
    expect(session.sent.some((m) => m.type === 'discovery_conjecture_cancel')).toBe(true);
    session.emit({ type: 'discovery_conjecture_result', job_id: 'job-1', status: 'cancelled', result: null });
    expect(await handle.done).toEqual({ kind: 'result', status: 'cancelled', result: null });
    expect(await handle.cancel()).toBe(false);
  });

  it('resolves kernel error envelopes, with the offending path', async () => {
    const session = createFakeSession();
    const handle = createConjectureTester(session, { newJobId: ids }).start({ conjecture: fixtureConjecture(), seed: 1 }, () => undefined);
    session.emit({ type: 'error', phase: 'discovery', code: 'invalid_conjecture', message: 'n_range too wide', path: 'n_range' } as never);
    expect(await handle.done).toEqual({ kind: 'error', error: { code: 'invalid_conjecture', message: 'n_range too wide', path: 'n_range' } });
  });

  it('surfaces conjecture_busy and ignores unrelated errors after the ack', async () => {
    const session = createFakeSession();
    const handle = createConjectureTester(session, { newJobId: ids }).start({ conjecture: fixtureConjecture(), seed: 1 }, () => undefined);
    session.emit({ type: 'error', phase: 'execute', message: 'unrelated' });
    session.emit({ type: 'error', phase: 'discovery', code: 'conjecture_busy', message: 'one at a time' });
    expect(await handle.done).toMatchObject({ kind: 'error', error: { code: 'conjecture_busy' } });
  });

  it('resolves disconnected when the socket drops mid-test', async () => {
    const session = createFakeSession();
    const handle = createConjectureTester(session, { newJobId: ids }).start({ conjecture: fixtureConjecture(), seed: 1 }, () => undefined);
    session.emit({ type: 'discovery_conjecture_started', job_id: 'job-1' });
    session.drop();
    expect(await handle.done).toEqual({ kind: 'disconnected' });
  });

  it('times out when the kernel never acknowledges', async () => {
    const session = createFakeSession();
    const handle = createConjectureTester(session, { newJobId: ids, ackTimeoutMs: 5 }).start({ conjecture: fixtureConjecture(), seed: 1 }, () => undefined);
    expect(await handle.done).toMatchObject({ kind: 'error', error: { code: 'timeout' } });
  });
});
