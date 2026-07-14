import { useEffect } from 'react';

/**
 * Closes a modal/overlay when the user presses Escape.
 *
 * Every dialog in Nuclei should be dismissable from the keyboard — a token
 * prompt or an unsaved-changes guard that can only be closed with the mouse
 * is a keyboard-a11y dead end. This centralizes the `keydown` listener so
 * each modal doesn't hand-roll (and occasionally forget) it.
 *
 * Pass `enabled: false` to keep the listener off while the modal is hidden.
 */
export function useEscapeToClose(onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, enabled]);
}
