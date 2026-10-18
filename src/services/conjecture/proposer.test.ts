import { describe, expect, it, vi } from 'vitest';
import { buildDigest } from './digest';
import { fixtureConjecture, fixtureSchema, frontierFixture } from './fixtures';
import { buildProposeRequestBody, createConjectureProposer, PROPOSER_MODEL } from './proposer';
import { SYSTEM_PROMPT } from './prompt';
import { PROPOSE_TOOL_NAME } from './schema';

const input = () => ({ digest: buildDigest(frontierFixture(12)), schema: fixtureSchema(), idPrefix: 'cj-test' });
const hash = async (t: string) => `h${t.length}`;
const reply = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
  vi.fn(async () => ({ ok: init.ok ?? true, status: init.status ?? 200, json: async () => body }) as unknown as Response);
const toolReply = (conjectures: unknown[]) => ({
  content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: PROPOSE_TOOL_NAME, input: { conjectures } }],
  usage: { input_tokens: 900, output_tokens: 300 },
});
const make = (fetchFn: typeof fetch, key: string | null = 'sk-test') =>
  createConjectureProposer({ getApiKey: () => key, hash, fetch: fetchFn, apiUrl: 'https://api.test/v1/messages' });

describe('conjecture proposer', () => {
  it('sends the depth model with a forced tool and the right headers', async () => {
    const fetchFn = reply(toolReply([fixtureConjecture()]));
    await make(fetchFn as unknown as typeof fetch).propose(input());
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/messages');
    expect(init.headers).toMatchObject({ 'x-api-key': 'sk-test', 'anthropic-version': '2023-06-01' });
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(PROPOSER_MODEL);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.tool_choice).toEqual({ type: 'tool', name: PROPOSE_TOOL_NAME });
    expect(body.thinking).toBeUndefined();
    expect(body.tools[0].input_schema.properties.conjectures.maxItems).toBe(5);
    expect(body.messages[0].content).toContain('ARCHIVE DIGEST');
  });

  it('returns validated conjectures with usage and prompt hash, renumbering ids', async () => {
    const res = await make(reply(toolReply([fixtureConjecture({ id: 'x' }), fixtureConjecture({ id: 'y' })])) as unknown as typeof fetch).propose(input());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.conjectures.map((c) => c.id)).toEqual(['cj-test-1', 'cj-test-2']);
    expect(res.usage.input_tokens).toBe(900);
    expect(res.prompt_sha256).toMatch(/^h\d+$/);
    expect(res.model).toBe('claude-opus-5-5');
  });

  it('drops invalid conjectures but keeps the valid ones', async () => {
    const bad = fixtureConjecture({ n_range: [8, 999] });
    const res = await make(reply(toolReply([bad, fixtureConjecture()])) as unknown as typeof fetch).propose(input());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.conjectures).toHaveLength(1);
    expect(res.dropped).toHaveLength(1);
    expect(res.dropped[0].issues[0].path).toBe('n_range');
  });

  it('reports schema_mismatch when nothing validates', async () => {
    const res = await make(reply(toolReply([{ statement: 'x' }])) as unknown as typeof fetch).propose(input());
    expect(res).toMatchObject({ ok: false, code: 'schema_mismatch' });
    if (!res.ok) expect(res.usage?.output_tokens).toBe(300);
  });

  it('reports malformed output when the tool was not called', async () => {
    const res = await make(reply({ content: [{ type: 'text', text: 'I refuse' }], usage: {} }) as unknown as typeof fetch).propose(input());
    expect(res).toMatchObject({ ok: false, code: 'malformed_output' });
  });

  it('reports HTTP errors with the API message and status', async () => {
    const res = await make(reply({ error: { message: 'overloaded' } }, { ok: false, status: 529 }) as unknown as typeof fetch).propose(input());
    expect(res).toMatchObject({ ok: false, code: 'http', status: 529, message: 'overloaded' });
  });

  it('reports network failures without throwing', async () => {
    const res = await make((async () => { throw new Error('offline'); }) as unknown as typeof fetch).propose(input());
    expect(res).toMatchObject({ ok: false, code: 'network' });
  });

  it('explains a missing key and does not call the API', async () => {
    const fetchFn = reply({});
    const proposer = make(fetchFn as unknown as typeof fetch, '  ');
    expect(proposer.hasKey()).toBe(false);
    const res = await proposer.propose(input());
    expect(res).toMatchObject({ ok: false, code: 'no_key' });
    if (!res.ok) expect(res.message).toMatch(/API key/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('keeps the careful-scientist rules in the system prompt', () => {
    expect(SYSTEM_PROMPT).toMatch(/falsifiable/i);
    expect(SYSTEM_PROMPT).toMatch(/observable locality/i);
    expect(SYSTEM_PROMPT).toMatch(/NEW circuits/);
    expect(SYSTEM_PROMPT).toMatch(/Never write "proven"/);
    expect(JSON.stringify(buildProposeRequestBody(input()).system)).toContain('careful');
  });
});
