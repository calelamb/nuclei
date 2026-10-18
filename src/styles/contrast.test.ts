import { describe, expect, it } from 'vitest';
import { DARK_COLORS, LIGHT_COLORS, type ColorTokens } from './tokens';

function channel(hex: string, i: number): number {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function lum(hex: string): number {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Hex of `fill` at `alpha` composited over `surface` (the badge background). */
function wash(fill: string, surface: string, alpha: number): string {
  const mix = (i: number) => {
    const f = parseInt(fill.slice(1 + i * 2, 3 + i * 2), 16);
    const s = parseInt(surface.slice(1 + i * 2, 3 + i * 2), 16);
    return Math.round(f * alpha + s * (1 - alpha)).toString(16).padStart(2, '0');
  };
  return `#${mix(0)}${mix(1)}${mix(2)}`;
}

const SURFACES: (keyof ColorTokens)[] = ['surfaceBase', 'surfaceRaised', 'surfaceOverlay', 'surfaceSunken'];
const BODY_TEXT: (keyof ColorTokens)[] = ['textPrimary', 'textSecondary', 'textTertiary', 'accentQuantumText', 'accentDiracText', 'modeResearch', 'warning', 'warningText', 'dangerText', 'successText', 'syntaxKeyword'];

describe.each([['dark', DARK_COLORS], ['light', LIGHT_COLORS]] as const)('%s palette contrast', (_n, c) => {
  for (const text of BODY_TEXT) {
    for (const surface of SURFACES) {
      it(`${text} on ${surface} meets WCAG AA 4.5:1`, () => {
        expect(ratio(c[text], c[surface])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  for (const surface of SURFACES) {
    it(`borderControl on ${surface} meets the 3:1 non-text boundary (WCAG 1.4.11)`, () => {
      expect(ratio(c.borderControl, c[surface])).toBeGreaterThanOrEqual(3);
    });
  }
  it.each([['successText', 'success'], ['warningText', 'warning'], ['dangerText', 'danger']] as const)(
    '%s on its own 12%% badge wash keeps AA at 11px (the badge background)',
    (textKey, fillKey) => {
      for (const surface of SURFACES) {
        expect(ratio(c[textKey], wash(c[fillKey], c[surface], 0.12)), `${textKey} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
  it('keeps the text hierarchy ordered (primary > secondary > tertiary > disabled)', () => {
    const r = (k: keyof ColorTokens) => ratio(c[k], c.surfaceBase);
    expect(r('textPrimary')).toBeGreaterThan(r('textSecondary'));
    expect(r('textSecondary')).toBeGreaterThan(r('textTertiary'));
    expect(r('textTertiary')).toBeGreaterThan(r('textDisabled'));
  });
  it('onAccent text on the accent fill meets AA 4.5:1 for small button text', () => {
    expect(ratio(c.onAccent, c.accentQuantum)).toBeGreaterThanOrEqual(4.5);
  });
  it('white text on the Dirac fill meets AA', () => {
    expect(ratio('#FFFFFF', c.accentDirac)).toBeGreaterThanOrEqual(4.5);
  });
  it('data hues for QEC bases are distinct from the Dirac purple', () => {
    expect(new Set([c.basisX, c.basisZ, c.accentDiracText]).size).toBe(3);
  });
});
