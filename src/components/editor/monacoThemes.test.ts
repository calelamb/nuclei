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

  it('Dirac inline suggestions render in a distinct ghost-text color', () => {
    // Ghost text must be its own color (not the default grey) so an AI
    // suggestion never reads as ordinary IntelliSense. Both themes set it.
    const dark = buildNucleiDarkTheme();
    const light = buildNucleiLightTheme();
    expect(dark.colors['editorGhostText.foreground']).toBeTruthy();
    expect(light.colors['editorGhostText.foreground']).toBeTruthy();
    expect(dark.colors['editorGhostText.foreground']).not.toBe(dark.colors['editor.foreground']);
  });

  it('selection is tinted toward the quantum accent, not generic blue', () => {
    const t = buildNucleiDarkTheme();
    expect(t.colors['editor.selectionBackground']?.toUpperCase()).toContain('00B4D8');
  });
});
