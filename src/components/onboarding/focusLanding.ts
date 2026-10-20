import { useResearchTourStore } from '../../stores/researchTourStore';

const LANDING_SELECTORS = ['.lesson__title', '.tracks__title', '.monaco-editor textarea'];

/**
 * Moves keyboard focus to wherever onboarding just landed the user (lesson heading, track chooser
 * or editor) so they do not have to Tab through the whole shell from the top of the page.
 */
export function focusLanding(): boolean {
  // The Research tour owns focus while it is open; moving it into the editor behind the dim would let typing edit code.
  if (useResearchTourStore.getState().active) return true;
  for (const selector of LANDING_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) continue;
    if (!el.matches('textarea, input, button') && el.tabIndex < 0 && !el.hasAttribute('tabindex')) {
      el.setAttribute('tabindex', '-1');
    }
    el.focus({ preventScroll: true });
    return document.activeElement === el;
  }
  return false;
}

/** Focus once the landing view has rendered; retries briefly because the editor and lessons mount lazily. */
export function scheduleLandingFocus(attempts = 10, delayMs = 150): void {
  const tryFocus = (left: number): void => {
    if (focusLanding() || left <= 0) return;
    window.setTimeout(() => tryFocus(left - 1), delayMs);
  };
  window.setTimeout(() => tryFocus(attempts), delayMs);
}
