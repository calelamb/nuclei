/** Marks the element the results column hands focus to when it is brought back from its rail tab. */
export const VIZ_LANDING_ATTR = 'data-viz-landing';

const MAX_FRAMES = 12;

/**
 * Bringing the results column back from its rail tab removes the tab that held focus, which would drop
 * focus to <body>. Wait for the column to mount, then focus its landing element. Returns a cancel function.
 */
export function focusVizLanding(doc: Document = document): () => void {
  let frame = 0;
  let handle = 0;
  const attempt = () => {
    const target = doc.querySelector<HTMLElement>(`[${VIZ_LANDING_ATTR}]`);
    if (target) { target.focus({ preventScroll: true }); return; }
    frame += 1;
    if (frame < MAX_FRAMES) handle = requestAnimationFrame(attempt);
  };
  handle = requestAnimationFrame(attempt);
  return () => cancelAnimationFrame(handle);
}
