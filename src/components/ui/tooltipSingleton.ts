/** Adjacent triggers: a tooltip that opens this soon after another closed skips its open delay. */
export const TOOLTIP_WARMUP_MS = 300;

let activeClose: (() => void) | null = null;
let lastClosedAt = Number.NEGATIVE_INFINITY;

/** Register `close` as the one visible tooltip; whichever was open before is closed now. */
export function claimTooltip(close: () => void): void {
  if (activeClose && activeClose !== close) activeClose();
  activeClose = close;
}

/** Called when a tooltip closes. */
export function releaseTooltip(close: () => void): void {
  if (activeClose === close) activeClose = null;
  lastClosedAt = Date.now();
}

/** True while another tooltip is open or one closed a moment ago (moving along a row of icons). */
export function tooltipIsWarm(): boolean {
  return activeClose !== null || Date.now() - lastClosedAt < TOOLTIP_WARMUP_MS;
}

/** Test seam: forget every open tooltip and the warm-up window. */
export function resetTooltipSingleton(): void {
  activeClose = null;
  lastClosedAt = Number.NEGATIVE_INFINITY;
}
