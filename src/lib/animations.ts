/**
 * Nuclei Animation System
 *
 * Centralized animation utilities. CSS transition-based, no external library.
 * All animations respect prefers-reduced-motion.
 *
 * Duration: 150-300ms for micro-interactions, up to 1000ms for state changes
 * Easing: ease-out for entering, ease-in for exiting
 * Spring overshoot via cubic-bezier(0.34, 1.56, 0.64, 1) for playful elements
 * Never block interaction — all animations are interruptible
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
  /** Measurement snap — overshoot then settle */
  snap: 'cubic-bezier(0.68, -0.6, 0.32, 1.6)',
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
  /** State changes: Bloch sphere rotation, histogram grow */
  stateChange: 600,
  /** Dramatic: circuit wire draw, entanglement animation */
  dramatic: 1000,
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

/** CSS keyframes as inline style for pulse glow */
export function pulseGlow(color: string): Record<string, string> {
  return {
    animation: prefersReducedMotion() ? 'none' : `nuclei-pulse 1.5s ${EASING.enter} infinite`,
    boxShadow: `0 0 8px ${color}40`,
  };
}

/** Get staggered delay for list items */
export function staggerDelay(index: number, baseDelay: number = 50): number {
  return prefersReducedMotion() ? 0 : index * baseDelay;
}

/** Build staggered animation style for list items */
export function staggerStyle(index: number, animation: string = 'nuclei-slide-up', duration: number = DURATION.normal): React.CSSProperties {
  if (prefersReducedMotion()) return {};
  return {
    animation: `${animation} ${duration}ms ${EASING.enter} ${staggerDelay(index)}ms both`,
  };
}

/** Spring physics for panel resize — returns a CSS transition with spring easing */
export function springTransition(properties: string | string[], duration: number = DURATION.slow): string {
  const d = getDuration(duration);
  const props = Array.isArray(properties) ? properties : [properties];
  return props.map((p) => `${p} ${d}ms ${EASING.spring}`).join(', ');
}

/** Animate a numeric counter (used for qubit count, depth) */
export function animateCounter(
  element: HTMLElement,
  from: number,
  to: number,
  duration: number = 300
): void {
  if (prefersReducedMotion() || from === to) {
    element.textContent = String(to);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(from + (to - from) * eased);
    element.textContent = String(current);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Spherical linear interpolation for Bloch sphere */
export function slerp(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  t: number
): { x: number; y: number; z: number } {
  // Normalize
  const lenA = Math.sqrt(from.x ** 2 + from.y ** 2 + from.z ** 2) || 1;
  const lenB = Math.sqrt(to.x ** 2 + to.y ** 2 + to.z ** 2) || 1;
  const a = { x: from.x / lenA, y: from.y / lenA, z: from.z / lenA };
  const b = { x: to.x / lenB, y: to.y / lenB, z: to.z / lenB };

  let dot = a.x * b.x + a.y * b.y + a.z * b.z;
  dot = Math.max(-1, Math.min(1, dot));

  if (dot > 0.9995) {
    // Close enough — linear interpolation
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
  }

  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;

  return {
    x: a.x * wa + b.x * wb,
    y: a.y * wa + b.y * wb,
    z: a.z * wa + b.z * wb,
  };
}
