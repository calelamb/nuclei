/**
 * Where the learner stopped reading each lesson, so reopening it (after a rail or mode round trip, or a
 * reload) lands on that block instead of the top. Session-scoped: it is a place-keeper, not progress.
 */
const STORAGE_KEY = 'nuclei-lesson-position';

function readAll(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => typeof v === 'number' && Number.isInteger(v) && v >= 0),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

/** Remember the block the learner is reading; block 0 forgets the place (the top is the default). */
export function rememberLessonBlock(lessonId: string, blockIndex: number): void {
  const rest = Object.fromEntries(Object.entries(readAll()).filter(([id]) => id !== lessonId));
  const next = blockIndex > 0 ? { ...rest, [lessonId]: blockIndex } : rest;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the place is simply not kept */
  }
}

/** The remembered block for a lesson, or null when none (start at the top). */
export function recallLessonBlock(lessonId: string, blockCount: number): number | null {
  const value = readAll()[lessonId];
  return value !== undefined && value > 0 && value < blockCount ? value : null;
}
