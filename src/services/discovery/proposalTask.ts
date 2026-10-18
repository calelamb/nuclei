/**
 * One proposal, end to end: produce a program (LLM edit or AST mutation),
 * skip duplicates, evaluate through the cascade, and record the candidate.
 * Never throws; a problem becomes a notice and a skipped or invalid record.
 */

import type { CandidateLlmInfo, CandidateRecord, DiscoveryEvaluation, DiscoveryStage, RunUsage } from '../../types/discovery';
import { optimisticFitness, shouldPromote } from './cascade';
import { isCancelled, isTransportFailure, syntheticFailure } from './kernelEval';
import { resolveProposal, type LlmResult } from './llmMutator';
import type { PlanItem } from './planning';
import { auditIfDue } from './auditStep';
import { buildUserPrompt, summarizeRejections, type PromptCandidate } from './prompt';
import { buildRedQueenUserPrompt } from './redQueenPrompt';
import { primaryObjective, type RunContext } from './runContext';
import type { ProposeInput } from './llmMutator';

function promptView(c: CandidateRecord): PromptCandidate {
  return { id: c.id, program: c.program, evaluation: c.evaluation };
}

/** Best archived fitness; in Red Queen mode that is the adversarial fitness (see redQueen.ts). */
export function bestFitness(ctx: RunContext): number | null {
  let best: number | null = null;
  for (const c of ctx.candidates.values()) {
    const f = !c.in_archive ? null : ctx.rq ? c.adversarial_fitness ?? 0 : c.evaluation?.fitness;
    if (typeof f === 'number' && (best === null || f > best)) best = f;
  }
  return best;
}

export function buildProposeInput(ctx: RunContext, item: PlanItem, generation: number): ProposeInput | null {
  const parent = ctx.candidates.get(item.parentId);
  if (!parent) return null;
  const inspirations = item.inspirationIds
    .map((id) => ctx.candidates.get(id))
    .filter((c): c is CandidateRecord => c !== undefined)
    .map(promptView);
  const { spec } = ctx;
  const common = {
    parent: promptView(parent),
    inspirations,
    rejections: summarizeRejections(ctx.rejections.slice(-50)),
    generation,
    generations: spec.search.generations,
    island: item.island,
    islands: spec.search.islands,
    bestFitness: bestFitness(ctx),
  };
  const user = ctx.rq ? buildRedQueenUserPrompt({ ...common, findings: ctx.rq.findings }) : buildUserPrompt(common);
  return { system: ctx.system, user, tier: item.tier, depth: item.depth, thinking: item.thinking };
}

function noteRejection(ctx: RunContext, evaluation: DiscoveryEvaluation | null): void {
  if (evaluation?.status === 'rejected' && evaluation.rejection) ctx.rejections.push(evaluation.rejection);
}

function now(ctx: RunContext): string {
  return ctx.deps.clock.now().toISOString();
}

interface Produced {
  program: string;
  llm: CandidateLlmInfo | null;
  astOps: string[] | null;
  regionWarning: boolean;
}

type ProduceOutcome = { kind: 'ok'; produced: Produced } | { kind: 'invalid'; record: CandidateRecord } | { kind: 'skip' };

async function produceWithLlm(
  ctx: RunContext,
  item: PlanItem,
  generation: number,
  parent: CandidateRecord,
  batchResult: LlmResult | undefined,
  batchId: string | null,
): Promise<ProduceOutcome | 'fallback'> {
  let result = batchResult;
  if (!result) {
    const input = buildProposeInput(ctx, item, generation);
    if (!input) return { kind: 'skip' };
    ctx.activity(item.candidateId, 'proposing');
    result = await ctx.llmLimit(() => ctx.deps.llm.propose(input, ctx.signal));
    const calls = result.api_calls ?? 1;
    ctx.setUsage((u) => ({ ...u, llm_calls: u.llm_calls + calls }));
  }
  if (result.usage) {
    const usage = result.usage;
    ctx.setUsage((u) => ({
      ...u,
      input_tokens: u.input_tokens + usage.input_tokens,
      output_tokens: u.output_tokens + usage.output_tokens,
      cache_read_tokens: u.cache_read_tokens + usage.cache_read_input_tokens,
      cache_write_tokens: u.cache_write_tokens + usage.cache_creation_input_tokens,
    }));
  }
  if (!result.ok) {
    // Stop aborts the request on purpose: not a failure to report, and never a hybrid fallback.
    if (ctx.control.stopped) return { kind: 'skip' };
    ctx.notice(`LLM proposal failed (${result.code}): ${result.message}`);
    return ctx.spec.mutator.kind === 'hybrid' ? 'fallback' : { kind: 'skip' };
  }
  const gradient = parent.evaluation?.metrics.gradient_map;
  const { applied, touchedDeadLines } = resolveProposal(parent.program, result.proposal, gradient);
  const llm: CandidateLlmInfo = {
    model: result.model,
    tier: item.tier,
    depth: item.depth,
    thinking: item.thinking && item.depth,
    rationale: result.proposal.rationale,
    expected_effect: result.proposal.expected_effect,
    edits: result.proposal.edits,
    usage: result.usage,
    prompt_sha256: result.prompt_sha256,
    touched_dead_lines: touchedDeadLines,
    batch_id: batchId,
  };
  if (!applied.ok) {
    const record = baseRecord(ctx, item, generation, parent.program, await ctx.deps.hash(parent.program), {
      mutator: 'llm',
      llm,
      outcome: 'invalid_proposal',
      proposal_error: `${applied.code}: ${applied.message}`,
    });
    ctx.rejections.push({ guardrail: `edit:${applied.code}`, message: applied.message });
    return { kind: 'invalid', record };
  }
  return { kind: 'ok', produced: { program: applied.program, llm, astOps: null, regionWarning: applied.regionWarning } };
}

function baseRecord(
  ctx: RunContext,
  item: PlanItem,
  generation: number,
  program: string,
  sha: string,
  patch: Partial<CandidateRecord>,
): CandidateRecord {
  return {
    id: item.candidateId,
    parent_id: item.parentId,
    island: item.island,
    generation,
    mutator: 'ast',
    program,
    program_sha256: sha,
    llm: null,
    ast_ops: null,
    evaluation: null,
    created_at: now(ctx),
    outcome: 'pending',
    eval_seed: item.evalSeed,
    inspiration_ids: item.inspirationIds,
    screen: null,
    duplicate_of: null,
    proposal_error: null,
    in_archive: false,
    region_warning: false,
    reevaluations: [],
    ...patch,
  };
}

async function produceWithAst(ctx: RunContext, item: PlanItem, parent: CandidateRecord): Promise<ProduceOutcome> {
  ctx.activity(item.candidateId, 'proposing');
  const res = await ctx.kernel.mutate(parent.program, item.astSeed, 1);
  if (!res.ok || res.mutations.length === 0) {
    ctx.notice(`AST mutation failed: ${res.ok ? 'the kernel returned no mutation' : res.message}`);
    return { kind: 'skip' };
  }
  const m = res.mutations[0];
  return { kind: 'ok', produced: { program: m.program, llm: null, astOps: m.operators, regionWarning: false } };
}

/** Ask the kernel for a program's dedup key; null when unsupported or unanswered (the caller falls back). */
async function programKeyOf(ctx: RunContext, program: string): Promise<string | null> {
  if (ctx.control.stopped) return null;
  const res = await ctx.kernel.programKey(program);
  return res.ok ? res.key : null;
}

/** The candidate that already owns `key`, when it is not this one. */
function keyedDuplicate(ctx: RunContext, key: string | null | undefined, candidateId: string): string | undefined {
  const known = key ? ctx.seenProgramKeys.get(key) : undefined;
  return known && known !== candidateId ? known : undefined;
}

/** Wait out an in-flight evaluation of the same key; resolves with its owner once the key is known, or undefined if it never became known. */
async function waitForKey(ctx: RunContext, key: string, candidateId: string): Promise<string | undefined> {
  for (;;) {
    const known = keyedDuplicate(ctx, key, candidateId);
    if (known) return known;
    const claim = ctx.keyClaims.get(key);
    if (!claim) return undefined;
    await claim;
  }
}

/**
 * Only a scored or rejected program is known: a failed run says nothing about the program, so it
 * must not blacklist it. `firstWins` keeps an earlier owner of the key.
 */
export function registerKey(
  ctx: RunContext,
  key: string | null | undefined,
  candidateId: string,
  evaluation: DiscoveryEvaluation | null,
  firstWins = true,
): void {
  if (!key || !evaluation || (evaluation.status !== 'scored' && evaluation.status !== 'rejected')) return;
  if (firstWins && ctx.seenProgramKeys.has(key)) return;
  ctx.seenProgramKeys.set(key, candidateId);
}

function markDuplicate(ctx: RunContext, candidate: CandidateRecord, of: string, evaluation: DiscoveryEvaluation | null): CandidateRecord {
  ctx.setUsage((u) => ({ ...u, proposals: { ...u.proposals, duplicate: u.proposals.duplicate + 1 } }));
  return { ...candidate, evaluation, outcome: 'duplicate', duplicate_of: of };
}

/**
 * Usage after one kernel evaluation. `max_evaluations` is an honest compute
 * budget (CR-M2): every screen run and every full run counts, so a promoted
 * candidate costs two.
 */
export function countEvaluation(usage: RunUsage): RunUsage {
  return { ...usage, evaluations: usage.evaluations + 1 };
}

/** Evaluate through the cascade; returns the updated record (still `pending` if cancelled). */
export async function evaluateCandidate(
  ctx: RunContext,
  candidate: CandidateRecord,
  threshold: number | null,
): Promise<CandidateRecord> {
  const { spec } = ctx;
  const request = (stage: DiscoveryStage) => ({
    runId: ctx.runId,
    wireId: candidate.id,
    evaluator: { kind: spec.evaluator.kind, config: spec.evaluator.config },
    program: candidate.program,
    entry: spec.entry,
    seed: candidate.eval_seed,
    stage,
  });
  const run = async (stage: DiscoveryStage): Promise<DiscoveryEvaluation> =>
    ctx.evalLimit(async () => {
      if (ctx.control.stopped) return syntheticFailure(request(stage), ctx.evaluator, 'cancelled', 'Run stopped.');
      ctx.activity(candidate.id, stage === 'screen' ? 'screening' : 'evaluating');
      ctx.setUsage(countEvaluation);
      return ctx.kernel.evaluate(request(stage));
    });

  // Ask the kernel for the AST-normalised key first, so a known duplicate costs no evaluation (CR-M1).
  const preKey = await programKeyOf(ctx, candidate.program);
  let release: () => void = () => undefined;
  if (preKey) {
    const known = await waitForKey(ctx, preKey, candidate.id);
    if (known) return markDuplicate(ctx, candidate, known, null);
    const claim = new Promise<void>((resolve) => { release = resolve; });
    ctx.keyClaims.set(preKey, claim);
  }
  let first: DiscoveryEvaluation;
  try {
    first = await run(spec.evaluation.cascade ? 'screen' : 'full');
    if (!isCancelled(first) && !isTransportFailure(first)) registerKey(ctx, preKey ?? first.program_key, candidate.id, first, true);
  } finally {
    if (preKey) ctx.keyClaims.delete(preKey);
    release();
  }
  if (isCancelled(first) || isTransportFailure(first)) return candidate;
  // An older kernel has no program-key request: fall back to the key the evaluation carries.
  const knownLate = preKey ? undefined : keyedDuplicate(ctx, first.program_key, candidate.id);
  if (knownLate) return markDuplicate(ctx, candidate, knownLate, first);

  if (!spec.evaluation.cascade || first.status !== 'scored') {
    noteRejection(ctx, first);
    return { ...candidate, evaluation: first, outcome: 'evaluated', screen: spec.evaluation.cascade ? first : null };
  }
  const promote = shouldPromote(optimisticFitness(first, primaryObjective(ctx.evaluator)), threshold);
  if (!promote) return { ...candidate, screen: first, evaluation: first, outcome: 'screened_out' };

  await ctx.control.gate();
  const full = await run('full');
  if (isCancelled(full) || isTransportFailure(full)) return { ...candidate, screen: first };
  noteRejection(ctx, full);
  return { ...candidate, screen: first, evaluation: full, outcome: 'evaluated' };
}

export async function runProposal(
  ctx: RunContext,
  item: PlanItem,
  generation: number,
  batch?: { result: LlmResult | undefined; batchId: string },
): Promise<CandidateRecord | null> {
  try {
    await ctx.control.gate();
    if (ctx.control.stopped) return null;
    const parent = ctx.candidates.get(item.parentId);
    if (!parent) return null;

    let outcome: ProduceOutcome;
    if (item.mutator === 'llm') {
      const llm = await produceWithLlm(ctx, item, generation, parent, batch?.result, batch?.batchId ?? null);
      outcome = llm === 'fallback' ? await produceWithAst(ctx, item, parent) : llm;
    } else {
      outcome = await produceWithAst(ctx, item, parent);
    }
    if (outcome.kind === 'skip') return null;
    if (outcome.kind === 'invalid') {
      ctx.setUsage((u) => ({ ...u, proposals: { ...u.proposals, invalid: u.proposals.invalid + 1 } }));
      ctx.saveCandidate(outcome.record);
      return outcome.record;
    }

    const { produced } = outcome;
    const sha = await ctx.deps.hash(produced.program);
    const mutator = produced.llm ? 'llm' : 'ast';
    const priorId = ctx.seenHashes.get(sha);
    ctx.setUsage((u) => ({ ...u, proposals: { ...u.proposals, [mutator]: u.proposals[mutator] + 1 } }));
    if (priorId !== undefined) {
      const dup = baseRecord(ctx, item, generation, produced.program, sha, {
        mutator, llm: produced.llm, ast_ops: produced.astOps, outcome: 'duplicate', duplicate_of: priorId,
      });
      ctx.setUsage((u) => ({ ...u, proposals: { ...u.proposals, duplicate: u.proposals.duplicate + 1 } }));
      ctx.saveCandidate(dup);
      return dup;
    }
    ctx.seenHashes.set(sha, item.candidateId);
    const pending = baseRecord(ctx, item, generation, produced.program, sha, {
      mutator, llm: produced.llm, ast_ops: produced.astOps, region_warning: produced.regionWarning,
    });
    ctx.saveCandidate(pending);
    const done = await evaluateCandidate(ctx, pending, item.threshold);
    ctx.saveCandidate(done);
    const audited = await auditIfDue(ctx, done);
    ctx.activity(item.candidateId, 'idle');
    return audited;
  } catch (e) {
    ctx.notice(`Proposal ${item.candidateId} failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

