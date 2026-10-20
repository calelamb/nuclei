import { describe, expect, it } from 'vitest';
import { describeCodeError, errorLineFromTraceback, shiftLineMentions } from './errorLine';

describe('errorLineFromTraceback', () => {
  it('reads a syntax error line', () => {
    expect(errorLineFromTraceback('  File "<string>", line 2\n    x = (\nSyntaxError: invalid syntax')).toBe(2);
  });

  it('takes the innermost user frame', () => {
    const tb = 'Traceback (most recent call last):\n  File "<string>", line 9, in <module>\n  File "<string>", line 4, in solve\nNameError: x';
    expect(errorLineFromTraceback(tb)).toBe(4);
  });

  it('subtracts the harness lines before the student code', () => {
    expect(errorLineFromTraceback('File "<string>", line 6', 1)).toBe(5);
  });

  it('returns null when the line is inside the harness or absent', () => {
    expect(errorLineFromTraceback('File "<string>", line 1', 3)).toBeNull();
    expect(errorLineFromTraceback('NameError: x')).toBeNull();
    expect(errorLineFromTraceback(undefined)).toBeNull();
  });
});

describe('errorLineFromTraceback file names', () => {
  it.each(['untitled.py', 'bell.py', '<string>'])('reads frames named %s', (name) => {
    expect(errorLineFromTraceback(`Traceback (most recent call last):\n  File "${name}", line 7, in <module>\nNameError: x`)).toBe(7);
  });

  it('ignores runtime frames', () => {
    const tb = 'File "bell.py", line 3, in solve\n  File "/lib/python3.12/site-packages/qiskit/x.py", line 99, in h';
    expect(errorLineFromTraceback(tb)).toBe(3);
  });
});

describe('shiftLineMentions', () => {
  it('moves "on line N" into student numbering', () => {
    expect(shiftLineMentions('IndentationError: expected an indented block after function definition on line 4', 1))
      .toBe('IndentationError: expected an indented block after function definition on line 3');
  });
});

describe('describeCodeError', () => {
  it('prefixes the line when known', () => {
    expect(describeCodeError('SyntaxError: bad', 'File "<string>", line 2').text).toBe('Line 2 · SyntaxError: bad');
  });

  it('leaves the message alone otherwise', () => {
    expect(describeCodeError('NameError: x').text).toBe('NameError: x');
  });
});
