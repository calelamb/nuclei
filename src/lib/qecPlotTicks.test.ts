import { describe, it, expect } from 'vitest';
import { logAxis, makeLogScale } from './qecPlotTicks';

describe('logAxis', () => {
  it('returns null when nothing is positive and finite', () => {
    expect(logAxis([])).toBeNull();
    expect(logAxis([0, -1, Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
  });

  it('labels decades inside the data range as superscripted powers of ten', () => {
    const axis = logAxis([0.001, 0.016])!;
    expect(axis.labeled.filter((t) => t.major).map((t) => t.label)).toEqual(['10⁻³', '10⁻²']);
    expect(axis.lo).toBeLessThan(Math.log10(0.001));
    expect(axis.hi).toBeGreaterThan(Math.log10(0.016));
  });

  it('ignores non-positive values rather than producing -Infinity bounds', () => {
    const axis = logAxis([0, 0.001, 0.01])!;
    expect(Number.isFinite(axis.lo)).toBe(true);
    expect(Number.isFinite(axis.hi)).toBe(true);
  });

  it('fits a narrow sweep tightly instead of forcing a whole decade (qec-14)', () => {
    const axis = logAxis([0.0005, 0.0014])!;
    const span = axis.hi - axis.lo;
    expect(span).toBeLessThan(0.6);
    expect(axis.lo).toBeLessThan(Math.log10(0.0005));
    expect(axis.hi).toBeGreaterThan(Math.log10(0.0014));
  });

  it('keeps a floor on the span for a single value and labels every 2-9 multiple under a decade', () => {
    const axis = logAxis([0.008, 0.0125])!;
    expect(axis.hi - axis.lo).toBeGreaterThanOrEqual(0.3);
    const labels = axis.labeled.map((t) => t.label);
    expect(labels).toEqual(expect.arrayContaining(['8×10⁻³', '9×10⁻³', '10⁻²']));
  });

  it('labels 2 and 5 multiples for a two-decade view so intermediate points can be read', () => {
    const labels = logAxis([0.001, 0.016])!.labeled.map((t) => t.label);
    expect(labels).toEqual(expect.arrayContaining(['10⁻³', '2×10⁻³', '5×10⁻³', '10⁻²']));
  });

  it('adds unlabeled minor ticks 2..9 inside the range', () => {
    const axis = logAxis([0.001, 0.1])!;
    expect(axis.minors.length).toBeGreaterThan(8);
    for (const v of axis.minors) {
      const e = Math.log10(v);
      expect(e).toBeGreaterThanOrEqual(axis.lo - 1e-9);
      expect(e).toBeLessThanOrEqual(axis.hi + 1e-9);
      expect(axis.labeled.some((t) => t.value === v && t.major)).toBe(false);
    }
  });

  it('thins decade labels on very wide ranges', () => {
    const axis = logAxis([1e-14, 1])!;
    expect(axis.labeled.filter((t) => t.major).length).toBeLessThanOrEqual(8);
  });
});

describe('makeLogScale', () => {
  it('maps the domain ends to the range ends and clamps non-positive input to the start', () => {
    const s = makeLogScale({ lo: -3, hi: -1 }, 0, 200);
    expect(s(1e-3)).toBeCloseTo(0);
    expect(s(1e-1)).toBeCloseTo(200);
    expect(s(1e-2)).toBeCloseTo(100);
    expect(Number.isFinite(s(0))).toBe(true);
    expect(s(0)).toBe(0);
  });
  it('supports inverted ranges for the y axis', () => {
    const s = makeLogScale({ lo: -4, hi: 0 }, 300, 0);
    expect(s(1)).toBeCloseTo(0);
    expect(s(1e-4)).toBeCloseTo(300);
  });
});
