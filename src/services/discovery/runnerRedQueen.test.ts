import { describe, expect, it } from 'vitest';
import type { CandidateRecord, ExploitRecord, RunRecord } from '../../types/discovery';
import { NO_EXPLOIT_MESSAGE } from './redQueen';
import { runDiscovery, type DiscoveryRunContext, type RunnerEvent } from './runner';
import {
  SEED_PROGRAM, TOY_EVALUATOR, createFakeKernel, createFakeLlm, createManualClock, createMemoryFs, improveValue, joinPath,
  makeSpec, testHash, type FakeKernelOptions, type Scorer,
} from './testkit';

const ctx: DiscoveryRunContext = {
  projectRoot: 'proj', definitionFile: 'toy.discovery.yaml', evaluator: TOY_EVALUATOR, seedProgram: SEED_PROGRAM,
};

const rqSpec = (overrides: Record<string, unknown> = {}) =>
  makeSpec({ mutator: { kind: 'red_queen' }, confirm: { seeds: 2 }, red_queen: { audit_every: 'improvement', max_audits: 50 }, ...overrides });

function setup(kernelOptions: FakeKernelOptions = {}, fs = createMemoryFs()) {
  const kernel = createFakeKernel(kernelOptions);
  // Distinct values per call (binary lineage sums), so no proposal is a duplicate.
  const llm = createFakeLlm({ edit: (parent, call) => [{ search: `IMPROVE = ${parent}`, replace: `IMPROVE = ${parent + 2 ** call}` }] });
  const clock = createManualClock();
  const deps = { session: kernel.session, fs, llm, clock, hash: testHash, join: joinPath };
  return { kernel, llm, clock, fs, deps };
}

const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, label: string, limit = 600) {
  for (let i = 0; i < limit && !cond(); i += 1) await wait(2);
  if (!cond()) throw new Error(`timed out waiting for ${label}`);
}

const dirOf = (run: RunRecord) => `proj/experiments/toy/discovery/${run.run_id}`;

function candidatesOf(fs: ReturnType<typeof createMemoryFs>, run: RunRecord): CandidateRecord[] {
  const prefix = `${dirOf(run)}/candidates/`;
  return [...fs.files.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => JSON.parse(v) as CandidateRecord).sort((a, b) => a.id.localeCompare(b.id));
}

function exploitFiles(fs: ReturnType<typeof createMemoryFs>, run: RunRecord): Array<[string, ExploitRecord]> {
  const prefix = `${dirOf(run)}/exploits/`;
  return [...fs.files.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, JSON.parse(v) as ExploitRecord]);
}

/** Audits `c-0002` as an exploit; every other candidate is consistent. */
const exploitOnC2: NonNullable<FakeKernelOptions['auditor']> = (m) =>
  m.candidate_id === 'c-0002'
    ? {
        verdict: 'exploit', audit_fitness: 0.2, gap: 4.8,
        reasons: ['determinism check passed only under the evaluator seed'],
        checks: [{ id: 'deterministic', label: 'Deterministic under a fresh seed', status: 'fail', detail: 'flipped under seed 99' }],
      }
    : {};

describe('Red Queen runner: audits', () => {
  it('audits scored candidates on improvement, never the seed, with the full wire payload', async () => {
    const { deps, kernel } = setup();
    const run = await runDiscovery(rqSpec(), ctx, deps).done;
    expect(run.status).toBe('completed');
    const audits = kernel.audits();
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.some((a) => a.candidate_id === 'c-0000')).toBe(false);
    for (const a of audits) {
      expect(a).toMatchObject({
        type: 'discovery_audit', run_id: run.run_id, entry: 'build',
        evaluator: { kind: 'state_synthesis', config: {} },
      });
      expect(a.evaluation.candidate_id).toBe(a.candidate_id);
      expect(a.evaluation.status).toBe('scored');
      expect(typeof a.seed).toBe('number');
      expect(improveValue(a.program)).not.toBeNaN();
    }
  });

  it('audit_every: all audits every full-stage scored candidate, once each', async () => {
    const { deps, kernel, fs } = setup();
    const run = await runDiscovery(rqSpec({ red_queen: { audit_every: 'all', max_audits: 100 } }), ctx, deps).done;
    const scored = candidatesOf(fs, run).filter((c) => c.mutator !== 'seed' && c.outcome === 'evaluated' && c.evaluation?.status === 'scored');
    const ids = kernel.audits().map((a) => a.candidate_id);
    expect(ids.sort()).toEqual(scored.map((c) => c.id).sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stores the verdict on the candidate and the adversarial fitness (not the evaluator fitness) in the archive', async () => {
    const { deps, fs } = setup({ auditor: exploitOnC2 });
    const run = await runDiscovery(rqSpec({ red_queen: { audit_every: 'all', max_audits: 100 } }), ctx, deps).done;
    const c2 = candidatesOf(fs, run).find((c) => c.id === 'c-0002')!;
    expect(c2.audit?.verdict).toBe('exploit');
    expect(c2.audit_pending).toBe(false);
    expect(c2.adversarial_fitness).toBeGreaterThanOrEqual(1000);
    const other = candidatesOf(fs, run).find((c) => c.id === 'c-0001')!;
    expect(other.adversarial_fitness).toBe(0);
    const elites = run.archive.islands.flatMap((island) => Object.values(island));
    expect(elites.find((e) => e.candidateId === 'c-0002')?.fitness).toBeGreaterThanOrEqual(1000);
    expect(elites.filter((e) => e.candidateId !== 'c-0002').every((e) => e.fitness < 1000)).toBe(true);
    expect(run.champion_id).toBe('c-0002');
  });

  it('does not run champion confirmation in Red Queen mode', async () => {
    const { deps } = setup();
    const run = await runDiscovery(rqSpec(), ctx, deps).done;
    expect(run.confirmation).toBeNull();
  });

  it('runs only with an API key and says so', async () => {
    const { deps, llm, kernel } = setup();
    llm.key.value = false;
    const run = await runDiscovery(rqSpec(), ctx, deps).done;
    expect(run.status).toBe('failed');
    expect(run.message).toMatch(/Red Queen mode needs an Anthropic API key/);
    expect(kernel.sent).toHaveLength(0);
  });

  it('uses the adversarial prompt: guardrails in the system block, no standard persona', async () => {
    const { deps, llm } = setup();
    await runDiscovery(rqSpec(), ctx, deps).done;
    expect(llm.calls.length).toBeGreaterThan(0);
    const system = llm.calls[0].system[0].text;
    expect(system).toContain('security test of Nuclei');
    expect(system).not.toContain('research collaborator');
  });
});

describe('Red Queen runner: cascade threshold (CR-H5)', () => {
  // Fitness grows with the IMPROVE value, so a descendant of the best elite always beats the best screen result.
  const rising: Scorer = (program) => ({
    fitness: 1 + improveValue(program) * 0.01,
    descriptors: { d1: improveValue(program) % 10, d2: improveValue(program) % 90 },
    program_key: `key:${improveValue(program)}`,
  });

  it('compares screen fitness with evaluator screen fitness, not the adversarial fitness of an exploit', async () => {
    const { deps, fs, kernel } = setup({ auditor: exploitOnC2, scorer: rising });
    const run = await runDiscovery(
      rqSpec({
        evaluation: { cascade: true, promote_if: 'island_best' },
        red_queen: { audit_every: 'all', max_audits: 100 },
        search: { islands: 1, generations: 3, candidates_per_generation: 3, migration_interval: 0, early_stop_patience: 0, exploration: 0 },
      }),
      ctx, deps,
    ).done;
    const files = candidatesOf(fs, run);
    expect(files.find((c) => c.id === 'c-0002')?.audit?.verdict).toBe('exploit');
    // The exploit sits in the archive with adversarial fitness 1000+; the threshold must not read that.
    expect(files.some((c) => c.generation >= 2 && c.outcome === 'evaluated')).toBe(true);
    expect(kernel.audits().some((a) => Number(a.candidate_id.slice(2)) > 3)).toBe(true);
  });
});

describe('Red Queen runner: exploits', () => {
  it('persists each exploit in the kernel fixture format plus the audit', async () => {
    const { deps, fs } = setup({ auditor: exploitOnC2 });
    const events: RunnerEvent[] = [];
    const run = await runDiscovery(rqSpec({ red_queen: { audit_every: 'all', max_audits: 100 } }), ctx, deps, { onEvent: (e) => events.push(e) }).done;
    const files = exploitFiles(fs, run);
    expect(files.map(([k]) => k)).toEqual([`${dirOf(run)}/exploits/c-0002.json`]);
    const record = files[0][1];
    expect(Object.keys(record).sort()).toEqual(
      ['audit', 'discovered_by', 'entry', 'evaluator', 'expect', 'id', 'notes', 'program', 'seed', 'stage', 'title'],
    );
    expect(record).toMatchObject({
      id: `rq-${run.run_id}-c-0002`, evaluator: { kind: 'state_synthesis', config: {} }, entry: 'build', stage: 'full',
      discovered_by: 'red_queen', expect: 'audit_exploit',
    });
    expect(record.audit.verdict).toBe('exploit');
    expect(record.title).toContain('determinism check passed only under the evaluator seed');
    expect(record.notes).toContain('gap 4.8');
    const c2 = candidatesOf(fs, run).find((c) => c.id === 'c-0002')!;
    expect(record.program).toBe(c2.program);
    expect(record.seed).toBe(c2.eval_seed);
    expect(run.message).toBeNull();
    expect(events.some((e) => e.type === 'notice' && e.message.startsWith('Exploit found in c-0002'))).toBe(true);
  });

  it('a run with zero exploits records the honest message and writes no exploit files', async () => {
    const { deps, fs } = setup();
    const run = await runDiscovery(rqSpec(), ctx, deps).done;
    expect(run.status).toBe('completed');
    expect(run.message).toBe(NO_EXPLOIT_MESSAGE);
    expect(run.message).toBe('no exploit found within budget — evidence, not proof, of robustness');
    expect(run.notices).toContain(NO_EXPLOIT_MESSAGE);
    expect(exploitFiles(fs, run)).toHaveLength(0);
  });

  it('a user stop is not reported as "no exploit found within budget"', async () => {
    const { deps, kernel } = setup();
    kernel.holdAudits.value = true;
    const handle = runDiscovery(rqSpec(), ctx, deps);
    await until(() => kernel.audits().length > 0, 'first audit');
    handle.stop();
    const run = await handle.done;
    expect(run.status).toBe('stopped');
    expect(run.message).toBeNull();
  });

  it('feeds earlier exploits back to the adversary', async () => {
    const { deps, llm } = setup({ auditor: exploitOnC2 });
    await runDiscovery(rqSpec({ red_queen: { audit_every: 'all', max_audits: 100 }, search: { islands: 2, generations: 4, candidates_per_generation: 3, migration_interval: 0, early_stop_patience: 0, exploration: 0 } }), ctx, deps).done;
    const later = llm.calls.map((c) => c.user).filter((u) => u.includes('Exploits already found'));
    expect(later.length).toBeGreaterThan(0);
    expect(later[0]).toContain('c-0002 (exploit');
    expect(later[0]).toContain('determinism check passed only under the evaluator seed');
  });
});

describe('Red Queen runner: exploit bar (CR-M3)', () => {
  const withSeedFitness = (seed: number, child: number): Scorer => (program) => ({
    fitness: improveValue(program) === 0 ? seed : child + improveValue(program) * 0.001,
    descriptors: { d1: improveValue(program) % 10, d2: improveValue(program) % 90 },
    program_key: `key:${improveValue(program)}`,
  });
  const allExploits: NonNullable<FakeKernelOptions['auditor']> = () => ({
    verdict: 'exploit', audit_fitness: 0.2, gap: 4,
    reasons: ['determinism check failed'],
    checks: [{ id: 'deterministic', label: 'Deterministic under a fresh seed', status: 'fail', detail: 'flipped' }],
  });

  it('a failing audit below the honest seed fitness is shown but is not an exploit and writes no exploit file', async () => {
    const { deps, fs } = setup({ auditor: allExploits, scorer: withSeedFitness(5, 1) });
    const run = await runDiscovery(rqSpec({ red_queen: { audit_every: 'all', max_audits: 100 } }), ctx, deps).done;
    const files = candidatesOf(fs, run).filter((c) => c.audit);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((c) => c.audit?.verdict === 'inconclusive')).toBe(true);
    expect(files[0].audit?.reasons[0]).toMatch(/audit failure, not an exploit/i);
    expect(files[0].audit?.checks[0].status).toBe('fail');
    expect(exploitFiles(fs, run)).toHaveLength(0);
    expect(run.message).toBe(NO_EXPLOIT_MESSAGE);
  });

  it('at or above the honest seed fitness the same audit is an exploit', async () => {
    const { deps, fs } = setup({ auditor: allExploits, scorer: withSeedFitness(5, 5) });
    const run = await runDiscovery(rqSpec({ red_queen: { audit_every: 'all', max_audits: 100 } }), ctx, deps).done;
    expect(candidatesOf(fs, run).some((c) => c.audit?.verdict === 'exploit')).toBe(true);
    expect(exploitFiles(fs, run).length).toBeGreaterThan(0);
  });
});

describe('Red Queen runner: budgets and control', () => {
  it('respects max_audits', async () => {
    const { deps, kernel } = setup();
    const events: RunnerEvent[] = [];
    await runDiscovery(rqSpec({ red_queen: { audit_every: 'all', max_audits: 2 } }), ctx, deps, { onEvent: (e) => events.push(e) }).done;
    expect(kernel.audits()).toHaveLength(2);
    expect(events.some((e) => e.type === 'notice' && e.message.includes('Audit budget used up (2 audits)'))).toBe(true);
  });

  it('shares max_concurrent_evaluations between evaluations and audits', async () => {
    const { deps, kernel } = setup({ latencyMs: 2 });
    await runDiscovery(rqSpec({ red_queen: { audit_every: 'all', max_audits: 100 }, budget: { max_evaluations: 100, max_llm_calls: 100, max_wall_minutes: 60, max_concurrent_evaluations: 1 } }), ctx, deps).done;
    expect(kernel.audits().length).toBeGreaterThan(1);
    expect(kernel.maxTotalInFlight()).toBe(1);
  });

  it('stop cancels in-flight audits, leaves them pending and sends discovery_audit_cancel', async () => {
    const { deps, kernel, fs } = setup();
    kernel.holdAudits.value = true;
    const handle = runDiscovery(rqSpec(), ctx, deps);
    await until(() => kernel.audits().length > 0, 'first audit');
    handle.stop();
    const run = await handle.done;
    expect(kernel.sent.some((m) => m.type === 'discovery_audit_cancel' && m.run_id === run.run_id)).toBe(true);
    const pending = candidatesOf(fs, run).filter((c) => c.audit_pending === true);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((c) => !c.audit)).toBe(true);
  });

  it('pause holds back new audits until resume', async () => {
    const { deps, kernel } = setup({ latencyMs: 1 });
    const handle = runDiscovery(rqSpec({ red_queen: { audit_every: 'all', max_audits: 100 } }), ctx, deps);
    handle.pause();
    await wait(60);
    const during = kernel.audits().length;
    await wait(60);
    expect(kernel.audits().length).toBe(during);
    handle.resume();
    const run = await handle.done;
    expect(run.status).toBe('completed');
    expect(kernel.audits().length).toBeGreaterThan(during);
  });

  it('resume re-sends pending audits with the same candidate and then completes', async () => {
    const first = setup();
    first.kernel.holdAudits.value = true;
    const h1 = runDiscovery(rqSpec(), ctx, first.deps);
    await until(() => first.kernel.audits().length > 0, 'first audit');
    h1.stop();
    const stopped = await h1.done;
    const pendingIds = candidatesOf(first.fs, stopped).filter((c) => c.audit_pending).map((c) => c.id);
    expect(pendingIds.length).toBeGreaterThan(0);

    const second = setup({}, first.fs);
    const h2 = runDiscovery(rqSpec(), { ...ctx, resumeRunId: stopped.run_id }, second.deps);
    const run = await h2.done;
    expect(run.status).toBe('completed');
    const resent = second.kernel.audits().map((a) => a.candidate_id);
    for (const id of pendingIds) expect(resent).toContain(id);
    const after = candidatesOf(first.fs, run);
    expect(after.filter((c) => c.audit_pending)).toHaveLength(0);
    for (const id of pendingIds) expect(after.find((c) => c.id === id)?.audit?.verdict).toBe('consistent');
  });

  it('a kernel error on an audit is recorded, not fatal', async () => {
    const { deps, fs, kernel } = setup();
    const original = kernel.session.send.bind(kernel.session);
    kernel.session.send = (message) => {
      if (message.type === 'discovery_audit') {
        setTimeout(() => {
          for (const h of handlers) h({ type: 'error', phase: 'discovery', code: 'unknown_evaluator', message: 'no audit for this evaluator', run_id: message.run_id, candidate_id: message.candidate_id });
        }, 0);
        return undefined;
      }
      return original(message);
    };
    const handlers = new Set<(m: never) => void>();
    const sub = kernel.session.subscribe.bind(kernel.session);
    kernel.session.subscribe = (h) => { handlers.add(h as never); return sub(h); };
    const run = await runDiscovery(rqSpec(), ctx, deps).done;
    expect(run.status).toBe('completed');
    const failed = candidatesOf(fs, run).filter((c) => c.audit_error);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0].audit_error).toContain('unknown_evaluator');
    expect(failed[0].audit_pending).toBe(false);
  });
});
