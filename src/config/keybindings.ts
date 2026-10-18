/**
 * The single registry of global keyboard shortcuts. The App.tsx key handler,
 * the command palette's shortcut hints, tooltips and the shortcuts sheet all
 * read from here, so the sheet can never list a binding that does not exist
 * (or omit one that does).
 */

import { isWebBuild } from '../platform/buildTarget';

export type KeybindingGroup = 'Essential' | 'Editor' | 'Navigation' | 'View';

export interface Keybinding {
  id: string;
  /** Lower-case key as compared against `e.key.toLowerCase()`. `1-9` is a digit range. */
  key: string;
  shift?: boolean;
  /** Human label of the key for display (defaults to the upper-cased key). */
  display?: string;
  label: string;
  group: KeybindingGroup;
  /** `editor` bindings are owned by Monaco; they are listed but not dispatched by App. */
  owner: 'app' | 'editor';
  /** Another `e.key` the same chord reports (Shift+/ reports '?'). */
  alias?: string;
  /** Shift is required but is part of the glyph already (⌘? rather than ⌘⇧?). */
  implicitShift?: boolean;
  /** The chord uses the physical Control key even on Mac (⌃M), not Command. */
  ctrl?: boolean;
  /** Chrome keeps this chord for itself (new window, reopen tab): a web page never receives it. */
  browserReserved?: boolean;
}

export const KEYBINDINGS: readonly Keybinding[] = [
  { id: 'run', key: 'enter', display: '↵', label: 'Run circuit', group: 'Essential', owner: 'editor' },
  { id: 'save', key: 's', label: 'Save file', group: 'Essential', owner: 'app' },
  { id: 'palette', key: 'p', shift: true, label: 'Command palette', group: 'Essential', owner: 'app' },
  { id: 'toggle-dirac', key: 'd', label: 'Toggle Dirac panel', group: 'Essential', owner: 'app' },
  { id: 'focus-dirac', key: 'l', label: 'Focus Dirac input', group: 'Essential', owner: 'app' },
  // Plain ⌘/ is Monaco's toggle-comment, so help lives on ⌘? (Shift+/); F1 is handled in App too.
  { id: 'shortcuts', key: '/', alias: '?', shift: true, implicitShift: true, display: '?', label: 'Keyboard shortcuts', group: 'Essential', owner: 'app' },

  { id: 'inline-edit', key: 'k', label: 'Inline edit with Dirac (selection)', group: 'Editor', owner: 'editor' },
  { id: 'compose', key: 'i', label: 'Compose with Dirac', group: 'Editor', owner: 'app' },
  { id: 'find', key: 'f', label: 'Find', group: 'Editor', owner: 'editor' },
  { id: 'toggle-comment', key: '/', label: 'Toggle line comment', group: 'Editor', owner: 'editor' },
  { id: 'tab-focus', key: 'm', ctrl: true, label: 'Let Tab move focus out of the editor', group: 'Editor', owner: 'editor' },

  { id: 'open', key: 'o', label: 'Open file', group: 'Navigation', owner: 'app' },
  { id: 'new', key: 'n', label: 'New file', group: 'Navigation', owner: 'app', browserReserved: true },
  { id: 'save-as', key: 's', shift: true, label: 'Save as', group: 'Navigation', owner: 'app' },
  { id: 'goto-rail-view', key: '1-9', display: '1–9', label: 'Jump to sidebar view', group: 'Navigation', owner: 'app' },
  { id: 'toggle-bottom-panel', key: '`', label: 'Toggle terminal panel', group: 'Navigation', owner: 'app' },
  { id: 'switch-workspace', key: 'm', shift: true, label: 'Switch Learn / Research', group: 'Navigation', owner: 'app' },

  { id: 'toggle-theme', key: 't', shift: true, label: 'Toggle theme', group: 'View', owner: 'app', browserReserved: true },
  { id: 'cycle-ui-mode', key: 'l', shift: true, label: 'Cycle UI mode (Learn)', group: 'View', owner: 'app' },
  { id: 'launch', key: 'r', shift: true, label: 'Launch on hardware', group: 'View', owner: 'app' },
];

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

function keyMatches(binding: Keybinding, key: string): boolean {
  if (binding.key === '1-9') return /^[1-9]$/.test(key);
  return binding.key === key || binding.alias === key;
}

/** Resolve a keydown to a binding id, or null. Casing-insensitive (Chromium reports 'P' under Shift). */
export function findBindingId(e: KeyLike): string | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  const hit = KEYBINDINGS.find(
    (b) => b.owner === 'app' && keyMatches(b, key) && Boolean(b.shift) === e.shiftKey,
  );
  return hit ? hit.id : null;
}

export function bindingFor(id: string): Keybinding {
  const found = KEYBINDINGS.find((b) => b.id === id);
  if (!found) throw new Error(`Unknown keybinding: ${id}`);
  return found;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return true;
  return /Mac|iPhone|iPad|darwin/i.test(navigator.platform || navigator.userAgent || '');
}

/** Glyph form on Mac (⌘⇧P), word form elsewhere (Ctrl+Shift+P). */
export function formatKeys(binding: Keybinding, mac: boolean = isMacPlatform()): string {
  const key = binding.display ?? binding.key.toUpperCase();
  const showShift = Boolean(binding.shift) && !binding.implicitShift;
  if (mac) return `${binding.ctrl ? '⌃' : '⌘'}${showShift ? '⇧' : ''}${key}`;
  return `Ctrl+${showShift ? 'Shift+' : ''}${key}`;
}

/** Whether this chord can actually reach the app in the running build (a browser tab never gets the reserved ones). */
export function isBindingAvailable(binding: Keybinding, web: boolean = isWebBuild()): boolean {
  return !(web && binding.browserReserved);
}

/** The key hint for a binding, or undefined when the chord is unbound or unreachable (never advertise a dead key). */
export function shortcutLabel(id: string, mac: boolean = isMacPlatform(), web: boolean = isWebBuild()): string | undefined {
  const binding = KEYBINDINGS.find((b) => b.id === id);
  return binding && isBindingAvailable(binding, web) ? formatKeys(binding, mac) : undefined;
}

/** For tooltips: "Run simulation (⌘↵)". */
export function withShortcut(label: string, id: string, mac: boolean = isMacPlatform()): string {
  const keys = shortcutLabel(id, mac);
  return keys ? `${label} (${keys})` : label;
}
