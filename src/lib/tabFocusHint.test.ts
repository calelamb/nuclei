import { describe, it, expect } from 'vitest';
import { compactTabFocusHint, tabFocusHint } from './tabFocusHint';

describe('tabFocusHint', () => {
  it('tells keyboard users how to escape the editor', () => {
    expect(tabFocusHint(false, true)).toBe('Tab indents · ⌃M to move focus with Tab');
    expect(tabFocusHint(false, false)).toBe('Tab indents · Ctrl+M to move focus with Tab');
  });
  it('reflects the toggled state', () => {
    expect(tabFocusHint(true, false)).toBe('Tab moves focus · Ctrl+M to indent with Tab');
  });
  it('has a compact status-bar form that names the chord from the registry', () => {
    expect(compactTabFocusHint(false, true)).toBe('⌃M: Tab moves focus');
    expect(compactTabFocusHint(true, false)).toBe('Tab moves focus · Ctrl+M to indent');
  });
});
