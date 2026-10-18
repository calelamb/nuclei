import { hasMoreBelow, hasMoreRight } from '../../lib/scrollMetrics';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const FADE_PX = 28;

function hasMoreBeyond(el: HTMLElement): boolean {
  return el.dataset.axis === 'x' ? hasMoreRight(el) : hasMoreBelow(el);
}

interface ScrollFadeProps {
  children: ReactNode;
  style?: CSSProperties;
  /** Which edge fades while more content lies beyond it: the bottom (default) or the right. */
  axis?: 'y' | 'x';
  /** When set, the scroller is a labelled, focusable region so the keyboard can scroll it. */
  label?: string;
}

/** Scrollable block that fades its trailing edge while more content is beyond it. */
export function ScrollFade({ children, style, axis = 'y', label }: ScrollFadeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    if (ref.current) setMore(hasMoreBeyond(ref.current));
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });
  const direction = axis === 'x' ? 'to right' : 'to bottom';
  const mask = `linear-gradient(${direction}, #000 calc(100% - ${FADE_PX}px), transparent)`;
  const overflow: CSSProperties = axis === 'x' ? { overflow: 'auto' } : { overflowY: 'auto' };
  const region = label ? { role: 'region', 'aria-label': label, tabIndex: 0 } : {};
  return (
    <div
      ref={ref} onScroll={measure} data-axis={axis} data-more-below={axis === 'y' ? more : undefined} data-more-right={axis === 'x' ? more : undefined}
      {...region}
      style={{ ...style, ...overflow, ...(more ? { WebkitMaskImage: mask, maskImage: mask } : {}) }}
    >
      {children}
    </div>
  );
}
