import type { ExpressibilityResult } from '../../../types/trainability';

type Bin = ExpressibilityResult['histogram'][number];

/** Fraction of the tallest bin below which a bin counts as empty when zooming. */
const NEGLIGIBLE = 0.005;

/**
 * Fidelity histograms of an expressive circuit pile up near F = 0 (the Haar
 * density is (1 − F)^(d − 2)), so on a [0, 1] axis the data sits in the first
 * few percent. Zoom to the bins that carry mass, with a little headroom.
 * Returns the full [0, 1] range when nothing is negligible.
 */
export function zoomedFidelityDomain(histogram: readonly Bin[]): [number, number] {
  if (histogram.length === 0) return [0, 1];
  const peak = Math.max(...histogram.flatMap((b) => [b.observed, b.haar]), 0);
  if (!(peak > 0)) return [0, 1];
  let last = -1;
  histogram.forEach((b, i) => {
    if (Math.max(b.observed, b.haar) > peak * NEGLIGIBLE) last = i;
  });
  if (last < 0) return [0, 1];
  const hi = histogram[Math.min(histogram.length - 1, last + 1)].hi;
  return [0, Math.min(1, Math.max(hi, histogram[0].hi))];
}

export function isFullRange(domain: readonly [number, number]): boolean {
  return domain[0] <= 0 && domain[1] >= 1;
}
