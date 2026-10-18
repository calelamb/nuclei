/**
 * Run KPIs (PRD 14 §3.2 KPI strip), derived purely from a run record and its
 * candidates so the store, the context builder and the UI agree.
 */

import type { CandidateRecord, ConfirmedObjective, ObjectiveValue, RunRecord } from '../../types/discovery';
import { summarizeAudits, type AuditSummary } from './redQueen';

interface CandidateCounts {
  /** Candidates with a program that was proposed (excludes the seed). */
  proposed: number;
  scored: number;
  rejected: number;
  failed: number;
  screenedOut: number;
  duplicate: number;
  invalid: number;
  /** Waiting for an evaluation (in flight or re-queueable). */
  pending: number;
}

export interface DiscoveryKpis {
  seedFitness: number | null;
  bestFitness: number | null;
  /** Best minus seed fitness. */
  bestDelta: number | null;
  championId: string | null;
  championObjective: { key: string; label: string; value: ObjectiveValue } | null;
  confirmedObjective: ConfirmedObjective | null;
  counts: CandidateCounts;
  /** Archive entries over evaluated (non-seed) candidates, or null before any. */
  acceptanceRate: number | null;
  /** Candidates that beat their parent, by mutator. */
  improvements: { llm: number; ast: number };
  /** Share of improvements by mutator; null with no improvements. */
  improvementShare: { llm: number; ast: number } | null;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  llmCalls: number;
  evaluations: number;
  wallMs: number;
  /** Independent audits (Red Queen or manual); `audits.exploits` is the Exploits KPI. */
  audits: AuditSummary;
}

export function computeKpis(run: RunRecord | null, candidates: readonly CandidateRecord[]): DiscoveryKpis {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const counts: CandidateCounts = { proposed: 0, scored: 0, rejected: 0, failed: 0, screenedOut: 0, duplicate: 0, invalid: 0, pending: 0 };
  const improvements = { llm: 0, ast: 0 };
  let evaluated = 0;
  let accepted = 0;

  for (const c of candidates) {
    if (c.mutator === 'seed') continue;
    counts.proposed += 1;
    if (c.outcome === 'duplicate') counts.duplicate += 1;
    else if (c.outcome === 'invalid_proposal') counts.invalid += 1;
    else if (c.outcome === 'screened_out') counts.screenedOut += 1;
    else if (c.outcome === 'pending') counts.pending += 1;
    else if (c.evaluation) {
      evaluated += 1;
      if (c.in_archive) accepted += 1;
      if (c.evaluation.status === 'scored') counts.scored += 1;
      else if (c.evaluation.status === 'rejected') counts.rejected += 1;
      else counts.failed += 1;
      const parentFitness = c.parent_id ? byId.get(c.parent_id)?.evaluation?.fitness : null;
      const fitness = c.evaluation.fitness;
      if (c.evaluation.status === 'scored' && typeof fitness === 'number' && typeof parentFitness === 'number' && fitness > parentFitness) {
        improvements[c.mutator === 'llm' ? 'llm' : 'ast'] += 1;
      }
    }
  }

  const total = improvements.llm + improvements.ast;
  const champion = run?.champion_id ? byId.get(run.champion_id) : undefined;
  const primaryKey = run?.archive.objectives[0]?.key;
  const objective = champion?.evaluation && primaryKey ? champion.evaluation.objectives[primaryKey] : undefined;
  const best = champion?.evaluation?.fitness ?? null;
  const seedFitness = run?.seed_fitness ?? null;
  const usage = run?.usage;
  return {
    seedFitness,
    bestFitness: best,
    bestDelta: best !== null && seedFitness !== null ? best - seedFitness : null,
    championId: run?.champion_id ?? null,
    championObjective: objective && primaryKey ? { key: primaryKey, label: objective.label, value: objective } : null,
    confirmedObjective: run?.confirmation?.objectives.find((o) => o.key === primaryKey) ?? null,
    counts,
    acceptanceRate: evaluated > 0 ? accepted / evaluated : null,
    improvements,
    improvementShare: total > 0 ? { llm: improvements.llm / total, ast: improvements.ast / total } : null,
    tokens: {
      input: usage?.input_tokens ?? 0,
      output: usage?.output_tokens ?? 0,
      cacheRead: usage?.cache_read_tokens ?? 0,
      cacheWrite: usage?.cache_write_tokens ?? 0,
      total: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
    },
    llmCalls: usage?.llm_calls ?? 0,
    evaluations: usage?.evaluations ?? 0,
    wallMs: usage?.wall_ms ?? 0,
    audits: summarizeAudits(candidates),
  };
}
