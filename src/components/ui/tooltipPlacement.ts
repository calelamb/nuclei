export const TOOLTIP_GAP_PX = 6;
export const TOOLTIP_EDGE_PX = 8;
/** Half the narrowest tooltip: keeps the anchor point from sitting on the viewport edge before the real clamp. */
const HALF_MIN_WIDTH_PX = 60;
/** Half a one-line tooltip's height, so a vertically centred tip clears the viewport edge before the real clamp. */
const HALF_LINE_PX = 14;

export type TooltipSide = 'above' | 'below' | 'right' | 'left';

export interface TooltipPosition { left: number; top: number; placement: TooltipSide }

export const TOOLTIP_TRANSFORMS: Record<TooltipSide, string> = {
  above: 'translate(-50%, -100%)',
  below: 'translate(-50%, 0)',
  right: 'translate(0, -50%)',
  left: 'translate(-100%, -50%)',
};

interface Box { left: number; right: number; top: number; bottom: number }
interface Viewport { width: number; height: number }

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Where a tooltip anchors for `trigger`. Side placements centre on the trigger, or on the
 * pointer when one is hovering, so a full-height trigger (a rail tab) keeps its tip beside the cursor.
 */
export function anchorTooltip(trigger: Box, placement: TooltipSide, viewport: Viewport, pointerY: number | null): TooltipPosition {
  if (placement === 'right' || placement === 'left') {
    const centre = pointerY ?? (trigger.top + trigger.bottom) / 2;
    const top = clamp(centre, trigger.top, trigger.bottom);
    return {
      left: placement === 'right' ? trigger.right + TOOLTIP_GAP_PX : trigger.left - TOOLTIP_GAP_PX,
      top: clamp(top, TOOLTIP_EDGE_PX + HALF_LINE_PX, viewport.height - TOOLTIP_EDGE_PX - HALF_LINE_PX),
      placement,
    };
  }
  const wantBelow = placement === 'below' || trigger.top < 40;
  return {
    left: clamp((trigger.left + trigger.right) / 2, TOOLTIP_EDGE_PX + HALF_MIN_WIDTH_PX, viewport.width - TOOLTIP_EDGE_PX - HALF_MIN_WIDTH_PX),
    top: wantBelow ? trigger.bottom + TOOLTIP_GAP_PX : trigger.top - TOOLTIP_GAP_PX,
    placement: wantBelow ? 'below' : 'above',
  };
}

/** The shift (dx, dy) that brings a rendered tooltip fully inside the viewport, EDGE from each side. */
export function nudgeIntoView(tip: Box, viewport: Viewport): { dx: number; dy: number } {
  const axis = (start: number, end: number, size: number) => {
    let shift = 0;
    if (end > size - TOOLTIP_EDGE_PX) shift = size - TOOLTIP_EDGE_PX - end;
    if (start + shift < TOOLTIP_EDGE_PX) shift = TOOLTIP_EDGE_PX - start;
    return shift;
  };
  return { dx: axis(tip.left, tip.right, viewport.width), dy: axis(tip.top, tip.bottom, viewport.height) };
}
