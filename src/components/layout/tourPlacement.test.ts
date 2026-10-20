import { describe, expect, it } from 'vitest';
import { placeTourCard } from './tourPlacement';

const VIEW = { width: 1440, height: 900 };
const RAIL_ITEM = { top: 40, left: 4, width: 40, height: 40 };

describe('placeTourCard', () => {
  it('sits beside the rail item when no sidebar is open', () => {
    const p = placeTourCard(RAIL_ITEM, 'right', VIEW, null);
    expect(p.left).toBe(58);
    expect(p.arrow).toBe(true);
  });

  it('clears an open sidebar instead of covering the pane it describes', () => {
    const p = placeTourCard(RAIL_ITEM, 'right', VIEW, 288);
    expect(p.left).toBe(296);
    expect(p.arrow).toBe(false);
  });

  it('stays inside the window on the right', () => {
    expect(placeTourCard(RAIL_ITEM, 'right', { width: 400, height: 900 }, 380).left).toBe(400 - 300 - 8);
  });

  it('puts a status-bar target above it, kept inside the left edge', () => {
    const p = placeTourCard({ top: 880, left: 2, width: 100, height: 20 }, 'above', VIEW, null);
    expect(p.left).toBe(8);
    expect(p.bottom).toBe(900 - 880 + 14);
  });
});
