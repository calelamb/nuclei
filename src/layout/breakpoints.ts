/**
 * Viewport widths (px) at which secondary chrome yields to the editor.
 * Order of retreat as the window shrinks: Dirac folds to its rail tab first,
 * then the sidebar; the right-hand viz column hides on its own when the editor
 * would otherwise drop below EDITOR_MIN_WIDTH (see PanelLayout).
 */
export const DIRAC_COLLAPSE_BELOW = 1280;
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
