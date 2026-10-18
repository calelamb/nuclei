import { describe, expect, it } from 'vitest';
import type { CandidateRecord } from '../../types/discovery';
import { candidateList, createRunView, reduceRunEvent } from './runView';
import { createFakeKernel, makeSpec } from './testkit';
import { runDiscovery } from './runner';
import { SEED_PROGRAM, TOY_EVALUATOR, createFakeLlm, createManualClock, createMemoryFs, joinPath, testHash } from './testkit';

function record(id: string, patch: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    id, parent_id: null, island: 0, generation: 1, mutator: 'ast', program: 'p', program_sha256: 'x', llm: null, ast_ops: null,
    evaluation: null, created_at: 't', outcome: 'pending', eval_seed: 1, inspiration_ids: [], screen: null, duplicate_of: null,
    proposal_error: null, in_archive: false, region_warning: false, reevaluations: [], ...patch,
  };
}

async function someRun() {
  const kernel = createFakeKernel();
  const deps = { session: kernel.session, fs: createMemoryFs(), llm: createFakeLlm(), clock: createManualClock(), hash: testHash, join: joinPath };
  return runDiscovery(makeSpec({ confirm: { seeds: 0 } }), { projectRoot: 'proj', definitionFile: 'toy.discovery.yaml', evaluator: TOY_EVALUATOR, seedProgram: SEED_PROGRAM }, deps).done;
}

describe('run view reducer (CR-M10)', () => {
  it('appends new candidates to order in creation order instead of re-sorting', async () => {
    const run = await someRun();
    let view = createRunView(run, [record('c-0001')]);
    // Past four digits the ids no longer sort lexically; creation order is the truth.
    view = reduceRunEvent(view, { type: 'candidate', candidate: record('c-9999') });
    view = reduceRunEvent(view, { type: 'candidate', candidate: record('c-10000') });
    expect(view.order).toEqual(['c-0001', 'c-9999', 'c-10000']);
    const again = reduceRunEvent(view, { type: 'candidate', candidate: record('c-9999', { outcome: 'evaluated' }) });
    expect(again.order).toBe(view.order);
  });

  it('keeps the candidate list identity across status, activity and notice events', async () => {
    const run = await someRun();
    const view = createRunView(run, [record('c-0001'), record('c-0002')]);
    const list = candidateList(view);
    const afterStatus = reduceRunEvent(view, { type: 'status', run: { ...run, generation: 9 } });
    const afterActivity = reduceRunEvent(afterStatus, { type: 'activity', candidateId: 'c-0001', phase: 'screening' });
    const afterNotice = reduceRunEvent(afterActivity, { type: 'notice', message: 'hello' });
    expect(candidateList(afterNotice)).toBe(list);
    const afterCandidate = reduceRunEvent(afterNotice, { type: 'candidate', candidate: record('c-0003') });
    expect(candidateList(afterCandidate)).not.toBe(list);
    expect(candidateList(afterCandidate).map((c) => c.id)).toEqual(['c-0001', 'c-0002', 'c-0003']);
  });
});

describe('notice caps (low)', () => {
  it('the run record and the view share one cap', async () => {
    const { MAX_NOTICES } = await import('./runContext');
    const { MAX_VIEW_NOTICES } = await import('./runView');
    expect(MAX_VIEW_NOTICES).toBe(MAX_NOTICES);
  });
});
