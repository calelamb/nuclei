import { describe, it, expect } from 'vitest';
import { logAxis, makeLogScale, visibleLabels } from './qecPlotTicks';

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

describe('end-of-axis coverage', () => {
  it('labels past the last decade when data reaches 1.4e-3 (domain 1e-4 .. 1.4e-3)', () => {
    const axis = logAxis([1e-4, 1.4e-3])!;
    const span = axis.hi - axis.lo;
    const last = Math.max(...axis.labeled.map((t) => Math.log10(t.value)));
    expect(axis.hi - last).toBeLessThanOrEqual(0.3 * span);
  });

  it('labels the tail of the mid.csv range (5e-4 .. 1.4e-3) beyond 10^-3', () => {
    const axis = logAxis([5e-4, 1.4e-3])!;
    expect(axis.labeled.some((t) => t.value > 1.05e-3)).toBe(true);
    expect(axis.labeled.map((t) => t.label)).toContain('1.2×10⁻³');
  });

  it('puts a label in the first and last 30% of the axis for realistic sweeps', () => {
    for (const range of [[3e-4, 1.48e-3], [1e-3, 1e-2], [1e-4, 1e-2], [5e-4, 1.4e-3]]) {
      const axis = logAxis(range)!;
      const span = axis.hi - axis.lo;
      const logs = axis.labeled.map((t) => Math.log10(t.value));
      expect(axis.hi - Math.max(...logs)).toBeLessThanOrEqual(0.3 * span + 1e-9);
      expect(Math.min(...logs) - axis.lo).toBeLessThanOrEqual(0.3 * span + 1e-9);
    }
  });
});

describe('partial decades at the ends of a wide axis', () => {
  it('labels 2x and 5x in the closing partial decade so the last stretch can be read', () => {
    const labels = logAxis([1e-5, 5e-2])!.labeled.map((t) => t.label);
    expect(labels).toEqual(expect.arrayContaining(['10⁻⁵', '10⁻²', '2×10⁻²', '5×10⁻²']));
  });

  it('does not add partial-decade labels beyond the data range', () => {
    const labels = logAxis([1e-6, 1e-2])!.labeled.map((t) => t.label);
    expect(labels).not.toContain('2×10⁻²');
  });
});

describe('visibleLabels', () => {
  const tick = (value: number, major = false) => ({ value, major, label: String(value) });
  const px = (v: number) => v * 100;

  it('keeps every label when they fit', () => {
    const ticks = [tick(1), tick(2), tick(3)];
    expect(visibleLabels(ticks, px, () => 40, 8)).toEqual(ticks);
  });

  it('drops the lower-priority neighbour of an overlapping pair and keeps major decades', () => {
    const ticks = [tick(1, true), tick(1.2), tick(2, true)];
    const kept = visibleLabels(ticks, px, () => 60, 8).map((t) => t.value);
    expect(kept).toEqual([1, 2]);
  });

  it('returns ticks in axis order', () => {
    const ticks = [tick(1, true), tick(3), tick(5), tick(7, true)];
    const kept = visibleLabels(ticks, px, () => 150, 8).map((t) => t.value);
    expect([...kept].sort((a, b) => a - b)).toEqual(kept);
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
