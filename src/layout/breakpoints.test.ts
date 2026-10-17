import { describe, expect, it } from 'vitest';
import { bandsForWidth, DIRAC_COLLAPSE_BELOW, EDITOR_MIN_WIDTH, SIDEBAR_COLLAPSE_BELOW } from './breakpoints';

describe('bandsForWidth', () => {
  it.each([1280, 1366, 1399])('folds Dirac at %ipx so the editor keeps room for the circuit and a labelled Run', (w) => {
    expect(bandsForWidth(w).diracNarrow).toBe(true);
  });

  it('keeps Dirac open from 1400px up', () => {
    expect(bandsForWidth(DIRAC_COLLAPSE_BELOW).diracNarrow).toBe(false);
    expect(bandsForWidth(1440).diracNarrow).toBe(false);
  });

  it('folds the sidebar below 1000px only', () => {
    expect(bandsForWidth(SIDEBAR_COLLAPSE_BELOW - 1).sidebarNarrow).toBe(true);
    expect(bandsForWidth(SIDEBAR_COLLAPSE_BELOW).sidebarNarrow).toBe(false);
  });

  it('leaves an editor wider than its minimum at 1366 once Dirac has folded', () => {
    // viewport - activity rail (48) - sidebar (240) leaves the editor+viz row.
    const row = 1366 - 48 - 240;
    expect(row * 0.6).toBeGreaterThan(EDITOR_MIN_WIDTH);
  });
});
