// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { KeyboardShortcuts, shortcutGroups } from './KeyboardShortcuts';
import { KEYBINDINGS } from '../../config/keybindings';
import { useWorkspaceStore } from '../../stores/workspaceStore';

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
    const rows = shortcutGroups(true, false, 'learn').flatMap((g) => g.shortcuts.map((s) => s.description));
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

describe('shortcuts sheet by workspace', () => {
  it('Learn lists Change level; Research omits it because the level does not exist there', () => {
    const learn = shortcutGroups(true, false, 'learn').flatMap((g) => g.shortcuts.map((s) => s.description));
    const research = shortcutGroups(true, false, 'research').flatMap((g) => g.shortcuts.map((s) => s.description));
    expect(learn).toContain('Change level');
    expect(research).not.toContain('Change level');
    expect(research).toContain('Toggle theme');
  });

  it('files Launch on hardware next to Run circuit under Essential and has no one-row Run group', () => {
    const groups = shortcutGroups(true, false, 'research');
    const essential = groups.find((g) => g.title === 'Essential')?.shortcuts.map((s) => s.description) ?? [];
    expect(essential.indexOf('Launch on hardware')).toBe(essential.indexOf('Run circuit') + 1);
    expect(groups.find((g) => g.title === 'Run')).toBeUndefined();
    expect(groups.every((g) => g.shortcuts.length >= 2)).toBe(true);
  });

  it('the rendered sheet follows the live workspace', () => {
    useWorkspaceStore.setState({ mode: 'research' });
    render(<KeyboardShortcuts onClose={() => {}} />);
    expect(screen.queryByText('Change level')).toBeNull();
    cleanup();
    useWorkspaceStore.setState({ mode: 'learn' });
    render(<KeyboardShortcuts onClose={() => {}} />);
    expect(screen.getByText('Change level')).toBeTruthy();
  });
});

describe('shortcuts sheet is the shared Dialog', () => {
  it('uses the ui Dialog surface and closes on Escape', () => {
    let closed = 0;
    render(<KeyboardShortcuts onClose={() => { closed += 1; }} />);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(dialog.className).toContain('nuclei-dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closed).toBe(1);
  });
});

describe('shortcutGroups folds tiny groups', () => {
  it('never shows a group of fewer than three rows (web Research View has one)', () => {
    for (const mode of ['learn', 'research'] as const) {
      for (const web of [true, false]) {
        const groups = shortcutGroups(true, web, mode);
        expect(groups.every((g) => g.shortcuts.length >= 3 || groups.length === 1)).toBe(true);
      }
    }
    const web = shortcutGroups(false, true, 'research');
    expect(web.some((g) => g.shortcuts.some((r) => r.description === 'Toggle terminal panel'))).toBe(true);
    expect(web.find((g) => g.title === 'View')).toBeUndefined();
  });
});
