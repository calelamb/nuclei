import { TabFocus } from 'monaco-editor/esm/vs/editor/browser/config/tabFocus.js';
import { useEditorFocusStore } from '../../stores/editorFocusStore';

/**
 * Mirrors Monaco's real Tab-focus flag into the editor focus store so the
 * status-bar hint can never disagree with what Tab actually does. Returns a
 * disposer.
 */
export function syncTabFocusToStore(): () => void {
  const set = useEditorFocusStore.getState().setTabMovesFocus;
  set(TabFocus.getTabFocusMode());
  const subscription = TabFocus.onDidChangeTabFocus(set);
  return () => subscription.dispose();
}
