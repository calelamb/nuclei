import { useCallback, useEffect, useState } from 'react';

/** Below this viewport width the canvas needs the room more than the file list does. */
export const SOURCES_RAIL_QUERY = '(max-width: 999px)';

function initiallyCollapsed(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(SOURCES_RAIL_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * The Sources / Data panel folds to a narrow rail on narrow windows so the
 * investigation canvas keeps most of the width. Crossing the breakpoint
 * (in either direction) resets it; the toggle overrides it in between.
 */
export function useSourcesRail(): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(SOURCES_RAIL_QUERY);
    if (typeof query.addEventListener !== 'function') return undefined;
    const onChange = (event: MediaQueryListEvent): void => setCollapsed(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  const toggle = useCallback(() => setCollapsed((current) => !current), []);
  return { collapsed, toggle };
}
