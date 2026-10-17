import { hasMoreBelow } from '../../lib/scrollMetrics';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const FADE_PX = 28;

/** Scrollable block that fades its bottom edge while more content is below. */
export function ScrollFade({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    if (ref.current) setMore(hasMoreBelow(ref.current));
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });
  const mask = `linear-gradient(to bottom, #000 calc(100% - ${FADE_PX}px), transparent)`;
  return (
    <div
      ref={ref} onScroll={measure} data-more-below={more}
      style={{ ...style, overflowY: 'auto', ...(more ? { WebkitMaskImage: mask, maskImage: mask } : {}) }}
    >
      {children}
    </div>
  );
}
