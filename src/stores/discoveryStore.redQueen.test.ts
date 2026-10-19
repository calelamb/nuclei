import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DiscoveryEnv } from '../services/discovery/env';
import { auditStatus } from '../services/discovery/redQueen';
import {
  SEED_PROGRAM, createFakeKernel, createFakeLlm, createManualClock, createMemoryFs, joinPath, testHash, type FakeKernel, type FakeKernelOptions,
} from '../services/discovery/testkit';
import { selectRunExploits, useDiscoveryStore } from './discoveryStore';

const definition = (mutator: string, extra = '') => `schema: 1
type: discovery
name: toy
program: discovery/toy.py
evaluator: { kind: state_synthesis, config: {} }
search:
  islands: 2
  generations: 2
  candidates_per_generation: 3
  archive: { descriptors: [d1, d2], bins: [4, 4] }
  migration_interval: 0
  early_stop_patience: 0
  exploration: 0
evaluation: { cascade: false }
mutator: { kind: ${mutator} }
${extra}budget: { max_evaluations: 50, max_concurrent_evaluations: 2 }
confirm: { seeds: 2 }
seed: 5
`;

const wait = (ms = 4) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, label: string, limit = 800) {
  for (let i = 0; i < limit && !cond(); i += 1) await wait();
  if (!cond()) throw new Error(`timed out waiting for ${label}`);
}

let kernel: FakeKernel;
let fs: ReturnType<typeof createMemoryFs>;
const store = () => useDiscoveryStore.getState();

function setup(files: Record<string, string>, kernelOptions: FakeKernelOptions = {}) {
  fs = createMemoryFs(files);
  kernel = createFakeKernel({ latencyMs: 1, ...kernelOptions });
  const env: DiscoveryEnv = {
    fs, join: joinPath, hash: testHash, clock: createManualClock(),
    llm: createFakeLlm({ edit: (parent, call) => [{ search: `IMPROVE = ${parent}`, replace: `IMPROVE = ${parent + 2 ** call}` }] }),
    openSession: async () => kernel.session,
  };
  store().reset();
  store().configure(env);
}

const exploitAny: FakeKernelOptions['auditor'] = (m) =>
  m.candidate_id === 'c-0001' ? { verdict: 'exploit', gap: 3, reasons: ['seed-dependent determinism'], checks: [{ id: 'det', label: 'Deterministic', status: 'fail', detail: 'flipped' }] } : {};

afterEach(() => {
  store().reset();
  store().configure(null);
});

describe('Red Queen through the store', () => {
  beforeEach(async () => {
    setup({ 'proj/experiments/toy.discovery.yaml': definition('red_queen', 'red_queen: { audit_every: all, max_audits: 20 }\n'), 'proj/discovery/toy.py': SEED_PROGRAM }, { auditor: exploitAny });
    await store().reload('proj');
  });

  it('runs, derives the exploit list and audit statuses, and counts exploits in the KPIs', async () => {
    const started = await store().startRun('toy.discovery.yaml');
    expect(started.ok).toBe(true);
    await until(() => store().liveRunIds.length === 0, 'run to finish');
    const runId = store().selectedRunId as string;
    const view = store().views[runId];
    expect(view.run.status).toBe('completed');
    const exploits = selectRunExploits(view);
    expect(exploits.map((x) => x.candidateId)).toEqual(['c-0001']);
    expect(exploits[0].id).toBe(`rq-${runId}-c-0001`);
    expect(auditStatus(view.candidates['c-0001'])).toBe('exploit');
    expect(auditStatus(view.candidates['c-0000'])).toBe('none');
    expect(store().kpis[runId].audits.exploits).toBe(1);
    expect(store().kpis[runId].audits.consistent).toBeGreaterThan(0);
  });

  it('exports the fixture to the run folder when the project has no kernel fixtures folder', async () => {
    await store().startRun('toy.discovery.yaml');
    await until(() => store().liveRunIds.length === 0, 'run to finish');
    const runId = store().selectedRunId as string;
    const res = await store().exportExploitFixture(runId, 'c-0001');
    expect(res).toMatchObject({ ok: true, inKernelFixtures: false, path: `proj/experiments/toy/discovery/${runId}/exploits/rq-${runId}-c-0001.json` });
    expect(fs.files.has(`proj/experiments/toy/discovery/${runId}/exploits/rq-${runId}-c-0001.json`)).toBe(true);
  });

  it('exports to kernel/tests/fixtures/exploits when it exists, and reports the path', async () => {
    await store().startRun('toy.discovery.yaml');
    await until(() => store().liveRunIds.length === 0, 'run to finish');
    const runId = store().selectedRunId as string;
    await fs.writeFile('proj/kernel/tests/fixtures/exploits/.gitkeep', '');
    const res = await store().exportExploitFixture(runId, 'c-0001');
    expect(res).toMatchObject({ ok: true, inKernelFixtures: true, path: `proj/kernel/tests/fixtures/exploits/rq-${runId}-c-0001.json` });
    const fixture = JSON.parse(fs.files.get(`proj/kernel/tests/fixtures/exploits/rq-${runId}-c-0001.json`) as string);
    expect(fixture).toMatchObject({ expect: 'audit_exploit', discovered_by: 'red_queen', entry: 'build' });
    expect('audit' in fixture).toBe(false);
  });

  it('refuses to export a candidate that is not an exploit, and an unloaded one', async () => {
    await store().startRun('toy.discovery.yaml');
    await until(() => store().liveRunIds.length === 0, 'run to finish');
    const runId = store().selectedRunId as string;
    expect(await store().exportExploitFixture(runId, 'c-0000')).toEqual({ ok: false, error: 'c-0000 has no exploit verdict to export.' });
    expect(await store().exportExploitFixture(runId, 'c-9999')).toEqual({ ok: false, error: 'That candidate is not loaded.' });
  });
});

describe('manual audits in a standard run', () => {
  beforeEach(async () => {
    setup({ 'proj/experiments/toy.discovery.yaml': definition('ast'), 'proj/discovery/toy.py': SEED_PROGRAM }, { auditor: () => ({ verdict: 'exploit', gap: 2, reasons: ['manual'] }) });
    await store().reload('proj');
    await store().startRun('toy.discovery.yaml');
    await until(() => store().liveRunIds.length === 0, 'run to finish');
  });

  it('audits one candidate on demand and stores the verdict', async () => {
    const runId = store().selectedRunId as string;
    expect(store().views[runId].candidates['c-0001'].audit).toBeUndefined();
    const res = await store().auditCandidate(runId, 'c-0001');
    expect(res.ok).toBe(true);
    expect(kernel.audits().map((a) => a.candidate_id)).toEqual(['c-0001']);
    expect(store().views[runId].candidates['c-0001'].audit?.verdict).toBe('exploit');
    expect(selectRunExploits(store().views[runId])[0]).toMatchObject({ candidateId: 'c-0001', discoveredBy: 'manual_audit' });
    expect(store().pendingActions[`${runId}:audit:c-0001`]).toBeUndefined();
  });

  it('reports a kernel failure without touching the candidate', async () => {
    const runId = store().selectedRunId as string;
    const res = await store().auditCandidate(runId, 'c-9999');
    expect(res.ok).toBe(false);
    expect(store().views[runId].candidates['c-0001'].audit).toBeUndefined();
  });
});

describe('scaffolding a Red Queen discovery', () => {
  it('writes mutator.kind red_queen and the red_queen block, and the file parses', async () => {
    setup({ 'proj/.keep': '' });
    await store().reload('proj');
    const res = await store().createFromTemplate('w-state-synthesis', 'rq run', {}, { kind: 'red_queen', red_queen: { audit_every: 'top_k', top_k: 3, max_audits: 9 } });
    expect(res.ok).toBe(true);
    const text = fs.files.get('proj/experiments/rq-run.discovery.yaml') as string;
    expect(text).toContain('kind: red_queen');
    expect(text).toContain('audit_every: top_k');
    await store().reload('proj');
    const def = store().definitions.find((d) => d.fileName === 'rq-run.discovery.yaml');
    expect(def?.spec.mutator.kind).toBe('red_queen');
    expect(def?.spec.red_queen).toEqual({ audit_every: 'top_k', top_k: 3, max_audits: 9 });
  });
});
