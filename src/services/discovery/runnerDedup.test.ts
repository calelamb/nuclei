import { describe, expect, it } from 'vitest';
import type { CandidateRecord, RunRecord } from '../../types/discovery';
import { runDiscovery, type DiscoveryRunContext } from './runner';
import {
  SEED_PROGRAM, TOY_EVALUATOR, createFakeKernel, createFakeLlm, createManualClock, createMemoryFs, defaultScorer, improveValue,
  joinPath, makeSpec, testHash, type FakeKernelOptions, type Scorer,
} from './testkit';

const ctx: DiscoveryRunContext = {
  projectRoot: 'proj', definitionFile: 'toy.discovery.yaml', evaluator: TOY_EVALUATOR, seedProgram: SEED_PROGRAM,
};

function setup(options: FakeKernelOptions) {
  const kernel = createFakeKernel(options);
  const fs = createMemoryFs();
  const deps = { session: kernel.session, fs, llm: createFakeLlm(), clock: createManualClock(), hash: testHash, join: joinPath };
  return { kernel, fs, deps };
}

function candidatesOf(fs: ReturnType<typeof createMemoryFs>, run: RunRecord): CandidateRecord[] {
  const prefix = `proj/experiments/toy/discovery/${run.run_id}/candidates/`;
  return [...fs.files.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => JSON.parse(v) as CandidateRecord).sort((a, b) => a.id.localeCompare(b.id));
}

const keyOfProgram = (p: string) => `key:${improveValue(p)}`;
/** Same IMPROVE value, different text: byte-different (so the client hash misses) but the same kernel key. */
let n = 0;
const sameValueMutation = (value: number) => (p: string) => [{ program: `${p.replace(/IMPROVE = -?\d+/, `IMPROVE = ${value}`)}# variant ${(n += 1)}\n`, operators: ['x'], description: '' }];
const spec = (extra: Record<string, unknown> = {}) =>
  makeSpec({ search: { generations: 1, candidates_per_generation: 3, islands: 1 }, confirm: { seeds: 0 }, budget: { max_concurrent_evaluations: 1 }, ...extra });
const evaluates = (k: ReturnType<typeof createFakeKernel>) => k.sent.filter((m) => m.type === 'discovery_evaluate');

describe('program-key dedup before evaluation (CR-M1)', () => {
  it('skips a known key as duplicate without spending a screen evaluation', async () => {
    n = 0;
    const { deps, fs, kernel } = setup({ programKey: keyOfProgram, mutate: sameValueMutation(4) });
    const run = await runDiscovery(spec({ evaluation: { cascade: true, promote_if: 'always' } }), ctx, deps).done;
    const files = candidatesOf(fs, run).filter((c) => c.mutator !== 'seed');
    expect(files.filter((c) => c.outcome === 'evaluated')).toHaveLength(1);
    const dups = files.filter((c) => c.outcome === 'duplicate');
    expect(dups).toHaveLength(2);
    expect(dups.every((c) => c.duplicate_of === files.find((f) => f.outcome === 'evaluated')?.id && c.evaluation === null)).toBe(true);
    // The seed (screen + full) and the one distinct child (screen + full); nothing for the duplicates.
    expect(evaluates(kernel)).toHaveLength(4);
    expect(run.usage.evaluations).toBe(4);
    expect(run.usage.proposals.duplicate).toBe(2);
    expect(kernel.sent.filter((m) => m.type === 'discovery_program_key').length).toBeGreaterThanOrEqual(3);
  });

  it('registers the seed key on a fresh run, so a child identical to the seed is a duplicate', async () => {
    n = 0;
    const { deps, fs, kernel } = setup({ programKey: keyOfProgram, mutate: sameValueMutation(0) });
    const run = await runDiscovery(spec({ evaluation: { cascade: false } }), ctx, deps).done;
    const children = candidatesOf(fs, run).filter((c) => c.mutator !== 'seed');
    expect(children.every((c) => c.outcome === 'duplicate' && c.duplicate_of === 'c-0000')).toBe(true);
    expect(evaluates(kernel)).toHaveLength(1);
  });

  it('a failed evaluation does not register its key, so a retry of the program is still evaluated', async () => {
    n = 0;
    let calls = 0;
    const flaky: Scorer = (p, s, seed, id) => {
      if (improveValue(p) === 4 && (calls += 1) === 1) return { status: 'failed', fitness: null, failure: { stage: 'sandbox', code: 'sandbox_crash', message: 'worker died' }, program_key: 'key:4' };
      return defaultScorer(p, s, seed, id);
    };
    const { deps, fs } = setup({ programKey: keyOfProgram, mutate: sameValueMutation(4), scorer: flaky });
    const run = await runDiscovery(spec({ evaluation: { cascade: false } }), ctx, deps).done;
    const children = candidatesOf(fs, run).filter((c) => c.mutator !== 'seed');
    expect(children[0].evaluation?.status).toBe('failed');
    expect(children[1].outcome).toBe('evaluated');
    expect(children[1].evaluation?.status).toBe('scored');
    expect(children[2].outcome).toBe('duplicate');
    expect(children[2].duplicate_of).toBe(children[1].id);
  });

  it('a rejected program stays known (its key is registered)', async () => {
    n = 0;
    const rejecting: Scorer = (p, s, seed, id) => (improveValue(p) === 4
      ? { status: 'rejected', fitness: null, rejection: { guardrail: 'noiseless', message: 'no noise' }, program_key: 'key:4' }
      : defaultScorer(p, s, seed, id));
    const { deps, fs } = setup({ programKey: keyOfProgram, mutate: sameValueMutation(4), scorer: rejecting });
    const run = await runDiscovery(spec({ evaluation: { cascade: false } }), ctx, deps).done;
    const children = candidatesOf(fs, run).filter((c) => c.mutator !== 'seed');
    expect(children.map((c) => c.outcome)).toEqual(['evaluated', 'duplicate', 'duplicate']);
  });

  it('falls back to the key carried by the evaluation on an older kernel', async () => {
    n = 0;
    const { deps, fs, kernel } = setup({ mutate: sameValueMutation(4) });
    const run = await runDiscovery(spec({ evaluation: { cascade: false } }), ctx, deps).done;
    const children = candidatesOf(fs, run).filter((c) => c.mutator !== 'seed');
    expect(children.map((c) => c.outcome)).toEqual(['evaluated', 'duplicate', 'duplicate']);
    // Without a pre-check the duplicates were evaluated once each before being recognised.
    expect(evaluates(kernel)).toHaveLength(4);
    expect(kernel.sent.filter((m) => m.type === 'discovery_program_key')).toHaveLength(1);
  });
});
