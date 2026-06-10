// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PYTHON_COMPLETION_SYSTEM_PROMPT,
  buildCompletionSystemPrompt,
  isInCommentOrString,
  registerGhostCompletions,
} from './ghostCompletions';

describe('buildCompletionSystemPrompt', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the Python prompt for Python frameworks', () => {
    expect(buildCompletionSystemPrompt('qiskit')).toBe(PYTHON_COMPLETION_SYSTEM_PROMPT);
    expect(buildCompletionSystemPrompt('cirq')).toBe(PYTHON_COMPLETION_SYSTEM_PROMPT);
    expect(buildCompletionSystemPrompt('cuda-q')).toBe(PYTHON_COMPLETION_SYSTEM_PROMPT);
  });

  it('keeps the Python prompt targeting Python, not Q#', () => {
    expect(PYTHON_COMPLETION_SYSTEM_PROMPT).toContain('Python code');
    expect(PYTHON_COMPLETION_SYSTEM_PROMPT).not.toContain('Q#');
  });

  it('returns a Q# prompt for qsharp', () => {
    const prompt = buildCompletionSystemPrompt('qsharp');
    expect(prompt).toContain('Q#');
    expect(prompt).toContain('QDK');
    expect(prompt).not.toContain('Python code');
  });
});

describe('isInCommentOrString', () => {
  it('guards Python comments and strings', () => {
    expect(isInCommentOrString('# comment', 'python')).toBe(true);
    expect(isInCommentOrString("'docstring", 'python')).toBe(true);
    expect(isInCommentOrString('"docstring', 'python')).toBe(true);
    expect(isInCommentOrString('qc.h(0)', 'python')).toBe(false);
    expect(isInCommentOrString('// not a python comment', 'python')).toBe(false);
  });

  it('guards Q# comments and strings', () => {
    expect(isInCommentOrString('// comment', 'qsharp')).toBe(true);
    expect(isInCommentOrString('"text', 'qsharp')).toBe(true);
    expect(isInCommentOrString('$"interpolated', 'qsharp')).toBe(true);
    expect(isInCommentOrString('H(q);', 'qsharp')).toBe(false);
    expect(isInCommentOrString('# not a q# comment', 'qsharp')).toBe(false);
  });
});

describe('registerGhostCompletions', () => {
  it('registers the same provider for both python and qsharp language ids', () => {
    const register = vi.fn(() => ({ dispose: vi.fn() }));
    const monaco = { languages: { registerInlineCompletionsProvider: register } };

    registerGhostCompletions(monaco);

    const ids = register.mock.calls.map((c) => c[0]);
    expect(ids).toEqual(['python', 'qsharp']);
    // Same provider object — completion behavior is shared, only prompts differ.
    expect(register.mock.calls[0][1]).toBe(register.mock.calls[1][1]);
  });

  it('returns a composite disposable covering every registration', () => {
    const dispose = vi.fn();
    const register = vi.fn(() => ({ dispose }));
    const monaco = { languages: { registerInlineCompletionsProvider: register } };

    const disposable = registerGhostCompletions(monaco);
    disposable.dispose();

    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
