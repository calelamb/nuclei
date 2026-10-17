/** Below this analysis height the plot, Λ and decoder table cannot share the area without cramping each other. */
export const SHORT_ANALYSIS_HEIGHT = 600;

/** Short windows get one section at a time; an unmeasured (0) height keeps everything visible. */
export function isShortAnalysis(height: number): boolean {
  return height > 0 && height < SHORT_ANALYSIS_HEIGHT;
}
