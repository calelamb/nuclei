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

  it('on the web build omits the chords Chrome reserves (⌘N, ⌘⇧T) and keeps the rest', () => {
    const rows = shortcutGroups(true, true).flatMap((g) => g.shortcuts.map((s) => s.description));
    expect(rows).not.toContain('New file');
    expect(rows).not.toContain('Toggle theme');
    expect(rows).toContain('Command palette');
  });

  it('desktop still lists them', () => {
    const rows = shortcutGroups(true, false).flatMap((g) => g.shortcuts.map((s) => s.description));
    expect(rows).toContain('New file');
    expect(rows).toContain('Toggle theme');
  });
});

describe('shortcuts sheet focus', () => {
  it('does not autofocus the close button on open', () => {
    render(<KeyboardShortcuts onClose={() => {}} />);
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Close shortcuts' }));
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Keyboard shortcuts' }));
  });
});
