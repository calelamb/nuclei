import { describe, expect, it } from 'vitest';
import type { CandidateRecord } from '../../types/discovery';
import {
  EMPTY_POLICY, EXPLOIT_BONUS, adversarialFitness, auditStatus, auditsStarted, buildExploitRecord, exploitId, exploitsOf,
  observeScored, redQueenConfig, summarizeAudits, toKernelFixture,
} from './redQueen';
import { makeAudit, makeEvaluation, makeSpec } from './testkit';

const exploitAudit = makeAudit({ verdict: 'exploit', evaluator_fitness: 5, audit_fitness: 0.2, gap: 4.8, reasons: ['bad'], checks: [
  { id: 'a', label: 'A', status: 'pass', detail: null }, { id: 'b', label: 'B', status: 'fail', detail: 'boom' },
] });

function cand(id: string, patch: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    id, parent_id: 'c-0000', island: 0, generation: 1, mutator: 'llm', program: `# ${id}`, program_sha256: id, llm: null, ast_ops: null,
    evaluation: makeEvaluation({ candidate_id: id }), created_at: 't', outcome: 'evaluated', eval_seed: 7, inspiration_ids: [], screen: null,
    duplicate_of: null, proposal_error: null, in_archive: false, region_warning: false, reevaluations: [], ...patch,
  };
}

describe('adversarialFitness', () => {
  it('is the clamped gap for consistent and inconclusive verdicts', () => {
    expect(adversarialFitness(makeAudit({ gap: 1.5 }))).toBe(1.5);
    expect(adversarialFitness(makeAudit({ verdict: 'inconclusive', gap: 0.4 }))).toBe(0.4);
    expect(adversarialFitness(makeAudit({ gap: -3 }))).toBe(0);
    expect(adversarialFitness(makeAudit({ gap: null }))).toBe(0);
  });
  it('is a large bonus plus the gap for an exploit, so an exploit outranks any gap', () => {
    expect(adversarialFitness(exploitAudit)).toBe(EXPLOIT_BONUS + 4.8);
    expect(adversarialFitness(makeAudit({ verdict: 'exploit', gap: null }))).toBe(EXPLOIT_BONUS);
    expect(adversarialFitness(exploitAudit)).toBeGreaterThan(adversarialFitness(makeAudit({ gap: 500 })));
  });
  it('is 0 without an audit', () => {
    expect(adversarialFitness(null)).toBe(0);
    expect(adversarialFitness(undefined)).toBe(0);
  });
});

describe('observeScored', () => {
  const config = { audit_every: 'improvement' as const, top_k: 2 };
  it('improvement: audits a new best or a new cell, not a repeat', () => {
    let state = observeScored(EMPTY_POLICY, config, 1, '0,0');
    expect(state.audit).toBe(true);
    state = observeScored(state.state, config, 0.5, '0,0');
    expect(state.audit).toBe(false);
    state = observeScored(state.state, config, 0.4, '1,0');
    expect(state.audit).toBe(true);
    state = observeScored(state.state, config, 2, '1,0');
    expect(state.audit).toBe(true);
    expect(state.state.bestFitness).toBe(2);
  });
  it('all: always', () => {
    let s = observeScored(EMPTY_POLICY, { audit_every: 'all', top_k: 1 }, 1, '0,0');
    s = observeScored(s.state, { audit_every: 'all', top_k: 1 }, 0, '0,0');
    expect(s.audit).toBe(true);
  });
  it('top_k: audits only the k best evaluator fitnesses so far', () => {
    const cfg = { audit_every: 'top_k' as const, top_k: 2 };
    let s = observeScored(EMPTY_POLICY, cfg, 5, 'a');
    expect(s.audit).toBe(true);
    s = observeScored(s.state, cfg, 3, 'a');
    expect(s.audit).toBe(true);
    s = observeScored(s.state, cfg, 1, 'a');
    expect(s.audit).toBe(false);
    s = observeScored(s.state, cfg, 4, 'a');
    expect(s.audit).toBe(true);
  });
  it('does not mutate the previous state', () => {
    const before = observeScored(EMPTY_POLICY, config, 1, '0,0').state;
    const cellsBefore = [...before.cells];
    observeScored(before, config, 9, '5,5');
    expect([...before.cells]).toEqual(cellsBefore);
    expect(before.bestFitness).toBe(1);
  });
});

describe('exploits and summaries', () => {
  const spec = makeSpec({ mutator: { kind: 'red_queen' } });
  it('builds the exact kernel fixture record', () => {
    const record = buildExploitRecord(spec, 'run1', cand('c-0003'), exploitAudit, 'red_queen');
    expect(record).toMatchObject({
      id: 'rq-run1-c-0003', evaluator: { kind: 'state_synthesis', config: {} }, program: '# c-0003', entry: 'build', seed: 7, stage: 'full',
      discovered_by: 'red_queen', expect: 'audit_exploit', audit: exploitAudit,
    });
    expect(record.title).toBe('Candidate c-0003: bad');
    expect(record.notes).toContain('Audit verdict exploit');
    const fixture = toKernelFixture(record);
    expect('audit' in fixture).toBe(false);
    expect(fixture.notes).toBe(record.notes);
  });
  it('derives exploits from candidates, with only the failing checks', () => {
    const list = [cand('c-0001'), cand('c-0003', { audit: exploitAudit }), cand('c-0004', { audit: makeAudit() })];
    const ex = exploitsOf('run1', list, spec);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ id: exploitId('run1', 'c-0003'), candidateId: 'c-0003', gap: 4.8, discoveredBy: 'red_queen' });
    expect(ex[0].failedChecks.map((c) => c.id)).toEqual(['b']);
    expect(exploitsOf('run1', list, makeSpec())[0].discoveredBy).toBe('manual_audit');
  });
  it('reports audit status and counts', () => {
    const list = [
      cand('c-0001'),
      cand('c-0002', { audit_pending: true }),
      cand('c-0003', { audit: exploitAudit }),
      cand('c-0004', { audit: makeAudit() }),
      cand('c-0005', { audit: makeAudit({ verdict: 'inconclusive', gap: 0.3 }) }),
      cand('c-0006', { audit_error: 'x: y' }),
    ];
    expect(list.map(auditStatus)).toEqual(['none', 'pending', 'exploit', 'consistent', 'inconclusive', 'error']);
    expect(summarizeAudits(list)).toEqual({ run: 3, pending: 1, consistent: 1, inconclusive: 1, exploits: 1, errors: 1, maxGap: 4.8 });
    expect(auditsStarted(list)).toBe(5);
  });
  it('resolves red_queen config defaults', () => {
    expect(redQueenConfig(makeSpec())).toEqual({ audit_every: 'improvement', top_k: 5, max_audits: 50 });
    expect(redQueenConfig(makeSpec({ red_queen: { max_audits: 3 } }))).toEqual({ audit_every: 'improvement', top_k: 5, max_audits: 3 });
  });
});
