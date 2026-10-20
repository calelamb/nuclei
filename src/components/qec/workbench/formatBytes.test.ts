import { describe, expect, it } from 'vitest';
import { formatByteSize, shortHash } from './formatBytes';

describe('formatByteSize', () => {
  it('reads like a file manager', () => {
    expect(formatByteSize(0)).toBe('0 B');
    expect(formatByteSize(812)).toBe('812 B');
    expect(formatByteSize(8701)).toBe('8.5 KB');
    expect(formatByteSize(25 * 1024)).toBe('25 KB');
    expect(formatByteSize(3.2 * 1024 * 1024)).toBe('3.2 MB');
  });
  it('refuses nonsense', () => {
    expect(formatByteSize(-1)).toBe('Unknown');
    expect(formatByteSize(Number.NaN)).toBe('Unknown');
  });
});

describe('shortHash', () => {
  it('keeps 12 characters', () => {
    expect(shortHash('6f45baf5e9f4215ebabc0e5177c34abe')).toBe('6f45baf5e9f4');
    expect(shortHash('abc')).toBe('abc');
  });
});
