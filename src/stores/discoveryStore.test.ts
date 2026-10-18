import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DiscoveryEnv } from '../services/discovery/env';
import {
  SEED_PROGRAM, createFakeKernel, createFakeLlm, createManualClock, createMemoryFs, joinPath, testHash, type FakeKernel,
} from '../services/discovery/testkit';
import { isDiscoveryActive, isDiscoveryRunning, selectSelectedView, useDiscoveryStore } from './discoveryStore';

const DEFINITION = `schema: 1
type: discovery
name: toy
program: discovery/toy.py
evaluator: { kind: state_synthesis, config: {} }
search:
  islands: 2
  generations: 2
  candidates_per_generation: 2
  archive: { descriptors: [d1, d2], bins: [4, 4] }
  migration_interval: 0
  early_stop_patience: 0
  exploration: 0
evaluation: { cascade: false }
mutator: { kind: ast }
budget: { max_evaluations: 50, max_concurrent_evaluations: 2 }
confirm: { seeds: 2 }
seed: 5
`;

const wait = (ms = 4) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, label: string, limit = 500) {
  for (let i = 0; i < limit && !cond(); i += 1) await wait();
  if (!cond()) throw new Error(`timed out waiting for ${label}`);
}

let kernel: FakeKernel;
let fs: ReturnType<typeof createMemoryFs>;
const store = () => useDiscoveryStore.getState();

function makeEnv(files: Record<string, string>): DiscoveryEnv {
  fs = createMemoryFs(files);
  kernel = createFakeKernel({ latencyMs: 2 });
  return {
    fs, join: joinPath, hash: testHash, clock: createManualClock(), llm: createFakeLlm(),
    openSession: async () => kernel.session,
  };
}

const project = () => ({ 'proj/experiments/toy.discovery.yaml': DEFINITION, 'proj/discovery/toy.py': SEED_PROGRAM });

beforeEach(async () => {
  store().reset();
  store().configure(makeEnv(project()));
  await store().reload('proj');
});

afterEach(() => {
  store().reset();
  store().configure(null);
});

describe('definitions', () => {
  it('lists valid definitions and reports malformed ones as data', async () => {
    store().configure(makeEnv({ ...project(), 'proj/experiments/bad.discovery.yaml': 'schema: 1\ntype: discovery\n', 'proj/experiments/notes.txt': 'x' }));
    await store().reload('proj');
    expect(store().definitions.map((d) => d.fileName)).toEqual(['toy.discovery.yaml']);
    expect(store().validationErrors).toHaveLength(1);
    expect(store().validationErrors[0].fileName).toBe('bad.discovery.yaml');
    expect(store().validationErrors[0].errors.join()).toContain('program');
    expect(store().loading).toBe(false);
  });

  it('is empty for a project without experiments', async () => {
    store().configure(makeEnv({}));
    await store().reload('proj');
    expect(store().definitions).toEqual([]);
  });

  it('reports an unconfigured platform instead of throwing', async () => {
    store().configure(null);
    await store().reload('proj');
    expect(store().error).toContain('not configured');
  });

  it('creates a definition and seed from a template, then selects it', async () => {
    const res = await store().createFromTemplate('tfim-ansatz', 'My TFIM', { max_evaluations: 30 }, { kind: 'ast' });
    expect(res).toEqual({ ok: true, definitionFile: 'my-tfim.discovery.yaml' });
    expect(fs.files.has('proj/discovery/my-tfim.py')).toBe(true);
    expect(store().definitions.map((d) => d.fileName)).toContain('my-tfim.discovery.yaml');
    expect(store().selectedDefinition).toBe('my-tfim.discovery.yaml');
    expect(await store().createFromTemplate('tfim-ansatz', 'My TFIM')).toMatchObject({ ok: false });
    expect(await store().createFromTemplate('nope', 'x')).toMatchObject({ ok: false });
  });
});

describe('running', () => {
  it('owns the run: live flags, events, KPIs, then final state on disk', async () => {
    const res = await store().startRun('toy.discovery.yaml');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(isDiscoveryRunning(store())).toBe(true);
    expect(isDiscoveryActive(store())).toBe(true);
    expect(store().selectedRunId).toBe(res.runId);
    expect(await store().startRun('toy.discovery.yaml')).toMatchObject({ ok: false, error: expect.stringContaining('already active') });

    await until(() => !isDiscoveryActive(store()), 'run to finish');
    const view = selectSelectedView(store())!;
    expect(view.run.status).toBe('completed');
    expect(view.order.length).toBeGreaterThan(1);
    expect(view.run.confirmation).not.toBeNull();
    const kpis = store().kpis[res.runId];
    expect(kpis.counts.proposed).toBeGreaterThan(0);
    expect(kpis.bestFitness).not.toBeNull();
    expect(kpis.evaluations).toBe(view.run.usage.evaluations);
    expect(store().runsByDefinition['toy.discovery.yaml'][0].run_id).toBe(res.runId);
    expect(isDiscoveryRunning(store())).toBe(false);
    expect(store().evaluators).toHaveLength(1);
  });

  it('refuses without a project, a valid definition, a seed file, or a known evaluator', async () => {
    store().reset();
    expect(await store().startRun('toy.discovery.yaml')).toMatchObject({ ok: false });
    store().configure(makeEnv({ 'proj/experiments/toy.discovery.yaml': DEFINITION }));
    await store().reload('proj');
    expect(await store().startRun('toy.discovery.yaml')).toMatchObject({ ok: false, error: expect.stringContaining('discovery/toy.py') });
    expect(await store().startRun('missing.discovery.yaml')).toMatchObject({ ok: false });
    store().configure(makeEnv({ ...project(), 'proj/experiments/toy.discovery.yaml': DEFINITION.replace('state_synthesis', 'qec_memory') }));
    await store().reload('proj');
    const res = await store().startRun('toy.discovery.yaml');
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('no "qec_memory" evaluator') });
    expect(isDiscoveryActive(store())).toBe(false);
  });

  it('pauses, resumes and stops through the store', async () => {
    kernel.hold.value = true;
    const res = await store().startRun('toy.discovery.yaml');
    if (!res.ok) throw new Error(res.error);
    await until(() => kernel.sent.some((m) => m.type === 'discovery_evaluate'), 'seed eval');
    store().pauseRun(res.runId);
    expect(store().views[res.runId].run.status).toBe('paused');
    expect(isDiscoveryRunning(store())).toBe(false);
    expect(isDiscoveryActive(store())).toBe(true);
    kernel.release();
    expect(await store().resumeRun(res.runId)).toEqual({ ok: true });
    expect(store().views[res.runId].run.status).toBe('running');
    expect(isDiscoveryRunning(store())).toBe(true);
    store().stopRun(res.runId);
    await until(() => !isDiscoveryActive(store()), 'stop');
    expect(store().views[res.runId].run.status).toBe('stopped');
  });
});

describe('persisted runs', () => {
  async function finishedRun() {
    const res = await store().startRun('toy.discovery.yaml');
    if (!res.ok) throw new Error(res.error);
    await until(() => !isDiscoveryActive(store()), 'finish');
    return res.runId;
  }

  it('loads a run from disk on selection and normalizes a dead "running" run to stale', async () => {
    const runId = await finishedRun();
    const path = `proj/experiments/toy/discovery/${runId}/run.json`;
    fs.files.set(path, fs.files.get(path)!.replace('"status": "completed"', '"status": "running"'));
    store().reset();
    await store().reload('proj');
    expect(store().runsByDefinition['toy.discovery.yaml'][0].status).toBe('stale');
    await store().selectRun(runId);
    const view = selectSelectedView(store())!;
    expect(view.run.status).toBe('stale');
    expect(Object.keys(view.candidates).length).toBeGreaterThan(1);
    expect(store().kpis[runId]).toBeDefined();
    expect(isDiscoveryActive(store())).toBe(false);
  });

  it('resumes a stale run from disk', async () => {
    const runId = await finishedRun();
    const path = `proj/experiments/toy/discovery/${runId}/run.json`;
    const raw = JSON.parse(fs.files.get(path)!);
    fs.files.set(path, JSON.stringify({ ...raw, status: 'stopped', generation: 1, stop_reason: 'user', confirmation: null }));
    store().reset();
    await store().reload('proj');
    expect(await store().resumeRun(runId)).toEqual({ ok: true });
    await until(() => !isDiscoveryActive(store()), 'resumed run');
    expect(store().views[runId].run.status).toBe('completed');
    expect(store().views[runId].run.generation).toBe(2);
  });

  it('promotes a candidate into the project, and writes champion.py for the champion', async () => {
    const runId = await finishedRun();
    const view = store().views[runId];
    const champion = view.run.champion_id!;
    const res = await store().promoteCandidate(runId, champion);
    expect(res).toEqual({ ok: true, path: `discovery/toy.${champion}.py` });
    expect(fs.files.get(`proj/discovery/toy.${champion}.py`)).toBe(view.candidates[champion].program);
    expect(await store().promoteCandidate(runId, 'c-9999')).toMatchObject({ ok: false });
  });

  it('re-confirms the champion on fresh seeds', async () => {
    const runId = await finishedRun();
    const before = store().views[runId].run.confirmation!;
    const res = await store().confirmChampion(runId);
    expect(res).toEqual({ ok: true });
    const after = store().views[runId].run.confirmation!;
    expect(after.seeds).not.toEqual(before.seeds);
    expect(JSON.parse(fs.files.get(`proj/experiments/toy/discovery/${runId}/run.json`)!).confirmation.seeds).toEqual(after.seeds);
    expect(store().pendingActions).toEqual({});
  });

  it('re-evaluates one candidate and appends the result', async () => {
    const runId = await finishedRun();
    const id = store().views[runId].run.champion_id!;
    expect(await store().reevaluateCandidate(runId, id)).toEqual({ ok: true });
    const candidate = store().views[runId].candidates[id];
    expect(candidate.reevaluations).toHaveLength(1);
    expect(candidate.reevaluations[0].seed).not.toBe(candidate.eval_seed);
    expect(await store().reevaluateCandidate(runId, 'c-9999')).toMatchObject({ ok: false });
  });

  it('refuses post-run actions for unknown runs and while the run is live', async () => {
    expect(await store().confirmChampion('nope')).toMatchObject({ ok: false });
    kernel.hold.value = true;
    const res = await store().startRun('toy.discovery.yaml');
    if (!res.ok) throw new Error(res.error);
    await until(() => store().views[res.runId] !== undefined, 'view');
    expect(await store().confirmChampion(res.runId)).toMatchObject({ ok: false, error: expect.stringContaining('finish') });
    store().stopRun(res.runId);
    kernel.release();
    await until(() => !isDiscoveryActive(store()), 'stop');
  });
});

describe('selection', () => {
  it('tracks the selected definition, run and candidate', () => {
    store().selectDefinition('toy.discovery.yaml');
    store().selectCandidate('c-0001');
    expect(store().selectedDefinition).toBe('toy.discovery.yaml');
    expect(store().selectedCandidateId).toBe('c-0001');
    store().selectDefinition(null);
    expect(store().selectedCandidateId).toBeNull();
    expect(selectSelectedView(store())).toBeNull();
  });
});
