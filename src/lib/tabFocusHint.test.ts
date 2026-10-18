import { describe, it, expect } from 'vitest';
import { tabFocusHint } from './tabFocusHint';

describe('tabFocusHint', () => {
  it('tells keyboard users how to escape the editor', () => {
    expect(tabFocusHint(false, true)).toBe('⌃M: Tab moves focus');
    expect(tabFocusHint(false, false)).toBe('Ctrl+M: Tab moves focus');
  });
  it('reflects the toggled state', () => {
    expect(tabFocusHint(true, false)).toBe('Tab moves focus · Ctrl+M to indent');
  });
});
