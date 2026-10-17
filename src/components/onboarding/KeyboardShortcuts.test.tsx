// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { KeyboardShortcuts, shortcutGroups } from './KeyboardShortcuts';
import { KEYBINDINGS } from '../../config/keybindings';

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe('shortcuts sheet', () => {
  it('lists every registered binding and nothing that is unbound', () => {
    const rows = shortcutGroups(true).flatMap((g) => g.shortcuts.map((s) => s.description));
    for (const b of KEYBINDINGS) expect(rows).toContain(b.label);
    expect(rows.join('|')).not.toMatch(/bottom panel|Step forward|Step backward/);
  });

  it('uses one glyph style and the real chords', () => {
    const all = shortcutGroups(true).flatMap((g) => g.shortcuts);
    expect(all.find((s) => s.description === 'Toggle theme')?.keys).toBe('⌘⇧T');
    expect(all.find((s) => s.description === 'Toggle terminal panel')?.keys).toBe('⌘`');
    expect(all.some((s) => s.keys.includes('+Shift+'))).toBe(false);
  });

  it('shows Ctrl chords off Mac', () => {
    const all = shortcutGroups(false).flatMap((g) => g.shortcuts);
    expect(all.find((s) => s.description === 'Command palette')?.keys).toBe('Ctrl+Shift+P');
  });

  it('is a labelled modal dialog', () => {
    render(<KeyboardShortcuts onClose={() => {}} />);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
  });
});
