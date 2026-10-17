import { describe, it, expect } from 'vitest';
import { stripLeadingTitle } from './descriptionTitle';

describe('stripLeadingTitle (LR-16)', () => {
  it('drops a first heading that repeats the title', () => {
    expect(stripLeadingTitle('## GHZ State\n\nPrepare it.', 'GHZ State')).toBe('Prepare it.');
  });
  it('is case-insensitive', () => {
    expect(stripLeadingTitle('# ghz state\nBody', 'GHZ State')).toBe('Body');
  });
  it('keeps a first heading that says something else', () => {
    const md = '## Background\n\nBody';
    expect(stripLeadingTitle(md, 'GHZ State')).toBe(md);
  });
  it('keeps text that merely starts with the title', () => {
    const md = 'GHZ State is a state.\n\n## GHZ State';
    expect(stripLeadingTitle(md, 'GHZ State')).toBe(md);
  });
});
