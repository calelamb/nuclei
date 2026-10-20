export const MIN_SHOTS = 100;
export const MAX_SHOTS = 100000;

export interface ShotsCommit {
  /** The shot count to apply, always within [MIN_SHOTS, MAX_SHOTS] (the current value when the draft was rejected). */
  value: number;
  /** Inline hint explaining a correction; null when the draft was used as typed. */
  hint: string | null;
}

/**
 * Resolve what a typed Shots draft means once the person commits it (blur / Enter). Anything that
 * is not a whole number in range keeps the current value and says why: a typo (10242048) must never
 * be silently rewritten to a different count and persisted as the default.
 */
export function commitShotsDraft(draft: string, current: number): ShotsCommit {
  // Committed values are shown grouped ("2,048"), so grouping separators are part of valid input.
  const digits = draft.replace(/[\s,_]/g, '');
  const parsed = /^\d+$/.test(digits) ? Number.parseInt(digits, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return { value: current, hint: `Enter a whole number from ${MIN_SHOTS.toLocaleString('en-US')} to ${MAX_SHOTS.toLocaleString('en-US')}.` };
  }
  const kept = `Kept ${current.toLocaleString('en-US')}.`;
  if (parsed < MIN_SHOTS) return { value: current, hint: `Minimum is ${MIN_SHOTS.toLocaleString('en-US')} shots. ${kept}` };
  if (parsed > MAX_SHOTS) return { value: current, hint: `Maximum is ${MAX_SHOTS.toLocaleString('en-US')} shots. ${kept}` };
  return { value: parsed, hint: null };
}
