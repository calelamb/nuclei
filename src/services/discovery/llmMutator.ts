/**
 * The LLM mutator (PRD 14 §7.4): Claude Messages API with the
 * `propose_program_edit` tool, plus the Message Batches API for unattended
 * runs. Nothing here throws; every failure is a typed `LlmFailure`.
 *
 * Thinking and tool choice (decision, documented):
 * - Breadth calls (no thinking) FORCE the tool: `tool_choice: {type:'tool'}`.
 * - Depth calls with `depth_thinking` enable thinking. The API forbids a
 *   forced `tool_choice` while thinking is on, so these calls use
 *   `tool_choice: {type:'auto'}` and a validation retry: when the reply has
 *   no valid tool call, the conversation (assistant content incl. thinking
 *   blocks, unmodified) is continued once with a corrective turn.
 *   Batch requests cannot retry; an invalid depth reply there is a failure.
 * - The thinking shape depends on the model generation: `haiku`/4.5-era ids
 *   take `{type:'enabled', budget_tokens}`; 4.6+ ids (our sonnet and opus)
 *   take `{type:'adaptive'}` because 4.7+ rejects `enabled` with HTTP 400.
 */

import { DIRAC_API_URL, HAIKU_MODEL, OPUS_MODEL, SONNET_MODEL } from '../../config/dirac';
import type { GradientMap, LlmUsage, ModelTier } from '../../types/discovery';
import { applyEdits, type ApplyEditsResult, type Edit } from './diff';
import { countTouchedDeadLines } from './gradient';
import type { SystemBlock } from './prompt';

export const TIER_MODEL_IDS: Readonly<Record<ModelTier, string>> = {
  haiku: HAIKU_MODEL,
  sonnet: SONNET_MODEL,
  opus: OPUS_MODEL,
};

export const PROPOSE_TOOL_NAME = 'propose_program_edit';
export const MAX_RATIONALE = 800;
export const MAX_EXPECTED_EFFECT = 300;
export const MAX_EDITS = 8;
const MAX_TOKENS = 4096;
const THINKING_BUDGET_TOKENS = 4096;
export const BATCH_POLL_MS = 15_000;

export const PROPOSE_TOOL = {
  name: PROPOSE_TOOL_NAME,
  description:
    'Propose one small edit to the parent program as SEARCH/REPLACE pairs. Each search must be copied verbatim and match exactly once, inside the EVOLVE-BLOCK region.',
  input_schema: {
    type: 'object' as const,
    properties: {
      rationale: { type: 'string' as const, description: `Your hypothesis, at most ${MAX_RATIONALE} characters.` },
      expected_effect: {
        type: 'string' as const,
        description: `Which objective you expect to move and how, at most ${MAX_EXPECTED_EFFECT} characters.`,
      },
      edits: {
        type: 'array' as const,
        minItems: 1,
        maxItems: MAX_EDITS,
        items: {
          type: 'object' as const,
          properties: { search: { type: 'string' as const }, replace: { type: 'string' as const } },
          required: ['search', 'replace'],
        },
      },
    },
    required: ['rationale', 'expected_effect', 'edits'],
  },
};

export interface ProposeInput {
  system: SystemBlock[];
  user: string;
  tier: ModelTier;
  /** Routed to the depth model. */
  depth: boolean;
  /** Extended thinking requested (only honoured on depth calls). */
  thinking: boolean;
}

export interface LlmProposal {
  rationale: string;
  expected_effect: string;
  edits: Edit[];
}

export type LlmFailureCode = 'no_key' | 'network' | 'http' | 'malformed_output' | 'batch_failed' | 'batch_expired';

export interface LlmSuccess {
  ok: true;
  proposal: LlmProposal;
  model: string;
  thinking: boolean;
  usage: LlmUsage;
  prompt_sha256: string;
}

export interface LlmFailure {
  ok: false;
  code: LlmFailureCode;
  message: string;
  status?: number;
  usage: LlmUsage | null;
  prompt_sha256: string | null;
}

export type LlmResult = LlmSuccess | LlmFailure;

export interface BatchItem {
  customId: string;
  input: ProposeInput;
}

export type BatchPoll = { state: 'in_progress' } | { state: 'ended' } | { state: 'error'; message: string };

/** The runner's view of the model; `createLlmMutator` is the production implementation. */
export interface DiscoveryLlm {
  hasKey(): boolean;
  propose(input: ProposeInput): Promise<LlmResult>;
  submitBatch(items: BatchItem[]): Promise<{ ok: true; batchId: string } | { ok: false; message: string }>;
  pollBatch(batchId: string): Promise<BatchPoll>;
  /** Results keyed by custom id; `prompt_sha256` is filled by the caller from its plan. */
  batchResults(batchId: string): Promise<Record<string, LlmResult>>;
}

export interface LlmMutatorDeps {
  getApiKey: () => string | null | undefined;
  hash: (text: string) => Promise<string>;
  fetch?: typeof fetch;
  apiUrl?: string;
}

// ── Pure helpers ───────────────────────────────────────────────────────

export function emptyUsage(): LlmUsage {
  return { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
}

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
  };
}

function toUsage(raw: unknown): LlmUsage {
  const u = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    input_tokens: n(u.input_tokens),
    output_tokens: n(u.output_tokens),
    cache_creation_input_tokens: n(u.cache_creation_input_tokens),
    cache_read_input_tokens: n(u.cache_read_input_tokens),
  };
}

/** Deterministic breadth/depth routing from the run RNG: one draw per proposal. */
export function routeModel(
  draw: number,
  models: { breadth: ModelTier; depth: ModelTier; depth_share: number; depth_thinking: boolean },
): { tier: ModelTier; depth: boolean; thinking: boolean } {
  const depth = draw < models.depth_share;
  return { tier: depth ? models.depth : models.breadth, depth, thinking: depth && models.depth_thinking };
}

/** 4.6+ models (our sonnet and opus ids) use adaptive thinking; 4.5-era ids use a budget. */
export function usesAdaptiveThinking(modelId: string): boolean {
  return !/claude-(haiku|sonnet|opus)-4-5/.test(modelId) && !/claude-3/.test(modelId);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Validate a tool input; over-long prose is clipped, structural problems are errors. */
export function validateProposal(input: unknown): { ok: true; proposal: LlmProposal } | { ok: false; message: string } {
  if (input === null || typeof input !== 'object') return { ok: false, message: 'tool input is not an object' };
  const raw = input as Record<string, unknown>;
  if (typeof raw.rationale !== 'string' || raw.rationale.trim() === '') {
    return { ok: false, message: 'rationale must be a non-empty string' };
  }
  if (typeof raw.expected_effect !== 'string') return { ok: false, message: 'expected_effect must be a string' };
  if (!Array.isArray(raw.edits) || raw.edits.length < 1 || raw.edits.length > MAX_EDITS) {
    return { ok: false, message: `edits must be an array of 1 to ${MAX_EDITS} items` };
  }
  const edits: Edit[] = [];
  for (const [i, item] of raw.edits.entries()) {
    const e = item as Record<string, unknown> | null;
    if (!e || typeof e.search !== 'string' || typeof e.replace !== 'string') {
      return { ok: false, message: `edits[${i}] needs string search and replace` };
    }
    edits.push({ search: e.search, replace: e.replace });
  }
  return {
    ok: true,
    proposal: {
      rationale: clip(raw.rationale, MAX_RATIONALE),
      expected_effect: clip(raw.expected_effect, MAX_EXPECTED_EFFECT),
      edits,
    },
  };
}

interface ContentBlock {
  type?: string;
  name?: string;
  id?: string;
  input?: unknown;
}

function findToolUse(content: unknown): ContentBlock | null {
  if (!Array.isArray(content)) return null;
  return (content as ContentBlock[]).find((b) => b?.type === 'tool_use' && b.name === PROPOSE_TOOL_NAME) ?? null;
}

export function buildRequestBody(input: ProposeInput, messages?: unknown[]): Record<string, unknown> {
  const model = TIER_MODEL_IDS[input.tier];
  const thinking = input.depth && input.thinking;
  const body: Record<string, unknown> = {
    model,
    max_tokens: thinking && !usesAdaptiveThinking(model) ? MAX_TOKENS + THINKING_BUDGET_TOKENS : MAX_TOKENS,
    system: input.system,
    tools: [PROPOSE_TOOL],
    tool_choice: thinking ? { type: 'auto' } : { type: 'tool', name: PROPOSE_TOOL_NAME },
    messages: messages ?? [{ role: 'user', content: input.user }],
  };
  if (thinking) {
    body.thinking = usesAdaptiveThinking(model)
      ? { type: 'adaptive' }
      : { type: 'enabled', budget_tokens: THINKING_BUDGET_TOKENS };
  }
  return body;
}

/** Apply a proposal to the parent and compute addendum §C's `touched_dead_lines`. */
export function resolveProposal(
  parentProgram: string,
  proposal: LlmProposal,
  parentGradientMap?: GradientMap | null,
): { applied: ApplyEditsResult; touchedDeadLines: number } {
  const applied = applyEdits(parentProgram, proposal.edits);
  return { applied, touchedDeadLines: applied.ok ? countTouchedDeadLines(applied.spans, parentGradientMap) : 0 };
}

// ── Production client ──────────────────────────────────────────────────

export function createLlmMutator(deps: LlmMutatorDeps): DiscoveryLlm {
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const apiUrl = deps.apiUrl ?? DIRAC_API_URL;
  const batchUrl = `${apiUrl}/batches`;
  const key = () => deps.getApiKey()?.trim() || null;

  const headers = (apiKey: string): Record<string, string> => ({
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  });

  const fail = (
    code: LlmFailureCode,
    message: string,
    extra: Partial<Pick<LlmFailure, 'status' | 'usage' | 'prompt_sha256'>> = {},
  ): LlmFailure => ({ ok: false, code, message, usage: null, prompt_sha256: null, ...extra });

  async function httpError(response: Response): Promise<string> {
    let reason = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: unknown } };
      if (typeof body?.error?.message === 'string' && body.error.message) reason = body.error.message;
    } catch {
      /* non-JSON error body; keep the status text */
    }
    return reason;
  }

  async function post(apiKey: string, body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | LlmFailure> {
    let response: Response;
    try {
      response = await doFetch(apiUrl, { method: 'POST', headers: headers(apiKey), body: JSON.stringify(body) });
    } catch (e) {
      return fail('network', `Network error contacting Anthropic: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!response.ok) return fail('http', await httpError(response), { status: response.status });
    try {
      return { ok: true, data: (await response.json()) as Record<string, unknown> };
    } catch {
      return fail('malformed_output', 'Anthropic returned a non-JSON response.');
    }
  }

  async function propose(input: ProposeInput): Promise<LlmResult> {
    const apiKey = key();
    if (!apiKey) return fail('no_key', 'No Anthropic API key. Add one in Settings, Dirac.');
    const model = TIER_MODEL_IDS[input.tier];
    const thinking = input.depth && input.thinking;
    const prompt_sha256 = await deps.hash(JSON.stringify({ model, thinking, system: input.system, user: input.user }));
    let usage = emptyUsage();
    let messages: unknown[] = [{ role: 'user', content: input.user }];
    const attempts = thinking ? 2 : 1; // forced-tool calls need no retry; auto (thinking) calls get one.

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const res = await post(apiKey, buildRequestBody(input, messages));
      if (!res.ok) return { ...res, usage: usage.input_tokens > 0 ? usage : null, prompt_sha256 };
      usage = addUsage(usage, toUsage(res.data.usage));
      const toolUse = findToolUse(res.data.content);
      const checked = toolUse ? validateProposal(toolUse.input) : null;
      if (checked?.ok) return { ok: true, proposal: checked.proposal, model, thinking, usage, prompt_sha256 };

      const problem = checked ? checked.message : 'the reply did not call propose_program_edit';
      if (attempt + 1 >= attempts) return fail('malformed_output', `Model output rejected: ${problem}.`, { usage, prompt_sha256 });
      const assistant = { role: 'assistant', content: res.data.content };
      const followUp = toolUse
        ? { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: `Invalid: ${problem}. Call propose_program_edit again with valid input.` }] }
        : { role: 'user', content: `You must respond by calling ${PROPOSE_TOOL_NAME}. Call it now.` };
      messages = [...messages, assistant, followUp];
    }
    return fail('malformed_output', 'Model output rejected.', { usage, prompt_sha256 });
  }

  async function submitBatch(items: BatchItem[]) {
    const apiKey = key();
    if (!apiKey) return { ok: false as const, message: 'No Anthropic API key. Add one in Settings, Dirac.' };
    const requests = items.map((item) => ({ custom_id: item.customId, params: buildRequestBody(item.input) }));
    try {
      const response = await doFetch(batchUrl, { method: 'POST', headers: headers(apiKey), body: JSON.stringify({ requests }) });
      if (!response.ok) return { ok: false as const, message: await httpError(response) };
      const data = (await response.json()) as { id?: unknown };
      if (typeof data.id !== 'string') return { ok: false as const, message: 'Batch response had no id.' };
      return { ok: true as const, batchId: data.id };
    } catch (e) {
      return { ok: false as const, message: `Network error creating batch: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  async function pollBatch(batchId: string): Promise<BatchPoll> {
    const apiKey = key();
    if (!apiKey) return { state: 'error', message: 'No Anthropic API key.' };
    try {
      const response = await doFetch(`${batchUrl}/${encodeURIComponent(batchId)}`, { headers: headers(apiKey) });
      if (!response.ok) return { state: 'error', message: await httpError(response) };
      const data = (await response.json()) as { processing_status?: unknown };
      return data.processing_status === 'ended' ? { state: 'ended' } : { state: 'in_progress' };
    } catch (e) {
      return { state: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }

  async function batchResults(batchId: string): Promise<Record<string, LlmResult>> {
    const apiKey = key();
    const out: Record<string, LlmResult> = {};
    if (!apiKey) return out;
    let text: string;
    try {
      const response = await doFetch(`${batchUrl}/${encodeURIComponent(batchId)}/results`, { headers: headers(apiKey) });
      if (!response.ok) throw new Error(await httpError(response));
      text = await response.text();
    } catch (e) {
      throw new Error(`Could not fetch batch results: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let entry: { custom_id?: string; result?: { type?: string; message?: Record<string, unknown>; error?: { error?: { message?: string }; message?: string } } };
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (!entry.custom_id) continue;
      out[entry.custom_id] = parseBatchEntry(entry.result);
    }
    return out;
  }

  function parseBatchEntry(result: { type?: string; message?: Record<string, unknown>; error?: { error?: { message?: string }; message?: string } } | undefined): LlmResult {
    if (result?.type === 'succeeded' && result.message) {
      const usage = toUsage(result.message.usage);
      const toolUse = findToolUse(result.message.content);
      const checked = toolUse ? validateProposal(toolUse.input) : null;
      const model = typeof result.message.model === 'string' ? result.message.model : '';
      if (checked?.ok) {
        return { ok: true, proposal: checked.proposal, model, thinking: false, usage, prompt_sha256: '' };
      }
      return fail('malformed_output', `Model output rejected: ${checked ? checked.message : 'no tool call'}.`, { usage });
    }
    if (result?.type === 'expired') return fail('batch_expired', 'The batch request expired before it ran.');
    const message = result?.error?.error?.message ?? result?.error?.message ?? `batch result ${result?.type ?? 'missing'}`;
    return fail('batch_failed', message);
  }

  return { hasKey: () => key() !== null, propose, submitBatch, pollBatch, batchResults };
}
