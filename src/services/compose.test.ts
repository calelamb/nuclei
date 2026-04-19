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
    expect(out).toBeNull();
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
    expect(out?.code).toContain('LineQubit');
    expect(out?.explanation).toContain('Bell');
  });

  it('returns null if no tool_use block', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'just chatting' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const out = await compose({ intent: 'make bell', framework: 'cirq', currentCode: '' });
    expect(out).toBeNull();
  });

  it('returns null on http error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const out = await compose({ intent: 'make bell', framework: 'cirq', currentCode: '' });
    expect(out).toBeNull();
  });
});
