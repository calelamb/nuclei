import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputBatcher } from './outputBatcher';

describe('OutputBatcher', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('delivers many lines pushed in one interval as a single block', () => {
    const delivered: string[] = [];
    const batcher = new OutputBatcher((t) => delivered.push(t), 50);
    for (let i = 0; i < 1000; i++) batcher.push(`line ${i}`);
    expect(delivered).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].split('\n')).toHaveLength(1001); // 1000 lines + trailing newline
    expect(delivered[0].endsWith('line 999\n')).toBe(true);
  });

  it('flush() delivers immediately and cancels the timer', () => {
    const delivered: string[] = [];
    const batcher = new OutputBatcher((t) => delivered.push(t), 50);
    batcher.push('a');
    batcher.flush();
    vi.advanceTimersByTime(100);
    expect(delivered).toEqual(['a\n']);
  });

  it('does nothing when empty', () => {
    const deliver = vi.fn();
    new OutputBatcher(deliver).flush();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('keeps streaming across intervals', () => {
    const delivered: string[] = [];
    const batcher = new OutputBatcher((t) => delivered.push(t), 50);
    batcher.push('a');
    vi.advanceTimersByTime(50);
    batcher.push('b');
    vi.advanceTimersByTime(50);
    expect(delivered).toEqual(['a\n', 'b\n']);
  });
});
