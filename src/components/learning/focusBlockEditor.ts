/**
 * Moves keyboard focus into a demo/exercise block's editor (falling back to its Run button).
 * Called by Reset before the Reset button disables itself, so focus never drops to <body>.
 */
export function focusBlockEditor(block: HTMLElement | null): void {
  const target = block?.querySelector<HTMLElement>('.demo__editor textarea')
    ?? block?.querySelector<HTMLElement>('.demo__actions button');
  target?.focus({ preventScroll: true });
}
