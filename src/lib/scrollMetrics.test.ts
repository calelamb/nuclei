import { describe, it, expect } from 'vitest';
import { hasMoreBelow } from './scrollMetrics';

describe('hasMoreBelow', () => {
  it('is true while content remains below', () => {
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 200, scrollHeight: 400 })).toBe(true);
  });
  it('is false at the end or when nothing overflows', () => {
    expect(hasMoreBelow({ scrollTop: 200, clientHeight: 200, scrollHeight: 400 })).toBe(false);
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 200, scrollHeight: 200 })).toBe(false);
  });
});
