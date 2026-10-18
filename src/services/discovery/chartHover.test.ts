import { describe, expect, it } from 'vitest';
import { nearestPoint } from './chartHover';

describe('nearestPoint', () => {
  const items = [{ id: 'a', p: [10, 10] as const }, { id: 'b', p: [30, 10] as const }];
  it('returns the closest item within the radius', () => {
    expect(nearestPoint(items, 28, 12, (i) => i.p)?.id).toBe('b');
  });
  it('returns null when nothing is close enough', () => {
    expect(nearestPoint(items, 200, 200, (i) => i.p)).toBeNull();
    expect(nearestPoint([], 0, 0, (i: { p: readonly [number, number] }) => i.p)).toBeNull();
  });
});
