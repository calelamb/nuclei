import { describe, it, expect } from 'vitest';
import { TabFocus } from 'monaco-editor/esm/vs/editor/browser/config/tabFocus.js';
import { syncTabFocusToStore } from './tabFocusSync';
import { useEditorFocusStore } from '../../stores/editorFocusStore';

describe('syncTabFocusToStore', () => {
  it('mirrors Monaco tab-focus changes into the store and stops on dispose', () => {
    const stop = syncTabFocusToStore();
    expect(useEditorFocusStore.getState().tabMovesFocus).toBe(false);
    (TabFocus as unknown as { setTabFocusMode(v: boolean): void }).setTabFocusMode(true);
    expect(useEditorFocusStore.getState().tabMovesFocus).toBe(true);
    stop();
    (TabFocus as unknown as { setTabFocusMode(v: boolean): void }).setTabFocusMode(false);
    expect(useEditorFocusStore.getState().tabMovesFocus).toBe(true);
    useEditorFocusStore.getState().setTabMovesFocus(false);
  });
});
