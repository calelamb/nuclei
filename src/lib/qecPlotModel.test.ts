import { describe, it, expect } from 'vitest';
import type { ThresholdSeries } from '../types/qecStats';
import { buildPlotModel } from './qecPlotModel';

const series = (points: ThresholdSeries['points'], d = 3): ThresholdSeries => ({
  key: `x·d${d}·mwpm`, label: 'x', distance: d, decoder: 'mwpm', points,
});
const P = (noise: number, p: number, lo = p * 0.8, hi = p * 1.2) => ({ noise, rate: { p, lo, hi }, errors: 3, kept: 100 });

describe('buildPlotModel', () => {
  it('returns null when nothing can be drawn on log axes', () => {
    expect(buildPlotModel([series([P(0, 0.1)])], 'dark', '#999', 'per_shot')).toBeNull();
    expect(buildPlotModel([], 'dark', '#999', 'per_shot')).toBeNull();
  });

  it('keeps every axis bound finite when p = 0 rows are present', () => {
    const m = buildPlotModel([series([P(0, 0.2), P(0.001, 0.01), P(0.01, 0.1)])], 'dark', '#999', 'per_shot')!;
    for (const v of [m.xAxis.lo, m.xAxis.hi, m.yAxis.lo, m.yAxis.hi]) expect(Number.isFinite(v)).toBe(true);
    expect(m.notes).toEqual(['1 point not drawn: p = 0 on a log axis']);
    expect(m.parts[0].normal).toHaveLength(2);
  });

  it('places zero-error points at their upper bound and extends the y range for it', () => {
    const m = buildPlotModel(
      [series([P(0.001, 0.01), P(0.002, 0, 0, 0.5)])], 'light', '#999', 'per_round',
    )!;
    expect(m.parts[0].upper).toHaveLength(1);
    expect(m.yAxis.hi).toBeGreaterThanOrEqual(Math.log10(0.5));
    expect(m.notes.join(' ')).toMatch(/zero-error point drawn at its upper bound|zero-error points? drawn at their upper bound/);
  });

  it('titles the y axis by units', () => {
    expect(buildPlotModel([series([P(0.001, 0.01)])], 'dark', '#999', 'per_round')!.yTitle).toBe('logical error per round');
    expect(buildPlotModel([series([P(0.001, 0.01)])], 'dark', '#999', 'per_shot')!.yTitle).toBe('logical error per shot');
  });
});
