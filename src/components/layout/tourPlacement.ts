export const TOUR_CARD_WIDTH = 300;
export const TOUR_EDGE = 8;
const TARGET_GAP = 14;
const SIDEBAR_GAP = 8;
const CARD_MAX_HEIGHT = 260;
/** Beyond this distance from its target the card no longer points at it. */
const ARROW_REACH = 24;

export interface TourRect { top: number; left: number; width: number; height: number }
export interface TourViewport { width: number; height: number }

export interface TourCardPlacement {
  left?: number;
  top?: number;
  bottom?: number;
  /** Whether the card sits close enough to its target for the arrow to make sense. */
  arrow: boolean;
}

/**
 * Where the tour card goes. A target in the activity rail sits to the left of an open sidebar;
 * placing the card at the target's right edge would cover the sidebar the step describes, so
 * the card clears the sidebar instead.
 */
export function placeTourCard(
  target: TourRect,
  placement: 'right' | 'above',
  viewport: TourViewport,
  sidebarRight: number | null,
): TourCardPlacement {
  if (placement === 'above') {
    return {
      left: Math.min(Math.max(TOUR_EDGE, target.left), viewport.width - TOUR_CARD_WIDTH - TOUR_EDGE),
      bottom: viewport.height - target.top + TARGET_GAP,
      arrow: true,
    };
  }
  const beside = target.left + target.width + TARGET_GAP;
  const clearOfSidebar = sidebarRight !== null && sidebarRight > beside ? sidebarRight + SIDEBAR_GAP : beside;
  return {
    left: Math.min(clearOfSidebar, viewport.width - TOUR_CARD_WIDTH - TOUR_EDGE),
    top: Math.max(TOUR_EDGE, Math.min(target.top, viewport.height - CARD_MAX_HEIGHT)),
    arrow: clearOfSidebar - (target.left + target.width) <= ARROW_REACH,
  };
}
