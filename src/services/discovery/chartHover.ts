/** Nearest-point lookup in plot space for chart hover and click-through. */
export function nearestPoint<T>(
  items: readonly T[],
  px: number,
  py: number,
  position: (item: T) => readonly [number, number],
  radius = 14,
): T | null {
  let best: T | null = null;
  let bestDistance = radius * radius;
  for (const item of items) {
    const [x, y] = position(item);
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d <= bestDistance) {
      best = item;
      bestDistance = d;
    }
  }
  return best;
}
