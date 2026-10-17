/** Alpha suffix for the mode chip's tinted fill. Kept faint so the 11px label stays AA on it. */
export const MODE_CHIP_TINT_ALPHA = 0.02;

export function modeChipTint(accent: string): string {
  const alpha = Math.round(MODE_CHIP_TINT_ALPHA * 255).toString(16).padStart(2, '0');
  return `${accent}${alpha}`;
}
