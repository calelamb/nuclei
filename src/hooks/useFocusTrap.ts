import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface FocusTrapOptions {
  /** Return focus to the element that had it before the trap mounted. Default true. */
  restoreFocus?: boolean;
  /** Move focus into the container on mount. Default true. */
  autoFocus?: boolean;
  /** CSS selector of regions whose controls are skipped when choosing the initial focus target (Tab still reaches them). */
  autoFocusSkip?: string;
}

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Makes a container behave like a real modal for keyboard users: focus moves
 * in on mount, Tab / Shift+Tab wrap inside it (and pull focus back if it ever
 * lands outside), and focus is restored to the opener on unmount.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  { restoreFocus = true, autoFocus = true, autoFocusSkip }: FocusTrapOptions = {},
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (autoFocus) {
      const candidates = focusableWithin(container);
      const first = autoFocusSkip ? candidates.find((el) => !el.closest(autoFocusSkip)) : candidates[0];
      (first ?? container).focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusableWithin(container);
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && container.contains(active);
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (restoreFocus && opener && document.contains(opener)) opener.focus();
    };
  }, [containerRef, restoreFocus, autoFocus, autoFocusSkip]);
}
