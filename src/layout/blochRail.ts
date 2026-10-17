import { blochGridLayout } from '../lib/blochGrid';

/** Sizing for the Bloch spheres in the right rail: a wrapping grid that paginates, never a sideways scroll strip. */
const STAGE_PAD_PX = 16;
const GAP_PX = 8;
const PAGER_PX = 32;
/** The most qubits the rail aims to show at once (a 2-column rail makes this a 3x2 grid). */
export const BLOCH_TARGET_VISIBLE = 6;
/** When the qubits page anyway, the rail only asks for a 2x2 page so the circuit keeps its room. */
const BLOCH_PAGED_VISIBLE = 4;
/** A comfortable tile: a readable sphere plus its caption. Taller adds only dead space. */
export const BLOCH_ROW_MAX_PX = 170;
/** One row of the smallest allowed sphere (112px) plus its 36px caption. */
export const BLOCH_ROW_MIN_PX = 148;
const FALLBACK_RAIL_WIDTH = 316;

export interface BlochRailHeights {
  /** Height that fits up to BLOCH_TARGET_VISIBLE tiles at their comfortable size. */
  desired: number;
  /** The shortest the rail may shrink to: one full row, so spheres are never drawn as slivers. */
  min: number;
}

/**
 * How tall the rail wants to be for `count` qubits at `width`: enough rows for up to six tiles
 * (so six qubits form a 3x2 grid in a narrow rail). When the column is shorter the rail
 * shrinks toward `min` and the panel pages with its pager instead of shrinking the tiles.
 */
export function blochRailHeights(count: number, width: number): BlochRailHeights {
  const n = Math.max(1, Math.floor(count));
  const usable = Math.max(0, (width > 0 ? width : FALLBACK_RAIL_WIDTH) - STAGE_PAD_PX);
  const shown = n > BLOCH_TARGET_VISIBLE ? BLOCH_PAGED_VISIBLE : n;
  const probe = blochGridLayout({ count: shown, width: usable, height: 10_000 });
  const rows = Math.ceil(shown / probe.cols);
  const row = Math.min(probe.cellHeight, BLOCH_ROW_MAX_PX);
  const pager = n > shown || probe.pageCount > 1 ? PAGER_PX : 0;
  return {
    desired: rows * row + (rows - 1) * GAP_PX + STAGE_PAD_PX + pager,
    min: BLOCH_ROW_MIN_PX + STAGE_PAD_PX + (pagesAtMin(n, usable) ? PAGER_PX : 0),
  };
}

/** Whether `n` qubits would need a pager if the rail were squeezed to its one-row minimum. */
function pagesAtMin(n: number, usableWidth: number): boolean {
  return blochGridLayout({ count: n, width: usableWidth, height: BLOCH_ROW_MIN_PX }).pageCount > 1;
}

/**
 * The height the grid will actually occupy inside a rail of `height` x `width`: the same layout
 * BlochPanel computes, plus the stage inset and (when the qubits page) the pager. Never more than `height`.
 */
export function blochRailUsedHeight(count: number, width: number, height: number): number {
  const n = Math.max(1, Math.floor(count));
  const gridWidth = Math.max(0, width - STAGE_PAD_PX);
  const unpaged = blochGridLayout({ count: n, width: gridWidth, height: Math.max(0, height - STAGE_PAD_PX) });
  const paged = unpaged.pageCount > 1;
  const layout = paged
    ? blochGridLayout({ count: n, width: gridWidth, height: Math.max(0, height - STAGE_PAD_PX - PAGER_PX) })
    : unpaged;
  const grid = layout.rows * layout.cellHeight + (layout.rows - 1) * GAP_PX;
  return Math.min(height, grid + STAGE_PAD_PX + (paged ? PAGER_PX : 0));
}
