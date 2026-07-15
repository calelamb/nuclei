import { describe, it, expect } from 'vitest';
import { pathsRemoved } from './tabModels';

describe('pathsRemoved', () => {
  it('returns paths present before but not after (closed tabs)', () => {
    expect(pathsRemoved(['a.py', 'b.py', 'c.py'], new Set(['a.py', 'c.py']))).toEqual(['b.py']);
  });

  it('returns empty when nothing was closed', () => {
    expect(pathsRemoved(['a.py'], new Set(['a.py', 'b.py']))).toEqual([]);
  });

  it('returns all when every tab closed', () => {
    expect(pathsRemoved(['a.py', 'b.py'], new Set())).toEqual(['a.py', 'b.py']);
  });

  it('accepts a Set as the prev iterable', () => {
    expect(pathsRemoved(new Set(['x', 'y']), new Set(['x']))).toEqual(['y']);
  });
});
