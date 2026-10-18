import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KernelMessage, KernelResponse } from '../../types/quantum';
import { fetchEvaluators } from './evaluatorCatalog';
import { BUSY_RETRIES, createKernelEvaluator, isCancelled, type EvalRequest } from './kernelEval';
import { TOY_EVALUATOR, makeEvaluation } from './testkit';

function harness(onSend: (m: KernelMessage, emit: (r: KernelResponse) => void) => void) {
  const handlers = new Set<(m: KernelResponse) => void>();
  const closeHandlers = new Set<() => void>();
  const emit = (r: KernelResponse) => handlers.forEach((h) => h(r));
  const session = {
    send: (m: KernelMessage) => onSend(m, emit),
    subscribe: (h: (m: KernelResponse) => void) => { handlers.add(h); return () => handlers.delete(h); },
    onClose: (h: () => void) => { closeHandlers.add(h); return () => closeHandlers.delete(h); },
  };
  return { session, emit, close: () => closeHandlers.forEach((h) => h()), handlers };
}

const req: EvalRequest = {
  runId: 'r', wireId: 'c-0001', evaluator: { kind: 'state_synthesis', config: {} }, program: 'p', entry: 'build', seed: 9, stage: 'full',
};

afterEach(() => vi.useRealTimers());

describe('createKernelEvaluator', () => {
  it('sends discovery_evaluate with the stage and resolves on the matching evaluation', async () => {
    const sent: KernelMessage[] = [];
    const h = harness((m, emit) => {
      sent.push(m);
      emit({ type: 'discovery_evaluate_accepted', run_id: 'r', candidate_id: 'c-0001', queue_position: 0 });
      emit({ type: 'discovery_evaluation', run_id: 'other', candidate_id: 'c-0001', evaluation: makeEvaluation({ fitness: 99 }) });
      emit({ type: 'discovery_evaluation', run_id: 'r', candidate_id: 'c-0001', evaluation: makeEvaluation({ fitness: 3 }) });
    });
    const k = createKernelEvaluator({ session: h.session, info: TOY_EVALUATOR, sleep: async () => undefined });
    const ev = await k.evaluate(req);
    expect(ev.fitness).toBe(3);
    expect(sent[0]).toMatchObject({ type: 'discovery_evaluate', run_id: 'r', candidate_id: 'c-0001', stage: 'full', seed: 9, entry: 'build' });
    k.dispose();
    expect(h.handlers.size).toBe(0);
  });

  it('turns a discovery error into a failed evaluation', async () => {
    const h = harness((_m, emit) => emit({ type: 'error', phase: 'discovery', code: 'invalid_config', message: 'bad config', run_id: 'r', candidate_id: 'c-0001' }));
    const ev = await createKernelEvaluator({ session: h.session, info: TOY_EVALUATOR, sleep: async () => undefined }).evaluate(req);
    expect(ev).toMatchObject({ status: 'failed', failure: { code: 'invalid_config', message: 'bad config' }, stage: 'full', seed: 9 });
  });

  it('backs off and resends on discovery_busy, then gives up', async () => {
    let sends = 0;
    const sleeps: number[] = [];
    const h = harness((_m, emit) => {
      sends += 1;
      if (sends <= 2) emit({ type: 'error', phase: 'discovery', code: 'discovery_busy', message: 'busy', run_id: 'r', candidate_id: 'c-0001' });
      else emit({ type: 'discovery_evaluation', run_id: 'r', candidate_id: 'c-0001', evaluation: makeEvaluation() });
    });
    const k = createKernelEvaluator({ session: h.session, info: TOY_EVALUATOR, sleep: async (ms) => { sleeps.push(ms); } });
    expect((await k.evaluate(req)).status).toBe('scored');
    expect(sends).toBe(3);
    expect(sleeps).toEqual([500, 1000]);

    sends = -100;
    const always = createKernelEvaluator({ session: harness((_m, emit) => { sends += 1; emit({ type: 'error', phase: 'discovery', code: 'discovery_busy', message: 'busy', run_id: 'r', candidate_id: 'c-0001' }); }).session, info: TOY_EVALUATOR, sleep: async () => undefined });
    const ev = await always.evaluate(req);
    expect(ev.failure?.code).toBe('discovery_busy');
    expect(sends).toBe(-100 + BUSY_RETRIES + 1);
  });

  it('fails an evaluation when the kernel never answers', async () => {
    vi.useFakeTimers();
    const h = harness(() => undefined);
    const promise = createKernelEvaluator({ session: h.session, info: TOY_EVALUATOR, sleep: async () => undefined, timeoutMs: 1000 }).evaluate(req);
    await vi.advanceTimersByTimeAsync(1001);
    expect((await promise).failure?.code).toBe('eval_timeout');
  });

  it('fails in-flight evaluations when the session closes, and reports send errors', async () => {
    const h = harness(() => undefined);
    const k = createKernelEvaluator({ session: h.session, info: TOY_EVALUATOR, sleep: async () => undefined });
    const p = k.evaluate(req);
    h.close();
    expect((await p).failure?.code).toBe('session_closed');
    const throwing = createKernelEvaluator({ session: harness(() => { throw new Error('socket closed'); }).session, info: TOY_EVALUATOR, sleep: async () => undefined });
    expect((await throwing.evaluate(req)).failure).toMatchObject({ code: 'send_failed', message: 'socket closed' });
  });

  it('cancelRun settles waiters as cancelled and tells the kernel', async () => {
    const sent: KernelMessage[] = [];
    const h = harness((m) => { sent.push(m); });
    const k = createKernelEvaluator({ session: h.session, info: TOY_EVALUATOR, sleep: async () => undefined });
    const p = k.evaluate(req);
    k.cancelRun('r');
    const ev = await p;
    expect(isCancelled(ev)).toBe(true);
    expect(sent.at(-1)).toEqual({ type: 'discovery_cancel', run_id: 'r' });
  });

  it('serializes discovery_mutate calls and maps errors', async () => {
    const order: number[] = [];
    const h = harness((m, emit) => {
      if (m.type !== 'discovery_mutate') return;
      order.push(m.seed);
      if (m.seed === 3) emit({ type: 'error', phase: 'discovery', code: 'x', message: 'mutate failed' });
      else emit({ type: 'discovery_mutations', mutations: [{ program: `p${m.seed}`, operators: ['o'], description: '' }] });
    });
    const k = createKernelEvaluator({ session: h.session, info: TOY_EVALUATOR, sleep: async () => undefined });
    const [a, b, c] = await Promise.all([k.mutate('x', 1), k.mutate('x', 2), k.mutate('x', 3)]);
    expect(order).toEqual([1, 2, 3]);
    expect(a).toMatchObject({ ok: true, mutations: [{ program: 'p1' }] });
    expect(b).toMatchObject({ ok: true, mutations: [{ program: 'p2' }] });
    expect(c).toEqual({ ok: false, message: 'mutate failed' });
  });
});

describe('fetchEvaluators', () => {
  it('resolves the catalogue, reports errors, and times out', async () => {
    const ok = harness((_m, emit) => emit({ type: 'discovery_evaluators_result', evaluators: [TOY_EVALUATOR] }));
    expect(await fetchEvaluators(ok.session)).toEqual({ ok: true, evaluators: [TOY_EVALUATOR] });
    const bad = harness((_m, emit) => emit({ type: 'error', phase: 'discovery', message: 'no kernel' }));
    expect(await fetchEvaluators(bad.session)).toEqual({ ok: false, error: 'no kernel' });
    vi.useFakeTimers();
    const silent = harness(() => undefined);
    const p = fetchEvaluators(silent.session, 500);
    await vi.advanceTimersByTimeAsync(501);
    expect(await p).toMatchObject({ ok: false });
  });
});
