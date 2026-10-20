import { describe, it, expect } from 'vitest';
import { KEYBINDINGS, findBindingId, formatKeys, bindingFor, shortcutLabel, isBindingInMode, railShortcutLabel, type KeyLike } from './keybindings';

function ev(key: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { key, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, ...mods };
}

describe('keybinding registry', () => {
  it('opens settings on Cmd+, and lists it in the shortcuts sheet group Navigation', () => {
    expect(findBindingId(ev(','))).toBe('settings');
    expect(bindingFor('settings')).toMatchObject({ label: 'Open settings', group: 'Navigation', owner: 'app' });
    expect(formatKeys(bindingFor('settings'), true)).toBe('⌘,');
  });

  it('matches Shift chords regardless of the casing Chromium reports', () => {
    // Chromium reports e.key as 'P' when Shift is held; Safari/Firefox report 'p'.
    expect(findBindingId(ev('P', { shiftKey: true }))).toBe('palette');
    expect(findBindingId(ev('p', { shiftKey: true }))).toBe('palette');
    expect(findBindingId(ev('S', { shiftKey: true }))).toBe('save-as');
    expect(findBindingId(ev('L', { shiftKey: true }))).toBe('cycle-ui-mode');
    expect(findBindingId(ev('T', { shiftKey: true }))).toBe('toggle-theme');
    expect(findBindingId(ev('R', { shiftKey: true }))).toBe('launch');
    expect(findBindingId(ev('M', { shiftKey: true }))).toBe('switch-workspace');
  });

  it('distinguishes the plain and shifted forms of the same letter', () => {
    expect(findBindingId(ev('s'))).toBe('save');
    expect(findBindingId(ev('l'))).toBe('focus-dirac');
    expect(findBindingId(ev('d'))).toBe('toggle-dirac');
  });

  it('accepts Ctrl as the modifier on non-Mac platforms and ignores unmodified keys', () => {
    expect(findBindingId(ev('s', { metaKey: false, ctrlKey: true }))).toBe('save');
    expect(findBindingId(ev('s', { metaKey: false }))).toBeNull();
  });

  it('maps 1-9 to the rail views and the backtick to the bottom panel', () => {
    expect(findBindingId(ev('3'))).toBe('goto-rail-view');
    expect(findBindingId(ev('`'))).toBe('toggle-bottom-panel');
  });

  it('does not claim chords that have no binding (the old sheet listed Cmd+J)', () => {
    expect(findBindingId(ev('j'))).toBeNull();
    expect(findBindingId(ev('ArrowRight'))).toBeNull();
    expect(KEYBINDINGS.some((b) => b.key === 'j')).toBe(false);
  });

  it('formats glyphs for Mac and words for other platforms', () => {
    const palette = bindingFor('palette');
    expect(formatKeys(palette, true)).toBe('⌘⇧P');
    expect(formatKeys(palette, false)).toBe('Ctrl+Shift+P');
    expect(formatKeys(bindingFor('run'), true)).toBe('⌘↵');
    expect(formatKeys(bindingFor('goto-rail-view'), true)).toBe('⌘1–9');
  });

  it('keeps plain Cmd+/ for the editor and puts the help sheet on Cmd+? (and never dispatches Cmd+/ from App)', () => {
    expect(findBindingId(ev('/'))).toBeNull();
    expect(findBindingId(ev('?', { shiftKey: true }))).toBe('shortcuts');
    expect(findBindingId(ev('/', { shiftKey: true }))).toBe('shortcuts');
    expect(formatKeys(bindingFor('shortcuts'), true)).toBe('⌘?');
    expect(formatKeys(bindingFor('toggle-comment'), true)).toBe('⌘/');
    expect(bindingFor('toggle-comment').owner).toBe('editor');
  });

  it('formats the Control-based Tab-focus chord in one notation', () => {
    expect(formatKeys(bindingFor('tab-focus'), true)).toBe('⌃M');
    expect(formatKeys(bindingFor('tab-focus'), false)).toBe('Ctrl+M');
  });

  it('has unique ids', () => {
    const ids = KEYBINDINGS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exposes a palette-ready label by id', () => {
    expect(shortcutLabel('palette', true)).toBe('⌘⇧P');
    expect(shortcutLabel('nope', true)).toBeUndefined();
  });

  it('never advertises a browser-reserved chord on the web build', () => {
    expect(shortcutLabel('new', true, true)).toBeUndefined();
    expect(shortcutLabel('toggle-theme', true, true)).toBeUndefined();
    expect(shortcutLabel('toggle-theme', true, false)).toBe('⌘⇧T');
    expect(shortcutLabel('palette', true, true)).toBe('⌘⇧P');
  });
});

describe('workspace-scoped bindings', () => {
  it('Change level is a Learn-only chord and is not advertised in Research', () => {
    expect(bindingFor('cycle-ui-mode').modes).toEqual(['learn']);
    expect(isBindingInMode(bindingFor('cycle-ui-mode'), 'research')).toBe(false);
    expect(shortcutLabel('cycle-ui-mode', true, false, 'research')).toBeUndefined();
    expect(shortcutLabel('cycle-ui-mode', true, false, 'learn')).toBe('⌘⇧L');
    expect(shortcutLabel('cycle-ui-mode', true, false)).toBe('⌘⇧L');
  });

  it('Launch on hardware sits under Essential right after Run circuit (no one-row group)', () => {
    const essential = KEYBINDINGS.filter((b) => b.group === 'Essential').map((b) => b.id);
    expect(essential.indexOf('launch')).toBe(essential.indexOf('run') + 1);
  });

  it('leaves no shortcut group with fewer than three rows in Learn', () => {
    const counts = new Map<string, number>();
    for (const b of KEYBINDINGS) {
      if (isBindingInMode(b, 'learn')) counts.set(b.group, (counts.get(b.group) ?? 0) + 1);
    }
    for (const [group, n] of counts) expect(n, group).toBeGreaterThanOrEqual(3);
  });

  it('dispatches Mod+Enter from App (the editor also binds it, so App skips it inside Monaco)', () => {
    expect(findBindingId(ev('Enter'))).toBe('run');
    expect(findBindingId(ev('Enter', { metaKey: false, ctrlKey: true }))).toBe('run');
    expect(findBindingId(ev('Enter', { shiftKey: true }))).toBeNull();
  });
});

describe('railShortcutLabel', () => {
  it('says Ctrl on non-Mac and the glyph on Mac, and stops after nine', () => {
    expect(railShortcutLabel(0, true)).toBe('⌘1');
    expect(railShortcutLabel(3, false)).toBe('Ctrl+4');
    expect(railShortcutLabel(9, true)).toBeUndefined();
  });
  it('labels the Settings and inline-edit chords per platform', () => {
    expect(shortcutLabel('settings', false, false)).toBe('Ctrl+,');
    expect(shortcutLabel('inline-edit', false, false)).toBe('Ctrl+K');
  });
});
