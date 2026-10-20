import { describe, expect, it } from 'vitest';
import { computeMenuPosition, type Box } from './menuPosition';

const box = (left: number, top: number, w = 80, h = 24): Box => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
const VIEW = { width: 1000, height: 700 };

describe('computeMenuPosition', () => {
  it('opens below and start-aligned when it fits', () => {
    const p = computeMenuPosition(box(100, 100), { width: 200, height: 160 }, VIEW, 'bottom-start');
    expect(p).toMatchObject({ left: 100, top: 128, placement: 'bottom-start' });
  });

  it('flips above when there is no room below', () => {
    const p = computeMenuPosition(box(100, 640), { width: 200, height: 160 }, VIEW, 'bottom-start');
    expect(p.placement).toBe('top-start');
    expect(p.top).toBe(640 - 4 - 160);
  });

  it('end-aligns to the trigger and clamps inside the right edge', () => {
    const p = computeMenuPosition(box(950, 100), { width: 200, height: 100 }, VIEW, 'bottom-end');
    expect(p.left + 200).toBeLessThanOrEqual(1000 - 8);
  });

  it('clamps inside the left edge', () => {
    const p = computeMenuPosition(box(2, 100, 20), { width: 200, height: 100 }, VIEW, 'bottom-end');
    expect(p.left).toBeGreaterThanOrEqual(8);
  });

  it('caps the height to the available room when neither side fits', () => {
    const p = computeMenuPosition(box(100, 300), { width: 200, height: 900 }, VIEW, 'bottom-start');
    expect(p.maxHeight).toBeLessThan(700);
  });
});
