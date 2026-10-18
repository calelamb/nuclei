import { describe, expect, it } from 'vitest';
import type { CandidateRecord } from '../../types/discovery';
import { auditStoredCandidate, exportExploitFixture } from './auditActions';
import { buildExploitRecord } from './redQueen';
import { toJson } from './records';
import { SEED_PROGRAM, TOY_EVALUATOR, createFakeKernel, createFakeLlm, createManualClock, createMemoryFs, joinPath, makeAudit, makeEvaluation, makeSpec, testHash } from './testkit';

const exploitAudit = makeAudit({ verdict: 'exploit', evaluator_fitness: 5, audit_fitness: 0.2, gap: 4.8, reasons: ['bad'] });
const spec = makeSpec({ mutator: { kind: 'red_queen' } });
const candidate: CandidateRecord = {
  id: 'c-0003', parent_id: 'c-0000', island: 0, generation: 1, mutator: 'llm', program: SEED_PROGRAM, program_sha256: 'x', llm: null, ast_ops: null,
  evaluation: makeEvaluation({ candidate_id: 'c-0003' }), created_at: 't', outcome: 'evaluated', eval_seed: 11, inspiration_ids: [], screen: null,
  duplicate_of: null, proposal_error: null, in_archive: false, region_warning: false, reevaluations: [], audit: exploitAudit,
};
const RUN = '20261018-141530-abcd';
const exploitDir = `proj/experiments/toy/discovery/${RUN}/exploits`;

describe('exportExploitFixture', () => {
  it('writes to kernel/tests/fixtures/exploits when that folder exists, without the audit', async () => {
    const fs = createMemoryFs({ 'proj/kernel/tests/fixtures/exploits/.gitkeep': '' });
    const res = await exportExploitFixture(fs, joinPath, 'proj', spec, RUN, 'toy.discovery.yaml', candidate);
    expect(res).toEqual({ ok: true, path: `proj/kernel/tests/fixtures/exploits/rq-${RUN}-c-0003.json`, inKernelFixtures: true, id: `rq-${RUN}-c-0003` });
    const written = JSON.parse(fs.files.get(`proj/kernel/tests/fixtures/exploits/rq-${RUN}-c-0003.json`)!);
    expect(written).toMatchObject({ id: `rq-${RUN}-c-0003`, expect: 'audit_exploit', discovered_by: 'red_queen', entry: 'build', seed: 11, stage: 'full' });
    expect('audit' in written).toBe(false);
    expect(written.notes).toContain('Audit verdict exploit');
  });
  it('falls back to the run exploits folder and says so', async () => {
    const fs = createMemoryFs();
    const res = await exportExploitFixture(fs, joinPath, 'proj', spec, RUN, 'toy.discovery.yaml', candidate);
    expect(res).toMatchObject({ ok: true, inKernelFixtures: false, path: `${exploitDir}/rq-${RUN}-c-0003.json` });
    expect(fs.files.has(`${exploitDir}/rq-${RUN}-c-0003.json`)).toBe(true);
  });
  it('refuses a candidate without an exploit verdict', async () => {
    const res = await exportExploitFixture(createMemoryFs(), joinPath, 'proj', spec, RUN, 'toy.discovery.yaml', { ...candidate, audit: makeAudit() });
    expect(res).toEqual({ ok: false, error: 'c-0003 has no exploit verdict to export.' });
  });
  it('reports write failures', async () => {
    const fs = createMemoryFs();
    fs.writeFile = async () => { throw new Error('disk full'); };
    const res = await exportExploitFixture(fs, joinPath, 'proj', spec, RUN, 'toy.discovery.yaml', candidate);
    expect(res).toEqual({ ok: false, error: 'disk full' });
  });
  it('matches buildExploitRecord minus the audit', async () => {
    const fs = createMemoryFs();
    await exportExploitFixture(fs, joinPath, 'proj', spec, RUN, 'toy.discovery.yaml', candidate);
    const { audit: _a, ...expected } = buildExploitRecord(spec, RUN, candidate, exploitAudit, 'red_queen');
    void _a;
    expect(JSON.parse(fs.files.get(`${exploitDir}/rq-${RUN}-c-0003.json`)!)).toEqual(expected);
  });
});

describe('auditStoredCandidate', () => {
  const ctx = { projectRoot: 'proj', definitionFile: 'toy.discovery.yaml', evaluator: TOY_EVALUATOR, seedProgram: SEED_PROGRAM };
  const stored = { ...candidate, audit: undefined };
  const make = (auditor?: Parameters<typeof createFakeKernel>[0]) => {
    const fs = createMemoryFs({ [`proj/experiments/toy/discovery/${RUN}/candidates/c-0003.json`]: toJson(stored) });
    const kernel = createFakeKernel(auditor);
    return { fs, kernel, deps: { session: kernel.session, fs, llm: createFakeLlm(), clock: createManualClock(), hash: testHash, join: joinPath } };
  };

  it('sends discovery_audit, stores the verdict and records an exploit', async () => {
    const { fs, kernel, deps } = make({ auditor: () => ({ verdict: 'exploit', gap: 2, reasons: ['r'] }) });
    const res = await auditStoredCandidate(spec, ctx, deps, RUN, 'c-0003');
    expect(res.ok && res.audit.verdict).toBe('exploit');
    expect(kernel.audits()).toHaveLength(1);
    const saved = JSON.parse(fs.files.get(`proj/experiments/toy/discovery/${RUN}/candidates/c-0003.json`)!) as CandidateRecord;
    expect(saved.audit?.verdict).toBe('exploit');
    expect(saved.adversarial_fitness).toBe(1002);
    expect(JSON.parse(fs.files.get(`${exploitDir}/c-0003.json`)!)).toMatchObject({ expect: 'audit_exploit' });
  });
  it('works in any mode and tags non-Red-Queen exploits as manual audits', async () => {
    const { fs, deps } = make({ auditor: () => ({ verdict: 'exploit' }) });
    await auditStoredCandidate(makeSpec(), ctx, deps, RUN, 'c-0003');
    expect(JSON.parse(fs.files.get(`${exploitDir}/c-0003.json`)!).discovered_by).toBe('manual_audit');
  });
  it('a consistent verdict writes no exploit', async () => {
    const { fs, deps } = make();
    const res = await auditStoredCandidate(spec, ctx, deps, RUN, 'c-0003');
    expect(res.ok && res.audit.verdict).toBe('consistent');
    expect(fs.files.has(`${exploitDir}/c-0003.json`)).toBe(false);
  });
  it('refuses unknown or unscored candidates', async () => {
    const { deps, fs } = make();
    expect(await auditStoredCandidate(spec, ctx, deps, RUN, 'c-0099')).toMatchObject({ ok: false });
    fs.files.set(`proj/experiments/toy/discovery/${RUN}/candidates/c-0003.json`, toJson({ ...stored, evaluation: makeEvaluation({ status: 'rejected', fitness: null }) }));
    const res = await auditStoredCandidate(spec, ctx, deps, RUN, 'c-0003');
    expect(!res.ok && res.error).toContain('Only scored candidates');
  });
});
