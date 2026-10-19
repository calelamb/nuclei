import { describe, expect, it } from 'vitest';
import { commitShotsDraft } from './shotsDraft';

describe('commitShotsDraft', () => {
  it('accepts an in-range value untouched', () => {
    expect(commitShotsDraft('2048', 1024)).toEqual({ value: 2048, hint: null });
  });
  it('clamps below the minimum with a hint', () => {
    const r = commitShotsDraft('20', 1024);
    expect(r.value).toBe(100);
    expect(r.hint).toMatch(/Minimum is 100/);
  });
  it('clamps above the maximum with a hint', () => {
    const r = commitShotsDraft('999999', 1024);
    expect(r.value).toBe(100000);
    expect(r.hint).toMatch(/Maximum is 100,000/);
  });
  it('keeps the current value for an empty or non-numeric draft', () => {
    expect(commitShotsDraft('', 1024).value).toBe(1024);
    expect(commitShotsDraft('abc', 512).hint).not.toBeNull();
  });
});
