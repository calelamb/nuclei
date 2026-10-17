import { describe, expect, it } from 'vitest';
import { tabBarDensity } from './tabBarLayout';

describe('tabBarDensity', () => {
  it('is full for wide bars', () => expect(tabBarDensity(1000)).toBe('full'));
  it('is compact between the thresholds', () => {
    expect(tabBarDensity(859)).toBe('compact');
    expect(tabBarDensity(520)).toBe('compact');
  });
  it('is tight for narrow editors', () => expect(tabBarDensity(290)).toBe('tight'));
});
