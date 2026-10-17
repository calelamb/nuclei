import { TabFocus } from 'monaco-editor/esm/vs/editor/browser/config/tabFocus.js';

/**
 * Monaco keeps "Tab moves focus" in one module-level flag shared by every
 * editor (the public API only exposes a toggle). Lesson editors need to set it
 * explicitly, so this wraps the flag with the setter it really has.
 */
interface TabFocusFlag {
  getTabFocusMode(): boolean;
  setTabFocusMode(next: boolean): void;
  onDidChangeTabFocus(listener: (next: boolean) => void): { dispose(): void };
}

const flag = TabFocus as unknown as TabFocusFlag;

export const lessonTabFocus = {
  get: (): boolean => flag.getTabFocusMode(),
  set: (next: boolean): void => flag.setTabFocusMode(next),
  subscribe: (listener: (next: boolean) => void): { dispose(): void } => flag.onDidChangeTabFocus(listener),
};
