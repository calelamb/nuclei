import { describe, it, expect } from 'vitest';
import { differsFromBaseline, formatDiffValue, splitDiffFields, LONG_VALUE_CHARS } from './compareDiffModel';

describe('compareDiffModel (LR-06)', () => {
  it('moves long string values (stack traces) out of the grid', () => {
    const trace = 'x'.repeat(LONG_VALUE_CHARS + 1);
    const { grid, long } = splitDiffFields([
      { key: 'params.theta', values: [0, 1] },
      { key: 'error', values: [null, trace] },
    ]);
    expect(grid.map((f) => f.key)).toEqual(['params.theta']);
    expect(long.map((f) => f.key)).toEqual(['error']);
  });

  it('highlights only values that differ from the first run', () => {
    const values = [1, 1, 2];
    expect([0, 1, 2].map((i) => differsFromBaseline(values, i))).toEqual([false, false, true]);
  });

  it('formats started_at as local time and leaves other values alone', () => {
    expect(formatDiffValue('started_at', '2026-10-15T14:21:50Z')).not.toContain('2026-10-15T');
    expect(formatDiffValue('shots', 100)).toBe('100');
    expect(formatDiffValue('git.commit', null)).toBe('null');
    expect(formatDiffValue('x', undefined)).toBe('—');
  });
});
