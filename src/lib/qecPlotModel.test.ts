import { describe, it, expect } from 'vitest';
import type { ThresholdSeries } from '../types/qecStats';
import { buildPlotModel, whiskerLow, MAX_WHISKER_DECADES } from './qecPlotModel';

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

describe('lower whiskers', () => {
  it('includes the interval lower bound in the y domain', () => {
    const m = buildPlotModel([series([P(0.001, 1e-3, 4e-4, 2e-3), P(0.01, 1e-2)])], 'dark', '#999', 'per_shot')!;
    expect(m.yAxis.lo).toBeLessThanOrEqual(Math.log10(4e-4));
    const low = whiskerLow(4e-4, m.yAxis);
    expect(low).toEqual({ value: 4e-4, open: false });
  });

  it('floors extreme lower bounds and flags the whisker open', () => {
    const m = buildPlotModel([series([P(0.001, 1e-3, 1e-9, 2e-3), P(0.01, 1e-2)])], 'dark', '#999', 'per_shot')!;
    expect(m.yAxis.lo).toBeGreaterThan(Math.log10(1e-3) - MAX_WHISKER_DECADES - 0.5);
    const low = whiskerLow(1e-9, m.yAxis);
    expect(low.open).toBe(true);
    expect(low.value).toBeCloseTo(10 ** m.yAxis.lo, 12);
  });

  it('treats a zero lower bound as open at the axis bottom', () => {
    const m = buildPlotModel([series([P(0.001, 1e-3, 0, 2e-3)])], 'dark', '#999', 'per_shot')!;
    expect(whiskerLow(0, m.yAxis).open).toBe(true);
  });

  it('keeps few-error lower whiskers inside the plot', () => {
    const m = buildPlotModel([series([P(0.001, 2e-4, 6e-5, 5e-4), P(0.01, 1e-2)])], 'dark', '#999', 'per_shot')!;
    const low = whiskerLow(6e-5, m.yAxis);
    expect(Math.log10(low.value)).toBeGreaterThanOrEqual(m.yAxis.lo);
  });
});
