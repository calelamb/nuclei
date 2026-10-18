/**
 * Bring the newest error line of the Terminal into view and put keyboard focus in its output, so
 * "Show error" does what it says even when the Terminal is already open. Returns false when no
 * Terminal output is mounted yet.
 */
export function revealTerminalError(): boolean {
  const output = document.querySelector<HTMLElement>('[data-terminal-output]');
  if (!output) return false;
  const errors = output.querySelectorAll<HTMLElement>('[data-terminal-error]');
  const last = errors.length > 0 ? errors[errors.length - 1] : null;
  last?.scrollIntoView?.({ block: 'center' });
  output.focus({ preventScroll: true });
  return true;
}
