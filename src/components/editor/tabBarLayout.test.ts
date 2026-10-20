import { describe, expect, it } from 'vitest';
import { tabBarDensity } from './tabBarLayout';

describe('tabBarDensity', () => {
  it('is full for wide bars', () => expect(tabBarDensity(1000)).toBe('full'));
  it('is compact between the thresholds', () => {
    expect(tabBarDensity(859)).toBe('compact');
    expect(tabBarDensity(400)).toBe('compact'); // a 400px editor still keeps the Run label
    expect(tabBarDensity(499)).toBe('compact'); // default 1440 layout keeps the Run label
  });
  it('is tight for narrow editors', () => expect(tabBarDensity(399)).toBe('tight'));
});
