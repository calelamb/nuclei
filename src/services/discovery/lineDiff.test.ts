import { describe, expect, it } from 'vitest';
import { diffStats, lineDiff, renderDiffText } from './lineDiff';

describe('lineDiff', () => {
  it('reports unchanged text as all same', () => {
    expect(diffStats(lineDiff('a\nb', 'a\nb'))).toEqual({ added: 0, removed: 0 });
  });
  it('finds an insertion, a deletion and a replacement', () => {
    const lines = lineDiff('a\nb\nc', 'a\nx\nc\nd');
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
    expect(renderDiffText(lines)).toBe('  a\n- b\n+ x\n  c\n+ d');
  });
  it('degrades to a whole-file replace for huge inputs', () => {
    const big = Array.from({ length: 2500 }, (_, i) => `l${i}`).join('\n');
    const lines = lineDiff(big, `${big}\nmore`);
    expect(lines.filter((l) => l.kind === 'same')).toHaveLength(0);
  });
});
