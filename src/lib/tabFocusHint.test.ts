import { describe, it, expect } from 'vitest';
import { tabFocusHint } from './tabFocusHint';

describe('tabFocusHint', () => {
  it('tells keyboard users how to escape the editor', () => {
    expect(tabFocusHint(false, true)).toBe('Tab indents · ⌃M to move focus with Tab');
    expect(tabFocusHint(false, false)).toBe('Tab indents · Ctrl+M to move focus with Tab');
  });
  it('reflects the toggled state', () => {
    expect(tabFocusHint(true, false)).toBe('Tab moves focus · Ctrl+M to indent with Tab');
  });
});
