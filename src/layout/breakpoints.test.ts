import { describe, expect, it } from 'vitest';
import { bandsForWidth, DIRAC_COLLAPSE_BELOW, EDITOR_MIN_WIDTH, planRoom, SIDEBAR_COLLAPSE_BELOW } from './breakpoints';

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

describe('planRoom (retreat order when Dirac opens)', () => {
  const base = { sidebarWidth: 240, vizWanted: true };

  it('keeps everything at 1440 with Dirac open', () => {
    expect(planRoom({ ...base, viewport: 1440, diracWidth: 320 })).toEqual({ closeSidebar: false, hideViz: false });
  });

  it('folds the sidebar first at 1100 with Dirac open, keeping the circuit column', () => {
    expect(planRoom({ ...base, viewport: 1100, diracWidth: 320 })).toEqual({ closeSidebar: true, hideViz: false });
  });

  it('hides the viz column only when even a closed sidebar leaves too little room', () => {
    expect(planRoom({ ...base, viewport: 900, diracWidth: 320 })).toEqual({ closeSidebar: true, hideViz: true });
  });

  it('never leaves an open sidebar squeezing the editor under its minimum (900, Dirac open, no viz)', () => {
    const plan = planRoom({ viewport: 900, sidebarWidth: 240, diracWidth: 320, vizWanted: false });
    expect(plan.closeSidebar).toBe(true);
    expect(900 - 48 - 320).toBeGreaterThanOrEqual(EDITOR_MIN_WIDTH);
  });

  it('leaves the sidebar alone when Dirac is folded and the row is wide enough', () => {
    expect(planRoom({ ...base, viewport: 1100, diracWidth: null })).toEqual({ closeSidebar: false, hideViz: false });
  });
});
