import { describe, expect, it } from 'vitest';
import type { CandidateRecord, RunRecord } from '../../types/discovery';
import { runDiscovery, type DiscoveryRunContext, type RunnerEvent } from './runner';
import {
  SEED_PROGRAM, TOY_EVALUATOR, createFakeKernel, createFakeLlm, createManualClock, createMemoryFs, defaultScorer,
  improveValue, joinPath, makeSpec, testHash, type FakeKernel, type FakeLlm, type Scorer,
} from './testkit';

const ctx: DiscoveryRunContext = {
  projectRoot: 'proj', definitionFile: 'toy.discovery.yaml', evaluator: TOY_EVALUATOR, seedProgram: SEED_PROGRAM,
};

function setup(kernelOptions: Parameters<typeof createFakeKernel>[0] = {}, fs = createMemoryFs()) {
  const kernel = createFakeKernel(kernelOptions);
  const llm = createFakeLlm();
  const clock = createManualClock();
  const deps = { session: kernel.session, fs, llm, clock, hash: testHash, join: joinPath };
  return { kernel, llm, clock, fs, deps };
}

const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, label: string, limit = 400) {
  for (let i = 0; i < limit && !cond(); i += 1) await wait(2);
  if (!cond()) throw new Error(`timed out waiting for ${label}`);
}

function candidatesOf(fs: ReturnType<typeof createMemoryFs>, run: RunRecord): CandidateRecord[] {
  const prefix = `proj/experiments/toy/discovery/${run.run_id}/candidates/`;
  return [...fs.files.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => JSON.parse(v) as CandidateRecord).sort((a, b) => a.id.localeCompare(b.id));
}

const evaluates = (k: FakeKernel) => k.sent.filter((m) => m.type === 'discovery_evaluate');

describe('full run', () => {
  it('searches, confirms the champion and persists the §7.4 layout', async () => {
    const { deps, fs, kernel } = setup();
    const events: RunnerEvent[] = [];
    const handle = runDiscovery(makeSpec(), ctx, deps, { onEvent: (e) => events.push(e) });
    const run = await handle.done;

    expect(run.status).toBe('completed');
    expect(run.stop_reason).toBe('generations');
    expect(run.generation).toBe(3);
    expect(run.champion_id).not.toBeNull();
    expect(run.seed_fitness).toBe(0);
    expect(run.evaluator.fingerprint).toBe('f'.repeat(64));
    expect(run.best_fitness_history).toHaveLength(3);

    const dir = `proj/experiments/toy/discovery/${run.run_id}`;
    expect(run.run_id).toMatch(/^20261018-141530-[0-9a-f]{4}$/);
    const onDisk = JSON.parse(fs.files.get(`${dir}/run.json`)!) as RunRecord;
    expect(onDisk.status).toBe('completed');
    expect(onDisk.rng).toHaveLength(4);
    expect(onDisk.archive.islands).toHaveLength(2);
    const files = candidatesOf(fs, run);
    expect(files[0]).toMatchObject({ id: 'c-0000', mutator: 'seed', parent_id: null, outcome: 'evaluated' });
    expect(files.length).toBeGreaterThan(3);
    expect(files.every((c) => c.program_sha256.length === 64)).toBe(true);
    const champion = files.find((c) => c.id === run.champion_id)!;
    expect(fs.files.get(`${dir}/champion.py`)).toBe(champion.program);
    expect(improveValue(champion.program)).toBeGreaterThan(0);

    expect(events.some((e) => e.type === 'candidate')).toBe(true);
    expect(events.filter((e) => e.type === 'status').length).toBeGreaterThan(3);
    expect(evaluates(kernel).every((m) => m.type === 'discovery_evaluate' && m.run_id === run.run_id)).toBe(true);
  });

  it('assigns islands round-robin', async () => {
    const { deps, fs } = setup();
    const run = await runDiscovery(makeSpec({ confirm: { seeds: 0 } }), ctx, deps).done;
    const islands = candidatesOf(fs, run).filter((c) => c.mutator !== 'seed').map((c) => c.island);
    expect(new Set(islands)).toEqual(new Set([0, 1]));
  });

  it('is reproducible: the same seed yields the same candidates', async () => {
    const a = setup();
    const b = setup();
    const ra = await runDiscovery(makeSpec(), ctx, a.deps).done;
    const rb = await runDiscovery(makeSpec(), ctx, b.deps).done;
    expect(candidatesOf(a.fs, ra).map((c) => c.program)).toEqual(candidatesOf(b.fs, rb).map((c) => c.program));
    expect(ra.champion_id).toBe(rb.champion_id);
  });
});

describe('budgets and early stop', () => {
  it('stops on the evaluation budget before every proposal', async () => {
    let n = 0;
    const { deps, kernel } = setup({ mutate: (p) => [{ program: p.replace(/IMPROVE = -?\d+/, `IMPROVE = ${(n += 1)}`), operators: [], description: '' }] });
    const run = await runDiscovery(makeSpec({ budget: { max_evaluations: 4, max_concurrent_evaluations: 2 }, confirm: { seeds: 0 } }), ctx, deps).done;
    expect(run.stop_reason).toBe('max_evaluations');
    expect(run.status).toBe('completed');
    expect(run.usage.evaluations).toBe(4);
    expect(evaluates(kernel)).toHaveLength(4);
  });

  it('stops on the wall-time budget', async () => {
    const clock = createManualClock();
    const scorer: Scorer = (p, s, seed, id) => { clock.advance(40_000); return defaultScorer(p, s, seed, id); };
    const kernel = createFakeKernel({ scorer });
    const fs = createMemoryFs();
    const run = await runDiscovery(makeSpec({ budget: { max_wall_minutes: 1 }, search: { generations: 10, candidates_per_generation: 3 } }), ctx,
      { session: kernel.session, fs, llm: createFakeLlm(), clock, hash: testHash, join: joinPath }).done;
    expect(run.stop_reason).toBe('max_wall_time');
    expect(run.usage.wall_ms).toBeGreaterThanOrEqual(60_000);
  });

  it('stops early after the patience window without improvement', async () => {
    const { deps } = setup({ mutate: (program) => [{ program: program.replace(/IMPROVE = -?\d+/, `IMPROVE = ${improveValue(program) - 1}`), operators: ['x'], description: '' }] });
    const run = await runDiscovery(makeSpec({ search: { generations: 10, early_stop_patience: 2, candidates_per_generation: 2 }, confirm: { seeds: 0 } }), ctx, deps).done;
    expect(run.stop_reason).toBe('early_stop');
    expect(run.generation).toBe(2);
    expect(run.stale_generations).toBe(2);
  });

  it('keeps going when patience is 0', async () => {
    const { deps } = setup({ mutate: (program) => [{ program: `${program}# ${Math.random()}\n`, operators: ['x'], description: '' }] });
    const run = await runDiscovery(makeSpec({ search: { generations: 4, early_stop_patience: 0, candidates_per_generation: 1 }, confirm: { seeds: 0 } }), ctx, deps).done;
    expect(run.generation).toBe(4);
  });
});

describe('concurrency', () => {
  it('keeps at most max_concurrent_evaluations in flight', async () => {
    let n = 0;
    const { deps, kernel } = setup({ latencyMs: 15, mutate: (p) => [{ program: p.replace(/IMPROVE = -?\d+/, `IMPROVE = ${(n += 1)}`), operators: [], description: '' }] });
    await runDiscovery(makeSpec({ budget: { max_concurrent_evaluations: 2 }, search: { candidates_per_generation: 6, generations: 1 }, confirm: { seeds: 0 }, mutator: { kind: 'ast' } }), ctx, deps).done;
    expect(kernel.maxInFlight()).toBe(2);
  });
});

describe('cascade', () => {
  const values = [-5, 3, 4];
  let n = 0;
  const mutate = (program: string) => {
    const next = values[n % values.length];
    n += 1;
    return [{ program: program.replace(/IMPROVE = -?\d+/, `IMPROVE = ${next}`), operators: ['x'], description: '' }];
  };

  it('screens first, promotes only promising candidates, and archives only full evaluations', async () => {
    n = 0;
    const { deps, kernel, fs } = setup({ mutate });
    const run = await runDiscovery(makeSpec({ evaluation: { cascade: true, promote_if: 'island_median' }, search: { generations: 1, candidates_per_generation: 3, islands: 1 }, confirm: { seeds: 0 } }), ctx, deps).done;
    const files = candidatesOf(fs, run);
    const loser = files.find((c) => improveValue(c.program) === -5)!;
    expect(loser.outcome).toBe('screened_out');
    expect(loser.evaluation?.stage).toBe('screen');
    expect(loser.in_archive).toBe(false);
    const winners = files.filter((c) => c.mutator === 'ast' && improveValue(c.program) > 0);
    expect(winners.length).toBe(2);
    expect(winners.every((c) => c.outcome === 'evaluated' && c.evaluation?.stage === 'full' && c.screen?.stage === 'screen')).toBe(true);
    const stagesOf = (id: string) => evaluates(kernel).filter((m) => m.candidate_id === id).map((m) => (m as { stage?: string }).stage);
    expect(stagesOf(loser.id)).toEqual(['screen']);
    expect(stagesOf(winners[0].id)).toEqual(['screen', 'full']);
    expect(stagesOf('c-0000')).toEqual(['full']);
    for (const grid of run.archive.islands) {
      for (const elite of Object.values(grid)) {
        expect(files.find((c) => c.id === elite.candidateId)!.evaluation?.stage).toBe('full');
      }
    }
    expect(run.usage.evaluations).toBe(4);
  });

  it('promotes everything with promote_if: always', async () => {
    n = 0;
    const { deps, fs } = setup({ mutate });
    const run = await runDiscovery(makeSpec({ evaluation: { cascade: true, promote_if: 'always' }, search: { generations: 1, candidates_per_generation: 3, islands: 1 }, confirm: { seeds: 0 } }), ctx, deps).done;
    expect(candidatesOf(fs, run).some((c) => c.outcome === 'screened_out')).toBe(false);
  });

  it('records a screen-stage rejection as final', async () => {
    const scorer: Scorer = (p, s, seed, id) => (s === 'screen' && improveValue(p) === 7 ? { status: 'rejected', fitness: null, rejection: { guardrail: 'noiseless', message: 'noise' } } : defaultScorer(p, s, seed, id));
    const { deps, kernel, fs } = setup({ scorer, mutate: (p) => [{ program: p.replace(/IMPROVE = -?\d+/, 'IMPROVE = 7'), operators: [], description: '' }] });
    const run = await runDiscovery(makeSpec({ evaluation: { cascade: true }, search: { generations: 1, candidates_per_generation: 1, islands: 1 }, confirm: { seeds: 0 } }), ctx, deps).done;
    const c = candidatesOf(fs, run).find((x) => x.id === 'c-0001')!;
    expect(c.evaluation?.status).toBe('rejected');
    expect(evaluates(kernel).filter((m) => m.candidate_id === 'c-0001')).toHaveLength(1);
  });
});

describe('confirmation', () => {
  it('re-evaluates the champion on fresh seeds and reports mean and CI', async () => {
    const { deps, kernel, fs } = setup();
    const run = await runDiscovery(makeSpec({ confirm: { seeds: 3 } }), ctx, deps).done;
    const conf = run.confirmation!;
    expect(conf.champion_id).toBe(run.champion_id);
    expect(conf.seeds).toHaveLength(3);
    expect(conf.n_scored).toBe(3);
    const used = new Set(candidatesOf(fs, run).flatMap((c) => [c.eval_seed, c.evaluation?.seed]));
    expect(conf.seeds.some((s) => used.has(s))).toBe(false);
    expect(new Set(conf.seeds).size).toBe(3);
    const confirms = evaluates(kernel).filter((m) => (m as { stage?: string }).stage === 'confirm');
    expect(confirms).toHaveLength(3);
    expect(confirms.every((m) => (m as { program: string }).program === candidatesOf(fs, run).find((c) => c.id === run.champion_id)!.program)).toBe(true);
    expect(conf.fitness_mean).not.toBeNull();
    expect(conf.fitness_ci95![0]).toBeLessThanOrEqual(conf.fitness_mean!);
    expect(conf.objectives.map((o) => o.key)).toEqual(['err', 'cost']);
    expect(conf.objectives[0]).toMatchObject({ n: 3 });
    expect(conf.objectives[0].ci95).not.toBeNull();
    expect(conf.fitness_drop).not.toBeNull();
  });

  it('skips confirmation when confirm.seeds is 0', async () => {
    const { deps } = setup();
    expect((await runDiscovery(makeSpec({ confirm: { seeds: 0 } }), ctx, deps).done).confirmation).toBeNull();
  });
});

describe('duplicates', () => {
  it('skips byte-identical proposals without evaluating them', async () => {
    const { deps, kernel, fs } = setup({ mutate: (p) => [{ program: p.replace(/IMPROVE = -?\d+/, 'IMPROVE = 2'), operators: [], description: '' }] });
    const run = await runDiscovery(makeSpec({ search: { generations: 1, candidates_per_generation: 4, islands: 1 }, confirm: { seeds: 0 } }), ctx, deps).done;
    const files = candidatesOf(fs, run);
    expect(files.filter((c) => c.outcome === 'duplicate')).toHaveLength(3);
    expect(files.filter((c) => c.outcome === 'duplicate').every((c) => c.duplicate_of === 'c-0001' && c.evaluation === null)).toBe(true);
    expect(evaluates(kernel)).toHaveLength(2);
    expect(run.usage.proposals.duplicate).toBe(3);
  });

  it('marks a candidate whose kernel program_key is already known as a duplicate', async () => {
    let n = 0;
    const { deps, fs } = setup({ mutate: (p) => { n += 1; return [{ program: `${p.replace(/IMPROVE = -?\d+/, 'IMPROVE = 2')}# variant ${n}\n`, operators: [], description: '' }]; } });
    const run = await runDiscovery(makeSpec({ search: { generations: 1, candidates_per_generation: 3, islands: 1 }, confirm: { seeds: 0 } }), ctx, deps).done;
    const files = candidatesOf(fs, run);
    expect(files.filter((c) => c.outcome === 'duplicate' && c.evaluation !== null)).toHaveLength(2);
    expect(files.filter((c) => c.in_archive && c.mutator !== 'seed')).toHaveLength(1);
  });
});

describe('seed handling', () => {
  it('fails the run when the seed is rejected', async () => {
    const { deps } = setup();
    const run = await runDiscovery(makeSpec(), { ...ctx, seedProgram: 'x = 1\n' }, deps).done;
    expect(run.status).toBe('failed');
    expect(run.stop_reason).toBe('seed_rejected');
    expect(run.message).toContain('no IMPROVE constant');
  });

  it('warns when the seed has no EVOLVE markers', async () => {
    const { deps } = setup();
    const run = await runDiscovery(makeSpec({ search: { generations: 1, candidates_per_generation: 1 }, confirm: { seeds: 0 } }), { ...ctx, seedProgram: 'IMPROVE = 0\n' }, deps).done;
    expect(run.notices.join()).toContain('no EVOLVE-BLOCK markers');
  });

  it('fails clearly when the archive descriptors are unknown', async () => {
    const { deps } = setup();
    const run = await runDiscovery(makeSpec({ search: { archive: { descriptors: ['nope', 'd2'] } } }), ctx, deps).done;
    expect(run.status).toBe('failed');
    expect(run.message).toContain('not all evaluator descriptors');
  });
});

describe('pause, resume and stop', () => {
  it('pauses between steps and continues on resume', async () => {
    const { deps, kernel } = setup();
    kernel.hold.value = true;
    const handle = runDiscovery(makeSpec({ confirm: { seeds: 0 } }), ctx, deps);
    await until(() => evaluates(kernel).length === 1, 'seed eval');
    handle.pause();
    expect(handle.current()?.status).toBe('paused');
    kernel.release();
    await wait(40);
    const sentWhilePaused = evaluates(kernel).length;
    await wait(40);
    expect(evaluates(kernel).length).toBe(sentWhilePaused);
    expect(sentWhilePaused).toBe(1);
    expect(handle.current()?.status).toBe('paused');
    handle.resume();
    expect(handle.current()?.status).toBe('running');
    const run = await handle.done;
    expect(run.status).toBe('completed');
    expect(run.generation).toBe(3);
  });

  it('persists the paused status', async () => {
    const { deps, kernel, fs } = setup();
    kernel.hold.value = true;
    const handle = runDiscovery(makeSpec({ confirm: { seeds: 0 } }), ctx, deps);
    await until(() => evaluates(kernel).length === 1, 'seed eval');
    handle.pause();
    await until(() => [...fs.files.values()].some((v) => v.includes('"status": "paused"')), 'paused run.json');
    handle.stop();
    kernel.release();
    await handle.done;
  });

  it('stops mid-generation: in-flight candidates stay pending, no confirmation', async () => {
    const { deps, kernel, fs } = setup();
    const handle = runDiscovery(makeSpec({ search: { generations: 3, candidates_per_generation: 4, islands: 2 }, budget: { max_concurrent_evaluations: 2 } }), ctx, deps);
    await until(() => evaluates(kernel).length >= 1, 'seed');
    await until(() => handle.current()?.generation === 0 && (handle.current()?.next_candidate_index ?? 0) > 1, 'planning');
    kernel.hold.value = true;
    await until(() => evaluates(kernel).length >= 3 || handle.current()?.generation !== 0, 'in-flight');
    handle.stop();
    const run = await handle.done;
    expect(run.status).toBe('stopped');
    expect(run.stop_reason).toBe('user');
    expect(run.confirmation).toBeNull();
    const files = candidatesOf(fs, run);
    expect(files.some((c) => c.outcome === 'pending' && c.evaluation === null)).toBe(true);
    expect(fs.files.has(`proj/experiments/toy/discovery/${run.run_id}/champion.py`)).toBe(false);
  });

  it('ignores pause/stop after the run has finished', async () => {
    const { deps } = setup();
    const handle = runDiscovery(makeSpec({ confirm: { seeds: 0 } }), ctx, deps);
    const run = await handle.done;
    handle.pause();
    handle.stop();
    expect(run.status).toBe('completed');
  });
});

describe('resume from disk', () => {
  async function stoppedRun() {
    const first = setup();
    first.kernel.hold.value = false;
    const spec = makeSpec({ search: { generations: 3, candidates_per_generation: 4, islands: 2 }, budget: { max_concurrent_evaluations: 2 } });
    const handle = runDiscovery(spec, ctx, first.deps);
    await until(() => handle.current()?.seed_fitness === 0, 'seed scored');
    first.kernel.hold.value = true;
    await until(() => evaluates(first.kernel).length >= 3, 'in-flight');
    handle.stop();
    const run = await handle.done;
    return { spec, run, files: new Map(first.fs.files) };
  }

  it('re-queues unevaluated candidates, never re-evaluates the seed, and completes', async () => {
    const { spec, run, files } = await stoppedRun();
    expect(run.status).toBe('stopped');
    const pendingIds = candidatesOf({ files } as ReturnType<typeof createMemoryFs>, run).filter((c) => c.outcome === 'pending').map((c) => c.id);
    expect(pendingIds.length).toBeGreaterThan(0);

    const second = setup({}, createMemoryFs(Object.fromEntries(files)));
    const resumed = await runDiscovery(spec, { ...ctx, resumeRunId: run.run_id }, second.deps).done;
    expect(resumed.status).toBe('completed');
    expect(resumed.generation).toBe(3);
    const sentIds = evaluates(second.kernel).map((m) => (m as { candidate_id: string }).candidate_id);
    expect(sentIds).not.toContain('c-0000');
    for (const id of pendingIds) expect(sentIds).toContain(id);
    expect(candidatesOf(second.fs, resumed).every((c) => c.outcome !== 'pending')).toBe(true);
    expect(resumed.run_id).toBe(run.run_id);
    expect(resumed.confirmation).not.toBeNull();
  });

  it('is deterministic: identical disk state gives identical results', async () => {
    const { spec, run, files } = await stoppedRun();
    const go = async () => {
      const s = setup({}, createMemoryFs(Object.fromEntries(files)));
      const r = await runDiscovery(spec, { ...ctx, resumeRunId: run.run_id }, s.deps).done;
      return { r, programs: candidatesOf(s.fs, r).map((c) => `${c.id}:${c.program}`) };
    };
    const a = await go();
    const b = await go();
    expect(a.programs).toEqual(b.programs);
    expect(a.r.champion_id).toBe(b.r.champion_id);
    expect(a.r.rng).toEqual(b.r.rng);
    expect(a.r.archive).toEqual(b.r.archive);
  });

  it('reports a missing run as a failed record', async () => {
    const { deps } = setup();
    const run = await runDiscovery(makeSpec(), { ...ctx, resumeRunId: 'nope' }, deps).done;
    expect(run.status).toBe('failed');
    expect(run.message).toContain('no readable run.json');
  });

  it('returns a completed run unchanged', async () => {
    const first = setup();
    const done = await runDiscovery(makeSpec({ confirm: { seeds: 0 } }), ctx, first.deps).done;
    const second = setup({}, first.fs);
    const again = await runDiscovery(makeSpec({ confirm: { seeds: 0 } }), { ...ctx, resumeRunId: done.run_id }, second.deps).done;
    expect(again.status).toBe('completed');
    expect(evaluates(second.kernel)).toHaveLength(0);
  });
});

describe('LLM mutator in the runner', () => {
  const llmSpec = (extra: Record<string, unknown> = {}) =>
    makeSpec({ mutator: { kind: 'llm', models: { breadth: 'haiku', depth: 'opus', depth_share: 0.5, depth_thinking: true }, inspirations: 1 }, search: { generations: 2, candidates_per_generation: 2, islands: 1 }, confirm: { seeds: 0 }, ...extra });

  it('records rationale, usage, prompt hash and model routing on candidates', async () => {
    const { deps, llm, fs } = setup();
    const run = await runDiscovery(llmSpec(), ctx, deps).done;
    const files = candidatesOf(fs, run).filter((c) => c.mutator === 'llm');
    expect(files.length).toBeGreaterThan(0);
    expect(files[0].llm).toMatchObject({ rationale: 'raise it', usage: { input_tokens: 100 } });
    expect(files[0].llm?.prompt_sha256).toBeTruthy();
    expect(new Set(llm.calls.map((c) => c.tier))).toEqual(new Set(['haiku', 'opus']));
    expect(llm.calls.filter((c) => c.depth).every((c) => c.thinking)).toBe(true);
    expect(llm.calls[0].system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(run.usage.llm_calls).toBe(llm.calls.length);
    expect(run.usage.input_tokens).toBe(100 * llm.calls.length);
    expect(run.usage.cache_read_tokens).toBe(50 * llm.calls.length);
  });

  it('refuses to start in llm mode without a key, without touching the kernel', async () => {
    const { deps, llm, kernel } = setup();
    llm.key.value = false;
    const run = await runDiscovery(llmSpec(), ctx, deps).done;
    expect(run.status).toBe('failed');
    expect(run.message).toContain('API key');
    expect(kernel.sent).toHaveLength(0);
  });

  it('hybrid falls back to AST with a visible notice when there is no key', async () => {
    const { deps, llm, fs } = setup();
    llm.key.value = false;
    const run = await runDiscovery(llmSpec({ mutator: { kind: 'hybrid', llm_share: 1 } }), ctx, deps).done;
    expect(run.status).toBe('completed');
    expect(run.notices.join()).toContain('No Anthropic API key');
    expect(candidatesOf(fs, run).some((c) => c.mutator === 'ast')).toBe(true);
    expect(llm.calls).toHaveLength(0);
  });

  it('falls back to AST for a failed hybrid call and notes it', async () => {
    const { deps, llm, fs } = setup();
    llm.propose = async () => ({ ok: false, code: 'http', message: 'overloaded', usage: null, prompt_sha256: null });
    const run = await runDiscovery(llmSpec({ mutator: { kind: 'hybrid', llm_share: 1 } }), ctx, deps).done;
    expect(run.notices.join()).toContain('overloaded');
    expect(candidatesOf(fs, run).some((c) => c.mutator === 'ast')).toBe(true);
  });

  it('records an invalid edit as an invalid_proposal and feeds it back as a rejection reason', async () => {
    const { deps, llm, fs } = setup();
    const bad = createFakeLlm({ edit: () => [{ search: 'import q', replace: 'import z' }] });
    Object.assign(llm, { propose: bad.propose });
    const run = await runDiscovery(llmSpec(), ctx, deps).done;
    const invalid = candidatesOf(fs, run).filter((c) => c.outcome === 'invalid_proposal');
    expect(invalid.length).toBeGreaterThan(0);
    expect(invalid[0].proposal_error).toContain('outside_region');
    expect(invalid[0].evaluation).toBeNull();
    expect(run.usage.proposals.invalid).toBe(invalid.length);
    expect(bad.calls.at(-1)?.user ?? '').toBeDefined();
  });

  it('stops with llm budget in llm mode, and degrades to AST in hybrid mode', async () => {
    const a = setup();
    const llmRun = await runDiscovery(llmSpec({ budget: { max_llm_calls: 1 } }), ctx, a.deps).done;
    expect(llmRun.stop_reason).toBe('max_llm_calls');
    const b = setup();
    const hybrid = await runDiscovery(llmSpec({ mutator: { kind: 'hybrid', llm_share: 1 }, budget: { max_llm_calls: 1 } }), ctx, b.deps).done;
    expect(hybrid.status).toBe('completed');
    expect(hybrid.notices.join()).toContain('LLM call budget used up');
  });

  it('sends inspirations, the gradient map and rejections in later prompts', async () => {
    const scorer: Scorer = (p, s, seed, id) => ({
      ...defaultScorer(p, s, seed, id),
      descriptors: { d1: 2, d2: improveValue(p) * 30 },
      metrics: { gradient_map: { method: 'statevector_sampling', n_qubits: 4, dead_fraction: 0.5, lines: [{ line: 3, parameters: ['a'], variance: 0, dead: true }] } },
    });
    const { deps, llm } = setup({ scorer });
    await runDiscovery(llmSpec({ search: { generations: 3, candidates_per_generation: 2, islands: 1 } }), ctx, deps).done;
    expect(llm.calls[0].user).toContain('Gradient map (from the trusted evaluator)');
    expect(llm.calls.at(-1)!.user).toContain('## Inspirations');
  });

  it('computes touched_dead_lines from the parent gradient map', async () => {
    const scorer: Scorer = (p, s, seed, id) => ({
      ...defaultScorer(p, s, seed, id),
      metrics: { gradient_map: { method: 'statevector_sampling', n_qubits: 4, dead_fraction: 0.5, lines: [{ line: 3, parameters: ['a'], variance: 0, dead: true }] } },
    });
    const { deps, fs } = setup({ scorer });
    const run = await runDiscovery(llmSpec({ search: { generations: 1, candidates_per_generation: 1, islands: 1 } }), ctx, deps).done;
    const llmCandidate = candidatesOf(fs, run).find((c) => c.mutator === 'llm')!;
    expect(llmCandidate.llm?.touched_dead_lines).toBe(1);
  });
});

describe('batch mode', () => {
  const batchSpec = () =>
    makeSpec({ mutator: { kind: 'llm', batch_mode: true, models: { breadth: 'haiku', depth: 'opus', depth_share: 0, depth_thinking: false } }, search: { generations: 1, candidates_per_generation: 3, islands: 1 }, confirm: { seeds: 0 } });

  it('submits a generation as one batch, polls, and uses the results', async () => {
    const { deps, llm, fs, clock } = setup();
    llm.batchState.endAfter = 3;
    const run = await runDiscovery(batchSpec(), ctx, deps).done;
    expect(llm.batchSubmits).toEqual([['c-0001', 'c-0002', 'c-0003']]);
    expect(llm.calls).toHaveLength(0);
    expect(clock.sleeps.length).toBeGreaterThanOrEqual(2);
    expect(run.pending_batch).toBeNull();
    expect(run.usage.llm_calls).toBe(3);
    const files = candidatesOf(fs, run).filter((c) => c.mutator === 'llm');
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((c) => c.llm?.batch_id === 'batch-1' && c.llm.prompt_sha256.length === 64)).toBe(true);
    expect(run.usage.input_tokens).toBe(300);
  });

  it('persists the batch id and a resumed run reattaches instead of resubmitting', async () => {
    const first = setup();
    first.llm.batchState.endAfter = Number.POSITIVE_INFINITY;
    const handle = runDiscovery(batchSpec(), ctx, first.deps);
    await until(() => first.llm.batchState.polls >= 2, 'polling');
    handle.stop();
    const stopped = await handle.done;
    expect(stopped.status).toBe('stopped');
    expect(stopped.pending_batch).toMatchObject({ batch_id: 'batch-1', generation: 1 });
    expect(stopped.pending_batch?.items.map((i) => i.candidate_id)).toEqual(['c-0001', 'c-0002', 'c-0003']);
    const onDisk = JSON.parse(first.fs.files.get(`proj/experiments/toy/discovery/${stopped.run_id}/run.json`)!) as RunRecord;
    expect(onDisk.pending_batch?.batch_id).toBe('batch-1');

    const second = setup({}, createMemoryFs(Object.fromEntries(first.fs.files)));
    second.llm.batchState.endAfter = 1;
    // The fake service remembers batches by id; share its memory with the resumed client.
    Object.assign(second.llm, { batchResults: first.llm.batchResults, submitBatch: first.llm.submitBatch });
    const resumed = await runDiscovery(batchSpec(), { ...ctx, resumeRunId: stopped.run_id }, second.deps).done;
    expect(first.llm.batchSubmits).toHaveLength(1);
    expect(resumed.status).toBe('completed');
    expect(resumed.pending_batch).toBeNull();
    expect(resumed.generation).toBe(1);
    const files = candidatesOf(second.fs, resumed).filter((c) => c.mutator === 'llm');
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((c) => c.llm?.batch_id === 'batch-1')).toBe(true);
  });

  it('falls back to live calls when the batch cannot be created', async () => {
    const { deps, llm } = setup();
    llm.submitBatch = async () => ({ ok: false, message: 'batch api down' });
    const run = await runDiscovery(batchSpec(), ctx, deps).done;
    expect(run.notices.join()).toContain('batch api down');
    expect(llm.calls.length).toBe(3);
  });
});
