import { describe, it, expect } from 'vitest';
import type { ThresholdSeries } from '../types/qecStats';
import { classifyPoint, partitionSeries, omissionNotes, nearestPoint, tooltipLines } from './qecPlotPoints';

const pt = (noise: number, p: number, lo = p / 2, hi = p * 2) => ({ noise, rate: { p, lo, hi }, errors: 5, kept: 1000 });
const series = (points: ReturnType<typeof pt>[], extra: Partial<ThresholdSeries> = {}): ThresholdSeries => ({
  key: 'a·d3·pymatching', label: 'a', distance: 3, decoder: 'pymatching', points, ...extra,
});

describe('classifyPoint', () => {
  it('draws positive points normally', () => {
    expect(classifyPoint(pt(0.001, 0.01))).toBe('normal');
  });
  it('skips p = 0 and negative or non-finite noise (cannot sit on a log axis)', () => {
    expect(classifyPoint(pt(0, 0.01))).toBe('skip-noise');
    expect(classifyPoint(pt(-1, 0.01))).toBe('skip-noise');
    expect(classifyPoint(pt(Number.NaN, 0.01))).toBe('skip-noise');
  });
  it('draws zero-error points at their upper bound', () => {
    expect(classifyPoint(pt(0.001, 0, 0, 0.003))).toBe('upper');
  });
  it('skips points whose rate and upper bound are both zero', () => {
    expect(classifyPoint(pt(0.001, 0, 0, 0))).toBe('skip-rate');
  });
});

describe('partitionSeries', () => {
  it('splits points by kind without mutating the input and counts omissions', () => {
    const s = series([pt(0, 0.1), pt(0.001, 0.01), pt(0.002, 0, 0, 0.004), pt(0.003, 0, 0, 0)]);
    const snapshot = JSON.stringify(s);
    const parts = partitionSeries([s]);
    expect(JSON.stringify(s)).toBe(snapshot);
    expect(parts.series[0].normal).toHaveLength(1);
    expect(parts.series[0].upper).toHaveLength(1);
    expect(parts.counts).toEqual({ skipNoise: 1, skipRate: 1, upper: 1, noiseAllZero: true });
  });
});

describe('omissionNotes', () => {
  it('says exactly what was left out and why', () => {
    expect(omissionNotes({ skipNoise: 2, skipRate: 0, upper: 0, noiseAllZero: true }))
      .toEqual(['2 points not drawn: p = 0 on a log axis']);
    expect(omissionNotes({ skipNoise: 1, skipRate: 0, upper: 0, noiseAllZero: false }))
      .toEqual(['1 point not drawn: p ≤ 0 on a log axis']);
    expect(omissionNotes({ skipNoise: 0, skipRate: 1, upper: 3, noiseAllZero: true })).toEqual([
      '1 point not drawn: rate and upper bound are both 0',
      '3 zero-error points drawn at their upper bound (hollow ▽)',
    ]);
    expect(omissionNotes({ skipNoise: 0, skipRate: 0, upper: 1, noiseAllZero: true }))
      .toEqual(['1 zero-error point drawn at its upper bound (hollow ▽)']);
  });
  it('is empty when nothing was omitted', () => {
    expect(omissionNotes({ skipNoise: 0, skipRate: 0, upper: 0, noiseAllZero: true })).toEqual([]);
  });
});

describe('nearestPoint', () => {
  const pts = [{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 50, y: 50 }];
  it('returns the closest point within the radius', () => {
    expect(nearestPoint(pts, 12, 11, 8)?.id).toBe('a');
    expect(nearestPoint(pts, 48, 53, 8)?.id).toBe('b');
  });
  it('returns null when nothing is close enough', () => {
    expect(nearestPoint(pts, 100, 100, 8)).toBeNull();
    expect(nearestPoint([], 0, 0, 8)).toBeNull();
  });
});

describe('tooltipLines', () => {
  it('lists d, p, decoder, rate, interval, errors and kept shots', () => {
    const lines = tooltipLines(series([]), pt(0.002, 0.0032, 0.0021, 0.0049), 'per_round');
    const text = lines.join('\n');
    expect(text).toContain('d = 3');
    expect(text).toContain('p = 2×10⁻³');
    expect(text).toContain('pymatching');
    expect(text).toContain('per round');
    expect(text).toContain('3.20×10⁻³');
    expect(text).toContain('2.10×10⁻³');
    expect(text).toContain('4.90×10⁻³');
    expect(text).toContain('5 errors');
    expect(text).toContain('1,000 kept shots');
  });
  it('marks zero-error points as upper bounds', () => {
    const lines = tooltipLines(series([]), pt(0.002, 0, 0, 0.004), 'per_shot');
    expect(lines.join('\n')).toMatch(/0 errors.*upper bound/s);
  });
});
