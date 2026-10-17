import type { LambdaGroupEstimate, RateUnits } from './qecFit';
import { lambdaCaveats } from './qecLambdaText';
import { formatLambda, formatNoise } from './qecPlotFormat';

export interface LambdaRowView {
  /** p as text, e.g. "3.6×10⁻⁴". */
  p: string;
  noise: number;
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

/** "stats r=3d" -> "rounds = 3d"; the default "stats" label carries no information. */
export function displayExperiment(label: string): string {
  return label.replace(/^(stats|unlabeled)\s*/, '').replace(/\br=/g, 'rounds = ').trim() || 'default';
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

function toRow(e: LambdaGroupEstimate, showExperiment: boolean): LambdaRowView {
  const est = e.estimate;
  return {
    p: formatNoise(e.noise),
    noise: e.noise,
    lambda: formatLambda(est.lambda.best),
    ci: est.intervalMeaningful ? `${formatLambda(est.ci95.low)}–${formatLambda(est.ci95.high)}` : null,
    rSquared: est.rSquared.toFixed(2),
    meaningful: est.intervalMeaningful,
    experiment: showExperiment ? displayExperiment(e.label) : null,
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
  const showExperiment = new Set(estimates.map((e) => e.label)).size > 1;
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
      .sort((a, b) => a.noise - b.noise || a.label.localeCompare(b.label));
    const all = mine.map((e) => toRow(e, showExperiment));
    const rows = all.filter((r) => r.meaningful);
    const hidden = all.filter((r) => !r.meaningful);
    return { decoder, rows, collapsed: hidden.length > 0 ? { rows: hidden, summary: collapsedSummary(hidden, rows) } : null };
  });
  return { subtitle, groups, notes: distinctNotes(estimates) };
}
