/**
 * Scrollable region with an overflow affordance (UI medium 2): edge fades and
 * a "scroll for more" hint appear only on the sides where content is clipped,
 * so a wide circuit never looks like it simply ends.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { overflowEdges, type OverflowEdges } from './scrollMath';

const NONE: OverflowEdges = { left: false, right: false, top: false, bottom: false };

export function LabScrollArea({
  children,
  label,
  maxHeight,
  style,
}: {
  children: ReactNode;
  /** Accessible name of the scroll region. */
  label: string;
  maxHeight?: number | string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState<OverflowEdges>(NONE);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = overflowEdges(el);
    setEdges((prev) =>
      prev.left === next.left && prev.right === next.right && prev.top === next.top && prev.bottom === next.bottom ? prev : next,
    );
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measure, children]);

  const more = edges.left || edges.right || edges.top || edges.bottom;
  return (
    <div
      className="lab-scroll"
      data-more-left={edges.left}
      data-more-right={edges.right}
      data-more-top={edges.top}
      data-more-bottom={edges.bottom}
    >
      <div
        ref={ref}
        className="lab-scroll__viewport"
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={measure}
        style={{ maxHeight, ...style }}
      >
        {children}
      </div>
      <span className="lab-scroll__fade lab-scroll__fade--left" aria-hidden />
      <span className="lab-scroll__fade lab-scroll__fade--right" aria-hidden />
      <span className="lab-scroll__fade lab-scroll__fade--bottom" aria-hidden />
      {more && (
        <div className="lab-scroll__hint" role="note">
          {edges.right || edges.left ? 'Scroll sideways to see the rest' : 'Scroll to see the rest'}
        </div>
      )}
    </div>
  );
}
