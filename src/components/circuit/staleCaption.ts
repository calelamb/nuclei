export const PREVIEW_PAUSED_CAPTION = 'Preview paused: this code runs longer than 5 s. Press Run to execute';

export interface StalePill { label: string; tooltip: string; line: number | null }

/** What the pill over a dimmed (last-good) diagram says, or null when nothing explains the staleness yet. */
export function describeStale(input: { previewPaused: boolean; error: string | null; errorLine: number | null }): StalePill | null {
  if (input.previewPaused) {
    return { label: 'Preview paused', tooltip: PREVIEW_PAUSED_CAPTION, line: null };
  }
  if (input.errorLine !== null) {
    return {
      label: `Out of date · line ${input.errorLine}`,
      tooltip: `The diagram shows the last code that parsed. Line ${input.errorLine} has an error. Select to jump there.`,
      line: input.errorLine,
    };
  }
  if (input.error !== null) {
    return { label: 'Out of date · code has an error', tooltip: 'The diagram shows the last code that parsed.', line: null };
  }
  return null;
}
