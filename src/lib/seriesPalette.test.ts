import { describe, expect, it } from 'vitest';
import { seriesColor } from './seriesPalette';
import { DARK_COLORS } from '../styles/tokens';

const colors = {
  bg: '', bgPanel: '', bgEditor: '', bgElevated: '', border: '', borderStrong: '',
  text: '', textMuted: '', textDim: '', accent: DARK_COLORS.accentQuantum,
  accentLight: DARK_COLORS.accentQuantumSoft, dirac: DARK_COLORS.accentDirac,
  success: DARK_COLORS.success, warning: DARK_COLORS.warning, error: DARK_COLORS.danger,
  info: DARK_COLORS.info, comment: '', string: '', number: '',
  gateSingle: '', gateMulti: '', gateMeasure: '', wire: '',
};

describe('seriesColor', () => {
  it('cycles through the palette by index', () => {
    const c0 = seriesColor(colors, 0);
    const c1 = seriesColor(colors, 1);
    expect(c0).not.toBe(c1);
    expect(seriesColor(colors, 0)).toBe(c0);
  });

  it('wraps around for an index beyond the palette length', () => {
    expect(seriesColor(colors, 7)).toBe(seriesColor(colors, 0));
  });

  it('handles a negative index without throwing', () => {
    expect(() => seriesColor(colors, -1)).not.toThrow();
  });
});
