// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rewritePythonError } from './errorRewrite';
import * as claudeClient from './claudeClient';

describe('rewritePythonError', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when callClaude fails (graceful)', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: null, error: 'no_api_key' });
    const out = await rewritePythonError({
      code: 'x',
      framework: 'cirq',
      traceback: 'Traceback...\nNameError: name "q0" is not defined',
    });
    expect(out).toBeNull();
  });

  it('parses JSON block from model response (fenced)', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({
      text: '```json\n{"explanation":"You forgot to declare q0 before using it.","fix":"q0 = cirq.LineQubit(0)\\n"}\n```',
      error: null,
    });
    const out = await rewritePythonError({
      code: 'cirq.H(q0)',
      framework: 'cirq',
      traceback: 'NameError: name "q0" is not defined',
    });
    expect(out?.explanation).toContain('forgot');
    expect(out?.fix).toContain('LineQubit');
  });

  it('accepts bare JSON without markdown fence', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({
      text: '{"explanation":"exp","fix":null}',
      error: null,
    });
    const out = await rewritePythonError({ code: '', framework: 'cirq', traceback: 'X' });
    expect(out?.explanation).toBe('exp');
    expect(out?.fix).toBeNull();
  });

  it('returns null on unparseable response', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: 'not json', error: null });
    const out = await rewritePythonError({ code: '', framework: 'cirq', traceback: 'X' });
    expect(out).toBeNull();
  });
});
