// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getErrorContext } from './useKernel';

describe('getErrorContext', () => {
  it('extracts the line from a Python traceback frame', () => {
    const ctx = getErrorContext({
      type: 'error',
      message: 'NameError',
      traceback:
        'Traceback (most recent call last):\n  File "<string>", line 4, in <module>\nNameError: name \'qc\' is not defined',
    });
    expect(ctx.line).toBe(4);
  });

  it('extracts the line from a Q# miette-rendered span', () => {
    const ctx = getErrorContext({
      type: 'error',
      message: 'Qsc.TypeCk.TyMismatch',
      traceback:
        'Qsc.TypeCk.TyMismatch\n\n  x expected (Qubit, Qubit), found Qubit\n   ,-[line_0:3:11]\n 3 |     H(qs);\n   :           ^\n   `----\n',
    });
    expect(ctx.line).toBe(3);
  });

  it('prefers the Python frame when both could match', () => {
    const ctx = getErrorContext({
      type: 'error',
      message: 'boom',
      traceback: 'File "<exec>", line 7, in <module>\n,-[line_0:3:11]',
    });
    expect(ctx.line).toBe(7);
  });

  it('returns null when no recognizable location exists', () => {
    const ctx = getErrorContext({
      type: 'error',
      message: 'kernel exploded with no context',
    });
    expect(ctx.line).toBeNull();
    expect(ctx.shortMessage).toBe('kernel exploded with no context');
  });
});
