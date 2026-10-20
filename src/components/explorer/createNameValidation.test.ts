import { describe, expect, it } from 'vitest';
import { validateNewName } from './createNameValidation';

describe('validateNewName', () => {
  it('accepts a fresh name', () => {
    expect(validateNewName({ name: 'new.py', existingNames: ['bell.py'] })).toBeNull();
  });
  it('rejects a duplicate regardless of case', () => {
    expect(validateNewName({ name: 'Bell.py', existingNames: ['bell.py'] })).toMatch(/already exists/);
  });
  it('rejects slashes', () => {
    expect(validateNewName({ name: 'a/b.py', existingNames: [] })).toMatch(/slashes/);
    expect(validateNewName({ name: 'a\\b.py', existingNames: [] })).toMatch(/slashes/);
  });
  it('rejects an empty name', () => {
    expect(validateNewName({ name: '', existingNames: [] })).toMatch(/name/);
  });

  it('names the existing entry when the clash differs only by case', () => {
    expect(validateNewName({ name: 'BELL.PY', existingNames: ['bell.py'] })).toBe(
      'A file or folder named bell.py already exists. Choose another name.',
    );
  });
});
