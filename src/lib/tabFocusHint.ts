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
  return tabMovesFocus ? `Tab moves focus · ${key} to indent` : `${key}: Tab moves focus`;
}
