import { describe, expect, it } from 'vitest';
import { DARK_COLORS, LIGHT_COLORS, type ColorTokens } from '../../styles/tokens';
import { MODE_CHIP_TINT_ALPHA, modeChipTint } from './modeChipTint';

const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (v: number): number => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (c: number[]): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: number[], b: number[]): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg: string, bg: string): number[] => {
  const f = rgb(fg);
  const b = rgb(bg);
  return f.map((v, i) => v * MODE_CHIP_TINT_ALPHA + b[i] * (1 - MODE_CHIP_TINT_ALPHA));
};

describe('modeChipTint', () => {
  it('appends an 8-bit alpha', () => {
    expect(modeChipTint('#0891b2')).toBe('#0891b205');
  });

  describe.each([['dark', DARK_COLORS], ['light', LIGHT_COLORS]] as const)('%s', (_n, c) => {
    const surfaces: (keyof ColorTokens)[] = ['surfaceBase', 'surfaceRaised', 'surfaceOverlay', 'surfaceSunken'];
    for (const [label, text, fill] of [
      ['LEARN', 'accentQuantumText', 'accentQuantum'],
      ['RESEARCH', 'modeResearch', 'modeResearch'],
    ] as const) {
      for (const s of surfaces) {
        it(`${label} label is AA on the tinted chip over ${s}`, () => {
          const bg = over(c[fill as keyof ColorTokens] as string, c[s] as string);
          expect(ratio(rgb(c[text as keyof ColorTokens] as string), bg)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  });
});
