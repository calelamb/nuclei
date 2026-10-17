import { describe, it, expect } from 'vitest';
import { blochCardWidthCss, blochRailSizes } from './blochRail';

describe('blochRail sizing', () => {
  it('clamps each card between a readable minimum and a comfortable maximum', () => {
    expect(blochCardWidthCss(2)).toBe('clamp(150px, (100cqw - 20px - 6px) / 2, 260px)');
  });

  it('accounts for gaps between cards', () => {
    expect(blochCardWidthCss(6)).toContain('30px');
  });

  it('keeps the card square: height is the card width plus vertical padding', () => {
    const { height } = blochRailSizes(3);
    expect(height).toBe(`calc(${blochCardWidthCss(3)} + 22px)`);
  });

  it('treats zero or negative counts as one', () => {
    expect(blochRailSizes(0)).toEqual(blochRailSizes(1));
  });
});
