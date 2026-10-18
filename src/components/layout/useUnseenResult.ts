import { useEffect, useState } from 'react';

/**
 * True when a result landed while the results column was folded away behind a rail tab, and the
 * student has not opened the column since. Clears itself as soon as the tab goes away.
 */
export function useUnseenResult(result: unknown, columnFolded: boolean): boolean {
  const [seen, setSeen] = useState<unknown>(result);
  useEffect(() => {
    if (!columnFolded) setSeen(result);
  }, [columnFolded, result]);
  return columnFolded && result != null && result !== seen;
}
