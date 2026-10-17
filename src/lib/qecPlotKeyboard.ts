/** Keyboard navigation over the plot's points (qec-18). */
export interface NavTarget {
  seriesKey: string;
  x: number;
}

/** Targets grouped by series (first-appearance order), each sorted left to right. */
function bySeries<T extends NavTarget>(targets: readonly T[]): number[][] {
  const groups = new Map<string, number[]>();
  targets.forEach((t, i) => groups.set(t.seriesKey, [...(groups.get(t.seriesKey) ?? []), i]));
  return [...groups.values()].map((g) => [...g].sort((a, b) => targets[a].x - targets[b].x));
}

/**
 * Index of the point to focus after `key`, or null when there is nothing to
 * focus. Left/Right walk along a series, Up/Down hop to the neighbouring
 * series at the nearest x, Home/End jump to the series' ends.
 */
export function nextTargetIndex<T extends NavTarget>(
  targets: readonly T[], current: number | null, key: string,
): number | null {
  if (targets.length === 0) return null;
  const groups = bySeries(targets);
  if (current === null || current < 0 || current >= targets.length) return groups[0][0];
  const gi = groups.findIndex((g) => g.includes(current));
  const group = groups[gi];
  const pos = group.indexOf(current);
  switch (key) {
    case 'ArrowRight': return group[Math.min(group.length - 1, pos + 1)];
    case 'ArrowLeft': return group[Math.max(0, pos - 1)];
    case 'Home': return group[0];
    case 'End': return group[group.length - 1];
    case 'ArrowUp':
    case 'ArrowDown': {
      const other = groups[gi + (key === 'ArrowDown' ? 1 : -1)];
      if (!other) return current;
      const x = targets[current].x;
      return other.reduce((best, i) => (Math.abs(targets[i].x - x) < Math.abs(targets[best].x - x) ? i : best), other[0]);
    }
    default: return current;
  }
}
