/** Vertical field of view (degrees) used when the viewport is at least as wide as it is tall. */
export const BASE_FOV_DEG = 45;

/**
 * Vertical field of view that keeps the sphere and its axis labels inside the
 * viewport. A tall, narrow cell (a single qubit in the rail) would otherwise crop
 * the X and Y labels, so the vertical fov widens to preserve the horizontal one.
 */
export function fovForAspect(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0 || aspect >= 1) return BASE_FOV_DEG;
  const half = Math.tan((BASE_FOV_DEG * Math.PI) / 360);
  return (2 * Math.atan(half / aspect) * 180) / Math.PI;
}

const MIN_LABEL_PX = 12;
const MAX_LABEL_PX = 20;

/**
 * Label height as a fraction of the viewport. Labels are drawn without size
 * attenuation, so a fixed fraction would be unreadable in a small cell and
 * oversized in a large one; clamp the on-screen height instead.
 */
export function labelHeightFraction(baseFraction: number, viewportPx: number): number {
  if (!Number.isFinite(viewportPx) || viewportPx <= 0) return baseFraction;
  const px = Math.min(MAX_LABEL_PX, Math.max(MIN_LABEL_PX, baseFraction * viewportPx));
  return px / viewportPx;
}
