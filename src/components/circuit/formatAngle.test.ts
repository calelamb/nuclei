import { describe, it, expect } from 'vitest';
import { formatAngle, formatGateParams } from './formatAngle';

describe('formatAngle', () => {
  it('writes common rotations as multiples of pi', () => {
    expect(formatAngle(Math.PI)).toBe('π');
    expect(formatAngle(Math.PI / 2)).toBe('π/2');
    expect(formatAngle(Math.PI / 4)).toBe('π/4');
    expect(formatAngle((3 * Math.PI) / 4)).toBe('3π/4');
    expect(formatAngle(-Math.PI / 2)).toBe('-π/2');
    expect(formatAngle(2 * Math.PI)).toBe('2π');
  });
  it('falls back to a short decimal for other angles', () => {
    expect(formatAngle(0.1234)).toBe('0.12');
    expect(formatAngle(1)).toBe('1');
  });
  it('handles zero', () => {
    expect(formatAngle(0)).toBe('0');
  });
  it('joins several parameters', () => {
    expect(formatGateParams([Math.PI / 2, 0])).toBe('π/2, 0');
    expect(formatGateParams([])).toBe('');
  });
});
