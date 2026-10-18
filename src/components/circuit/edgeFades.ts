import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

const FADE_PX = 24;
const SLACK_PX = 1;

export interface ScrollEdges {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
}

export interface ScrollBox {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
}

/** Which edges of a scroller still have content beyond them. */
export function scrollEdges(box: ScrollBox): ScrollEdges {
  return {
    top: box.scrollTop > SLACK_PX,
    bottom: box.scrollTop + box.clientHeight < box.scrollHeight - SLACK_PX,
    left: box.scrollLeft > SLACK_PX,
    right: box.scrollLeft + box.clientWidth < box.scrollWidth - SLACK_PX,
  };
}

function axisGradient(direction: 'to bottom' | 'to right', start: boolean, end: boolean): string | null {
  if (!start && !end) return null;
  const head = start ? `transparent, #000 ${FADE_PX}px` : '#000';
  const tail = end ? `#000 calc(100% - ${FADE_PX}px), transparent` : '#000';
  return `linear-gradient(${direction}, ${head}, ${tail})`;
}

/** The mask that fades every edge that has more content beyond it, or undefined when nothing overflows. */
export function edgeFadeStyle(edges: ScrollEdges): CSSProperties | undefined {
  const layers = [axisGradient('to bottom', edges.top, edges.bottom), axisGradient('to right', edges.left, edges.right)].filter(
    (g): g is string => g !== null,
  );
  if (layers.length === 0) return undefined;
  const mask = layers.join(', ');
  return { WebkitMaskImage: mask, maskImage: mask, WebkitMaskComposite: 'source-in', maskComposite: 'intersect' };
}

/** Ref + scroll handler + style for a scroller that fades the edges it is clipping (overlay scrollbars hide the cue). */
export function useEdgeFades<T extends HTMLElement>(): { ref: (el: T | null) => void; onScroll: () => void; style: CSSProperties | undefined } {
  const elRef = useRef<T | null>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ top: false, bottom: false, left: false, right: false });
  const measure = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const next = scrollEdges(el);
    setEdges((prev) => (prev.top === next.top && prev.bottom === next.bottom && prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    elRef.current = el;
    if (!el) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(measure);
    observer.current.observe(el);
    if (el.firstElementChild) observer.current.observe(el.firstElementChild);
  }, [measure]);
  useEffect(() => () => observer.current?.disconnect(), []);
  return { ref, onScroll: measure, style: edgeFadeStyle(edges) };
}
