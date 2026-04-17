import { useEffect, useState } from 'react';

/**
 * Tracks the user's `prefers-reduced-motion` setting. The Bloch viz uses
 * this to disable ambient drift, gate-reaction tilts, and spring-settled
 * camera dollies. Static bloom/material work is kept — no motion, still
 * beautiful.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return reduced;
}
