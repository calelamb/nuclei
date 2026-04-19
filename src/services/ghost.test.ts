// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ghostCompletion } from './ghost';
import * as claudeClient from './claudeClient';

describe('ghostCompletion', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when claude fails', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: null, error: 'no_api_key' });
    const out = await ghostCompletion({ prefix: 'import cirq\nq0 = ', framework: 'cirq' });
    expect(out).toBeNull();
  });

  it('returns a single line trimmed', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({
      text: 'cirq.LineQubit(0)\n# (ignored)',
      error: null,
    });
    const out = await ghostCompletion({ prefix: 'import cirq\nq0 = ', framework: 'cirq' });
    expect(out).toBe('cirq.LineQubit(0)');
  });

  it('strips a leading code fence if the model hallucinates one', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({
      text: '```python\ncirq.H(q0)\n```',
      error: null,
    });
    const out = await ghostCompletion({ prefix: 'q = cirq.LineQubit(0)\n', framework: 'cirq' });
    expect(out).toBe('cirq.H(q0)');
  });

  it('returns null on empty prefix (nothing to complete)', async () => {
    const spy = vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: 'x', error: null });
    const out = await ghostCompletion({ prefix: '', framework: 'cirq' });
    expect(out).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('includes the framework in the prompt', async () => {
    const spy = vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: 'x', error: null });
    await ghostCompletion({ prefix: 'q = ', framework: 'qiskit' });
    expect(spy.mock.calls[0][0].user).toContain('qiskit');
  });
});
