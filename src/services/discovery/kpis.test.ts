import { describe, expect, it } from 'vitest';
import type { CandidateRecord } from '../../types/discovery';
import { computeKpis } from './kpis';
import { createRunView } from './runView';
import { makeEvaluation, makeSpec } from './testkit';
import { emptyUsage } from './planning';
import { createArchive } from './archive';
import { TOY_EVALUATOR } from './testkit';
import type { RunRecord } from '../../types/discovery';

function cand(id: string, patch: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    id, parent_id: 'c-0000', island: 0, generation: 1, mutator: 'ast', program: 'x', program_sha256: 'h', llm: null, ast_ops: null,
    evaluation: makeEvaluation({ fitness: 1 }), created_at: '', outcome: 'evaluated', eval_seed: 1, inspiration_ids: [], screen: null,
    duplicate_of: null, proposal_error: null, in_archive: false, region_warning: false, reevaluations: [], ...patch,
  };
}

function run(patch: Partial<RunRecord> = {}): RunRecord {
  return {
    schema: 1, run_id: 'r', definition_file: 'toy.discovery.yaml', spec: makeSpec(),
    evaluator: { kind: 'state_synthesis', version: '1', fingerprint: null }, status: 'running', stop_reason: null, message: null,
    started_at: '', updated_at: '', finished_at: null, generation: 1, next_candidate_index: 5, rng: [1, 2, 3, 4],
    archive: createArchive([{ key: 'd1', label: 'd1', min: 0, max: 1, bins: 2 }, { key: 'd2', label: 'd2', min: 0, max: 1, bins: 2 }], TOY_EVALUATOR.objectives, 1),
    usage: { ...emptyUsage(), input_tokens: 10, output_tokens: 5, llm_calls: 2, evaluations: 7 }, champion_id: 'c-0002', seed_fitness: 0,
    best_fitness_history: [], stale_generations: 0, pending_batch: null, notices: [], confirmation: null, ...patch,
  };
}

describe('computeKpis', () => {
  const candidates = [
    cand('c-0000', { mutator: 'seed', parent_id: null, evaluation: makeEvaluation({ fitness: 0 }), in_archive: true }),
    cand('c-0001', { mutator: 'llm', evaluation: makeEvaluation({ fitness: 2 }), in_archive: true }),
    cand('c-0002', { mutator: 'ast', evaluation: makeEvaluation({ fitness: 3 }), in_archive: true }),
    cand('c-0003', { mutator: 'ast', evaluation: makeEvaluation({ status: 'rejected', fitness: null }) }),
    cand('c-0004', { evaluation: makeEvaluation({ status: 'failed', fitness: null }) }),
    cand('c-0005', { outcome: 'screened_out' }),
    cand('c-0006', { outcome: 'duplicate', evaluation: null }),
    cand('c-0007', { outcome: 'invalid_proposal', evaluation: null }),
    cand('c-0008', { outcome: 'pending', evaluation: null }),
    cand('c-0009', { mutator: 'llm', evaluation: makeEvaluation({ fitness: -1 }) }),
  ];

  it('counts outcomes and excludes the seed', () => {
    const k = computeKpis(run(), candidates);
    expect(k.counts).toEqual({ proposed: 9, scored: 3, rejected: 1, failed: 1, screenedOut: 1, duplicate: 1, invalid: 1, pending: 1 });
  });

  it('derives fitness delta, acceptance, improvement share and tokens', () => {
    const k = computeKpis(run(), candidates);
    expect(k.bestFitness).toBe(3);
    expect(k.bestDelta).toBe(3);
    expect(k.acceptanceRate).toBeCloseTo(2 / 5);
    expect(k.improvements).toEqual({ llm: 1, ast: 1 });
    expect(k.improvementShare).toEqual({ llm: 0.5, ast: 0.5 });
    expect(k.tokens.total).toBe(15);
    expect(k.llmCalls).toBe(2);
    expect(k.evaluations).toBe(7);
    expect(k.championObjective).toMatchObject({ key: 'err', value: { value: 0.1 } });
  });

  it('handles an empty or missing run', () => {
    const k = computeKpis(null, []);
    expect(k).toMatchObject({ bestFitness: null, acceptanceRate: null, improvementShare: null, championId: null });
    expect(createRunView(run()).order).toEqual([]);
  });

  it('exposes the confirmed primary objective', () => {
    const k = computeKpis(run({ confirmation: { champion_id: 'c-0002', seeds: [1], n_scored: 1, fitness_mean: 3, fitness_ci95: null, fitness_drop: 0, evaluations: [], created_at: '', objectives: [{ key: 'err', label: 'Error', direction: 'minimize', mean: 0.1, ci95: null, n: 1 }] } }), candidates);
    expect(k.confirmedObjective).toMatchObject({ key: 'err', mean: 0.1 });
  });
});
