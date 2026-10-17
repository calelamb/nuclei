import { useCallback, useEffect, useState } from 'react';

/** Thickness (px) the element's horizontal scrollbar takes from its layout box. */
export function measureScrollbarInset(el: HTMLElement): number {
  return Math.max(0, el.offsetHeight - el.clientHeight);
}

/**
 * Tracks how much layout height a horizontal scrollbar steals from an element,
 * so a sibling that must line up with the scrolled content can compensate.
 * Returns 0 where scrollbars overlay (or ResizeObserver is missing).
 */
export function useScrollbarInset<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [inset, setInset] = useState(0);
  const ref = useCallback((node: T | null) => setEl(node), []);

  useEffect(() => {
    if (!el) return undefined;
    const update = () => setInset(measureScrollbarInset(el));
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [el]);

  return [ref, inset];
}
