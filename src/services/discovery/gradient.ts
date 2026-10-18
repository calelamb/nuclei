/**
 * Addendum §C helpers: the trusted evaluator's per-line gradient map, and the
 * measurable "did this edit touch a flagged line" statistic.
 */

import type { GradientMap, GradientMapLine } from '../../types/discovery';
import type { EditSpan } from './diff';

export function deadGradientLines(map: GradientMap | null | undefined): GradientMapLine[] {
  return (map?.lines ?? []).filter((line) => line.dead);
}

/** Number of distinct dead lines of the parent's map that fall inside any edit span. */
export function countTouchedDeadLines(spans: readonly EditSpan[], map: GradientMap | null | undefined): number {
  const dead = new Set(deadGradientLines(map).map((line) => line.line));
  let touched = 0;
  for (const line of dead) {
    if (spans.some((span) => line >= span.startLine && line <= span.endLine)) touched += 1;
  }
  return touched;
}
