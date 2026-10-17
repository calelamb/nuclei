import { create } from 'zustand';

interface EditorFocusState {
  /** The code editor currently has keyboard focus. */
  focused: boolean;
  /** Tab moves focus out of the editor instead of indenting (Monaco's tab-focus mode). */
  tabMovesFocus: boolean;
  setFocused: (focused: boolean) => void;
  setTabMovesFocus: (on: boolean) => void;
}

export const useEditorFocusStore = create<EditorFocusState>((set) => ({
  focused: false,
  tabMovesFocus: false,
  setFocused: (focused) => set({ focused }),
  setTabMovesFocus: (tabMovesFocus) => set({ tabMovesFocus }),
}));
