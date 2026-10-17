import { describe, it, expect } from 'vitest';
import { blochLength, blochPurity, describeBlochState, easeOutCubic, interpolateBloch } from './blochMath';

describe('Bloch readout', () => {
  it('a Bell-pair qubit (r = 0) is entangled with no single-qubit state and purity 0.5', () => {
    const r = describeBlochState({ x: 0, y: 0, z: 0 });
    expect(r.kind).toBe('maximally-mixed');
    expect(r.purity).toBeCloseTo(0.5, 6);
    expect(r.summary).toMatch(/entangled/i);
    expect(r.summary).toMatch(/no single-qubit Bloch vector/i);
    expect(r.short).toBe('Entangled');
  });

  it('classifies partially mixed and pure vectors', () => {
    expect(describeBlochState({ x: 0.6, y: 0, z: 0 }).kind).toBe('mixed');
    expect(describeBlochState({ x: 0, y: 0, z: 1 }).kind).toBe('pure');
    expect(describeBlochState({ x: 0, y: 0, z: 0.999 }).kind).toBe('pure');
  });

  it('computes length and purity', () => {
    expect(blochLength({ x: 3, y: 4, z: 0 })).toBe(5);
    expect(blochPurity({ x: 0, y: 0, z: 1 })).toBeCloseTo(1, 6);
  });
});

describe('interpolateBloch', () => {
  const north = { x: 0, y: 0, z: 1 };
  const east = { x: 1, y: 0, z: 0 };

  it('hits both ends', () => {
    expect(interpolateBloch(north, east, 0)).toEqual(north);
    const end = interpolateBloch(north, east, 1);
    expect(end.x).toBeCloseTo(1, 6);
    expect(end.z).toBeCloseTo(0, 6);
  });

  it('stays on the unit sphere between two pure states (an arc, not a chord)', () => {
    for (const t of [0.25, 0.5, 0.75]) {
      expect(blochLength(interpolateBloch(north, east, t))).toBeCloseTo(1, 6);
    }
  });

  it('handles antipodal and zero vectors without NaN', () => {
    const mid = interpolateBloch(north, { x: 0, y: 0, z: -1 }, 0.5);
    expect(Number.isFinite(mid.x + mid.y + mid.z)).toBe(true);
    const fromZero = interpolateBloch({ x: 0, y: 0, z: 0 }, east, 0.5);
    expect(fromZero.x).toBeCloseTo(0.5, 6);
  });
});

describe('easeOutCubic', () => {
  it('is monotonic from 0 to 1 and clamps', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(2)).toBe(1);
  });
});
