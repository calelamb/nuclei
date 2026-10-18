/** Frames to wait for the origin to unmount and a target to appear (about half a second). */
const MAX_FRAMES = 30;

/** The editor's input surface: where typing continues when nothing nearer exists. */
export const EDITOR_FOCUS_TARGET = '.monaco-editor textarea';

/**
 * A control that unmounts itself (Dismiss, Collapse) would drop keyboard focus to <body>. Call this
 * before the state change: once `origin` leaves the DOM, focus moves to the first of `targets`
 * (CSS selectors, best first) that exists. Gives up if focus went somewhere on its own, if the
 * origin never unmounts, or after MAX_FRAMES. Returns a cancel function.
 */
export function focusAfterUnmount(
  origin: Element | null,
  targets: readonly string[],
  maxFrames: number = MAX_FRAMES,
): () => void {
  let frame = 0;
  let handle = 0;
  const tick = () => {
    frame += 1;
    const active = document.activeElement;
    const focusMoved = active !== null && active !== document.body && active !== origin;
    if (focusMoved) return;
    if (origin === null || !origin.isConnected) {
      for (const selector of targets) {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el) continue;
        el.focus({ preventScroll: true });
        if (document.activeElement === el) return;
      }
    }
    if (frame < maxFrames) handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(handle);
}
