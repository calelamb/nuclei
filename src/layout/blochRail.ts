/** Sizing for the Bloch spheres inside the narrow right rail. */
export const BLOCH_CARD_MIN = 150;
export const BLOCH_CARD_MAX = 260;
const BLOCH_GAP = 6;
const BLOCH_PAD_X = 20;
const BLOCH_PAD_Y = 22;

/**
 * Width of one Bloch card in a single row of `count`: it shares the rail width
 * but never shrinks below a readable sphere or grows past a comfortable one.
 * Expressed in container units so it follows the rail as it is dragged.
 */
export function blochCardWidthCss(count: number): string {
  const n = Math.max(1, Math.floor(count));
  const share = `(100cqw - ${BLOCH_PAD_X}px - ${BLOCH_GAP * (n - 1)}px) / ${n}`;
  return `clamp(${BLOCH_CARD_MIN}px, ${share}, ${BLOCH_CARD_MAX}px)`;
}

export interface BlochRailSizes {
  width: string;
  height: string;
}

/** Each card stays square so the sphere is never cropped; many qubits scroll sideways. */
export function blochRailSizes(count: number): BlochRailSizes {
  const n = Math.max(1, Math.floor(count));
  const card = blochCardWidthCss(n);
  return {
    width: `calc(${card} * ${n} + ${BLOCH_GAP * (n - 1) + BLOCH_PAD_X}px)`,
    height: `calc(${card} + ${BLOCH_PAD_Y}px)`,
  };
}
