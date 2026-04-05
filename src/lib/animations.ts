/**
 * Nuclei Animation System
 *
 * Centralized animation utilities. CSS transition-based, no external library.
 * All animations respect prefers-reduced-motion.
 *
 * UI/UX Pro Max guidelines:
 * - Duration: 150-300ms for micro-interactions, ≤400ms complex
 * - Easing: ease-out for entering, ease-in for exiting
 * - Spring-like overshoot via cubic-bezier(0.34, 1.56, 0.64, 1) for playful elements
 * - Never block interaction
 * - Exit faster than enter (~70% of enter duration)
 */

export const EASING = {
  /** Standard ease-out for entering elements */
  enter: 'cubic-bezier(0.4, 0, 0.2, 1)',
  /** Ease-in for exiting elements */
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  /** Spring-like overshoot for playful interactions */
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  /** Smooth deceleration for panels and large movements */
  decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
} as const;

export const DURATION = {
  /** Instant feedback: hover, active states */
  instant: 100,
  /** Micro-interactions: button press, toggle, tooltip */
  fast: 150,
  /** Standard transitions: panel toggle, tab switch */
  normal: 200,
  /** Complex transitions: mode switch, panel rearrange */
  slow: 300,
  /** Large animations: page transition, onboarding */
  emphasis: 400,
} as const;

/** Check if the user prefers reduced motion */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Get duration respecting reduced-motion preference */
export function getDuration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

/** Build a CSS transition string */
export function transition(
  properties: string | string[],
  duration: number = DURATION.normal,
  easing: string = EASING.enter
): string {
  const d = getDuration(duration);
  const props = Array.isArray(properties) ? properties : [properties];
  return props.map((p) => `${p} ${d}ms ${easing}`).join(', ');
}

/** CSS keyframes as inline style (for simple animations) */
export function pulseGlow(color: string): Record<string, string> {
  return {
    animation: prefersReducedMotion() ? 'none' : `nuclei-pulse 1.5s ${EASING.enter} infinite`,
    boxShadow: `0 0 8px ${color}40`,
  };
}
