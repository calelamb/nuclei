import type * as monaco from 'monaco-editor';
import {
  DARK_COLORS, LIGHT_COLORS,
  type ColorTokens,
} from '../../styles/tokens';

type Monaco = typeof monaco;
type ThemeData = monaco.editor.IStandaloneThemeData;

function stripHash(hex: string): string {
  // Monaco's `rules[].foreground` wants the 6-char form without the leading #.
  return hex.startsWith('#') ? hex.slice(1) : hex;
}

function buildTheme(base: 'vs' | 'vs-dark', c: ColorTokens): ThemeData {
  return {
    base,
    inherit: true,
    rules: [
      { token: 'comment', foreground: stripHash(c.syntaxComment), fontStyle: 'italic' },
      { token: 'keyword', foreground: stripHash(c.syntaxKeyword) },
      { token: 'string', foreground: stripHash(c.syntaxString) },
      { token: 'number', foreground: stripHash(c.syntaxNumber) },
      { token: 'type', foreground: stripHash(c.syntaxType) },
    ],
    colors: {
      'editor.background': c.surfaceBase,
      'editor.foreground': c.textPrimary,
      'editor.lineHighlightBackground': c.surfaceOverlay,
      'editor.selectionBackground': base === 'vs-dark' ? '#264F78' : '#B4D7FF',
      'editorCursor.foreground': c.accentQuantum,
      'editorLineNumber.foreground': c.wire,
      'editorLineNumber.activeForeground': c.accentQuantum,
    },
  };
}

export function buildNucleiDarkTheme(): ThemeData {
  return buildTheme('vs-dark', DARK_COLORS);
}

export function buildNucleiLightTheme(): ThemeData {
  return buildTheme('vs', LIGHT_COLORS);
}

export function registerNucleiThemes(monacoInstance: Monaco): void {
  monacoInstance.editor.defineTheme('nuclei-dark', buildNucleiDarkTheme());
  monacoInstance.editor.defineTheme('nuclei-light', buildNucleiLightTheme());
}
