import { describe, expect, it } from 'vitest';
import { hasMeasurements, tooltipOrder } from './MultiSeriesHistogram';

describe('MultiSeriesHistogram helpers', () => {
  it('treats a run with no measurements as unplottable', () => {
    expect(hasMeasurements({ label: 'a', measurements: {} })).toBe(false);
    expect(hasMeasurements({ label: 'a', measurements: { '00': 0 } })).toBe(false);
    expect(hasMeasurements({ label: 'a', measurements: { '00': 3 } })).toBe(true);
  });

  it('orders tooltip rows by legend position', () => {
    const series = [
      { label: 'first', measurements: { '0': 1 } },
      { label: 'second', measurements: { '0': 1 } },
    ];
    expect(tooltipOrder(series, 'first')).toBeLessThan(tooltipOrder(series, 'second'));
    expect(tooltipOrder(series, 'missing')).toBe(2);
  });
});
