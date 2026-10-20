import { stackedPlotHeight, WIDE_MIN_WIDTH } from './qecPlotLayout';

/** Below this analysis height the plot, Λ and decoder table cannot share the area without cramping each other. */
export const SHORT_ANALYSIS_HEIGHT = 600;

/**
 * Short windows, and any width too narrow for the plot to sit beside the Λ
 * readout (the plot falls back to its stacked layout), get one section at a
 * time instead of a nested scroll. An unmeasured (0) size keeps everything visible.
 */
export function isShortAnalysis(height: number, width = 0): boolean {
  const short = height > 0 && height < SHORT_ANALYSIS_HEIGHT;
  const narrow = width > 0 && width < WIDE_MIN_WIDTH;
  return short || narrow;
}

/** Height the panel header and padding take from the card before the plot starts. */
const PANEL_CHROME = 48;
/** The Λ readout needs about this much room under the plot to be worth showing there. */
export const LAMBDA_BELOW_MIN_SPACE = 260;

/**
 * In a narrow card (plot stacked, not beside the readout) that is tall enough to
 * leave the Λ readout room under the plot, show it there rather than behind a tab.
 */
export function canStackLambda(height: number, width: number): boolean {
  if (height <= 0 || width <= 0 || width >= WIDE_MIN_WIDTH) return false;
  return height - stackedPlotHeight(width) - PANEL_CHROME >= LAMBDA_BELOW_MIN_SPACE;
}
