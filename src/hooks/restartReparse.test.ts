import { describe, expect, it } from 'vitest';
import { shouldMarkStaleWhileReparsing, shouldReparseAfterRestart } from './restartReparse';

describe('shouldReparseAfterRestart', () => {
  it('re-parses after Stop or a runaway Run so the circuit matches the code', () => {
    expect(shouldReparseAfterRestart(false)).toBe(true);
  });
  it('does not re-parse code whose preview was just paused (it would loop on restarts)', () => {
    expect(shouldReparseAfterRestart(true)).toBe(false);
  });
});

describe('shouldMarkStaleWhileReparsing', () => {
  it('flags the old diagram while the re-parse is pending', () => {
    expect(shouldMarkStaleWhileReparsing(false)).toBe(true);
  });
  it('leaves an already paused preview alone', () => {
    expect(shouldMarkStaleWhileReparsing(true)).toBe(false);
  });
});
