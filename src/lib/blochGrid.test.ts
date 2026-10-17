import { describe, it, expect } from 'vitest';
import { blochGridLayout, MIN_SPHERE_PX, MAX_SPHERES_PER_PAGE } from './blochGrid';

describe('blochGridLayout', () => {
  it('keeps 1-3 qubits on one row in a wide panel', () => {
    const l = blochGridLayout({ count: 3, width: 480, height: 300 });
    expect(l.cols).toBe(3);
    expect(l.rows).toBe(1);
    expect(l.pageCount).toBe(1);
  });

  it('wraps 6 qubits into 2 columns in a narrow rail instead of shrinking them', () => {
    const l = blochGridLayout({ count: 6, width: 330, height: 520 });
    expect(l.cols).toBe(2);
    expect(l.rows).toBe(3);
    expect(l.cellWidth).toBeGreaterThanOrEqual(MIN_SPHERE_PX);
  });

  it('never shows more than the cap and pages the rest (18 qubits)', () => {
    const l = blochGridLayout({ count: 18, width: 640, height: 900 });
    expect(l.pageSize).toBeLessThanOrEqual(MAX_SPHERES_PER_PAGE);
    expect(l.pageCount).toBe(Math.ceil(18 / l.pageSize));
  });

  it('degrades to one sphere in a tiny area but never returns zero', () => {
    const l = blochGridLayout({ count: 5, width: 60, height: 60 });
    expect(l.cols).toBe(1);
    expect(l.pageSize).toBe(1);
    expect(l.pageCount).toBe(5);
  });

  it('never pages 2 qubits, even in the narrow 1100px slot', () => {
    const l = blochGridLayout({ count: 2, width: 200, height: 224 });
    expect(l.pageCount).toBe(1);
    expect(l.pageSize).toBe(2);
  });

  it('keeps 3 qubits together in a narrow slot and a wider one', () => {
    expect(blochGridLayout({ count: 3, width: 200, height: 224 }).pageCount).toBe(1);
    expect(blochGridLayout({ count: 3, width: 316, height: 224 }).pageCount).toBe(1);
  });

  it('keeps full-size spheres when there is room', () => {
    const l = blochGridLayout({ count: 2, width: 480, height: 300 });
    expect(l.cellWidth).toBeGreaterThanOrEqual(MIN_SPHERE_PX);
  });

  it('keeps 5 qubits on one screen in the narrow 1100px slot by shrinking the spheres', () => {
    const l = blochGridLayout({ count: 5, width: 316, height: 244 });
    expect(l.pageCount).toBe(1);
    expect(l.pageSize).toBe(5);
  });

  it('still pages once the count passes a page', () => {
    expect(blochGridLayout({ count: 12, width: 316, height: 244 }).pageCount).toBeGreaterThan(1);
  });
});
