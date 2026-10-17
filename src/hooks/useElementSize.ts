import { useCallback, useState } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Tracks an element's content box. Returns a callback ref so measurement starts
 * as soon as the element mounts (also when it mounts late, behind a conditional).
 */
export function useElementSize<T extends HTMLElement>(): [(node: T | null) => void, ElementSize] {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  const [observer] = useState(() =>
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          const box = entries[0]?.contentRect;
          if (!box) return;
          setSize((prev) => (
            Math.round(prev.width) === Math.round(box.width) && Math.round(prev.height) === Math.round(box.height)
              ? prev
              : { width: box.width, height: box.height }
          ));
        }),
  );
  const ref = useCallback((node: T | null) => {
    observer?.disconnect();
    if (!node) return;
    setSize({ width: node.clientWidth, height: node.clientHeight });
    observer?.observe(node);
  }, [observer]);
  return [ref, size];
}
