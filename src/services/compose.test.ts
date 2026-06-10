// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compose } from './compose';
import { useDiracStore } from '../stores/diracStore';

describe('compose', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useDiracStore.setState({ apiKey: 'sk-test' });
  });

  it('returns null when no api key', async () => {
    useDiracStore.setState({ apiKey: '' });
    const out = await compose({ intent: 'make bell', framework: 'cirq', currentCode: '' });
    expect(out).toEqual({
      ok: false,
      error: 'No API key set. Add one in Settings → Dirac.',
    });
  });

  it('returns { code, explanation } when Sonnet uses the insert_code tool', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            { type: 'text', text: 'Here is a Bell state.' },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'insert_code',
              input: { code: 'import cirq\nq0, q1 = cirq.LineQubit.range(2)\n' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const out = await compose({ intent: 'make bell', framework: 'cirq', currentCode: '' });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error(out.error);
    expect(out.code).toContain('LineQubit');
    expect(out.explanation).toContain('Bell');
  });

  it('builds a Q# system prompt and qsharp fence when framework is qsharp', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            { type: 'text', text: 'A Bell state in Q#.' },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'insert_code',
              input: { code: 'operation Main() : Result[] { return []; }' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const out = await compose({
      intent: 'make bell',
      framework: 'qsharp',
      currentCode: 'operation Main() : Result[] { return []; }',
    });
    expect(out.ok).toBe(true);

    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.system).toContain('Q#');
    // Stable marker proving the QDK style guide was appended.
    expect(body.system).toContain('ResetAll');
    const userPrompt: string = body.messages[0].content;
    expect(userPrompt).toContain('```qsharp');
    expect(userPrompt).not.toContain('```python');
  });

  it('keeps the original Python system prompt for qiskit', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            { type: 'text', text: 'Bell state.' },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'insert_code',
              input: { code: 'from qiskit import QuantumCircuit\n' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await compose({ intent: 'make bell', framework: 'qiskit', currentCode: '' });

    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.system).toContain('a COMPLETE, runnable Python file');
    expect(body.system).toContain('(cirq, qiskit, cuda-q)');
    expect(body.system).not.toContain('ResetAll');
    expect(body.messages[0].content).toContain('```python');
  });

  it('returns null if no tool_use block', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'just chatting' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const out = await compose({ intent: 'make bell', framework: 'cirq', currentCode: '' });
    expect(out).toEqual({
      ok: false,
      error: 'Dirac responded but didn\'t produce code. Try rephrasing the request.',
    });
  });

  it('returns null on http error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const out = await compose({ intent: 'make bell', framework: 'cirq', currentCode: '' });
    expect(out).toEqual({
      ok: false,
      error: 'HTTP 500',
    });
  });
});
