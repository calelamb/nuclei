import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_BAR_WIDTH, bandsForWidth, DIRAC_COLLAPSE_BELOW, DIRAC_RAIL_WIDTH, EDITOR_MIN_WIDTH, planRoom,
  shouldFoldDiracForSidebar, SIDEBAR_COLLAPSE_BELOW, vizRailTab,
} from './breakpoints';

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

describe('shouldFoldDiracForSidebar (the panel opened last wins)', () => {
  const base = { sidebarWidth: 240 };

  it('folds an open Dirac when the user opens the sidebar at 900 and the editor would drop under its minimum', () => {
    // 900 - 48 - 240 - 320 = 292 < 420, but with Dirac folded to its rail: 900 - 48 - 240 - 28 = 584.
    expect(shouldFoldDiracForSidebar({ ...base, viewport: 900, diracWidth: 320 })).toBe(true);
    expect(900 - ACTIVITY_BAR_WIDTH - 240 - DIRAC_RAIL_WIDTH).toBeGreaterThanOrEqual(EDITOR_MIN_WIDTH);
  });

  it('leaves Dirac open when sidebar, Dirac and a 420 px editor all fit', () => {
    expect(shouldFoldDiracForSidebar({ ...base, viewport: 1440, diracWidth: 320 })).toBe(false);
  });

  it('has nothing to fold when Dirac is already on its rail', () => {
    expect(shouldFoldDiracForSidebar({ ...base, viewport: 900, diracWidth: null })).toBe(false);
  });

  it('does not fold Dirac when folding would not rescue the editor anyway', () => {
    expect(shouldFoldDiracForSidebar({ sidebarWidth: 600, viewport: 900, diracWidth: 320 })).toBe(false);
  });
});

describe('vizRailTab', () => {
  const base = { vizHasContent: true, vizFits: false, diracOpen: false, sidebarOpen: false };

  it('stays away when the column fits or has nothing to show', () => {
    expect(vizRailTab({ ...base, vizFits: true })).toBeNull();
    expect(vizRailTab({ ...base, vizHasContent: false })).toBeNull();
  });

  it('folds Dirac when Dirac is what is in the way', () => {
    expect(vizRailTab({ ...base, diracOpen: true, sidebarOpen: true })?.action).toBe('foldDirac');
  });

  it('closes the sidebar when only the sidebar is in the way (900px + Explorer)', () => {
    const tab = vizRailTab({ ...base, sidebarOpen: true });
    expect(tab?.action).toBe('closeSidebar');
    expect(tab?.ariaLabel).toBe('Show circuit and results (closes sidebar)');
  });
});
