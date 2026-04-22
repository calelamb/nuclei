import { type ReactNode, useEffect, useRef, useState } from 'react';

export type RevealFrom = 'right' | 'left' | 'bottom' | 'top';

interface PanelRevealProps {
  when: boolean;
  from?: RevealFrom;
  children: ReactNode;
}

/**
 * Conditionally mounts children with a fade + translate transition.
 * When `when` goes false, the child unmounts after the exit transition.
 * Translate direction is controlled by `from` (defaults to 'right').
 *
 * The transition itself lives in `src/index.css` keyed off the
 * `data-reveal-*` attributes so tests can verify structure without
 * depending on computed animation values.
 */
export function PanelReveal({ when, from = 'right', children }: PanelRevealProps) {
  const [mounted, setMounted] = useState(when);
  const [entered, setEntered] = useState(false);
  const exitTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let raf: number | null = null;
    if (when) {
      if (exitTimeout.current) {
        clearTimeout(exitTimeout.current);
        exitTimeout.current = null;
      }
      queueMicrotask(() => {
        setMounted(true);
        // Defer 'entered' by one frame so the browser paints the
        // pre-transition state before transitioning.
        raf = requestAnimationFrame(() => setEntered(true));
      });
      return () => {
        if (raf !== null) cancelAnimationFrame(raf);
      };
    }
    queueMicrotask(() => {
      setEntered(false);
      exitTimeout.current = setTimeout(() => setMounted(false), 160);
    });
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      if (exitTimeout.current) clearTimeout(exitTimeout.current);
    };
  }, [when]);

  if (!mounted) return null;

  return (
    <div
      data-reveal-root=""
      data-reveal-from={from}
      data-reveal-entered={entered ? '' : undefined}
    >
      {children}
    </div>
  );
}
