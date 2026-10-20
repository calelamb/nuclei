export const MIN_SPHERE_PX = 112;
/** Smallest sphere allowed so that a handful of qubits stay on screen together. */
export const COMPACT_SPHERE_PX = 72;
const COMPACT_MAX_COUNT = 8;
const SIZE_STEPS = [112, 96, 84, COMPACT_SPHERE_PX];
export const MAX_SPHERES_PER_PAGE = 8;
/** Space under each sphere for its qubit label and readout. */
export const CELL_CAPTION_PX = 36;
const GAP_PX = 8;
/** When the qubits must page anyway, shrink spheres only until a page holds this many. */
const MIN_PAGE_TILES_WHEN_PAGED = 4;
const MAX_CELL_ASPECT = 1.15;
/** A narrower grid must grow the spheres by this factor to be worth the change. */
const ROOMIER_GAIN = 1.25;

export interface BlochGridInput {
  count: number;
  width: number;
  height: number;
}

export interface BlochGridLayout {
  cols: number;
  rows: number;
  /** How many spheres are shown at once. */
  pageSize: number;
  pageCount: number;
  cellWidth: number;
  cellHeight: number;
}

/**
 * Pick a grid that keeps every sphere at least MIN_SPHERE_PX wide and tall,
 * never more than MAX_SPHERES_PER_PAGE at once. More qubits than fit become pages.
 */
export function blochGridLayout({ count, width, height }: BlochGridInput): BlochGridLayout {
  const safeCount = Math.max(1, Math.floor(count));
  // Up to a page of qubits should never page: shrink the spheres first, page only as a last resort.
  const wanted = Math.min(safeCount, MIN_PAGE_TILES_WHEN_PAGED);
  const fitting = SIZE_STEPS.find((px) => capacityFor(px, width, height) >= (safeCount <= COMPACT_MAX_COUNT ? safeCount : wanted));
  return layoutFor(safeCount, fitting ?? MIN_SPHERE_PX, width, height);
}

function capacityFor(minPx: number, width: number, height: number): number {
  const maxCols = Math.max(1, Math.floor((width + GAP_PX) / (minPx + GAP_PX)));
  const maxRows = Math.max(1, Math.floor((height + GAP_PX) / (minPx + CELL_CAPTION_PX + GAP_PX)));
  return Math.min(MAX_SPHERES_PER_PAGE, maxCols * maxRows);
}

function layoutFor(safeCount: number, minPx: number, width: number, height: number): BlochGridLayout {
  const maxCols = Math.max(1, Math.floor((width + GAP_PX) / (minPx + GAP_PX)));
  const capacity = Math.min(safeCount, capacityFor(minPx, width, height));
  // Pages share the qubits evenly (6 in pages of 5 would leave a lone sphere on page 2: use 3 + 3).
  const pageCount = Math.ceil(safeCount / capacity);
  const pageSize = Math.ceil(safeCount / pageCount);
  // Prefer a single row while it fits, otherwise fill columns first, then even the rows out so
  // four spheres in a three-column rail form 2x2, not 3 + 1.
  const rows = Math.ceil(pageSize / Math.min(maxCols, pageSize));
  const base = gridFor(Math.ceil(pageSize / rows), pageSize, pageCount, width, height);
  return roomierGrid(base, pageSize, pageCount, width, height);
}

function gridFor(cols: number, pageSize: number, pageCount: number, width: number, height: number): BlochGridLayout {
  const rows = Math.ceil(pageSize / cols);
  const cellWidth = Math.floor((width - GAP_PX * (cols - 1)) / cols);
  const available = Math.floor((height - GAP_PX * (rows - 1)) / rows);
  // A cell much taller than it is wide only adds dead space around a width-limited sphere.
  const cellHeight = Math.min(available, Math.ceil(cellWidth * MAX_CELL_ASPECT) + CELL_CAPTION_PX);
  return { cols, rows, pageSize, pageCount, cellWidth, cellHeight };
}

function sphereSize(g: BlochGridLayout): number {
  return Math.min(g.cellWidth, g.cellHeight - CELL_CAPTION_PX);
}

/**
 * When a few spheres leave the box mostly empty (two qubits in a tall rail), fewer columns give each a
 * clearly bigger sphere. Only a decisive gain wins, so ordinary grids keep their shape.
 */
function roomierGrid(base: BlochGridLayout, pageSize: number, pageCount: number, width: number, height: number): BlochGridLayout {
  let best = base;
  for (let cols = base.cols - 1; cols >= 1; cols -= 1) {
    const candidate = gridFor(cols, pageSize, pageCount, width, height);
    if (sphereSize(candidate) >= MIN_SPHERE_PX && sphereSize(candidate) >= sphereSize(best) * ROOMIER_GAIN) best = candidate;
  }
  return best;
}
