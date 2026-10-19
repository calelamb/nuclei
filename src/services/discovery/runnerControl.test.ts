import { describe, expect, it } from 'vitest';
import type { CandidateRecord, RunRecord } from '../../types/discovery';
import { runDiscovery, type DiscoveryRunContext } from './runner';
import {
  SEED_PROGRAM, TOY_EVALUATOR, createFakeKernel, createFakeLlm, createManualClock, createMemoryFs, joinPath, makeSpec, testHash,
  type FakeKernelOptions,
} from './testkit';

const ctx: DiscoveryRunContext = {
  projectRoot: 'proj', definitionFile: 'toy.discovery.yaml', evaluator: TOY_EVALUATOR, seedProgram: SEED_PROGRAM,
};

function setup(options: FakeKernelOptions = {}, fs = createMemoryFs()) {
  const kernel = createFakeKernel(options);
  const llm = createFakeLlm();
  const clock = createManualClock();
  return { kernel, llm, clock, fs, deps: { session: kernel.session, fs, llm, clock, hash: testHash, join: joinPath } };
}

const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, label: string, limit = 600) {
  for (let i = 0; i < limit && !cond(); i += 1) await wait(2);
  if (!cond()) throw new Error(`timed out waiting for ${label}`);
}
const evaluates = (k: ReturnType<typeof createFakeKernel>) => k.sent.filter((m) => m.type === 'discovery_evaluate');
const distinct = (() => { let n = 0; return (p: string) => [{ program: p.replace(/IMPROVE = -?\d+/, `IMPROVE = ${(n += 1)}`), operators: ['x'], description: '' }]; })();

function candidatesOf(fs: ReturnType<typeof createMemoryFs>, run: RunRecord): CandidateRecord[] {
  const prefix = `proj/experiments/toy/discovery/${run.run_id}/candidates/`;
  return [...fs.files.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => JSON.parse(v) as CandidateRecord).sort((a, b) => a.id.localeCompare(b.id));
}

describe('pause gates queued work (CR-M8)', () => {
  it('queued evaluations do not start while paused', async () => {
    const { deps, kernel } = setup({ latencyMs: 20, mutate: distinct });
    const handle = runDiscovery(
      makeSpec({ budget: { max_concurrent_evaluations: 1 }, search: { generations: 1, candidates_per_generation: 6, islands: 1 }, confirm: { seeds: 0 } }),
      ctx, deps,
    );
    await until(() => evaluates(kernel).length >= 3, 'evaluations under way');
    handle.pause();
    await wait(60); // the evaluation already in flight finishes
    const frozen = evaluates(kernel).length;
    await wait(120);
    expect(evaluates(kernel).length).toBe(frozen);
    expect(frozen).toBeLessThan(7);
    handle.resume();
    const run = await handle.done;
    expect(run.status).toBe('completed');
    expect(evaluates(kernel).length).toBeGreaterThan(frozen);
  });

  it('queued LLM calls do not start while paused', async () => {
    const { deps, llm } = setup({ latencyMs: 5 });
    const slow = llm.propose.bind(llm);
    llm.propose = async (input, signal) => { await wait(25); return slow(input, signal); };
    const handle = runDiscovery(
      makeSpec({ mutator: { kind: 'llm' }, search: { generations: 1, candidates_per_generation: 6, islands: 1 }, confirm: { seeds: 0 } }),
      ctx, deps, { maxLlmConcurrency: 1 },
    );
    await until(() => llm.calls.length >= 1, 'first LLM call');
    handle.pause();
    await wait(60);
    const frozen = llm.calls.length;
    await wait(120);
    expect(llm.calls.length).toBe(frozen);
    expect(frozen).toBeLessThan(6);
    handle.resume();
    await handle.done;
    expect(llm.calls.length).toBeGreaterThan(frozen);
  });
});

describe('wall time excludes paused time (CR-M8)', () => {
  it('does not count a long pause and does not trip max_wall_time because of it', async () => {
    const { deps, kernel, clock } = setup({ mutate: distinct });
    const handle = runDiscovery(
      makeSpec({ budget: { max_wall_minutes: 5, max_concurrent_evaluations: 1 }, search: { generations: 2, candidates_per_generation: 2, islands: 1 }, confirm: { seeds: 0 } }),
      ctx, deps,
    );
    await until(() => handle.current()?.seed_fitness === 0, 'seed scored');
    kernel.hold.value = true;
    await until(() => evaluates(kernel).length >= 2, 'a candidate in flight');
    handle.pause();
    clock.advance(60 * 60_000); // an hour paused
    expect(handle.current()).not.toBeNull();
    handle.resume();
    kernel.release();
    const run = await handle.done;
    expect(run.stop_reason).toBe('generations');
    expect(run.usage.wall_ms).toBeLessThan(60_000);
  });
});

describe('stop during confirmation (CR-M8)', () => {
  it('stops queued confirmation evaluations and drops the partial confirmation', async () => {
    const { deps, kernel } = setup({ latencyMs: 25, mutate: distinct });
    const handle = runDiscovery(
      makeSpec({ budget: { max_concurrent_evaluations: 1 }, search: { generations: 1, candidates_per_generation: 1, islands: 1 }, confirm: { seeds: 3 } }),
      ctx, deps,
    );
    const confirms = () => evaluates(kernel).filter((m) => (m as { stage?: string }).stage === 'confirm');
    await until(() => confirms().length >= 1, 'confirmation to start');
    handle.stop();
    const run = await Promise.race([handle.done, wait(1000).then(() => 'hung' as const)]);
    expect(run).not.toBe('hung');
    await wait(80);
    expect(confirms()).toHaveLength(1);
    expect((run as RunRecord).confirmation).toBeNull();
    expect((run as RunRecord).notices.join()).toMatch(/unconfirmed/);
  });
});

describe('resumed batch items (CR-M8)', () => {
  const batchSpec = () =>
    makeSpec({
      mutator: { kind: 'hybrid', llm_share: 1, batch_mode: true, models: { breadth: 'haiku', depth: 'opus', depth_share: 0, depth_thinking: false } },
      evaluation: { cascade: true, promote_if: 'island_median' },
      search: { generations: 1, candidates_per_generation: 3, islands: 1 }, confirm: { seeds: 0 },
    });

  it('apply the cascade threshold and fall back with distinct derived AST seeds', async () => {
    const first = setup();
    first.llm.batchState.endAfter = Number.POSITIVE_INFINITY;
    const handle = runDiscovery(batchSpec(), ctx, first.deps);
    await until(() => first.llm.batchState.polls >= 2, 'polling');
    handle.stop();
    const stopped = await handle.done;
    expect(stopped.pending_batch?.items).toHaveLength(3);

    // On resume the batch results are unusable, so every item falls back to a (clearly bad) AST mutation.
    const second = setup(
      { mutate: (p) => [{ program: p.replace(/IMPROVE = -?\d+/, 'IMPROVE = -5'), operators: ['x'], description: '' }] },
      createMemoryFs(Object.fromEntries(first.fs.files)),
    );
    second.llm.batchState.endAfter = 1;
    second.llm.batchResults = async () => ({});
    const resumed = await runDiscovery(batchSpec(), { ...ctx, resumeRunId: stopped.run_id }, second.deps).done;
    const mutateSeeds = second.kernel.sent.filter((m) => m.type === 'discovery_mutate').map((m) => (m as { seed: number }).seed);
    expect(mutateSeeds).toHaveLength(3);
    expect(new Set(mutateSeeds).size).toBe(3);
    expect(mutateSeeds.every((s) => s !== 0)).toBe(true);
    const children = candidatesOf(second.fs, resumed).filter((c) => c.mutator !== 'seed' && c.outcome !== 'duplicate');
    expect(children.length).toBeGreaterThan(0);
    expect(children.every((c) => c.outcome === 'screened_out')).toBe(true);
    // The three batch requests were counted once, at submission, not again on resume.
    expect(resumed.usage.llm_calls).toBe(3);
  });
});
