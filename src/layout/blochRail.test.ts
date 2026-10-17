import { describe, it, expect } from 'vitest';
import { blochRailHeights, blochRailUsedHeight, BLOCH_ROW_MAX_PX, BLOCH_ROW_MIN_PX } from './blochRail';

describe('blochRailHeights', () => {
  it('gives six qubits in a narrow rail a 3x2 grid worth of rows', () => {
    const { desired } = blochRailHeights(6, 332);
    // 3 rows of up to 170px, two 8px gaps and 16px of inset: well past the old one-row 172px strip.
    expect(desired).toBeGreaterThanOrEqual(3 * BLOCH_ROW_MAX_PX * 0.9);
  });

  it('wants one row for a single qubit and never more than a comfortable tile', () => {
    const { desired } = blochRailHeights(1, 332);
    expect(desired).toBeLessThanOrEqual(BLOCH_ROW_MAX_PX + 16);
  });

  it('adds room for the pager once the qubits outnumber a page', () => {
    expect(blochRailHeights(18, 332).desired).toBe(blochRailHeights(4, 332).desired + 32);
  });

  it('never lets the rail shrink below one full row (no 152x12 slivers at 18 qubits)', () => {
    const { min } = blochRailHeights(18, 332);
    expect(min).toBeGreaterThanOrEqual(BLOCH_ROW_MIN_PX);
  });

  it('falls back to a sane width before the rail is measured', () => {
    expect(blochRailHeights(4, 0).desired).toBe(blochRailHeights(4, 316).desired);
  });

  it('treats zero or negative counts as one', () => {
    expect(blochRailHeights(0, 332)).toEqual(blochRailHeights(1, 332));
  });
});

describe('blochRailUsedHeight', () => {
  it('is no taller than the rail it was given', () => {
    for (const [count, width, height] of [[4, 310, 284], [3, 310, 240], [6, 332, 520], [18, 332, 400]] as const) {
      expect(blochRailUsedHeight(count, width, height)).toBeLessThanOrEqual(height);
    }
  });

  it('on a short rail draws one row of 3 qubits and reports only that row, not a 2-row grid', () => {
    const used = blochRailUsedHeight(3, 310, 284);
    expect(used).toBeLessThanOrEqual(blochRailHeights(3, 310).desired - 60);
  });

  it('on a tall rail reports the full multi-row grid', () => {
    expect(blochRailUsedHeight(4, 310, 600)).toBeGreaterThan(284);
  });

  it('adds the pager when the qubits page', () => {
    const paged = blochRailUsedHeight(18, 332, 400);
    expect(paged).toBeGreaterThan(32 + 16 + 100);
  });
});

describe('blochRailHeights min', () => {
  it('reserves no pager row when the qubits fit one row at the minimum', () => {
    expect(blochRailHeights(2, 332).min).toBe(BLOCH_ROW_MIN_PX + 16);
    expect(blochRailHeights(1, 332).min).toBe(BLOCH_ROW_MIN_PX + 16);
  });

  it('reserves the pager row when they would page', () => {
    expect(blochRailHeights(18, 332).min).toBe(BLOCH_ROW_MIN_PX + 16 + 32);
  });
});
