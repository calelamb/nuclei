import { describe, expect, it } from 'vitest';
import type { CandidateRecord, RunRecord } from '../../types/discovery';
import { optimisticFitness, promotionThreshold, screenReferences } from './cascade';
import { runDiscovery, type DiscoveryRunContext } from './runner';
import {
  SEED_PROGRAM, TOY_EVALUATOR, createFakeKernel, createFakeLlm, createManualClock, createMemoryFs, improveValue,
  joinPath, makeEvaluation, makeSpec, testHash, type Scorer,
} from './testkit';

const ctx: DiscoveryRunContext = {
  projectRoot: 'proj', definitionFile: 'toy.discovery.yaml', evaluator: TOY_EVALUATOR, seedProgram: SEED_PROGRAM,
};

function candidatesOf(fs: ReturnType<typeof createMemoryFs>, run: RunRecord): CandidateRecord[] {
  const prefix = `proj/experiments/toy/discovery/${run.run_id}/candidates/`;
  return [...fs.files.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => JSON.parse(v) as CandidateRecord).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The QEC case (CR-C1): the seed's full-stage fitness is 4.476, but a screen
 * with 5000 shots and zero logical errors is capped near 3.70 with the
 * interval [0, 1.54e-4]. Comparing a child's screen number with the seed's
 * full number can never promote anything.
 */
const SEED_FULL = 4.476;
const SCREEN_CAP = 3.7;
const qecScorer: Scorer = (program, stage) => {
  const value = improveValue(program);
  const full = SEED_FULL + value * 0.1;
  const fitness = stage === 'screen' ? SCREEN_CAP : full;
  const ci: [number, number] = stage === 'screen' ? [0, 1.54e-4] : [full * 1e-5, full * 2e-5];
  return {
    fitness,
    objectives: { err: { value: 0, ci95: ci, direction: 'minimize', label: 'Error' }, cost: { value: 5, direction: 'minimize', label: 'Cost' } },
    descriptors: { d1: 2, d2: Math.max(0, value) * 30 },
    program_key: `key:${value}`,
  };
};

function setup(scorer: Scorer, mutate?: (p: string) => Array<{ program: string; operators: string[]; description: string }>) {
  const kernel = createFakeKernel({ scorer, mutate });
  const fs = createMemoryFs();
  const deps = { session: kernel.session, fs, llm: createFakeLlm(), clock: createManualClock(), hash: testHash, join: joinPath };
  return { kernel, fs, deps };
}

describe('cascade compares like with like (CR-C1)', () => {
  it('promotes a zero-error QEC child and lets the improvement into the archive', async () => {
    const { deps, fs, kernel } = setup(qecScorer, (p) => [{ program: p.replace(/IMPROVE = -?\d+/, 'IMPROVE = 5'), operators: ['x'], description: '' }]);
    const run = await runDiscovery(
      makeSpec({ evaluation: { cascade: true, promote_if: 'island_median' }, search: { generations: 1, candidates_per_generation: 1, islands: 1 }, confirm: { seeds: 0 } }),
      ctx, deps,
    ).done;
    const files = candidatesOf(fs, run);
    const seed = files[0];
    expect(seed.screen?.fitness).toBe(SCREEN_CAP);
    expect(seed.evaluation?.fitness).toBe(SEED_FULL);
    const child = files[1];
    expect(child.outcome).toBe('evaluated');
    expect(child.evaluation?.stage).toBe('full');
    expect(child.evaluation?.fitness).toBeGreaterThan(SEED_FULL);
    expect(child.in_archive).toBe(true);
    expect(run.champion_id).toBe(child.id);
    const stages = kernel.sent.filter((m) => m.type === 'discovery_evaluate').map((m) => `${m.candidate_id}:${(m as { stage?: string }).stage}`);
    expect(stages).toEqual(['c-0000:screen', 'c-0000:full', 'c-0001:screen', 'c-0001:full']);
  });

  it('still drops a child whose screen is clearly worse than the island reference', async () => {
    const scorer: Scorer = (program, stage, seed, id) => {
      const base = qecScorer(program, stage, seed, id);
      if (stage === 'screen' && improveValue(program) === -5) {
        return { ...base, fitness: 1, objectives: { err: { value: 0.1, ci95: [0.08, 0.12], direction: 'minimize', label: 'Error' }, cost: { value: 5, direction: 'minimize', label: 'Cost' } } };
      }
      return base;
    };
    const { deps, fs } = setup(scorer, (p) => [{ program: p.replace(/IMPROVE = -?\d+/, 'IMPROVE = -5'), operators: ['x'], description: '' }]);
    const run = await runDiscovery(
      makeSpec({ evaluation: { cascade: true }, search: { generations: 1, candidates_per_generation: 1, islands: 1 }, confirm: { seeds: 0 } }),
      ctx, deps,
    ).done;
    expect(candidatesOf(fs, run)[1].outcome).toBe('screened_out');
  });

  it('uses the island screen reference, not the full-stage archive fitness, for the threshold', async () => {
    const { deps, fs } = setup(qecScorer);
    const run = await runDiscovery(
      makeSpec({ evaluation: { cascade: true }, search: { generations: 2, candidates_per_generation: 2, islands: 1 }, confirm: { seeds: 0 } }),
      ctx, deps,
    ).done;
    const files = candidatesOf(fs, run);
    expect(files.filter((c) => c.mutator === 'ast').every((c) => c.outcome !== 'screened_out')).toBe(true);
  });
});

describe('max_evaluations counts screen and full runs (CR-M2)', () => {
  it('never sends more kernel evaluations than the budget when every candidate is promoted', async () => {
    let n = 0;
    const { deps, kernel } = setup(qecScorer, (p) => [{ program: p.replace(/IMPROVE = -?\d+/, `IMPROVE = ${(n += 1)}`), operators: ['x'], description: '' }]);
    const run = await runDiscovery(
      makeSpec({
        evaluation: { cascade: true, promote_if: 'always' }, budget: { max_evaluations: 8, max_concurrent_evaluations: 2 },
        search: { generations: 10, candidates_per_generation: 2, islands: 1 }, confirm: { seeds: 0 },
      }),
      ctx, deps,
    ).done;
    const sent = kernel.sent.filter((m) => m.type === 'discovery_evaluate').length;
    expect(run.stop_reason).toBe('max_evaluations');
    expect(sent).toBeLessThanOrEqual(8);
    expect(run.usage.evaluations).toBe(sent);
  });
});

describe('cascade helpers', () => {
  const screened = (lo: number, hi: number, direction: 'minimize' | 'maximize' = 'minimize') =>
    makeEvaluation({ stage: 'screen', fitness: 3.7, objectives: { err: { value: 0, ci95: [lo, hi], direction, label: 'Error' } } });

  it('treats a zero lower bound on a minimised objective as unbounded slack', () => {
    expect(optimisticFitness(screened(0, 1.54e-4), { key: 'err' })).toBe(Number.POSITIVE_INFINITY);
    expect(optimisticFitness(screened(-1, 1), { key: 'err' })).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps finite slack for positive intervals and linear slack for maximised objectives', () => {
    expect(optimisticFitness(screened(1e-4, 1e-3), { key: 'err' })).toBeCloseTo(4.7, 6);
    expect(optimisticFitness(screened(0, 2, 'maximize'), { key: 'err' })).toBeCloseTo(5.7, 6);
  });

  it('builds thresholds from screen references only', () => {
    const refs = screenReferences(
      [{ candidateId: 'a' }, { candidateId: 'b' }, { candidateId: 'c' }] as never,
      (id) => ({ a: 3, b: null, c: 5 } as Record<string, number | null>)[id],
    );
    expect(refs).toEqual([3, 5]);
    expect(promotionThreshold('island_median', refs)).toBe(4);
    expect(promotionThreshold('island_best', refs)).toBe(5);
    expect(promotionThreshold('always', refs)).toBeNull();
    expect(promotionThreshold('island_median', [])).toBeNull();
  });
});

describe('confirmation rejection (qec_memory fault-distance check)', () => {
  const rejectedAt = (values: number[]): Scorer => (program, stage, seed, id) => {
    const base = qecScorer(program, stage, seed, id);
    if (stage === 'confirm' && values.includes(improveValue(program))) {
      return { ...base, status: 'rejected', fitness: null, rejection: { guardrail: 'fault_distance', message: 'exact fault distance 3 is below the claimed 5' } };
    }
    return base;
  };
  const mutate = () => { let n = 0; return (p: string) => [{ program: p.replace(/IMPROVE = -?\d+/, `IMPROVE = ${(n += 1)}`), operators: ['x'], description: '' }]; };
  const spec = () => makeSpec({ evaluation: { cascade: false }, search: { generations: 1, candidates_per_generation: 3, islands: 1 }, confirm: { seeds: 2 } });

  it('does not confirm a champion rejected at confirm, marks it, and falls back to the next-best elite', async () => {
    const top = 3; // the best candidate (highest IMPROVE) is the one rejected
    const { deps, fs } = setup(rejectedAt([top]), mutate());
    const run = await runDiscovery(spec(), ctx, deps).done;
    const files = candidatesOf(fs, run);
    const rejected = files.find((c) => improveValue(c.program) === top)!;
    expect(rejected.confirm_rejection).toMatch(/fault distance/);
    expect(run.champion_id).not.toBe(rejected.id);
    expect(run.champion_id).not.toBeNull();
    expect(run.confirmation?.champion_id).toBe(run.champion_id);
    expect(run.confirmation?.rejection).toBeUndefined();
    expect(run.confirmation?.n_scored).toBe(2);
    expect(run.notices.join()).toMatch(/champion rejected at confirmation: fault_distance/);
  });

  it('ends with no confirmed champion and no confirmed numbers when every elite is rejected', async () => {
    const { deps, fs } = setup(rejectedAt([0, 1, 2, 3]), mutate());
    const run = await runDiscovery(spec(), ctx, deps).done;
    expect(run.champion_id).toBeNull();
    expect(run.confirmation).toBeNull();
    expect(run.message).toMatch(/^no confirmed champion: .*fault distance/);
    expect(fs.files.has(`proj/experiments/toy/discovery/${run.run_id}/champion.py`)).toBe(false);
  });
});
