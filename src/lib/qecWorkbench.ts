/**
 * Decoder comparison table for the workbench: one row per point
 * (experiment, decoder, d, p), never pooled across p, d or experiments, with
 * the same discard-aware rate and sinter likelihood interval as the figure.
 */
import type { QecCampaignStatsRow } from '../types/qec';
import { assignExperiments } from './qecExperiments';
import { DEFAULT_MAX_LIKELIHOOD_FACTOR, rowProblem, rowRate } from './qecFit';

export interface DecoderComparisonRow {
  experiment: string;
  decoder: string;
  distance: number | null;
  noise: number | null;
  shots: number;
  discards: number;
  /** shots - discards, the denominator of the rate. */
  kept: number;
  errors: number;
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

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function decoderComparison(
  rows: readonly QecCampaignStatsRow[],
  opts: { maxLikelihoodFactor?: number } = {},
): DecoderComparison {
  const factor = opts.maxLikelihoodFactor ?? DEFAULT_MAX_LIKELIHOOD_FACTOR;
  const experiments = assignExperiments(rows);
  const cells = new Map<string, { row: QecCampaignStatsRow; shots: number; discards: number; errors: number; seconds: number }>();
  let skipped = 0;
  for (const row of rows) {
    if (rowProblem(row) !== null) { skipped += 1; continue; }
    const md = (row.json_metadata ?? {}) as Record<string, unknown>;
    const key = JSON.stringify([experiments.get(row)!.key, row.decoder, num(md.d), num(md.p)]);
    const c = cells.get(key) ?? { row, shots: 0, discards: 0, errors: 0, seconds: 0 };
    cells.set(key, {
      row: c.row, shots: c.shots + row.shots, discards: c.discards + (row.discards || 0),
      errors: c.errors + row.errors, seconds: c.seconds + row.seconds,
    });
  }
  const out = [...cells.values()].map((c): DecoderComparisonRow => {
    const md = (c.row.json_metadata ?? {}) as Record<string, unknown>;
    const { fit, kept } = rowRate({ ...c.row, shots: c.shots, discards: c.discards, errors: c.errors }, { maxLikelihoodFactor: factor });
    return {
      experiment: experiments.get(c.row)!.name, decoder: c.row.decoder, distance: num(md.d), noise: num(md.p),
      shots: c.shots, discards: c.discards, kept, errors: c.errors,
      rate: { p: fit.best, lo: fit.low, hi: fit.high },
      secondsPerShot: c.shots > 0 ? c.seconds / c.shots : 0,
    };
  });
  out.sort((a, b) =>
    a.experiment.localeCompare(b.experiment) || (a.noise ?? 0) - (b.noise ?? 0)
    || (a.distance ?? 0) - (b.distance ?? 0) || a.decoder.localeCompare(b.decoder));
  return { rows: out, skipped, maxLikelihoodFactor: factor };
}
