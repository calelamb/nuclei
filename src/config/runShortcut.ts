/**
 * Where the chord must not run the circuit from the window-level handler: inside Monaco (it binds the
 * same chord itself, so App running it too would run twice), in any modal dialog (the key belongs to
 * the dialog), and in Dirac's panel (Enter and its modifiers send the message).
 */
const RUN_OWNED_ELSEWHERE = '.monaco-editor, [role="dialog"], [aria-modal="true"], [data-dirac-panel]';

export function runShortcutOwnedElsewhere(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(RUN_OWNED_ELSEWHERE) !== null;
}

/**
 * A lesson or challenge takes the main area over and hides the editor; Run is editor-only there (the
 * command palette drops it too), so the chord must not run a buffer the person cannot see.
 */
export function runShortcutHiddenEditor(takeover: 'lesson' | 'challenge' | 'qec' | 'transpiler' | 'experiment' | null): boolean {
  return takeover === 'lesson' || takeover === 'challenge';
}
