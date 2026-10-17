import type { RunRecord } from '../types/experiment';

/**
 * PRD 09 Phase E (E2) — the "money shot": binning runs into plottable
 * metric-vs-parameter series. Pure, no d3/React — `SweepPlot.tsx` renders
 * the output, this module owns the correctness-critical data shaping.
 *
 * Only `status: "complete"` runs are usable — a failed or stale point has no
 * trustworthy metric value, so it's skipped rather than plotted as zero
 * (which would silently distort the curve). A run missing the requested X
 * param or Y metric (unknown name, or a run whose grid didn't sweep it) is
 * skipped the same way, point by point, so one bad run never breaks the
 * rest of the line.
 */

export interface SweepPoint {
  x: number;
  y: number;
  /** Run directory id — lets the UI cross-reference a plotted point back to
   * its run (e.g. for a tooltip or click-through to RunDetail). */
  dir: string;
}

export interface SweepSeries {
  /** Group-parameter value as its original string form, or `null` for the
   * ungrouped (1-D) case. */
  group: string | null;
  /** Points sorted ascending by `x`. */
  points: SweepPoint[];
}

function numericParam(run: RunRecord, name: string): number | null {
  const value = run.manifest.params[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metricValue(run: RunRecord, name: string): number | null {
  const value = run.metrics[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function byX(a: SweepPoint, b: SweepPoint): number {
  return a.x - b.x;
}

/**
 * Bin runs into one or more (x, y) series.
 *
 * - No `groupParam`: a single series over every usable run (1-D sweep, or a
 *   2-D+ grid the caller isn't grouping).
 * - With `groupParam`: one series per distinct group-parameter value,
 *   sorted by that value ascending (numeric compare — group values are
 *   always sweep parameters, hence numeric).
 *
 * An unknown `xParam`/`yMetric`/`groupParam` (not present on any run) simply
 * yields no usable points for that dimension, so the result degrades to an
 * empty series (1-D) or no series at all (grouped) rather than throwing —
 * consistent with the runner's "never crash on a run directory" contract.
 */
export function buildSweepSeries(
  runs: readonly RunRecord[],
  xParam: string,
  yMetric: string,
  groupParam?: string,
): SweepSeries[] {
  const usable = runs.filter((r) => r.manifest.status === 'complete');

  if (!groupParam) {
    const points: SweepPoint[] = [];
    for (const run of usable) {
      const x = numericParam(run, xParam);
      const y = metricValue(run, yMetric);
      if (x === null || y === null) continue;
      points.push({ x, y, dir: run.dir });
    }
    points.sort(byX);
    return [{ group: null, points }];
  }

  const byGroup = new Map<string, SweepPoint[]>();
  for (const run of usable) {
    const x = numericParam(run, xParam);
    const y = metricValue(run, yMetric);
    const g = numericParam(run, groupParam);
    if (x === null || y === null || g === null) continue;
    const key = String(g);
    const bucket = byGroup.get(key);
    if (bucket) {
      bucket.push({ x, y, dir: run.dir });
    } else {
      byGroup.set(key, [{ x, y, dir: run.dir }]);
    }
  }

  const sortedKeys = [...byGroup.keys()].sort((a, b) => Number(a) - Number(b));
  return sortedKeys.map((key) => ({
    group: key,
    points: byGroup.get(key)!.slice().sort(byX),
  }));
}

/** True when two points share an x — a line through them would zig-zag. */
export function hasRepeatedX(points: readonly SweepPoint[]): boolean {
  const seen = new Set<number>();
  for (const p of points) {
    if (seen.has(p.x)) return true;
    seen.add(p.x);
  }
  return false;
}

export interface FailedMarker {
  x: number;
  dir: string;
}

/**
 * Failed runs keyed by group value (`''` when ungrouped), so the plot can
 * mark them rather than silently bridging the gap with a straight line.
 */
export function findFailedMarkers(
  runs: readonly RunRecord[],
  xParam: string,
  groupParam?: string,
): Map<string, FailedMarker[]> {
  const markers = new Map<string, FailedMarker[]>();
  for (const run of runs) {
    if (run.manifest.status !== 'failed') continue;
    const x = numericParam(run, xParam);
    if (x === null) continue;
    let key = '';
    if (groupParam) {
      const g = numericParam(run, groupParam);
      if (g === null) continue;
      key = String(g);
    }
    markers.set(key, [...(markers.get(key) ?? []), { x, dir: run.dir }]);
  }
  return markers;
}

/** Split an x-sorted line into segments wherever a failed x falls between points. */
export function splitAtFailures(
  points: readonly SweepPoint[],
  failedXs: readonly number[],
): SweepPoint[][] {
  if (points.length === 0) return [];
  const segments: SweepPoint[][] = [[points[0]]];
  for (let i = 1; i < points.length; i += 1) {
    const [a, b] = [points[i - 1].x, points[i].x];
    const broken = failedXs.some((fx) => fx > a && fx < b);
    if (broken) segments.push([points[i]]);
    else segments[segments.length - 1] = [...segments[segments.length - 1], points[i]];
  }
  return segments;
}

const DERIVED_METRIC = /^(counts_|top_state)/;

/** Default Y metric: the first user-defined metric, falling back to derived count stats. */
export function pickDefaultMetric(metricNames: readonly string[]): string {
  return metricNames.find((m) => !DERIVED_METRIC.test(m)) ?? metricNames[0] ?? '';
}
