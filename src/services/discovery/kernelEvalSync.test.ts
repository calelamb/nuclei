import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KernelMessage, KernelResponse } from '../../types/quantum';
import { createAuditClient } from './kernelAudit';
import { fetchEvaluators } from './evaluatorCatalog';
import { createKernelEvaluator, isCancelled, type EvalRequest } from './kernelEval';
import { TOY_EVALUATOR, makeAudit, makeEvaluation } from './testkit';

function harness(onSend: (m: KernelMessage, emit: (r: KernelResponse) => void) => void = () => undefined) {
  const handlers = new Set<(m: KernelResponse) => void>();
  const emit = (r: KernelResponse) => handlers.forEach((h) => h(r));
  const sent: KernelMessage[] = [];
  const session = {
    send: (m: KernelMessage) => { sent.push(m); onSend(m, emit); },
    subscribe: (h: (m: KernelResponse) => void) => { handlers.add(h); return () => handlers.delete(h); },
    onClose: () => () => undefined,
  };
  return { session, emit, sent };
}

const idOf = (m: KernelMessage | undefined) => (m as { request_id?: string } | undefined)?.request_id;
const tick = () => new Promise((r) => setTimeout(r, 0));
const mutation = (program: string) => ({ program, operators: ['o'], description: '' });
const make = (session: ReturnType<typeof harness>['session']) => createKernelEvaluator({ session, info: TOY_EVALUATOR, sleep: async () => undefined });

const req: EvalRequest = {
  runId: 'r', wireId: 'c-0001', evaluator: { kind: 'state_synthesis', config: {} }, program: 'p', entry: 'build', seed: 9, stage: 'full',
};

afterEach(() => vi.useRealTimers());

describe('discovery_mutate correlation (CR-M4)', () => {
  it('sends a request_id and drops a stale reply that belongs to an earlier request', async () => {
    const h = harness();
    const k = make(h.session);
    const first = k.mutate('a', 1);
    await tick();
    const firstId = idOf(h.sent[0]);
    expect(firstId).toBeTruthy();
    h.emit({ type: 'discovery_mutations', mutations: [mutation('first')], request_id: firstId });
    expect(await first).toMatchObject({ ok: true, mutations: [{ program: 'first' }] });

    const second = k.mutate('b', 2);
    await tick();
    const secondId = idOf(h.sent[1]);
    expect(secondId).not.toBe(firstId);
    // A late duplicate of the first reply must not become the second's lineage.
    h.emit({ type: 'discovery_mutations', mutations: [mutation('stale')], request_id: firstId });
    let settled = false;
    void second.then(() => { settled = true; });
    await tick();
    expect(settled).toBe(false);
    h.emit({ type: 'discovery_mutations', mutations: [mutation('second')], request_id: secondId });
    expect(await second).toMatchObject({ ok: true, mutations: [{ program: 'second' }] });
  });

  it('accepts a reply with no id (older kernel)', async () => {
    const h = harness((m, emit) => { if (m.type === 'discovery_mutate') emit({ type: 'discovery_mutations', mutations: [mutation('legacy')] }); });
    expect(await make(h.session).mutate('a', 1)).toMatchObject({ ok: true, mutations: [{ program: 'legacy' }] });
  });

  it('an error with another request_id does not fail the in-flight mutate; a matching one does', async () => {
    const h = harness();
    const k = make(h.session);
    const pending = k.mutate('a', 1);
    await tick();
    const id = idOf(h.sent[0]);
    let settled = false;
    void pending.then(() => { settled = true; });
    h.emit({ type: 'error', phase: 'discovery', code: 'invalid_config', message: 'someone else', request_id: 'other' });
    await tick();
    expect(settled).toBe(false);
    h.emit({ type: 'error', phase: 'discovery', code: 'mutate_failed', message: 'mine', request_id: id });
    expect(await pending).toEqual({ ok: false, message: 'mine' });
  });

  it('once the kernel echoes ids, an id-less discovery error without a candidate_id is not trusted', async () => {
    const h = harness();
    const k = make(h.session);
    const first = k.mutate('a', 1);
    await tick();
    h.emit({ type: 'discovery_mutations', mutations: [mutation('x')], request_id: idOf(h.sent[0]) });
    await first;
    const second = k.mutate('b', 2);
    await tick();
    let settled = false;
    void second.then(() => { settled = true; });
    h.emit({ type: 'error', phase: 'discovery', code: 'cancel_failed', message: 'unrelated' });
    await tick();
    expect(settled).toBe(false);
    h.emit({ type: 'discovery_mutations', mutations: [mutation('ok')], request_id: idOf(h.sent[1]) });
    expect(await second).toMatchObject({ ok: true });
  });

  it('legacy fallback: with a kernel that never echoes, an id-less error still fails the mutate', async () => {
    const h = harness((m, emit) => { if (m.type === 'discovery_mutate') emit({ type: 'error', phase: 'discovery', code: 'x', message: 'old failure' }); });
    expect(await make(h.session).mutate('a', 1)).toEqual({ ok: false, message: 'old failure' });
  });
});

describe('discovery_program_key (CR-M1)', () => {
  it('requests the key with a request_id and returns it', async () => {
    const h = harness((m, emit) => {
      if (m.type === 'discovery_program_key') emit({ type: 'discovery_program_key_result', program_key: `k:${m.program}`, request_id: m.request_id });
    });
    expect(await make(h.session).programKey('prog')).toEqual({ ok: true, key: 'k:prog' });
    expect(h.sent[0]).toMatchObject({ type: 'discovery_program_key', program: 'prog' });
    expect(idOf(h.sent[0])).toBeTruthy();
  });

  it('falls back when an older kernel answers invalid_request, and does not ask again', async () => {
    const h = harness((m, emit) => {
      if (m.type === 'discovery_program_key') emit({ type: 'error', phase: 'discovery', code: 'invalid_request', message: 'unknown message' });
    });
    const k = make(h.session);
    expect(await k.programKey('a')).toMatchObject({ ok: false, unsupported: true });
    expect(await k.programKey('b')).toMatchObject({ ok: false, unsupported: true });
    expect(h.sent.filter((m) => m.type === 'discovery_program_key')).toHaveLength(1);
  });

  it('a stale key reply for another request is dropped', async () => {
    const h = harness();
    const k = make(h.session);
    const pending = k.programKey('a');
    await tick();
    h.emit({ type: 'discovery_program_key_result', program_key: 'stale', request_id: 'other' });
    h.emit({ type: 'discovery_program_key_result', program_key: 'right', request_id: idOf(h.sent[0]) });
    expect(await pending).toEqual({ ok: true, key: 'right' });
  });
});

describe('evaluator catalogue correlation (CR-M4)', () => {
  it('sends a request_id and ignores a reply that carries a different one', async () => {
    const h = harness();
    const pending = fetchEvaluators(h.session);
    await tick();
    h.emit({ type: 'discovery_evaluators_result', evaluators: [], request_id: 'stale' });
    h.emit({ type: 'discovery_evaluators_result', evaluators: [TOY_EVALUATOR], request_id: idOf(h.sent[0]) });
    expect(await pending).toEqual({ ok: true, evaluators: [TOY_EVALUATOR] });
  });
});

describe('eval and audit waiters (low)', () => {
  it('a bare error for a candidate both evaluated and audited settles neither, but each still gets its own result', async () => {
    const h = harness();
    const k = make(h.session);
    const audits = createAuditClient({ session: h.session, sleep: async () => undefined });
    const ev = k.evaluate(req);
    const au = audits.audit({ runId: 'r', candidateId: 'c-0001', evaluator: req.evaluator, program: 'p', entry: 'build', seed: 1, evaluation: makeEvaluation() });
    await tick();
    h.emit({ type: 'error', phase: 'discovery', code: 'x', message: 'boom', run_id: 'r', candidate_id: 'c-0001' });
    await tick();
    h.emit({ type: 'discovery_evaluation', run_id: 'r', candidate_id: 'c-0001', evaluation: makeEvaluation({ fitness: 7 }) });
    h.emit({ type: 'discovery_audit_result', run_id: 'r', candidate_id: 'c-0001', audit: makeAudit() });
    expect((await ev).fitness).toBe(7);
    expect(await au).toMatchObject({ status: 'ok' });
  });

  it('a candidate error still fails a lone evaluation, and a lone audit', async () => {
    const h = harness();
    const k = make(h.session);
    const ev = k.evaluate(req);
    await tick();
    h.emit({ type: 'error', phase: 'discovery', code: 'bad', message: 'eval boom', run_id: 'r', candidate_id: 'c-0001' });
    expect((await ev).failure?.message).toBe('eval boom');
    const audits = createAuditClient({ session: h.session, sleep: async () => undefined });
    const au = audits.audit({ runId: 'r', candidateId: 'c-0002', evaluator: req.evaluator, program: 'p', entry: 'build', seed: 1, evaluation: makeEvaluation() });
    await tick();
    h.emit({ type: 'error', phase: 'discovery', code: 'bad', message: 'audit boom', run_id: 'r', candidate_id: 'c-0002' });
    expect(await au).toMatchObject({ status: 'error', message: 'audit boom' });
  });
});

describe('eval_timeout (low)', () => {
  it('sends discovery_cancel for that candidate', async () => {
    vi.useFakeTimers();
    const h = harness();
    const k = createKernelEvaluator({ session: h.session, info: TOY_EVALUATOR, sleep: async () => undefined, timeoutMs: 1000 });
    const pending = k.evaluate(req);
    await vi.advanceTimersByTimeAsync(1001);
    const ev = await pending;
    expect(ev.failure?.code).toBe('eval_timeout');
    expect(isCancelled(ev)).toBe(false);
    expect(h.sent.at(-1)).toEqual({ type: 'discovery_cancel', run_id: 'r', candidate_id: 'c-0001' });
  });
});
