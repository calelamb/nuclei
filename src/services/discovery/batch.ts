/**
 * Message Batches plumbing for `mutator.batch_mode`: submit one generation's
 * LLM prompts, persist the batch id in the run (so a resumed run reattaches),
 * poll until the batch ends, and collect results by candidate id.
 */

import type { PendingBatch } from '../../types/discovery';
import { BATCH_POLL_MS, TIER_MODEL_IDS, type LlmResult } from './llmMutator';
import { toPendingBatchItem, type PlanItem } from './planning';
import { buildProposeInput } from './proposalTask';
import type { RunContext } from './runContext';

const MAX_POLL_ERRORS = 5;

export async function submitBatch(
  ctx: RunContext,
  items: PlanItem[],
  generation: number,
): Promise<{ ok: true; pending: PendingBatch } | { ok: false; message: string }> {
  const prepared: Array<{ item: PlanItem; input: NonNullable<ReturnType<typeof buildProposeInput>>; hash: string }> = [];
  for (const item of items) {
    const input = buildProposeInput(ctx, item, generation);
    if (!input) continue;
    const model = TIER_MODEL_IDS[item.tier];
    const hash = await ctx.deps.hash(JSON.stringify({ model, thinking: item.depth && item.thinking, system: input.system, user: input.user }));
    prepared.push({ item, input, hash });
  }
  const res = await ctx.deps.llm.submitBatch(prepared.map((p) => ({ customId: p.item.candidateId, input: p.input })), ctx.signal);
  if (!res.ok) return res;
  return {
    ok: true,
    pending: {
      batch_id: res.batchId,
      generation,
      items: prepared.map((p) => toPendingBatchItem(p.item, { promptSha256: p.hash, model: TIER_MODEL_IDS[p.item.tier] })),
    },
  };
}

/** Resolves when the signal aborts (never, for a run that is not stopped). */
function whenAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function missing(message: string): LlmResult {
  return { ok: false, code: 'batch_failed', message, usage: null, prompt_sha256: null };
}

/** Poll until the batch ends; `'interrupted'` when the run is stopped first (the batch id stays persisted). */
export async function awaitBatch(
  ctx: RunContext,
  pending: PendingBatch,
): Promise<Record<string, LlmResult> | 'interrupted'> {
  let errors = 0;
  for (;;) {
    if (ctx.control.stopped) return 'interrupted';
    await ctx.control.gate();
    const poll = await ctx.deps.llm.pollBatch(pending.batch_id, ctx.signal);
    if (ctx.control.stopped) return 'interrupted';
    if (poll.state === 'ended') break;
    if (poll.state === 'error') {
      errors += 1;
      ctx.notice(`Batch poll error: ${poll.message}`);
      if (errors >= MAX_POLL_ERRORS) return Object.fromEntries(pending.items.map((i) => [i.candidate_id, missing(`Batch polling failed: ${poll.message}`)]));
    }
    await Promise.race([ctx.deps.clock.sleep(BATCH_POLL_MS), whenAborted(ctx.signal)]);
  }
  let raw: Record<string, LlmResult> = {};
  try {
    raw = await ctx.deps.llm.batchResults(pending.batch_id, ctx.signal);
  } catch (e) {
    ctx.notice(e instanceof Error ? e.message : String(e));
  }
  const out: Record<string, LlmResult> = {};
  for (const item of pending.items) {
    const r = raw[item.custom_id];
    if (!r) out[item.candidate_id] = missing('The batch returned no result for this request.');
    else if (r.ok) out[item.candidate_id] = { ...r, model: r.model || item.model, thinking: item.thinking && item.depth, prompt_sha256: item.prompt_sha256 };
    else out[item.candidate_id] = { ...r, prompt_sha256: item.prompt_sha256 };
  }
  return out;
}
