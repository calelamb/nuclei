/**
 * Decoder comparison table for the workbench: one row per point
 * (experiment, decoder, d, p, task), never pooled across p, d, experiments or
 * distinct tasks (e.g. postselected vs not), with
 * the same discard-aware rate and sinter likelihood interval as the figure.
 */
import type { QecCampaignStatsRow } from '../types/qec';
import { MAPPED_KEY } from '../types/sinterMapping';
import { assignExperiments } from './qecExperiments';
import { DEFAULT_MAX_LIKELIHOOD_FACTOR, rowProblem, rowRate } from './qecFit';

export interface DecoderComparisonRow {
  experiment: string;
  /** Distinguishing experiment metadata (rounds scheme + non-sweep metadata keys). */
  context: string;
  decoder: string;
  distance: number | null;
  noise: number | null;
  shots: number;
  discards: number;
  /** shots - discards, the denominator of the rate. */
  kept: number;
  errors: number;
  /** Task identity (sinter strong_id): tasks sharing metadata are shown separately, never summed. */
  strongId: string;
  /** True when another task shares this row's (experiment, decoder, d, p) cell. */
  collides: boolean;
  rate: { p: number; lo: number; hi: number };
  /** Wall-seconds per shot (sinter timing, all shots including discards). */
  secondsPerShot: number;
}

export interface DecoderComparison {
  rows: DecoderComparisonRow[];
  /** Malformed or fully-discarded rows left out. */
  skipped: number;
  maxLikelihoodFactor: number;
}

const CONTEXT_SKIP = new Set(['d', 'p', 'r', 'rounds', 'label', 'decoder', MAPPED_KEY]);

const scalar = (v: unknown): string | null =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : null;

/** Human text for the experiment: rounds scheme, then the metadata that is not a sweep axis. */
function experimentContext(md: Record<string, unknown>, roundsTag: string, name: string, derived: ReadonlySet<string>): string {
  const parts = [
    ...(roundsTag ? [roundsTag.replace(/^r=/, 'rounds = ')] : []),
    ...Object.keys(md).filter((k) => !CONTEXT_SKIP.has(k) && !derived.has(k)).sort().flatMap((k) => {
      const v = scalar(md[k]);
      return v === null ? [] : [`${k}=${v}`];
    }),
  ];
  return parts.length > 0 ? parts.join(' · ') : name;
}

/** Numeric metadata keys that are a function of d across all rows (e.g. qubit
 * count) and vary: they restate the distance axis, not a distinct experiment. */
function distanceDerivedKeys(rows: readonly QecCampaignStatsRow[]): Set<string> {
  const byKey = new Map<string, Map<number, Set<unknown>>>();
  const disqualified = new Set<string>();
  for (const row of rows) {
    const md = (row.json_metadata ?? {}) as Record<string, unknown>;
    const d = num(md.d);
    for (const [k, v] of Object.entries(md)) {
      if (CONTEXT_SKIP.has(k)) continue;
      if (d === null || typeof v !== 'number') { disqualified.add(k); continue; }
      const perD = byKey.get(k) ?? new Map<number, Set<unknown>>();
      perD.set(d, (perD.get(d) ?? new Set<unknown>()).add(v));
      byKey.set(k, perD);
    }
  }
  return new Set([...byKey].filter(([k, perD]) =>
    !disqualified.has(k) && perD.size > 1 && [...perD.values()].every((vs) => vs.size === 1)).map(([k]) => k));
}

/** Seconds per shot with units (ns / µs / ms / s), three significant digits. */
export function formatSecondsPerShot(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const units: Array<[number, string]> = [[1, 's'], [1e-3, 'ms'], [1e-6, 'µs'], [1e-9, 'ns']];
  const [scale, unit] = units.find(([s]) => seconds >= s * 0.9995) ?? units[units.length - 1];
  return `${Number((seconds / scale).toPrecision(3))} ${unit}`;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function decoderComparison(
  rows: readonly QecCampaignStatsRow[],
  opts: { maxLikelihoodFactor?: number } = {},
): DecoderComparison {
  const factor = opts.maxLikelihoodFactor ?? DEFAULT_MAX_LIKELIHOOD_FACTOR;
  const experiments = assignExperiments(rows);
  const derived = distanceDerivedKeys(rows);
  const cells = new Map<string, { row: QecCampaignStatsRow; shots: number; discards: number; errors: number; seconds: number }>();
  let skipped = 0;
  for (const row of rows) {
    if (rowProblem(row) !== null) { skipped += 1; continue; }
    const md = (row.json_metadata ?? {}) as Record<string, unknown>;
    const key = JSON.stringify([experiments.get(row)!.key, row.decoder, num(md.d), num(md.p), row.strong_id]);
    const c = cells.get(key) ?? { row, shots: 0, discards: 0, errors: 0, seconds: 0 };
    cells.set(key, {
      row: c.row, shots: c.shots + row.shots, discards: c.discards + (row.discards || 0),
      errors: c.errors + row.errors, seconds: c.seconds + row.seconds,
    });
  }
  const siblings = new Map<string, number>();
  for (const [key] of cells) {
    const cell = (JSON.parse(key) as unknown[]).slice(0, 4).join('\u0000');
    siblings.set(cell, (siblings.get(cell) ?? 0) + 1);
  }
  const out = [...cells.entries()].map(([key, c]): DecoderComparisonRow => {
    const md = (c.row.json_metadata ?? {}) as Record<string, unknown>;
    const { fit, kept } = rowRate({ ...c.row, shots: c.shots, discards: c.discards, errors: c.errors }, { maxLikelihoodFactor: factor });
    return {
      experiment: experiments.get(c.row)!.name,
      context: experimentContext(md, experiments.get(c.row)!.roundsTag, experiments.get(c.row)!.name, derived),
      decoder: c.row.decoder, distance: num(md.d), noise: num(md.p),
      shots: c.shots, discards: c.discards, kept, errors: c.errors,
      strongId: c.row.strong_id,
      collides: (siblings.get((JSON.parse(key) as unknown[]).slice(0, 4).join('\u0000')) ?? 0) > 1,
      rate: { p: fit.best, lo: fit.low, hi: fit.high },
      secondsPerShot: c.shots > 0 ? c.seconds / c.shots : 0,
    };
  });
  out.sort((a, b) =>
    a.experiment.localeCompare(b.experiment) || (a.noise ?? 0) - (b.noise ?? 0)
    || (a.distance ?? 0) - (b.distance ?? 0) || a.decoder.localeCompare(b.decoder) || a.strongId.localeCompare(b.strongId));
  return { rows: out, skipped, maxLikelihoodFactor: factor };
}
