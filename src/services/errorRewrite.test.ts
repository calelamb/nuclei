// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rewriteExecutionError } from './errorRewrite';
import * as claudeClient from './claudeClient';
import { useWorkspaceStore } from '../stores/workspaceStore';

describe('rewriteExecutionError', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when callClaude fails (graceful)', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: null, error: 'no_api_key' });
    const out = await rewriteExecutionError({
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
    const out = await rewriteExecutionError({
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
    const out = await rewriteExecutionError({ code: '', framework: 'cirq', traceback: 'X' });
    expect(out?.explanation).toBe('exp');
    expect(out?.fix).toBeNull();
  });

  it('returns null on unparseable response', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: 'not json', error: null });
    const out = await rewriteExecutionError({ code: '', framework: 'cirq', traceback: 'X' });
    expect(out).toBeNull();
  });

  it('handles a Q# compiler diagnostic and mentions Q# in the system prompt', async () => {
    const spy = vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({
      text: '{"explanation":"Q# operations need a return type after the colon.","fix":"operation Main() : Result[] {"}',
      error: null,
    });
    const out = await rewriteExecutionError({
      code: 'operation Main() {',
      framework: 'qsharp',
      traceback: 'Qsc.Parse.Token\n\n  x syntax error\n   ,-[line_0:4:5]',
    });
    expect(out?.explanation).toContain('return type');
    expect(out?.fix).toContain('Result[]');

    const systemPrompt = spy.mock.calls[0][0].system;
    expect(systemPrompt).toContain('Q#');
  });
});

describe('Qiskit 2 migration hints (Research mode)', () => {
  const REMOVED_API = {
    code: 'from qiskit.primitives import Sampler',
    framework: 'qiskit',
    traceback: "ImportError: cannot import name 'Sampler' from 'qiskit.primitives'",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    useWorkspaceStore.setState({ mode: 'learn' });
  });

  it('answers a removed 1.x API without a model when the Dirac call fails', async () => {
    useWorkspaceStore.setState({ mode: 'research' });
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: null, error: 'no_api_key' });
    const out = await rewriteExecutionError(REMOVED_API);
    expect(out?.explanation).toContain('Qiskit 2');
    expect(out?.fix).toContain('StatevectorSampler');
  });

  it('hands the known migration to the model so its diagnosis uses it', async () => {
    useWorkspaceStore.setState({ mode: 'research' });
    const spy = vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({
      text: '{"explanation":"V1 Sampler is gone.","fix":null}',
      error: null,
    });
    const out = await rewriteExecutionError(REMOVED_API);
    expect(out?.explanation).toBe('V1 Sampler is gone.');
    expect(spy.mock.calls[0][0].user).toContain('StatevectorSampler');
  });

  it('leaves Learn mode exactly as before', async () => {
    useWorkspaceStore.setState({ mode: 'learn' });
    const spy = vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: null, error: 'no_api_key' });
    expect(await rewriteExecutionError(REMOVED_API)).toBeNull();
    expect(spy.mock.calls[0][0].user).not.toContain('StatevectorSampler');
  });
});
