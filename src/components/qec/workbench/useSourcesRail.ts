import { useCallback, useEffect, useState } from 'react';
import { isWebBuild } from '../../../platform/buildTarget';

/** Below this viewport width the canvas needs the room more than the file list does. */
export const SOURCES_RAIL_QUERY = '(max-width: 999px)';

/** The web build has no project folder, so the panel only holds a sentence: it starts and stays folded to the rail. */
function initiallyCollapsed(): boolean {
  if (isWebBuild()) return true;
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
    const onChange = (event: MediaQueryListEvent): void => setCollapsed(isWebBuild() || event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  const toggle = useCallback(() => setCollapsed((current) => !current), []);
  return { collapsed, toggle };
}
