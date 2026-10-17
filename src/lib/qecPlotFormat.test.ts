import { describe, it, expect } from 'vitest';
import { toSuperscript, formatPow10, formatSci, formatMultiplierTick } from './qecPlotFormat';

describe('toSuperscript', () => {
  it('maps digits and a true minus sign', () => {
    expect(toSuperscript(-3)).toBe('⁻³');
    expect(toSuperscript(12)).toBe('¹²');
    expect(toSuperscript(0)).toBe('⁰');
    expect(toSuperscript(-10)).toBe('⁻¹⁰');
  });
});

describe('formatPow10', () => {
  it('writes powers of ten with superscripts', () => {
    expect(formatPow10(-3)).toBe('10⁻³');
    expect(formatPow10(0)).toBe('10⁰');
    expect(formatPow10(2)).toBe('10²');
  });
  it('writes a multiplier tick when the mantissa is not 1', () => {
    expect(formatMultiplierTick(2, -3)).toBe('2×10⁻³');
    expect(formatMultiplierTick(1, -3)).toBe('10⁻³');
  });
});

describe('formatSci', () => {
  it('uses plain decimals for ordinary magnitudes', () => {
    expect(formatSci(0.25)).toBe('0.25');
    expect(formatSci(0.0123)).toBe('0.0123');
  });
  it('uses ×10 notation for small values, trimming a trailing .0', () => {
    expect(formatSci(0.0032)).toBe('3.2×10⁻³');
    expect(formatSci(0.0001)).toBe('1×10⁻⁴');
    expect(formatSci(1.234e-7)).toBe('1.2×10⁻⁷');
  });
  it('handles zero and non-finite values without NaN text', () => {
    expect(formatSci(0)).toBe('0');
    expect(formatSci(Number.NaN)).toBe('—');
    expect(formatSci(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
