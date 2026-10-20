/** Status bar height in px (kept in step with StatusBar). */
const STATUS_BAR_HEIGHT = 24;
/** Width of Dirac's collapsed rail tab. */
const DIRAC_RAIL_WIDTH = 28;
const CLEARANCE = 12;

/**
 * Where the update toast sits so it clears the status bar and the Dirac panel
 * (the open panel's composer occupies the bottom-right; the toast sits beside
 * it, not over it).
 */
export function updateBannerOffsets(diracOpen: boolean, diracWidth: number): { right: number; bottom: number } {
  return {
    right: (diracOpen ? diracWidth : DIRAC_RAIL_WIDTH) + CLEARANCE,
    bottom: STATUS_BAR_HEIGHT + CLEARANCE,
  };
}
