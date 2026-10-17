/**
 * CSV export of logical error rates exactly as the figure shows them: the
 * same sinter likelihood-ratio interval, on shots - discards, in the chosen
 * units, with the provenance (units, CI method, factor) on every row so a
 * file taken out of the app stays self-describing. `decoder` is the decoder
 * as written in the source file; `series` is the (group-by decorated) name the
 * figure used, so a re-import sees the original decoder.
 */
import type { QecCampaignStatsRow } from '../types/qec';
import { assignExperiments } from './qecExperiments';
import { roundForExport } from './qecPlotFormat';
import {
  DEFAULT_MAX_LIKELIHOOD_FACTOR, roundsFromMetadata, rowProblem, rowRate, type RateUnits,
} from './qecFit';

export const QEC_RATES_CSV_COLUMNS = [
  'experiment', 'distance', 'noise', 'decoder', 'series', 'rounds', 'shots', 'discards', 'kept_shots', 'errors',
  'rate', 'rate_low', 'rate_high', 'units', 'ci_method', 'max_likelihood_factor', 'note',
  'strong_id', 'json_metadata', 'custom_counts',
] as const;

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const metaNum = (meta: unknown, key: string): number | '' => {
  const v = (meta as Record<string, unknown> | null)?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? roundForExport(v) : '';
};

const NOTES = { invalid: 'invalid: errors exceed kept shots', no_kept: 'no kept shots' } as const;

export interface QecRatesCsvOptions {
  units?: RateUnits;
  maxLikelihoodFactor?: number;
  /** Rows as they were in the source file, by strong_id. When a CSV mapping
   * re-expressed the plotted rows, provenance columns come from these so the
   * exported json_metadata is exactly what the file said. */
  originals?: ReadonlyMap<string, QecCampaignStatsRow>;
}

const jsonCell = (v: unknown): string => JSON.stringify(v ?? null);

export function qecRatesToCsv(rows: readonly QecCampaignStatsRow[], opts: QecRatesCsvOptions = {}): string {
  const factor = opts.maxLikelihoodFactor ?? DEFAULT_MAX_LIKELIHOOD_FACTOR;
  const experiments = assignExperiments(rows);
  const lines = rows.map((row) => {
    const discards = row.discards || 0;
    const problem = rowProblem(row);
    const source = opts.originals?.get(row.strong_id) ?? row;
    const provenance = [row.strong_id, jsonCell(source.json_metadata), jsonCell(source.custom_counts ?? {})];
    const common = [
      experiments.get(row)?.name, metaNum(row.json_metadata, 'd'), metaNum(row.json_metadata, 'p'), source.decoder, row.decoder,
      roundsFromMetadata(row.json_metadata), row.shots, discards, row.shots - discards, row.errors,
    ];
    if (problem) {
      return [...common, '', '', '', '', '', '', NOTES[problem], ...provenance].map(csvCell).join(',');
    }
    const { fit, units } = rowRate(row, { units: opts.units, maxLikelihoodFactor: factor });
    const note = opts.units === 'per_round' && units === 'per_shot' ? 'rounds unknown: per-shot rate' : '';
    return [...common, roundForExport(fit.best), roundForExport(fit.low), roundForExport(fit.high), units, 'likelihood_ratio', factor, note, ...provenance].map(csvCell).join(',');
  });
  return [QEC_RATES_CSV_COLUMNS.join(','), ...lines].join('\n') + '\n';
}
