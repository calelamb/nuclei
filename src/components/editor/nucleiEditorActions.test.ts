import { beforeEach, describe, expect, it } from 'vitest';
import type * as monaco from 'monaco-editor';
import { cycleLevelInLearn, registerNucleiEditorActions } from './nucleiEditorActions';
import { useHelpOverlayStore } from '../../stores/helpOverlayStore';
import { useUIModeStore } from '../../stores/uiModeStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

const KeyMod = { CtrlCmd: 2048, Shift: 1024 };
const KeyCode = { KeyL: 42, KeyP: 46 };

function register() {
  const actions: monaco.editor.IActionDescriptor[] = [];
  const editor = { addAction: (a: monaco.editor.IActionDescriptor) => { actions.push(a); } } as unknown as monaco.editor.IStandaloneCodeEditor;
  registerNucleiEditorActions(editor, { KeyMod, KeyCode } as unknown as typeof monaco);
  return actions;
}

beforeEach(() => {
  useWorkspaceStore.setState({ mode: 'learn' });
  useUIModeStore.setState({ mode: 'beginner' });
  useHelpOverlayStore.setState({ paletteOpen: false });
});

describe('editor-owned app chords', () => {
  it('registers Change level on Cmd+Shift+L inside Monaco so it beats "select all occurrences"', () => {
    const action = register().find((a) => a.id === 'nuclei.cycleLevel');
    expect(action?.keybindings).toEqual([KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyL]);
    action?.run({} as monaco.editor.ICodeEditor);
    expect(useUIModeStore.getState().mode).toBe('intermediate');
  });

  it('cycling the level is a no-op in Research', () => {
    useWorkspaceStore.setState({ mode: 'research' });
    cycleLevelInLearn();
    expect(useUIModeStore.getState().mode).toBe('beginner');
  });

  it('routes Cmd+Shift+P to the app palette, not Monaco\'s', () => {
    const action = register().find((a) => a.id === 'nuclei.commandPalette');
    expect(action?.keybindings).toEqual([KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP]);
    action?.run({} as monaco.editor.ICodeEditor);
    expect(useHelpOverlayStore.getState().paletteOpen).toBe(true);
  });

  it('uses sentence-case labels', () => {
    for (const a of register()) expect(a.label).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
  });
});
