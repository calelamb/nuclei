import { describe, expect, it } from 'vitest';
import { shouldReparseAfterRestart } from './restartReparse';

describe('shouldReparseAfterRestart', () => {
  it('re-parses after Stop or a runaway Run so the circuit matches the code', () => {
    expect(shouldReparseAfterRestart(false)).toBe(true);
  });
  it('does not re-parse code whose preview was just paused (it would loop on restarts)', () => {
    expect(shouldReparseAfterRestart(true)).toBe(false);
  });
});
