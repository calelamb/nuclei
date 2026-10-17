import { describe, expect, it } from 'vitest';
import { DARK_COLORS, LIGHT_COLORS } from '../styles/tokens';
import { useThemeStore } from '../stores/themeStore';
import { seriesColor } from './seriesPalette';

describe('seriesColor', () => {
  it.each([
    ['dark', 'dark' as const],
    ['light', 'light' as const],
  ])('never uses the Dirac purple (%s theme), which is reserved for the assistant', (_name, mode) => {
    useThemeStore.getState().setMode(mode);
    const { colors } = useThemeStore.getState();
    const palette = Array.from({ length: 7 }, (_, i) => seriesColor(colors, i));
    expect(palette).not.toContain(colors.dirac);
    expect(palette).not.toContain(colors.diracText);
    expect(new Set(palette).size).toBe(palette.length);
    expect((mode === 'dark' ? DARK_COLORS : LIGHT_COLORS).accentDirac).not.toBe(palette[1]);
  });

  it('is stable and wraps around', () => {
    const { colors } = useThemeStore.getState();
    expect(seriesColor(colors, 0)).toBe(seriesColor(colors, 7));
    expect(seriesColor(colors, -1)).toBe(seriesColor(colors, 6));
  });
});
