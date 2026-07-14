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
      // Selection tinted toward the quantum accent instead of generic VS blue,
      // so the editor reads as part of Nuclei's palette (8-digit hex = alpha,
      // kept translucent so highlighted text stays legible).
      'editor.selectionBackground': base === 'vs-dark' ? '#00B4D83B' : '#00B4D82E',
      'editor.selectionHighlightBackground': base === 'vs-dark' ? '#00B4D81F' : '#00B4D817',
      'editorCursor.foreground': c.accentQuantum,
      'editorLineNumber.foreground': c.wire,
      'editorLineNumber.activeForeground': c.accentQuantum,
      // Dirac's inline suggestions render in Dirac violet (dimmed, since ghost
      // text is a proposal) — visually distinct from grey IntelliSense so it's
      // always clear which hand is writing. See registerGhostCompletions.
      'editorGhostText.foreground': base === 'vs-dark' ? '#A578D6' : '#8B3FB8',
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
