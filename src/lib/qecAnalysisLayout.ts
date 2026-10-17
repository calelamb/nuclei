import { WIDE_MIN_WIDTH } from './qecPlotLayout';

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
