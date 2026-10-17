// Monaco keeps the "Tab moves focus" flag in a module-level singleton that the
// public API does not expose; this is the minimal shape we read from it.
declare module 'monaco-editor/esm/vs/editor/browser/config/tabFocus.js' {
  export const TabFocus: {
    getTabFocusMode(): boolean;
    onDidChangeTabFocus(listener: (tabFocusMode: boolean) => void): { dispose(): void };
  };
}
