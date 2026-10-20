import { ROW_HEIGHT } from './RunsTableRow';

export type RowNavKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'PageDown' | 'PageUp';

export const ROW_NAV_KEYS: ReadonlySet<string> = new Set<RowNavKey>(['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']);

/** Row index a navigation key lands on, clamped to the list. */
export function nextRowIndex(key: string, current: number, count: number, pageSize: number): number {
  if (count === 0) return -1;
  const last = count - 1;
  switch (key) {
    case 'ArrowDown': return Math.min(last, current + 1);
    case 'ArrowUp': return Math.max(0, current - 1);
    case 'Home': return 0;
    case 'End': return last;
    case 'PageDown': return Math.min(last, current + pageSize);
    case 'PageUp': return Math.max(0, current - pageSize);
    default: return current;
  }
}

/**
 * Scroll offset that brings row `index` fully into view below the sticky
 * header, or the current offset when it already is.
 */
export function scrollTopToReveal(
  index: number, scrollTop: number, viewportHeight: number, headerHeight: number,
): number {
  const rowTop = headerHeight + index * ROW_HEIGHT;
  if (rowTop < scrollTop + headerHeight) return Math.max(0, rowTop - headerHeight);
  if (rowTop + ROW_HEIGHT > scrollTop + viewportHeight) return rowTop + ROW_HEIGHT - viewportHeight;
  return scrollTop;
}
