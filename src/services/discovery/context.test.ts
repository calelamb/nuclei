import { describe, expect, it } from 'vitest';
import { CONTEXT_MAX_CHARS, buildDiscoveryContext } from './context';
import { createArchive } from './archive';
import { emptyUsage } from './planning';
import { TOY_EVALUATOR, SEED_PROGRAM, makeEvaluation, makeSpec } from './testkit';
import type { CandidateRecord, RunRecord } from '../../types/discovery';

const spec = makeSpec();

function cand(id: string, patch: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    id, parent_id: 'c-0000', island: 0, generation: 1, mutator: 'llm', program: SEED_PROGRAM, program_sha256: 'h', llm: null, ast_ops: null,
    evaluation: makeEvaluation({ fitness: 1 }), created_at: '', outcome: 'evaluated', eval_seed: 1, inspiration_ids: [], screen: null,
    duplicate_of: null, proposal_error: null, in_archive: true, region_warning: false, reevaluations: [], ...patch,
  };
}

const run: RunRecord = {
  schema: 1, run_id: '20261018-141530-abcd', definition_file: 'toy.discovery.yaml', spec,
  evaluator: { kind: 'state_synthesis', version: '1', fingerprint: null }, status: 'completed', stop_reason: 'generations', message: null,
  started_at: '', updated_at: '', finished_at: null, generation: 3, next_candidate_index: 10, rng: [1, 2, 3, 4],
  archive: createArchive([{ key: 'd1', label: 'd1', min: 0, max: 1, bins: 2 }, { key: 'd2', label: 'd2', min: 0, max: 1, bins: 2 }], TOY_EVALUATOR.objectives, 1),
  usage: { ...emptyUsage(), evaluations: 9, llm_calls: 4, wall_ms: 180_000 }, champion_id: 'c-0003', seed_fitness: 0, best_fitness_history: [1],
  stale_generations: 0, pending_batch: null, notices: ['a', 'b', 'c', 'd', 'e'],
  confirmation: { champion_id: 'c-0003', seeds: [1, 2, 3], n_scored: 2, fitness_mean: 2.5, fitness_ci95: [2, 3], fitness_drop: 0.5, evaluations: [], created_at: '', objectives: [{ key: 'err', label: 'Error', direction: 'minimize', mean: 0.01, ci95: [0.009, 0.011], n: 2 }] },
};

describe('buildDiscoveryContext', () => {
  it('is empty with nothing selected', () => {
    expect(buildDiscoveryContext({ spec: null, run: null, candidates: [] })).toBe('');
  });

  it('describes the study alone when there is no run', () => {
    const text = buildDiscoveryContext({ spec, run: null, candidates: [] });
    expect(text).toContain('Study: toy');
    expect(text).not.toContain('Run ');
  });

  it('summarizes budgets, counts, champion, confirmation and discloses truncations', () => {
    const candidates = [
      cand('c-0000', { mutator: 'seed', parent_id: null, evaluation: makeEvaluation({ fitness: 0 }) }),
      ...Array.from({ length: 8 }, (_, i) => cand(`c-${String(i + 1).padStart(4, '0')}`, { evaluation: makeEvaluation({ fitness: i }) })),
      cand('c-0009', { evaluation: makeEvaluation({ status: 'rejected', fitness: null, rejection: { guardrail: 'noiseless', message: 'noise found' } }) }),
    ];
    const text = buildDiscoveryContext({ spec, run, candidates });
    expect(text).toContain('Budget used: 9 of 100 evaluations, 4 of 100 LLM calls, 3 of 60 minutes');
    expect(text).toContain('Top candidates (5 of 8 scored)');
    expect(text).toContain('Top rejection reasons (1 of 1 distinct, 1 rejections)');
    expect(text).toContain('Confirmation on 2 of 3 fresh seeds');
    expect(text).toContain('Notices (3 of 5)');
    expect(text).toContain("Winner's-curse fitness drop 0.5");
  });

  it('includes the selected candidate with a disclosed program excerpt', () => {
    const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const text = buildDiscoveryContext({
      spec, run, selectedCandidateId: 'c-0001',
      candidates: [cand('c-0001', { program: long, llm: { model: 'm', tier: 'haiku', depth: false, thinking: false, rationale: 'because', expected_effect: 'less error', edits: [], usage: null, prompt_sha256: 'x', touched_dead_lines: 0, batch_id: null } })],
    });
    expect(text).toContain('Selected candidate c-0001');
    expect(text).toContain('Rationale: because');
    expect(text).toContain('Program (showing 40 of 100 lines)');
  });

  it('caps its total size with a disclosure', () => {
    const notices = Array.from({ length: 3 }, () => 'x'.repeat(190));
    const huge = cand('c-0001', { program: 'y'.repeat(200000), llm: null });
    const text = buildDiscoveryContext({ spec, run: { ...run, notices }, candidates: [huge], selectedCandidateId: 'c-0001' });
    expect(text.length).toBeLessThanOrEqual(CONTEXT_MAX_CHARS + 80);
    expect(text).toMatch(/context cut at 6000 of \d+ characters/);
  });
});
