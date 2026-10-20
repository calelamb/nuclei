/** Largest overshoot (as a fraction of the column) that is scaled down rather than scrolled. */
export const FIT_TOLERANCE = 0.25;

export interface FittedWidth {
  /** CSS width/height scale for the svg (1 = natural size). */
  scale: number;
  /** True when the diagram is wider than the column and still has to scroll. */
  scrolls: boolean;
}

/**
 * A circuit slightly wider than its column (under 25%) is scaled to fit, so the
 * last gate is never clipped at the edge; a much wider one keeps its natural size
 * and scrolls (with an edge fade) because shrinking it further would be unreadable.
 */
export function fitCircuitWidth(svgWidth: number, containerWidth: number): FittedWidth {
  if (containerWidth <= 0 || svgWidth <= containerWidth) return { scale: 1, scrolls: false };
  if (svgWidth <= containerWidth * (1 + FIT_TOLERANCE)) return { scale: containerWidth / svgWidth, scrolls: false };
  return { scale: 1, scrolls: true };
}
