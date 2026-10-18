/**
 * Pure planning helpers for the runner: budget checks, mutator choice and
 * proposal plans. All randomness comes from the run RNG and is drawn in a
 * fixed order per proposal, so a plan depends only on (state, rng).
 */

import type {
  ArchiveState,
  DiscoverySpec,
  ModelTier,
  PendingBatchItem,
  RunUsage,
  StopReason,
} from '../../types/discovery';
import { islandElites } from './archive';
import { routeModel } from './llmMutator';
import { selectInspirations, selectParent } from './selection';
import { promotionThreshold } from './cascade';
import type { Rng } from './rng';

export interface BudgetView {
  usage: RunUsage;
  /** Evaluations / LLM calls already planned in the current generation. */
  plannedEvaluations: number;
  plannedLlmCalls: number;
  wallMs: number;
}

export function emptyUsage(): RunUsage {
  return {
    evaluations: 0,
    llm_calls: 0,
    wall_ms: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    proposals: { llm: 0, ast: 0, duplicate: 0, invalid: 0 },
  };
}

/** The first exhausted budget before one more proposal, or null. */
export function exhaustedBudget(spec: DiscoverySpec, view: BudgetView): StopReason | null {
  const { budget } = spec;
  if (view.wallMs >= budget.max_wall_minutes * 60_000) return 'max_wall_time';
  if (view.usage.evaluations + view.plannedEvaluations >= budget.max_evaluations) return 'max_evaluations';
  return null;
}

export function llmBudgetLeft(spec: DiscoverySpec, view: BudgetView): boolean {
  return view.usage.llm_calls + view.plannedLlmCalls < spec.budget.max_llm_calls;
}

export interface PlanItem {
  candidateId: string;
  island: number;
  parentId: string;
  inspirationIds: string[];
  mutator: 'llm' | 'ast';
  tier: ModelTier;
  depth: boolean;
  thinking: boolean;
  astSeed: number;
  evalSeed: number;
  /** Cascade promotion threshold of the island, frozen at generation start. */
  threshold: number | null;
}

export function thresholdForIsland(spec: DiscoverySpec, archive: ArchiveState, island: number): number | null {
  return spec.evaluation.cascade
    ? promotionThreshold(spec.evaluation.promote_if, islandElites(archive, island))
    : null;
}

export interface PlanInput {
  spec: DiscoverySpec;
  archive: ArchiveState;
  rng: Rng;
  candidateId: string;
  /** Global proposal counter, used for round-robin island assignment. */
  proposalIndex: number;
  llmAvailable: boolean;
  llmBudgetLeft: boolean;
}

export type PlanOutcome =
  | { kind: 'plan'; item: PlanItem; llmFallback: 'no_key' | 'llm_budget' | null }
  | { kind: 'stop'; reason: StopReason }
  | { kind: 'empty' };

/**
 * Plan one proposal. RNG draw order is fixed: parent selection, llm-share
 * coin, model-routing draw, AST seed, evaluation seed.
 */
export function planProposal(input: PlanInput): PlanOutcome {
  const { spec, archive, rng } = input;
  const island = input.proposalIndex % archive.islands.length;
  const parent = selectParent(archive, island, rng, spec.search.exploration);
  const wantsLlm = rng.chance(spec.mutator.llm_share);
  const routing = routeModel(rng.next(), spec.mutator.models);
  const astSeed = rng.childSeed();
  const evalSeed = rng.childSeed();
  if (!parent) return { kind: 'empty' };

  const kind = spec.mutator.kind;
  const asksLlm = kind === 'llm' || (kind === 'hybrid' && wantsLlm);
  let useLlm = asksLlm;
  let llmFallback: 'no_key' | 'llm_budget' | null = null;
  if (asksLlm && !input.llmAvailable) {
    useLlm = false;
    llmFallback = 'no_key';
  } else if (asksLlm && !input.llmBudgetLeft) {
    if (kind === 'llm') return { kind: 'stop', reason: 'max_llm_calls' };
    useLlm = false;
    llmFallback = 'llm_budget';
  }

  const inspirations = selectInspirations(archive, parent, spec.mutator.inspirations);
  return {
    kind: 'plan',
    llmFallback,
    item: {
      candidateId: input.candidateId,
      island,
      parentId: parent.candidateId,
      inspirationIds: inspirations.map((e) => e.candidateId),
      mutator: useLlm ? 'llm' : 'ast',
      tier: routing.tier,
      depth: routing.depth,
      thinking: routing.thinking,
      astSeed,
      evalSeed,
      threshold: thresholdForIsland(spec, archive, island),
    },
  };
}

export function toPendingBatchItem(
  item: PlanItem,
  extra: { promptSha256: string; model: string },
): PendingBatchItem {
  return {
    custom_id: item.candidateId,
    candidate_id: item.candidateId,
    island: item.island,
    parent_id: item.parentId,
    inspiration_ids: item.inspirationIds,
    tier: item.tier,
    depth: item.depth,
    eval_seed: item.evalSeed,
    prompt_sha256: extra.promptSha256,
    model: extra.model,
    thinking: item.thinking,
  };
}
