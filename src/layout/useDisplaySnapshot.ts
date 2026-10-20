import { useMemo } from 'react';
import { BUFFER_KEY, selectDisplaySnapshot, useCircuitStore, type DisplaySnapshot } from '../stores/circuitStore';
import { useProjectStore } from '../stores/projectStore';

/**
 * The circuit the viz column should show for the active file: the live parse, or the
 * last good one (flagged `stale`) while the current code has a transient syntax error.
 * Keeps the column mounted so the editor does not jump width mid-keystroke.
 */
export function useDisplaySnapshot(): DisplaySnapshot {
  const snapshot = useCircuitStore((s) => s.snapshot);
  const lastGood = useCircuitStore((s) => s.lastGood);
  const key = useProjectStore((s) => s.activeTabPath) ?? BUFFER_KEY;
  return useMemo(() => selectDisplaySnapshot({ snapshot, lastGood }, key), [snapshot, lastGood, key]);
}
