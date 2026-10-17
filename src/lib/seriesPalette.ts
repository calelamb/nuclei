import type { ThemeColors } from '../stores/themeStore';

/**
 * PRD 09 Phase E — a small categorical palette for N-series charts (the
 * Compare view's multi-series histogram, the sweep plot's per-group lines),
 * built entirely from existing theme tokens rather than introducing
 * hardcoded hex colors that would fight the light/dark theme. Purple is
 * reserved for Dirac, so it is never a series colour.
 */
const PALETTE_KEYS: Array<keyof ThemeColors> = [
  'accent',
  'warning',
  'success',
  'info',
  'error',
  'overlayMatching',
  'accentLight',
];

/** Cycle through the palette by index — stable regardless of how many
 * series are shown, and consistent across re-renders for the same index. */
export function seriesColor(colors: ThemeColors, index: number): string {
  const key = PALETTE_KEYS[((index % PALETTE_KEYS.length) + PALETTE_KEYS.length) % PALETTE_KEYS.length];
  return colors[key];
}
