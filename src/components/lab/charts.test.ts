import { describe, expect, it } from 'vitest';
import { catColor, formatDuration, formatInterval, formatPct, formatSci, formatTick, interpolateRamp, paddedDomain, seqColor } from './chartUtils';

describe('formatSci', () => {
  it('uses fixed notation in the readable band', () => {
    expect(formatSci(0.0123)).toBe('0.0123');
    expect(formatSci(3.14159)).toBe('3.14');
    expect(formatSci(12345)).toBe('12,300');
    expect(formatSci(-0.5)).toBe('−0.5');
  });
  it('uses ×10ⁿ outside it, with unicode superscripts and minus signs', () => {
    expect(formatSci(3.1e-4)).toBe('3.1×10⁻⁴');
    expect(formatSci(1e-6)).toBe('10⁻⁶');
    expect(formatSci(-2.5e7)).toBe('−2.5×10⁷');
  });
  it('carries mantissa rounding into the next decade', () => {
    expect(formatSci(9.9996e-5, 3)).toBe('10⁻⁴');
  });
  it('handles non-finite and missing values honestly', () => {
    expect(formatSci(null)).toBe('—');
    expect(formatSci(Number.NaN)).toBe('—');
    expect(formatSci(Number.POSITIVE_INFINITY)).toBe('∞');
    expect(formatSci(0)).toBe('0');
  });
});

describe('tick + misc formatting', () => {
  it('labels only decades on log axes', () => {
    expect(formatTick(1e-3, true)).toBe('10⁻³');
    expect(formatTick(3e-3, true)).toBe('');
    expect(formatTick(0, true)).toBe('');
  });
  it('formats percentages, intervals and durations', () => {
    expect(formatPct(0.1234)).toBe('12.3%');
    expect(formatInterval([1e-4, 2e-4])).toBe('[10⁻⁴, 2×10⁻⁴]');
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(4200)).toBe('4.2 s');
    expect(formatDuration(125_000)).toBe('2m 05s');
    expect(formatDuration(3_725_000)).toBe('1h 02m');
  });
});

describe('color roles', () => {
  it('maps magnitude to discrete sequential steps and clamps', () => {
    expect(seqColor(0)).toBe('var(--lab-seq-0)');
    expect(seqColor(1)).toBe('var(--lab-seq-8)');
    expect(seqColor(2)).toBe('var(--lab-seq-8)');
    expect(seqColor(Number.NaN)).toBe('var(--lab-seq-0)');
  });
  it('assigns categorical slots in fixed order and folds past eight', () => {
    expect(catColor(0)).toBe('var(--lab-cat-1)');
    expect(catColor(7)).toBe('var(--lab-cat-8)');
    expect(catColor(8)).toBe('var(--color-text-tertiary)');
  });
  it('interpolates ramps for canvas rendering', () => {
    expect(interpolateRamp(['#000000', '#ffffff'], 0.5)).toEqual([128, 128, 128]);
    expect(interpolateRamp(['#000000', '#ff0000', '#ffffff'], 1)).toEqual([255, 255, 255]);
  });
});

describe('paddedDomain', () => {
  it('pads linear extents and widens degenerate ones', () => {
    const [lo, hi] = paddedDomain([0, 10]);
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(10);
    expect(paddedDomain([5, 5])[0]).toBeLessThan(5);
  });
  it('snaps log extents to decades and ignores non-positive values', () => {
    expect(paddedDomain([2e-4, 3e-2, 0, -1], { log: true })).toEqual([1e-4, 0.1]);
  });
});
