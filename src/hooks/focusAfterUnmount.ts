/** Frames to wait for the origin to unmount and a target to appear (about half a second). */
const MAX_FRAMES = 30;
/** After focus lands, keep watching this many frames: the target may itself remount and drop focus to <body>. */
const SETTLE_FRAMES = 30;

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
  let landedAt: number | null = null;
  let landedOn: Element | null = null;
  let handle = 0;
  const land = (): boolean => {
    for (const selector of targets) {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) continue;
      el.focus({ preventScroll: true });
      if (document.activeElement === el) { landedOn = el; return true; }
    }
    return false;
  };
  const tick = () => {
    frame += 1;
    const active = document.activeElement;
    const onBody = active === null || active === document.body;
    if (landedAt !== null) {
      // Settling: keep watching while focus sits on the target, re-land if it fell to <body>, and stop
      // as soon as it is anywhere else (the person moved it).
      if (frame - landedAt >= SETTLE_FRAMES || (!onBody && active !== landedOn)) return;
      if (onBody) land();
      handle = requestAnimationFrame(tick);
      return;
    }
    const focusMoved = !onBody && active !== origin;
    if (focusMoved) return;
    if ((origin === null || !origin.isConnected) && land()) landedAt = frame;
    if (landedAt !== null || frame < maxFrames) handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(handle);
}
