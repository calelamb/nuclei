import { bindingFor, formatKeys, isMacPlatform } from '../config/keybindings';

export function tabFocusToggleLabel(mac: boolean = isMacPlatform()): string {
  return formatKeys(bindingFor('tab-focus'), mac);
}

/**
 * The status-bar hint shown while the code editor has focus. Monaco swallows Tab
 * for indentation, which traps keyboard-only users; this says how to leave.
 */
export function tabFocusHint(tabMovesFocus: boolean, mac: boolean = isMacPlatform()): string {
  const key = tabFocusToggleLabel(mac);
  return tabMovesFocus
    ? `Tab moves focus · ${key} to indent with Tab`
    : `Tab indents · ${key} to move focus with Tab`;
}

/** The status-bar form of the hint: short enough to sit beside the kernel state at any width. */
export function compactTabFocusHint(tabMovesFocus: boolean, mac: boolean = isMacPlatform()): string {
  const key = tabFocusToggleLabel(mac);
  return tabMovesFocus ? `Tab moves focus · ${key} to indent` : `Tab indents · ${key} to Tab out`;
}
