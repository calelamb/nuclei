import { describe, it, expect } from 'vitest';
import { blochRailHeights, BLOCH_ROW_MAX_PX, BLOCH_ROW_MIN_PX } from './blochRail';

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
    expect(blochRailHeights(18, 332).desired).toBeGreaterThan(blochRailHeights(6, 332).desired);
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
