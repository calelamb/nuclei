import { MIN_LAMBDA_DISTANCES, rowProblem, rowRate, type LambdaGroupEstimate, type RateUnits } from './qecFit';
import type { QecCampaignStatsRow } from '../types/qec';
import { assignExperiments } from './qecExperiments';
import { lambdaCaveats } from './qecLambdaText';
import { experimentNames } from './qecExperimentName';
import { formatLambda, formatNoise } from './qecPlotFormat';

/** A decoder's table shows this many rows before the rest sit behind "Show all". */
export const LAMBDA_ROW_LIMIT = 8;

export interface LambdaRowView {
  /** p as text, e.g. "3.6×10⁻⁴". */
  p: string;
  noise: number;
  /** Λ as a number, for range summaries. */
  lambdaValue: number;
  lambda: string;
  /** "4.74–8.09", or null when the interval is not meaningful. */
  ci: string | null;
  rSquared: string;
  meaningful: boolean;
  /** Experiment name, set only when more than one experiment is in the table. */
  experiment: string | null;
  /** Every caveat for this row (fit quality, collisions, dropped points). */
  flags: string[];
}

export interface LambdaCollapsed {
  rows: LambdaRowView[];
  summary: string;
}

export interface LambdaDecoderGroup {
  decoder: string;
  rows: LambdaRowView[];
  collapsed: LambdaCollapsed | null;
}

export interface LambdaTableView {
  subtitle: string;
  groups: LambdaDecoderGroup[];
  /** Distinct caveats shared across rows, one line each. */
  notes: string[];
}

function shortReason(warning: string): string {
  if (/^saturated/.test(warning)) return 'saturated';
  if (/^Λ ≤ 1/.test(warning)) return 'above threshold';
  if (/interval includes 1/.test(warning)) return 'not established';
  if (/^r²/.test(warning)) return 'poor linear fit';
  return warning.split(/[:;]/)[0];
}

function distanceList(dropped: readonly number[]): string {
  return dropped.length === 1 ? `d = ${dropped[0]}` : `d = ${dropped.slice(0, -1).join(', ')} and ${dropped[dropped.length - 1]}`;
}

function droppedNote(e: LambdaGroupEstimate): string[] {
  const dropped = e.estimate.droppedZeroError;
  if (dropped.length === 0) return [];
  return [`${distanceList(dropped)} had no logical errors and ${dropped.length === 1 ? 'is' : 'are'} left out of the fit (suppression is at least as strong)`];
}

function toRow(e: LambdaGroupEstimate, names: ReadonlyMap<string, string> | null): LambdaRowView {
  const est = e.estimate;
  return {
    p: formatNoise(e.noise),
    noise: e.noise,
    lambdaValue: est.lambda.best,
    lambda: formatLambda(est.lambda.best),
    ci: est.intervalMeaningful ? `${formatLambda(est.ci95.low)}–${formatLambda(est.ci95.high)}` : null,
    rSquared: est.rSquared.toFixed(2),
    meaningful: est.intervalMeaningful,
    experiment: names ? names.get(e.label) ?? e.label : null,
    flags: [...est.warnings, ...lambdaCaveats(e), ...droppedNote(e)],
  };
}

function collapsedSummary(hidden: LambdaRowView[], shown: LambdaRowView[]): string {
  const reasons = [...new Set(hidden.flatMap((r) => r.flags.filter((f) => !/left out of the fit|collide|rounds vary/.test(f)).map(shortReason)))].slice(0, 2);
  const maxShown = Math.max(0, ...shown.map((r) => r.noise));
  const minHidden = Math.min(...hidden.map((r) => r.noise));
  const where = minHidden > maxShown || shown.length === 0
    ? `p ≥ ${formatNoise(minHidden)}`
    : `p = ${hidden.slice(0, 3).map((r) => r.p).join(', ')}${hidden.length > 3 ? ', …' : ''}`;
  return `${hidden.length} more (${where}) not meaningful${reasons.length > 0 ? `: ${reasons.join(', ')}` : ''}`;
}

function distinctNotes(estimates: readonly LambdaGroupEstimate[]): string[] {
  const meaningful = estimates.filter((e) => e.estimate.intervalMeaningful);
  const caveats = meaningful.flatMap((e) => lambdaCaveats(e));
  const dropped = [...new Set(meaningful.flatMap((e) => e.estimate.droppedZeroError))].sort((a, b) => a - b);
  const droppedNote = dropped.length > 0
    ? [`${distanceList(dropped)} had no logical errors at some p and ${dropped.length === 1 ? 'is' : 'are'} left out of those fits (suppression is at least as strong there)`]
    : [];
  return [...new Set([...caveats, ...droppedNote])];
}

/**
 * View model for the Λ readout: one table per decoder, p-sorted, the
 * not-meaningful (saturated / above-threshold) rows folded into one summary
 * line, and each distinct caveat stated once instead of repeated per row.
 */
export function buildLambdaTable(estimates: readonly LambdaGroupEstimate[], units: RateUnits): LambdaTableView {
  const labels = estimates.map((e) => e.label);
  const names = new Set(labels).size > 1 ? experimentNames(labels) : null;
  const distances = [...new Set(estimates.flatMap((e) => e.estimate.distances))].sort((a, b) => a - b);
  const steps = [...new Set(estimates.map((e) => e.estimate.step))];
  const subtitle = [
    units === 'per_round' ? 'per round' : 'per shot',
    ...(distances.length > 0 ? [`fit over d = ${distances.join(', ')}`] : []),
    ...(steps.length === 1 ? [`Λ per Δd = ${steps[0]}`] : []),
  ].join(' · ');
  const decoders = [...new Set(estimates.map((e) => e.decoder))].sort();
  const groups = decoders.map((decoder) => {
    const mine = estimates
      .filter((e) => e.decoder === decoder)
      .sort((a, b) => a.label.localeCompare(b.label) || a.noise - b.noise);
    const all = mine.map((e) => toRow(e, names));
    const rows = all.filter((r) => r.meaningful);
    const hidden = all.filter((r) => !r.meaningful);
    return { decoder, rows, collapsed: hidden.length > 0 ? { rows: hidden, summary: collapsedSummary(hidden, rows) } : null };
  });
  return { subtitle, groups, notes: distinctNotes(estimates) };
}

/** "Λ 4.7–8.1 over 12 values of p": one line that says what a long table holds. */
export function lambdaRangeSummary(rows: readonly LambdaRowView[]): string {
  if (rows.length === 0) return '';
  const values = rows.map((r) => r.lambdaValue);
  const low = formatLambda(Math.min(...values));
  const high = formatLambda(Math.max(...values));
  if (rows.length === 1) return `Λ ${low} at p = ${rows[0].p}`;
  const span = low === high ? low : `${low}–${high}`;
  return `Λ ${span} over ${rows.length} values of p`;
}

interface DecoderCell { distances: Set<number>; withErrors: Set<number> }

function sortedList(values: Iterable<number>): number[] {
  return [...values].sort((a, b) => a - b);
}

/**
 * Per (experiment, p) cell: which distances were measured and which of them saw a logical error.
 * Cells follow the estimator's own grouping (experiment key, p, units) so the explanation can
 * never disagree with it.
 */
function decoderCells(
  rows: readonly QecCampaignStatsRow[],
  decoder: string,
  units: RateUnits,
): { cells: DecoderCell[]; allDistances: number[] } {
  const experiments = assignExperiments(rows);
  const cells = new Map<string, DecoderCell>();
  const all = new Set<number>();
  for (const row of rows) {
    const meta = (row.json_metadata ?? {}) as Record<string, unknown>;
    if (row.decoder !== decoder || typeof meta.d !== 'number' || typeof meta.p !== 'number' || rowProblem(row) === 'invalid') continue;
    if (rowRate(row, { units }).units !== units) continue;
    all.add(meta.d);
    const key = `${experiments.get(row)?.key ?? ''}\u0000${meta.p}`;
    const cell = cells.get(key) ?? { distances: new Set<number>(), withErrors: new Set<number>() };
    cell.distances.add(meta.d);
    if (row.errors > 0) cell.withErrors.add(meta.d);
    cells.set(key, cell);
  }
  return { cells: [...cells.values()], allDistances: sortedList(all) };
}

function wasWere(list: readonly number[]): string {
  return list.length === 1 ? 'was' : 'were';
}

/**
 * Why a decoder has no Λ row, in terms of its own data: which distances saw logical errors at a
 * shared p, which were measured but had none, and which were not measured at that p, so the panel
 * never contradicts a legend that lists five distances.
 */
export function explainMissingLambda(rows: readonly QecCampaignStatsRow[], decoder: string, units: RateUnits = 'per_shot'): string {
  const { cells, allDistances } = decoderCells(rows, decoder, units);
  if (allDistances.length < MIN_LAMBDA_DISTANCES) {
    const have = allDistances.length > 0 ? ` (this data has ${distanceList(allDistances)})` : '';
    return `Λ not estimated: needs ≥ ${MIN_LAMBDA_DISTANCES} distances at the same p${have}`;
  }
  const best = cells.reduce<DecoderCell | null>((top, c) => (top === null || c.withErrors.size > top.withErrors.size ? c : top), null);
  const withErrors = sortedList(best?.withErrors ?? []);
  // Three distances with errors should have fitted; do not claim a cause the data does not show.
  if (withErrors.length >= MIN_LAMBDA_DISTANCES) {
    return `Λ not estimated: no single experiment has ${MIN_LAMBDA_DISTANCES} usable distances at one p`;
  }
  const measured = best?.distances ?? new Set<number>();
  const none = sortedList([...measured].filter((d) => !best?.withErrors.has(d)));
  const missing = allDistances.filter((d) => !measured.has(d));
  const lead = withErrors.length === 0
    ? 'no distance has logical errors at a shared p'
    : `only ${distanceList(withErrors)} ${withErrors.length === 1 ? 'has' : 'have'} logical errors at a shared p`;
  const notes = [
    ...(none.length > 0 ? [`${distanceList(none)} had none`] : []),
    ...(missing.length > 0 ? [`${distanceList(missing)} ${wasWere(missing)} not measured at that p`] : []),
  ];
  return `Λ not estimated: ${lead}${notes.length > 0 ? ` (${notes.join('; ')})` : ''}`;
}
