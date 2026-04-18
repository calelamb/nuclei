// src/components/editor/monacoThemes.test.ts
import { describe, it, expect } from 'vitest';
import { buildNucleiDarkTheme, buildNucleiLightTheme } from './monacoThemes';
import { DARK_COLORS, LIGHT_COLORS } from '../../styles/tokens';

describe('monacoThemes', () => {
  it('dark theme surfaces are sourced from tokens', () => {
    const t = buildNucleiDarkTheme();
    expect(t.colors['editor.background']).toBe(DARK_COLORS.surfaceBase);
    expect(t.colors['editorCursor.foreground']).toBe(DARK_COLORS.accentQuantum);
    expect(t.colors['editorLineNumber.activeForeground']).toBe(DARK_COLORS.accentQuantum);
  });

  it('light theme surfaces are sourced from tokens', () => {
    const t = buildNucleiLightTheme();
    expect(t.colors['editor.background']).toBe(LIGHT_COLORS.surfaceBase);
    expect(t.colors['editorCursor.foreground']).toBe(LIGHT_COLORS.accentQuantum);
  });

  it('dark theme includes the required syntax tokens', () => {
    const t = buildNucleiDarkTheme();
    const tokens = t.rules.map((r) => r.token);
    expect(tokens).toEqual(expect.arrayContaining(['comment', 'keyword', 'string', 'number', 'type']));
  });
});
