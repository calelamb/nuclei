export const LESSON_EDITOR_LINE_HEIGHT = 19;
export const LESSON_EDITOR_MIN_HEIGHT = 96;
export const LESSON_EDITOR_MAX_HEIGHT = 420;
const VERTICAL_PADDING = 16;

/** Pixel height for a lesson mini-editor that shows `lineCount` lines without an inner scrollbar, up to a cap. */
export function lessonEditorHeight(lineCount: number): number {
  const lines = Math.max(1, Math.floor(lineCount));
  const wanted = lines * LESSON_EDITOR_LINE_HEIGHT + VERTICAL_PADDING;
  return Math.min(LESSON_EDITOR_MAX_HEIGHT, Math.max(LESSON_EDITOR_MIN_HEIGHT, wanted));
}

export function countLines(code: string): number {
  return code.length === 0 ? 1 : code.split('\n').length;
}
