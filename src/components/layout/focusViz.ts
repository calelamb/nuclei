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

/** After a keyboard navigation to a rail view, move focus into that view's sidebar. */
export function focusNavLanding(doc: Document = document): () => void {
  return focusWhenMounted(NAV_LANDING_ATTR, 2, doc);
}

/** Marks the wrapper of a full-width takeover (Learn home, Challenges) so focus can find its heading. */
export const TAKEOVER_ATTR = 'data-takeover';
// A lazily loaded takeover can take well over the 12 frames a sidebar needs; ~2 s of frames.
const TAKEOVER_MAX_FRAMES = 120;

/**
 * After a keyboard route opens a Learn/Challenge takeover, focus its first heading (made programmatically
 * focusable) instead of leaving focus in the editor behind it. Returns a cancel function.
 */
export function focusTakeoverHeading(doc: Document = document): () => void {
  let frame = 0;
  let handle = 0;
  const attempt = () => {
    frame += 1;
    const heading = doc.querySelector<HTMLElement>(`[${TAKEOVER_ATTR}] :is(h1, h2)`);
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
      return;
    }
    if (frame < TAKEOVER_MAX_FRAMES) handle = requestAnimationFrame(attempt);
  };
  handle = requestAnimationFrame(attempt);
  return () => cancelAnimationFrame(handle);
}

/** Where a keyboard route to `view` hands focus: the takeover's heading, or the sidebar's. */
export function focusAfterViewSelect(view: string, doc: Document = document): () => void {
  return view === 'learning' || view === 'challenges' ? focusTakeoverHeading(doc) : focusNavLanding(doc);
}
