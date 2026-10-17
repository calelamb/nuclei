/** Camera pose around the origin, in spherical coordinates (polar measured from +Y, the |0> axis). */
export interface OrbitPose {
  azimuth: number;
  polar: number;
  radius: number;
}

export const DEFAULT_ORBIT_POSE: OrbitPose = { azimuth: Math.PI / 4, polar: 1.13, radius: 3.9 };
export const MIN_ORBIT_RADIUS = 2.4;
export const MAX_ORBIT_RADIUS = 6;
const MIN_POLAR = 0.12;
const MAX_POLAR = Math.PI - 0.12;
const ROTATE_SPEED = 0.8; // radians per view-height of drag
const ZOOM_SPEED = 0.0015;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function orbitPosition({ azimuth, polar, radius }: OrbitPose): [number, number, number] {
  const sinP = Math.sin(polar);
  return [radius * sinP * Math.sin(azimuth), radius * Math.cos(polar), radius * sinP * Math.cos(azimuth)];
}

/** Rotate by a pointer drag of (dx, dy) CSS pixels over a view `viewHeight` tall. */
export function dragPose(pose: OrbitPose, dx: number, dy: number, viewHeight: number): OrbitPose {
  const scale = (Math.PI * 2 * ROTATE_SPEED) / Math.max(1, viewHeight);
  return {
    ...pose,
    azimuth: pose.azimuth - dx * scale,
    polar: clamp(pose.polar - dy * scale, MIN_POLAR, MAX_POLAR),
  };
}

export function zoomPose(pose: OrbitPose, wheelDeltaY: number): OrbitPose {
  return { ...pose, radius: clamp(pose.radius * (1 + wheelDeltaY * ZOOM_SPEED), MIN_ORBIT_RADIUS, MAX_ORBIT_RADIUS) };
}

/** Exponential decay of release velocity (rad/s). Returns 0 once it is too small to see. */
export function decayVelocity(velocity: number, dtSeconds: number): number {
  const next = velocity * Math.exp(-dtSeconds * 8);
  return Math.abs(next) < 0.02 ? 0 : next;
}
