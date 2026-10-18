import type * as monaco from 'monaco-editor';
import { useHelpOverlayStore } from '../../stores/helpOverlayStore';
import { useUIModeStore } from '../../stores/uiModeStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

type Editor = monaco.editor.IStandaloneCodeEditor;
type Monaco = typeof monaco;

const LEARN_CONTEXT_KEY = 'nuclei.learnWorkspace';

/** Cycle the Learn level. Research ignores the level entirely, so there it is a no-op (as at app level). */
export function cycleLevelInLearn(): void {
  if (useWorkspaceStore.getState().mode !== 'learn') return;
  useUIModeStore.getState().cycleMode();
}

/**
 * App-level chords that Monaco would otherwise pre-empt while the editor has focus. Registering them inside
 * the editor makes them work where the user's focus actually is; the window-level handler covers everywhere else.
 * Labels are sentence case, like the rest of the app.
 */
export function registerNucleiEditorActions(editor: Editor, monacoApi: Monaco): void {
  const { KeyMod, KeyCode } = monacoApi;
  // Change level only exists in Learn. Gating on a context key lets Cmd+Shift+L fall through to Monaco's
  // "select all occurrences" in Research instead of becoming a dead key.
  const learnKey = editor.createContextKey(LEARN_CONTEXT_KEY, useWorkspaceStore.getState().mode === 'learn');
  const unsubscribe = useWorkspaceStore.subscribe((state) => learnKey.set(state.mode === 'learn'));
  editor.onDidDispose(unsubscribe);
  editor.addAction({
    id: 'nuclei.cycleLevel',
    label: 'Change level',
    precondition: LEARN_CONTEXT_KEY,
    // Monaco's own ⌘⇧L ("select all occurrences") would add cursors instead of cycling the level.
    keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyL],
    run: cycleLevelInLearn,
  });
  editor.addAction({
    id: 'nuclei.commandPalette',
    label: 'Command palette',
    // Monaco binds ⌘⇧P to its own palette; Nuclei has one palette and it lives in the app.
    keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP],
    run: () => useHelpOverlayStore.getState().togglePalette(),
  });
}
