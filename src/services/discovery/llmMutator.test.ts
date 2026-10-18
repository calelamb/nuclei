import { describe, expect, it, vi } from 'vitest';
import { HAIKU_MODEL, OPUS_MODEL, SONNET_MODEL } from '../../config/dirac';
import {
  PROPOSE_TOOL_NAME, TIER_MODEL_IDS, buildRequestBody, createLlmMutator, resolveProposal, routeModel,
  usesAdaptiveThinking, validateProposal, type ProposeInput,
} from './llmMutator';
import { createRng } from './rng';
import { SEED_PROGRAM, testHash } from './testkit';

const input = (patch: Partial<ProposeInput> = {}): ProposeInput => ({
  system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
  user: 'user prompt', tier: 'haiku', depth: false, thinking: false, ...patch,
});

const goodTool = { rationale: 'r', expected_effect: 'e', edits: [{ search: 'IMPROVE = 0', replace: 'IMPROVE = 1' }] };
const message = (content: unknown[], usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 }) => ({ content, usage, model: 'm' });
const toolUse = (inputValue: unknown) => ({ type: 'tool_use', id: 'tu_1', name: PROPOSE_TOOL_NAME, input: inputValue });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mutator(fetchImpl: typeof fetch, key: string | null = 'sk-test') {
  return createLlmMutator({ getApiKey: () => key, hash: testHash, fetch: fetchImpl });
}

describe('request shape', () => {
  it('forces the tool for breadth calls and uses compose.ts headers', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(message([toolUse(goodTool)])));
    const result = await mutator(fetchMock as unknown as typeof fetch).propose(input());
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk-test', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
    });
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(HAIKU_MODEL);
    expect(body.tool_choice).toEqual({ type: 'tool', name: PROPOSE_TOOL_NAME });
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.thinking).toBeUndefined();
    expect(body.tools[0].input_schema.properties.edits.maxItems).toBe(8);
  });

  it('records usage and a stable prompt hash', async () => {
    const f = vi.fn(async () => jsonResponse(message([toolUse(goodTool)])));
    const a = await mutator(f as unknown as typeof fetch).propose(input());
    const b = await mutator(f as unknown as typeof fetch).propose(input());
    const c = await mutator(f as unknown as typeof fetch).propose(input({ user: 'other' }));
    if (!a.ok || !b.ok || !c.ok) throw new Error('expected success');
    expect(a.usage).toEqual({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 });
    expect(a.prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.prompt_sha256).toBe(b.prompt_sha256);
    expect(a.prompt_sha256).not.toBe(c.prompt_sha256);
  });
});

describe('failures are typed, never thrown', () => {
  it('no key', async () => {
    const f = vi.fn();
    const llm = mutator(f as unknown as typeof fetch, null);
    expect(llm.hasKey()).toBe(false);
    expect(await llm.propose(input())).toMatchObject({ ok: false, code: 'no_key' });
    expect(f).not.toHaveBeenCalled();
  });

  it('HTTP error with the API message', async () => {
    const f = async () => jsonResponse({ error: { message: 'overloaded' } }, 529);
    expect(await mutator(f as unknown as typeof fetch).propose(input())).toMatchObject({ ok: false, code: 'http', status: 529, message: 'overloaded' });
  });

  it('network error', async () => {
    const f = async () => { throw new Error('offline'); };
    expect(await mutator(f as unknown as typeof fetch).propose(input())).toMatchObject({ ok: false, code: 'network' });
  });

  it('malformed tool output', async () => {
    for (const bad of [{ rationale: 'r' }, { ...goodTool, edits: [] }, { ...goodTool, edits: Array(9).fill(goodTool.edits[0]) }, { ...goodTool, edits: [{ search: 1 }] }]) {
      const f = async () => jsonResponse(message([toolUse(bad)]));
      const res = await mutator(f as unknown as typeof fetch).propose(input());
      expect(res).toMatchObject({ ok: false, code: 'malformed_output' });
    }
    const noTool = async () => jsonResponse(message([{ type: 'text', text: 'sorry' }]));
    expect(await mutator(noTool as unknown as typeof fetch).propose(input())).toMatchObject({ ok: false, code: 'malformed_output' });
    const notJson = async () => new Response('<html>', { status: 200 });
    expect(await mutator(notJson as unknown as typeof fetch).propose(input())).toMatchObject({ ok: false, code: 'malformed_output' });
  });

  it('clips over-long prose instead of failing', () => {
    const res = validateProposal({ ...goodTool, rationale: 'x'.repeat(2000), expected_effect: 'y'.repeat(900) });
    expect(res.ok && res.proposal.rationale.length).toBe(800);
    expect(res.ok && res.proposal.expected_effect.length).toBe(300);
  });
});

describe('routing and thinking', () => {
  const models = { breadth: 'haiku', depth: 'opus', depth_share: 0.2, depth_thinking: true } as const;

  it('routes deterministically from the run RNG with the configured depth share', () => {
    const run = (seed: number) => { const r = createRng(seed); return Array.from({ length: 500 }, () => routeModel(r.next(), models)); };
    expect(run(9)).toEqual(run(9));
    const depth = run(9).filter((x) => x.depth).length;
    expect(depth).toBeGreaterThan(70);
    expect(depth).toBeLessThan(130);
    expect(routeModel(0.1, models)).toEqual({ tier: 'opus', depth: true, thinking: true });
    expect(routeModel(0.5, models)).toEqual({ tier: 'haiku', depth: false, thinking: false });
    expect(routeModel(0.1, { ...models, depth_thinking: false }).thinking).toBe(false);
  });

  it('maps tiers to the ids in config/dirac', () => {
    expect(TIER_MODEL_IDS).toEqual({ haiku: HAIKU_MODEL, sonnet: SONNET_MODEL, opus: OPUS_MODEL });
  });

  it('uses adaptive thinking with tool_choice auto on depth calls (forced choice is incompatible)', () => {
    const body = buildRequestBody(input({ tier: 'opus', depth: true, thinking: true }));
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(usesAdaptiveThinking('claude-opus-4-7')).toBe(true);
    expect(usesAdaptiveThinking('claude-haiku-4-5-20251001')).toBe(false);
  });

  it('thinking only applies to depth calls', () => {
    const body = buildRequestBody(input({ tier: 'haiku', depth: false, thinking: true }));
    expect(body.thinking).toBeUndefined();
    expect(body.tool_choice).toEqual({ type: 'tool', name: PROPOSE_TOOL_NAME });
  });

  it('retries a depth call once when the model skips the tool, passing back the assistant turn', async () => {
    const thinkingBlock = { type: 'thinking', thinking: 'hmm', signature: 'sig' };
    const replies = [message([thinkingBlock, { type: 'text', text: 'let me think' }]), message([toolUse(goodTool)])];
    const f = vi.fn(async () => jsonResponse(replies.shift()));
    const res = await mutator(f as unknown as typeof fetch).propose(input({ tier: 'opus', depth: true, thinking: true }));
    expect(res).toMatchObject({ ok: true, thinking: true });
    expect(res.ok && res.usage.input_tokens).toBe(20);
    const second = JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1]).toEqual({ role: 'assistant', content: [thinkingBlock, { type: 'text', text: 'let me think' }] });
  });

  it('answers an invalid tool call with an error tool_result, then fails after the retry', async () => {
    const f = vi.fn(async () => jsonResponse(message([toolUse({ rationale: '' })])));
    const res = await mutator(f as unknown as typeof fetch).propose(input({ tier: 'opus', depth: true, thinking: true }));
    expect(res).toMatchObject({ ok: false, code: 'malformed_output' });
    expect(f).toHaveBeenCalledTimes(2);
    const second = JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(second.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1', is_error: true });
  });

  it('does not retry forced-tool calls', async () => {
    const f = vi.fn(async () => jsonResponse(message([{ type: 'text', text: 'no' }])));
    await mutator(f as unknown as typeof fetch).propose(input());
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('resolveProposal (touched_dead_lines)', () => {
  const proposal = { rationale: 'r', expected_effect: 'e', edits: [{ search: 'IMPROVE = 0', replace: 'IMPROVE = 5' }] };
  const map = {
    method: 'pauli_propagation_exact' as const, n_qubits: 4, dead_fraction: 0.5,
    lines: [{ line: 3, parameters: ['a'], variance: 0, dead: true }, { line: 1, parameters: [], variance: 1, dead: false }, { line: 6, parameters: [], variance: 0, dead: true }],
  };

  it('counts dead lines inside edit spans', () => {
    const res = resolveProposal(SEED_PROGRAM, proposal, map);
    expect(res.applied.ok).toBe(true);
    expect(res.touchedDeadLines).toBe(1);
    expect(resolveProposal(SEED_PROGRAM, proposal, null).touchedDeadLines).toBe(0);
  });

  it('reports a failed application as zero touched lines', () => {
    const res = resolveProposal(SEED_PROGRAM, { ...proposal, edits: [{ search: 'nope', replace: 'x' }] }, map);
    expect(res.applied.ok).toBe(false);
    expect(res.touchedDeadLines).toBe(0);
  });
});

describe('batch mode', () => {
  const items = [
    { customId: 'c-0001', input: input({ tier: 'sonnet' }) },
    { customId: 'c-0002', input: input({ tier: 'opus', depth: true, thinking: true }) },
  ];

  it('creates a batch whose requests carry custom ids', async () => {
    const f = vi.fn(async () => jsonResponse({ id: 'msgbatch_1', processing_status: 'in_progress' }));
    const res = await mutator(f as unknown as typeof fetch).submitBatch(items);
    expect(res).toEqual({ ok: true, batchId: 'msgbatch_1' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages/batches');
    const body = JSON.parse(init.body as string);
    expect(body.requests.map((r: { custom_id: string }) => r.custom_id)).toEqual(['c-0001', 'c-0002']);
    expect(body.requests[1].params.tool_choice).toEqual({ type: 'auto' });
  });

  it('polls and fetches JSONL results, mapping failures per item', async () => {
    const lines = [
      JSON.stringify({ custom_id: 'c-0001', result: { type: 'succeeded', message: message([toolUse(goodTool)]) } }),
      JSON.stringify({ custom_id: 'c-0002', result: { type: 'errored', error: { error: { message: 'boom' } } } }),
      JSON.stringify({ custom_id: 'c-0003', result: { type: 'expired' } }),
      'not json',
    ].join('\n');
    const f = vi.fn(async (url: string) =>
      url.endsWith('/results') ? new Response(lines, { status: 200 }) : jsonResponse({ processing_status: f.mock.calls.length > 1 ? 'ended' : 'in_progress' }));
    const llm = mutator(f as unknown as typeof fetch);
    expect(await llm.pollBatch('b1')).toEqual({ state: 'in_progress' });
    expect(await llm.pollBatch('b1')).toEqual({ state: 'ended' });
    const results = await llm.batchResults('b1');
    expect(results['c-0001']).toMatchObject({ ok: true });
    expect(results['c-0002']).toMatchObject({ ok: false, code: 'batch_failed', message: 'boom' });
    expect(results['c-0003']).toMatchObject({ ok: false, code: 'batch_expired' });
  });

  it('reports submit and poll problems as data', async () => {
    const bad = async () => jsonResponse({ error: { message: 'nope' } }, 400);
    const llm = mutator(bad as unknown as typeof fetch);
    expect(await llm.submitBatch(items)).toEqual({ ok: false, message: 'nope' });
    expect(await llm.pollBatch('b')).toEqual({ state: 'error', message: 'nope' });
    expect(await mutator(bad as unknown as typeof fetch, null).submitBatch(items)).toMatchObject({ ok: false });
  });
});
