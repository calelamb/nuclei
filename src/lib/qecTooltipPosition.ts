export interface TooltipPlacement {
  readonly x: number;
  readonly plotWidth: number;
  readonly tooltipWidth: number;
  readonly offset: number;
}

const EDGE_MARGIN = 4;

/** Left edge for a hover tooltip: the side with room, always clamped inside the figure. */
export function tooltipLeft({ x, plotWidth, tooltipWidth, offset }: TooltipPlacement): number {
  const right = x + offset;
  const left = x - tooltipWidth - offset;
  const fitsRight = right + tooltipWidth <= plotWidth - EDGE_MARGIN;
  const side = fitsRight || left < EDGE_MARGIN ? right : left;
  const max = Math.max(EDGE_MARGIN, plotWidth - tooltipWidth - EDGE_MARGIN);
  return Math.min(max, Math.max(EDGE_MARGIN, side));
}
