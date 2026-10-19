import { NAV_LANDING_ATTR } from '../components/layout/focusViz';

/** Marks a heading a keyboard route hands focus to; the one shared rule in ui.css gives it no ring. */
export const LANDING_ATTR = NAV_LANDING_ATTR;

export interface LandingProps {
  readonly tabIndex: -1;
  readonly 'data-nav-landing': '';
}

/** Props that make an element a programmatic landing target: focusable by script, never by Tab, no ring. */
export const LANDING_PROPS: LandingProps = { tabIndex: -1, [LANDING_ATTR]: '' };
