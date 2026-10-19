import { useCallback, useRef, type RefObject } from 'react';

/** Marks a heading a keyboard route hands focus to; the one shared rule in ui.css gives it no ring. */
export const LANDING_ATTR = 'data-nav-landing';

export interface LandingProps {
  readonly tabIndex: -1;
  readonly 'data-nav-landing': '';
}

/** Props that make an element a programmatic landing target: focusable by script, never by Tab, no ring. */
export const LANDING_PROPS: LandingProps = { tabIndex: -1, [LANDING_ATTR]: '' };

export interface LandingHandle<T extends HTMLElement> {
  readonly ref: RefObject<T | null>;
  readonly props: LandingProps;
  /** Move focus to the target (no scrolling); false when it is not mounted. */
  readonly focus: () => boolean;
}

/** A landing target plus a way to focus it, for headings that a keyboard action should land on. */
export function useLandingRef<T extends HTMLElement>(): LandingHandle<T> {
  const ref = useRef<T | null>(null);
  const focus = useCallback(() => {
    const el = ref.current;
    if (!el) return false;
    el.focus({ preventScroll: true });
    return document.activeElement === el;
  }, []);
  return { ref, props: LANDING_PROPS, focus };
}
