import { describe, expect, it } from 'vitest';
import { tooltipLeft } from './qecTooltipPosition';

describe('tooltipLeft', () => {
  it('sits right of the point when it fits', () => {
    expect(tooltipLeft({ x: 50, plotWidth: 800, tooltipWidth: 260, offset: 14 })).toBe(64);
  });
  it('flips left near the right edge', () => {
    expect(tooltipLeft({ x: 700, plotWidth: 800, tooltipWidth: 260, offset: 14 })).toBe(426);
  });
  it('picks the roomier side and clamps inside the figure on a narrow plot', () => {
    for (let x = 0; x <= 400; x += 10) {
      const left = tooltipLeft({ x, plotWidth: 400, tooltipWidth: 260, offset: 14 });
      expect(left).toBeGreaterThanOrEqual(4);
      expect(left).toBeLessThanOrEqual(400 - 260 - 4);
    }
  });
  it('never goes negative when the figure is narrower than the tooltip', () => {
    expect(tooltipLeft({ x: 100, plotWidth: 200, tooltipWidth: 260, offset: 14 })).toBe(4);
  });
});
