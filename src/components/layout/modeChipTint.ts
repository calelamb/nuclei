/** Alpha suffix for the mode chip's tinted fill. Kept faint so the 11px label stays AA on it. */
export const MODE_CHIP_TINT_ALPHA = 0.02;

/** The fill on hover (a ring in modeChip.css carries most of the change): as high as the 11px label allows that the 11px label stays AA (see the test). */
export const MODE_CHIP_HOVER_ALPHA = 0.03;

function withAlpha(accent: string, alpha: number): string {
  return `${accent}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

export function modeChipTint(accent: string): string {
  return withAlpha(accent, MODE_CHIP_TINT_ALPHA);
}

export function modeChipHoverTint(accent: string): string {
  return withAlpha(accent, MODE_CHIP_HOVER_ALPHA);
}
