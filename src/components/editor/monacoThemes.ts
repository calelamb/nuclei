import type * as monaco from 'monaco-editor';

type Monaco = typeof monaco;

/**
 * Monaco theme definitions for Nuclei. Extracted from QuantumEditor so
 * `beforeMount` and the theme-toggle effect share a single source of
 * truth — previously each site had its own copy and they could drift.
 */

const nucleiDark: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6A737D', fontStyle: 'italic' },
    { token: 'keyword', foreground: '00B4D8' },
    { token: 'string', foreground: '98C379' },
    { token: 'number', foreground: 'D19A66' },
    { token: 'type', foreground: '48CAE4' },
  ],
  colors: {
    'editor.background': '#0F1B2D',
    'editor.foreground': '#E0E0E0',
    'editor.lineHighlightBackground': '#1A2A42',
    'editor.selectionBackground': '#264F78',
    'editorCursor.foreground': '#00B4D8',
    'editorLineNumber.foreground': '#3D5A80',
    'editorLineNumber.activeForeground': '#00B4D8',
  },
};

const nucleiLight: monaco.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6A737D', fontStyle: 'italic' },
    { token: 'keyword', foreground: '0096B7' },
    { token: 'string', foreground: '22863A' },
    { token: 'number', foreground: 'B76E00' },
    { token: 'type', foreground: '005F73' },
  ],
  colors: {
    'editor.background': '#FAFBFC',
    'editor.foreground': '#1A1A2E',
    'editor.lineHighlightBackground': '#F0F2F5',
    'editor.selectionBackground': '#B4D7FF',
    'editorCursor.foreground': '#0096B7',
    'editorLineNumber.foreground': '#959DA5',
    'editorLineNumber.activeForeground': '#0096B7',
  },
};

export function registerNucleiThemes(monacoInstance: Monaco): void {
  monacoInstance.editor.defineTheme('nuclei-dark', nucleiDark);
  monacoInstance.editor.defineTheme('nuclei-light', nucleiLight);
}
