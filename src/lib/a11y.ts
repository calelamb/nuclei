import type { KeyboardEvent } from 'react';

/**
 * Returns an `onKeyDown` handler that fires `activate` on Enter or Space,
 * for elements made clickable via a `<div onClick>` + `role="button"` /
 * `role="row"` pattern (Nuclei's inline-styled cards and table rows).
 *
 * Space is `preventDefault`ed so it activates the element instead of
 * scrolling the page.
 */
export function activateOnKey(activate: () => void) {
  return (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    }
  };
}
