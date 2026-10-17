export const MIN_SPHERE_PX = 112;
export const MAX_SPHERES_PER_PAGE = 8;
/** Space under each sphere for its qubit label and readout. */
export const CELL_CAPTION_PX = 36;
const GAP_PX = 8;
const MAX_CELL_ASPECT = 1.45;

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
  const maxCols = Math.max(1, Math.floor((width + GAP_PX) / (MIN_SPHERE_PX + GAP_PX)));
  const maxRows = Math.max(1, Math.floor((height + GAP_PX) / (MIN_SPHERE_PX + CELL_CAPTION_PX + GAP_PX)));
  const capacity = Math.min(MAX_SPHERES_PER_PAGE, maxCols * maxRows);
  const pageSize = Math.min(safeCount, capacity);
  // Prefer a single row while it fits, otherwise fill columns first.
  const cols = Math.min(maxCols, pageSize);
  const rows = Math.ceil(pageSize / cols);
  const cellWidth = Math.floor((width - GAP_PX * (cols - 1)) / cols);
  const available = Math.floor((height - GAP_PX * (rows - 1)) / rows);
  // A cell much taller than it is wide only adds dead space around a width-limited sphere.
  const cellHeight = Math.min(available, Math.ceil(cellWidth * MAX_CELL_ASPECT) + CELL_CAPTION_PX);
  return {
    cols,
    rows,
    pageSize,
    pageCount: Math.ceil(safeCount / pageSize),
    cellWidth,
    cellHeight,
  };
}
