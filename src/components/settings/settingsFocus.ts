/**
 * Keyboard-opened Settings (Cmd+, or the palette) must put focus inside the panel; otherwise it stays in the
 * editor and the next Tab indents code. The request survives until the panel mounts, and also reaches a panel
 * that is already open (pressing the shortcut again re-focuses it).
 */
const FOCUS_EVENT = 'nuclei:focus-settings';
let pending = false;

export function requestSettingsFocus(): void {
  pending = true;
  window.dispatchEvent(new Event(FOCUS_EVENT));
}

/** Consume a pending request; true when the caller should move focus now. */
export function takeSettingsFocusRequest(): boolean {
  const had = pending;
  pending = false;
  return had;
}

export function onSettingsFocusRequest(listener: () => void): () => void {
  window.addEventListener(FOCUS_EVENT, listener);
  return () => window.removeEventListener(FOCUS_EVENT, listener);
}
