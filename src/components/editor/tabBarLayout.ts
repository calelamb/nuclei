/** Toolbar density tiers for the editor tab bar, chosen from the bar's pixel width. */
export type TabBarDensity = 'full' | 'compact' | 'tight';

/** Below this width the toolbar drops hints and the Launch label. */
export const COMPACT_BAR_WIDTH = 860;
/** Below this width the Run button is icon-only so the tab strip keeps room. */
export const TIGHT_BAR_WIDTH = 480;

export function tabBarDensity(width: number): TabBarDensity {
  if (width < TIGHT_BAR_WIDTH) return 'tight';
  if (width < COMPACT_BAR_WIDTH) return 'compact';
  return 'full';
}
