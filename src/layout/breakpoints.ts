/**
 * Viewport widths (px) at which secondary chrome yields to the editor.
 * Order of retreat as the window shrinks: Dirac folds to its rail tab first,
 * then the sidebar; the right-hand viz column hides on its own when the editor
 * would otherwise drop below EDITOR_MIN_WIDTH (see PanelLayout).
 */
/**
 * Below this the editor, viz column and an open Dirac panel cannot all keep a usable
 * width (at 1280-1366 the editor shrank to ~420px: icon-only Run, clipped circuit).
 */
export const DIRAC_COLLAPSE_BELOW = 1400;
export const SIDEBAR_COLLAPSE_BELOW = 1000;

/** The editor never gets narrower than this while it has company. */
export const EDITOR_MIN_WIDTH = 420;
/** The viz column is hidden rather than squeezed below this. */
export const VIZ_MIN_WIDTH = 240;

export interface ViewportBands {
  diracNarrow: boolean;
  sidebarNarrow: boolean;
}

export function bandsForWidth(width: number): ViewportBands {
  return {
    diracNarrow: width < DIRAC_COLLAPSE_BELOW,
    sidebarNarrow: width < SIDEBAR_COLLAPSE_BELOW,
  };
}

/** The activity bar's fixed width. */
export const ACTIVITY_BAR_WIDTH = 48;
/** What a folded Dirac still takes: its vertical rail tab. */
export const DIRAC_RAIL_WIDTH = 28;

export interface RoomInput {
  viewport: number;
  sidebarWidth: number;
  /** Dirac's open width, or null when it is folded to its rail tab. */
  diracWidth: number | null;
  /** The right-hand viz column has something to show and so wants VIZ_MIN_WIDTH. */
  vizWanted: boolean;
}

export interface RoomPlan {
  /** Close the sidebar: the editor would otherwise drop below EDITOR_MIN_WIDTH (or force the viz column away). */
  closeSidebar: boolean;
  /** The viz column cannot fit even with the sidebar closed. */
  hideViz: boolean;
}

/**
 * Retreat order when something opens and the row gets tight: the sidebar folds first (it is the
 * most easily reopened), and only then does the viz column step aside. The editor is never squeezed below
 * EDITOR_MIN_WIDTH by an open sidebar.
 */
export function planRoom({ viewport, sidebarWidth, diracWidth, vizWanted }: RoomInput): RoomPlan {
  const rightEdge = diracWidth ?? DIRAC_RAIL_WIDTH;
  const row = viewport - ACTIVITY_BAR_WIDTH - rightEdge;
  const need = EDITOR_MIN_WIDTH + (vizWanted ? VIZ_MIN_WIDTH : 0);
  const closeSidebar = row - sidebarWidth < need;
  return { closeSidebar, hideViz: vizWanted && row < need };
}

export interface SidebarOpenInput {
  viewport: number;
  sidebarWidth: number;
  /** Dirac's open width, or null when it is already folded to its rail tab. */
  diracWidth: number | null;
}

/**
 * The user just opened the sidebar. When the sidebar and an open Dirac leave the editor under
 * EDITOR_MIN_WIDTH, Dirac folds to its rail tab (the panel opened most recently wins) - but only
 * when that rescues the editor; otherwise folding would cost Dirac for nothing.
 */
export function shouldFoldDiracForSidebar({ viewport, sidebarWidth, diracWidth }: SidebarOpenInput): boolean {
  if (diracWidth === null) return false;
  const editorWithDirac = viewport - ACTIVITY_BAR_WIDTH - sidebarWidth - diracWidth;
  const editorWithRail = viewport - ACTIVITY_BAR_WIDTH - sidebarWidth - DIRAC_RAIL_WIDTH;
  return editorWithDirac < EDITOR_MIN_WIDTH && editorWithRail >= EDITOR_MIN_WIDTH;
}

export type VizRailTabAction = 'foldDirac' | 'closeSidebar';

export interface VizRailTab {
  action: VizRailTabAction;
  ariaLabel: string;
}

export interface VizRailTabInput {
  vizHasContent: boolean;
  vizFits: boolean;
  diracOpen: boolean;
  sidebarOpen: boolean;
}

/**
 * The always-visible handle for a circuit/results column that has stepped aside. Whatever neighbour
 * is in the way (an open Dirac, otherwise the sidebar) is the thing the tab moves, so a Run never
 * leaves results with no way back.
 */
export function vizRailTab({ vizHasContent, vizFits, diracOpen, sidebarOpen }: VizRailTabInput): VizRailTab | null {
  if (!vizHasContent || vizFits) return null;
  if (diracOpen) return { action: 'foldDirac', ariaLabel: 'Show circuit and results (folds Dirac)' };
  if (sidebarOpen) return { action: 'closeSidebar', ariaLabel: 'Show circuit and results (closes sidebar)' };
  return null;
}
