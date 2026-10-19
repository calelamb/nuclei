import { describe, expect, it } from 'vitest';
import { commitShotsDraft } from './shotsDraft';

describe('commitShotsDraft', () => {
  it('accepts an in-range value untouched', () => {
    expect(commitShotsDraft('2048', 1024)).toEqual({ value: 2048, hint: null });
  });
  it('rejects below the minimum with a hint and keeps the current value', () => {
    const r = commitShotsDraft('20', 1024);
    expect(r.value).toBe(1024);
    expect(r.hint).toMatch(/Minimum is 100/);
  });
  it('rejects above the maximum with a hint and keeps the current value', () => {
    const r = commitShotsDraft('999999', 1024);
    expect(r.value).toBe(1024);
    expect(r.hint).toMatch(/Maximum is 100,000/);
  });
  it('keeps the current value for an empty or non-numeric draft', () => {
    expect(commitShotsDraft('', 1024).value).toBe(1024);
    expect(commitShotsDraft('abc', 512).hint).not.toBeNull();
  });
  it('reads comma-grouped numbers as typed', () => {
    expect(commitShotsDraft('2,048', 1024)).toEqual({ value: 2048, hint: null });
    expect(commitShotsDraft('2,049', 1024).value).toBe(2049);
    expect(commitShotsDraft('4,096', 1024).value).toBe(4096);
    expect(commitShotsDraft(' 1 000 ', 1024).value).toBe(1000);
  });
  it('rejects text that merely starts with digits', () => {
    expect(commitShotsDraft('12abc', 512)).toMatchObject({ value: 512 });
    expect(commitShotsDraft('12abc', 512).hint).not.toBeNull();
  });
});
