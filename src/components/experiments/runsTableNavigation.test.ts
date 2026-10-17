import { describe, it, expect } from 'vitest';
import { nextRowIndex, scrollTopToReveal } from './runsTableNavigation';
import { ROW_HEIGHT } from './RunsTableRow';

describe('runsTableNavigation (LR-10)', () => {
  it('moves one row and clamps at both ends', () => {
    expect(nextRowIndex('ArrowDown', 0, 3, 10)).toBe(1);
    expect(nextRowIndex('ArrowDown', 2, 3, 10)).toBe(2);
    expect(nextRowIndex('ArrowUp', 0, 3, 10)).toBe(0);
  });
  it('jumps to the ends and by pages', () => {
    expect(nextRowIndex('Home', 5, 20, 10)).toBe(0);
    expect(nextRowIndex('End', 5, 20, 10)).toBe(19);
    expect(nextRowIndex('PageDown', 5, 20, 10)).toBe(15);
    expect(nextRowIndex('PageUp', 5, 20, 10)).toBe(0);
  });
  it('has nowhere to go without rows', () => {
    expect(nextRowIndex('ArrowDown', 0, 0, 10)).toBe(-1);
  });
  it('scrolls only when the row is hidden behind the header or below the fold', () => {
    const header = 28;
    expect(scrollTopToReveal(0, 0, 400, header)).toBe(0);
    expect(scrollTopToReveal(30, 0, 400, header)).toBe(header + 30 * ROW_HEIGHT + ROW_HEIGHT - 400);
    expect(scrollTopToReveal(1, 500, 400, header)).toBe(ROW_HEIGHT);
  });
});
