import { describe, it, expect } from 'vitest';
import { BASE_FOV_DEG, fovForAspect, labelHeightFraction } from './blochFraming';

describe('fovForAspect', () => {
  it('keeps the base field of view for square and wide viewports', () => {
    expect(fovForAspect(1)).toBe(BASE_FOV_DEG);
    expect(fovForAspect(1.8)).toBe(BASE_FOV_DEG);
  });

  it('widens the vertical field of view for tall viewports so the horizontal one holds', () => {
    const fov = fovForAspect(0.5);
    expect(fov).toBeGreaterThan(BASE_FOV_DEG);
    const horizontal = 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * 0.5);
    const base = 2 * Math.atan(Math.tan((BASE_FOV_DEG * Math.PI) / 360));
    expect(horizontal).toBeCloseTo(base, 6);
  });

  it('falls back to the base value for degenerate input', () => {
    expect(fovForAspect(0)).toBe(BASE_FOV_DEG);
    expect(fovForAspect(Number.NaN)).toBe(BASE_FOV_DEG);
  });
});

describe('labelHeightFraction', () => {
  it('lifts labels in small cells to a readable height', () => {
    expect(labelHeightFraction(0.085, 100) * 100).toBeCloseTo(12, 6);
  });

  it('caps labels in large cells', () => {
    expect(labelHeightFraction(0.085, 440) * 440).toBeCloseTo(20, 6);
  });

  it('keeps the base size in between and survives a zero-size viewport', () => {
    expect(labelHeightFraction(0.085, 200) * 200).toBeCloseTo(17, 6);
    expect(labelHeightFraction(0.085, 0)).toBe(0.085);
  });
});
