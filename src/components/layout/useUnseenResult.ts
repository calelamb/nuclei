import { useState } from 'react';

/**
 * True when a result landed while the results column was folded away behind a rail tab, and the
 * student has not opened the column since. Clears itself as soon as the tab goes away.
 */
export function useUnseenResult(result: unknown, columnFolded: boolean): boolean {
  const [seen, setSeen] = useState<unknown>(result);
  // While the column is on screen every result counts as seen (derived during render, not in an effect).
  if (!columnFolded && seen !== result) setSeen(result);
  return columnFolded && result != null && result !== seen;
}
