/**
 * Moves keyboard focus into a demo/exercise block's editor (falling back to its Run button).
 * Called by Reset before the Reset button disables itself, so focus never drops to <body>.
 */
/** Moves focus to the block's Run button (used just before a Retry notice unmounts itself). */
export function focusBlockRun(block: HTMLElement | null): void {
  block?.querySelector<HTMLElement>('[data-lesson-run]')?.focus({ preventScroll: true });
}

export function focusBlockEditor(block: HTMLElement | null): void {
  const target = block?.querySelector<HTMLElement>('.demo__editor textarea')
    ?? block?.querySelector<HTMLElement>('.demo__actions button');
  target?.focus({ preventScroll: true });
}
