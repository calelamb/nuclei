import { describe, expect, it } from 'vitest';
import { blochPalette } from './blochPalette';

function luminance(hex: string): number {
  const c = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(0) + 0.7152 * c(1) + 0.0722 * c(2);
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('blochPalette', () => {
  it('returns a distinct palette per theme', () => {
    expect(blochPalette('dark')).not.toEqual(blochPalette('light'));
  });

  it('keeps the labels and state arrow legible on the light tile background (>= 3:1)', () => {
    const p = blochPalette('light');
    const tile = '#F8FAFC';
    for (const key of ['label', 'state', 'axisX', 'axisY', 'axisZ'] as const) {
      expect(ratio(p[key], tile), key).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the labels and axes legible on the dark tile background (>= 3:1)', () => {
    const p = blochPalette('dark');
    const tile = '#141B29';
    for (const key of ['label', 'state', 'axisX', 'axisY', 'axisZ'] as const) {
      expect(ratio(p[key], tile), key).toBeGreaterThanOrEqual(3);
    }
  });

  it('does not use a dark shell colour in light mode', () => {
    expect(luminance(blochPalette('light').shell)).toBeGreaterThan(0.5);
  });
});
