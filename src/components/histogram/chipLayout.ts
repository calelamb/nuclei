/** Mono glyph width at the chip's 11px size, with a little slack. */
const GLYPH_PX = 6.8;
/** Per-entry chrome besides the ket: gaps, a minimum bar and the percentage. */
const ENTRY_CHROME_PX = 82;
const HW_EXTRA_PX = 26;
const ENTRY_GAP_PX = 10;
const CONTROLS_PX = 110;
const CHIP_PADDING_PX = 24;

export type ChipLayout = 'inline' | 'rows';

/** Pixels one outcome needs in the single-line layout so its ket, bar and percentage all stay whole. */
export function entryWidth(label: string, hasHw: boolean): number {
  return (label.length + 2) * GLYPH_PX + ENTRY_CHROME_PX + (hasHw ? HW_EXTRA_PX : 0);
}

/**
 * One line when every outcome fits side by side with its percentage; otherwise a
 * stacked ket / bar / percentage row per outcome. An unmeasured chip (width 0)
 * keeps the inline layout.
 */
export function chooseChipLayout(labels: readonly string[], width: number, hasHw: boolean): ChipLayout {
  if (width <= 0) return 'inline';
  const needed = labels.reduce((sum, l) => sum + entryWidth(l, hasHw), 0)
    + ENTRY_GAP_PX * Math.max(0, labels.length - 1) + CONTROLS_PX + CHIP_PADDING_PX;
  return needed <= width ? 'inline' : 'rows';
}
