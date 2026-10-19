/**
 * The Conjecture Engine proposer: one Claude Messages API call with the
 * depth model and the forced `propose_conjectures` tool. Nothing here throws:
 * every failure is a typed `ProposeFailure`. Conjectures are validated
 * individually against the kernel schema; valid ones are returned and the
 * rest are reported in `dropped`.
 *
 * No extended thinking is requested, because the API forbids a forced
 * `tool_choice` while thinking is on and this call must always yield a tool use.
 */

import { DIRAC_API_URL } from '../../config/dirac';
import type { Conjecture, ConjectureSchemaInfo } from '../../types/conjecture';
import { MAX_CONJECTURES } from '../../types/conjecture';
import type { LlmUsage } from '../../types/discovery';
import { GuardError, LLM_REQUEST_TIMEOUT_MS, withGuard } from '../discovery/fetchGuard';
import { DISCOVERY_OPUS_MODEL } from '../discovery/models';
import type { Digest } from './digest';
import type { SchemaIssue } from './jsonSchema';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt';
import { buildProposeTool, PROPOSE_TOOL_NAME } from './schema';
import { validateConjecture } from './validate';

export const PROPOSER_MODEL = DISCOVERY_OPUS_MODEL;
const MAX_TOKENS = 8192;

type ProposeFailureCode = 'no_key' | 'network' | 'http' | 'malformed_output' | 'schema_mismatch' | 'aborted' | 'timeout';

export interface DroppedConjecture {
  index: number;
  issues: SchemaIssue[];
}

interface ProposeSuccess {
  ok: true;
  conjectures: Conjecture[];
  dropped: DroppedConjecture[];
  model: string;
  usage: LlmUsage;
  prompt_sha256: string;
}

interface ProposeFailure {
  ok: false;
  code: ProposeFailureCode;
  message: string;
  status?: number;
  dropped?: DroppedConjecture[];
  usage: LlmUsage | null;
  prompt_sha256: string | null;
}

export type ProposeResult = ProposeSuccess | ProposeFailure;

interface ProposerDeps {
  getApiKey: () => string | null | undefined;
  hash: (text: string) => Promise<string>;
  fetch?: typeof fetch;
  apiUrl?: string;
  /** Request timeout (default 5 min). */
  requestTimeoutMs?: number;
}

export interface ProposeInput {
  digest: Digest;
  schema: ConjectureSchemaInfo;
  /** Prefix for renumbered ids, so ids stay unique across proposal batches. */
  idPrefix: string;
}

export interface ConjectureProposer {
  hasKey(): boolean;
  /** `signal` cancels the request; the call also has its own timeout. */
  propose(input: ProposeInput, signal?: AbortSignal): Promise<ProposeResult>;
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

export function buildProposeRequestBody(input: ProposeInput): Record<string, unknown> {
  const tool = buildProposeTool(input.schema);
  return {
    model: PROPOSER_MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: SYSTEM_PROMPT }],
    tools: [tool],
    tool_choice: { type: 'tool', name: PROPOSE_TOOL_NAME },
    messages: [{ role: 'user', content: buildUserPrompt(input.digest, input.schema) }],
  };
}

async function httpError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body?.error?.message === 'string' && body.error.message) return body.error.message;
  } catch {
    /* non-JSON error body */
  }
  return `HTTP ${response.status}`;
}

export function createConjectureProposer(deps: ProposerDeps): ConjectureProposer {
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const apiUrl = deps.apiUrl ?? DIRAC_API_URL;
  const key = () => deps.getApiKey()?.trim() || null;

  const fail = (code: ProposeFailureCode, message: string, extra: Partial<ProposeFailure> = {}): ProposeFailure => ({
    ok: false,
    code,
    message,
    usage: null,
    prompt_sha256: null,
    ...extra,
  });

  async function propose(input: ProposeInput, signal?: AbortSignal): Promise<ProposeResult> {
    const apiKey = key();
    if (!apiKey) return fail('no_key', 'No Anthropic API key. Add one in Settings, Dirac.');
    const body = buildProposeRequestBody(input);
    const prompt_sha256 = await deps.hash(JSON.stringify(body));

    let data: Record<string, unknown>;
    try {
      const fetched = await withGuard(signal, deps.requestTimeoutMs ?? LLM_REQUEST_TIMEOUT_MS, async (guard) => {
        let response: Response;
        try {
          response = await doFetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify(body),
            signal: guard,
          });
        } catch (e) {
          if (guard.aborted) throw e;
          return fail('network', `Network error contacting Anthropic: ${e instanceof Error ? e.message : String(e)}`, { prompt_sha256 });
        }
        if (!response.ok) return fail('http', await httpError(response), { status: response.status, prompt_sha256 });
        try {
          return (await response.json()) as Record<string, unknown>;
        } catch (e) {
          if (guard.aborted) throw e;
          return fail('malformed_output', 'Anthropic returned a non-JSON response.', { prompt_sha256 });
        }
      });
      if ('ok' in fetched && fetched.ok === false) return fetched as ProposeFailure;
      data = fetched as Record<string, unknown>;
    } catch (e) {
      if (e instanceof GuardError) {
        return fail(e.kind, e.kind === 'aborted' ? 'The request was cancelled.' : `Anthropic did not answer: ${e.message}`, { prompt_sha256 });
      }
      throw e;
    }
    const usage = toUsage(data.usage);
    const blocks = Array.isArray(data.content) ? (data.content as Array<{ type?: string; name?: string; input?: unknown }>) : [];
    const toolUse = blocks.find((b) => b?.type === 'tool_use' && b.name === PROPOSE_TOOL_NAME);
    const list = (toolUse?.input as { conjectures?: unknown } | undefined)?.conjectures;
    if (!toolUse || !Array.isArray(list) || list.length === 0) {
      return fail('malformed_output', `The model did not return a ${PROPOSE_TOOL_NAME} call with at least one conjecture.`, { usage, prompt_sha256 });
    }

    const conjectures: Conjecture[] = [];
    const dropped: DroppedConjecture[] = [];
    list.slice(0, MAX_CONJECTURES).forEach((raw, index) => {
      const checked = validateConjecture(raw, input.schema);
      if (checked.ok) conjectures.push({ ...checked.conjecture, id: `${input.idPrefix}-${conjectures.length + 1}` });
      else dropped.push({ index, issues: checked.issues });
    });
    if (conjectures.length === 0) {
      const first = dropped[0]?.issues[0];
      const detail = first ? ` First problem: ${first.path} ${first.message}.` : '';
      return fail('schema_mismatch', `None of the ${dropped.length} proposed conjectures matched the kernel schema.${detail}`, { usage, prompt_sha256, dropped });
    }
    return { ok: true, conjectures, dropped, model: PROPOSER_MODEL, usage, prompt_sha256 };
  }

  return { hasKey: () => key() !== null, propose };
}
