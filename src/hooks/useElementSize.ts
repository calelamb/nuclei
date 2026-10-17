import { useCallback, useEffect, useState } from 'react';

export interface ElementSize { width: number; height: number }

const UNMEASURED: ElementSize = { width: 0, height: 0 };

/**
 * Content-box size of an element, kept current with a ResizeObserver. Returns a
 * callback ref, so it also works when the element mounts later than the
 * component (e.g. behind an empty state). Reports 0x0 until measured (and in
 * environments without ResizeObserver); callers supply their own fallback.
 */
export function useElementSize<T extends HTMLElement>(): [(el: T | null) => void, ElementSize] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState<ElementSize>(UNMEASURED);
  const ref = useCallback((node: T | null) => setEl(node), []);

  useEffect(() => {
    if (!el) return undefined;
    const update = (width: number, height: number) => {
      const next = { width: Math.round(width), height: Math.round(height) };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    update(el.clientWidth, el.clientHeight);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box) update(box.width, box.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);

  return [ref, size];
}
