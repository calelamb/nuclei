/** Marks the element the results column hands focus to when it is brought back from its rail tab. */
export const VIZ_LANDING_ATTR = 'data-viz-landing';
/** Marks the sidebar heading a keyboard navigation (palette "Go to", Cmd+1..9) hands focus to. */
export const NAV_LANDING_ATTR = 'data-nav-landing';

const MAX_FRAMES = 12;

/**
 * Focus the element carrying `attr` once it exists. A keyboard action that swaps what is on screen (a rail tab that
 * disappears, a sidebar view that changes) would otherwise leave focus on <body> or in the editor, where the next Tab
 * indents code. `settleFrames` lets React commit the new view before the first look. Returns a cancel function.
 */
export function focusWhenMounted(attr: string, settleFrames = 0, doc: Document = document): () => void {
  let frame = 0;
  let handle = 0;
  const attempt = () => {
    frame += 1;
    const target = frame > settleFrames ? doc.querySelector<HTMLElement>(`[${attr}]`) : null;
    if (target) { target.focus({ preventScroll: true }); return; }
    if (frame < MAX_FRAMES) handle = requestAnimationFrame(attempt);
  };
  handle = requestAnimationFrame(attempt);
  return () => cancelAnimationFrame(handle);
}

/** Bringing the results column back from its rail tab removes the tab that held focus. */
export function focusVizLanding(doc: Document = document): () => void {
  return focusWhenMounted(VIZ_LANDING_ATTR, 0, doc);
}

/** Marks the wrapper of a full-width takeover (Learn home, Challenges) so focus can find its heading. */
export const TAKEOVER_ATTR = 'data-takeover';
// A lazily loaded takeover can take well over the 12 frames a sidebar needs; ~2 s of frames.
const TAKEOVER_MAX_FRAMES = 120;
// Pane-header titles (web QEC Workbench, Transpiler) are only a fallback; the sidebar heading gets first refusal.
const PANE_TITLE_SELECTOR = '.nuclei-pane-header :is(h1, h2)';
const PANE_FALLBACK_FRAME = 8;
// After landing, watch this many frames for the editor re-mounting and taking focus back.
const STABLE_FRAMES = 6;
const KEEP_FOCUS_FRAMES = 40;
/** Set on a pane title a keyboard route landed on; the ring rule treats it like a sidebar landing heading. */
export const NAV_LANDED_ATTR = 'data-nav-landed';

/** Focus has been dropped to nowhere or to the code editor that a re-mount just autofocused. */
function focusWasStolen(doc: Document, target: HTMLElement): boolean {
  const active = doc.activeElement;
  if (active === target) return false;
  return active === null || active === doc.body || active.closest('.monaco-editor') !== null || !target.isConnected;
}

interface PollOptions {
  readonly find: (doc: Document, frame: number) => HTMLElement | null;
  readonly maxFrames: number;
  readonly doc: Document;
}

/** Poll each frame for a target, focus it, then keep watching briefly so a late re-mount cannot take focus back. */
function pollAndFocus({ find, maxFrames, doc }: PollOptions): () => void {
  let frame = 0;
  let handle = 0;
  // A pointer press is the person choosing where focus goes; stop watching once they do (not before the first landing).
  const onPointer = () => { cancel(); };
  const cancel = () => { cancelAnimationFrame(handle); doc.removeEventListener('pointerdown', onPointer, true); };
  doc.addEventListener('pointerdown', onPointer, true);
  let landedAt = -1;
  let landed: HTMLElement | null = null;
  const land = (target: HTMLElement) => {
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    if (target.closest('.nuclei-pane-header')) target.setAttribute(NAV_LANDED_ATTR, '');
    landed = target;
    landedAt = frame;
  };
  const attempt = () => {
    frame += 1;
    if (landed) {
      if (focusWasStolen(doc, landed)) {
        landed = null;
      } else if (frame - landedAt >= STABLE_FRAMES) {
        cancel();
        return;
      }
    }
    if (!landed) {
      const target = find(doc, frame);
      if (target) land(target);
    }
    if (frame < maxFrames) handle = requestAnimationFrame(attempt);
    else cancel();
  };
  handle = requestAnimationFrame(attempt);
  return cancel;
}

/**
 * Leaving a takeover re-mounts the editor, which autofocuses itself. After a rail click, hold focus on the clicked
 * button for a few frames so the person is not dropped into the code. A pointer press elsewhere ends the watch.
 */
export function keepFocusOn(target: HTMLElement, doc: Document = document): () => void {
  let frame = 0;
  let handle = 0;
  const cancel = () => { cancelAnimationFrame(handle); doc.removeEventListener('pointerdown', onPointer, true); };
  const onPointer = () => { cancel(); };
  const attempt = () => {
    frame += 1;
    const active = doc.activeElement;
    const lost = active === null || active === doc.body || active.closest('.monaco-editor') !== null;
    if (lost && target.isConnected) target.focus({ preventScroll: true });
    if (frame < KEEP_FOCUS_FRAMES) handle = requestAnimationFrame(attempt);
    else cancel();
  };
  doc.addEventListener('pointerdown', onPointer, true);
  handle = requestAnimationFrame(attempt);
  return cancel;
}

/** After a keyboard navigation to a rail view, move focus into that view's sidebar (or the pane's own title). */
export function focusNavLanding(doc: Document = document, settleFrames = 2): () => void {
  return pollAndFocus({
    doc,
    // Leaving a takeover: its wrapper must be gone before the sidebar heading is trusted to be the new one.
    maxFrames: TAKEOVER_MAX_FRAMES,
    find: (d, frame) => {
      if (frame <= settleFrames || d.querySelector(`[${TAKEOVER_ATTR}]`)) return null;
      const landing = d.querySelector<HTMLElement>(`[${NAV_LANDING_ATTR}]`);
      if (landing) return landing;
      return frame >= PANE_FALLBACK_FRAME ? d.querySelector<HTMLElement>(PANE_TITLE_SELECTOR) : null;
    },
  });
}

/**
 * After a keyboard route opens a Learn/Challenge takeover, focus its first heading (made programmatically
 * focusable) instead of leaving focus in the editor behind it. Scoped to `view` so the previous takeover's
 * heading, still mounted for a frame while the next chunk loads, is never mistaken for the new one.
 */
export function focusTakeoverHeading(view: string, doc: Document = document): () => void {
  return pollAndFocus({
    doc,
    maxFrames: TAKEOVER_MAX_FRAMES,
    find: (d) => d.querySelector<HTMLElement>(`[${TAKEOVER_ATTR}="${view}"] :is(h1, h2)`),
  });
}

let cancelPendingRoute: (() => void) | null = null;

/**
 * Where a keyboard route to `view` hands focus: the takeover's heading, or the sidebar's. Only the latest route
 * may land focus; an earlier route's poll is cancelled so it cannot pull focus back after the person moved on.
 */
export function focusAfterViewSelect(view: string, doc: Document = document): () => void {
  cancelPendingRoute?.();
  const cancel = view === 'learning' || view === 'challenges' ? focusTakeoverHeading(view, doc) : focusNavLanding(doc);
  cancelPendingRoute = cancel;
  return cancel;
}
