interface AttrTarget {
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
}

const FLAG = 'data-reduced-motion';

function defaultRoot(): AttrTarget | null {
  return typeof document === 'undefined' ? null : document.documentElement;
}

/**
 * Mirrors the Animations setting onto `<html data-reduced-motion="true">`.
 * index.css collapses animation and transition durations under that flag,
 * the same way it already does for the OS-level prefers-reduced-motion query.
 */
export function applyMotionPreference(animationsEnabled: boolean, root: AttrTarget | null = defaultRoot()): void {
  if (!root) return;
  if (animationsEnabled) root.removeAttribute(FLAG);
  else root.setAttribute(FLAG, 'true');
}
