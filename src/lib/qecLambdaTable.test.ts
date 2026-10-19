import { describe, it, expect } from 'vitest';
import { lambdaEstimates } from './qecFit';
import { buildLambdaTable, explainMissingLambda, lambdaRangeSummary, LAMBDA_ROW_LIMIT } from './qecLambdaTable';
import { formatLambda } from './qecPlotFormat';
import type { QecCampaignStatsRow } from '../types/qec';

function row(d: number, p: number, rate: number, decoder = 'pymatching', extra: Record<string, unknown> = {}): QecCampaignStatsRow {
  const shots = 1_000_000;
  return {
    strong_id: `${decoder}-${d}-${p}`, decoder, shots, errors: Math.max(1, Math.round(rate * shots)), discards: 0,
    seconds: 1, custom_counts: {}, json_metadata: { d, p, r: d, ...extra },
  };
}

/** Good suppression at small p, saturated (~0.5) at large p. */
const rows = ['pymatching', 'fusion_blossom'].flatMap((dec) => [
  ...[3, 5, 7, 9].flatMap((d, i) => [
    row(d, 0.0003599999999999999, 0.01 / 3 ** i, dec),
    row(d, 0.001, 0.02 / 2.5 ** i, dec),
    row(d, 0.006, 0.5, dec), row(d, 0.008, 0.499, dec), row(d, 0.01, 0.5, dec),
  ]),
]);

describe('formatLambda', () => {
  it('uses 3 significant figures and no decimals from 100', () => {
    expect(formatLambda(6.1938)).toBe('6.19');
    expect(formatLambda(0.5832)).toBe('0.583');
    expect(formatLambda(123.4)).toBe('123');
  });
});

describe('buildLambdaTable (qec-04)', () => {
  const est = lambdaEstimates(rows, { units: 'per_round' });
  const table = buildLambdaTable(est, 'per_round');

  it('writes a plain subtitle with units, distances and step', () => {
    expect(table.subtitle).toBe('per round · fit over d = 3, 5, 7, 9 · Λ per Δd = 2');
  });

  it('groups rows by decoder and formats p without raw floats', () => {
    expect(table.groups.map((g) => g.decoder)).toEqual(['fusion_blossom', 'pymatching']);
    const first = table.groups[0].rows[0];
    expect(first.p).toBe('3.6×10⁻⁴');
  });

  it('prints the CI as a compact range and never the "stats r=d" prefix', () => {
    const first = table.groups[0].rows[0];
    expect(first.ci).toMatch(/^[\d.]+–[\d.]+$/);
    expect(JSON.stringify(table)).not.toMatch(/stats r=d/);
    expect(table.groups[0].rows[0].experiment).toBeNull();
  });

  it('collapses not-meaningful rows with one short reason list', () => {
    const g = table.groups[0];
    expect(g.rows.every((r) => r.meaningful)).toBe(true);
    expect(g.collapsed).not.toBeNull();
    expect(g.collapsed!.rows).toHaveLength(3);
    expect(g.collapsed!.summary).toMatch(/^3 more \(p ≥ 6×10⁻³\) not meaningful: saturated/);
  });

  it('dedupes identical caveats into one note', () => {
    const colliding = est.map((e) => ({ ...e, collidingDistances: [5] }));
    const t = buildLambdaTable(colliding, 'per_round');
    expect(t.notes.filter((n) => /collide/.test(n))).toHaveLength(1);
  });

  it('shows the experiment only when there is more than one', () => {
    const two = [...rows, ...[3, 5, 7].map((d, i) => row(d, 0.001, 0.02 / 2 ** i, 'pymatching', { r: 3 * d }))];
    const t = buildLambdaTable(lambdaEstimates(two, { units: 'per_round' }), 'per_round');
    const exps = t.groups.flatMap((g) => g.rows.map((r) => r.experiment));
    expect(exps.some((e) => e !== null)).toBe(true);
  });
});

describe('lambdaRangeSummary (qec-r-35)', () => {
  const table = buildLambdaTable(lambdaEstimates(rows, { units: 'per_round' }), 'per_round');

  it('summarises the span of Λ and p across the meaningful rows', () => {
    const summary = lambdaRangeSummary(table.groups[0].rows);
    expect(summary).toMatch(/^Λ [\d.]+–[\d.]+ over 2 values of p$/);
  });

  it('is a single value when every Λ is equal', () => {
    const one = table.groups[0].rows.slice(0, 1);
    expect(lambdaRangeSummary(one)).toMatch(/^Λ [\d.]+ at p = /);
  });

  it('is empty without rows', () => {
    expect(lambdaRangeSummary([])).toBe('');
  });

  it('shows at most LAMBDA_ROW_LIMIT rows before offering the rest', () => {
    expect(LAMBDA_ROW_LIMIT).toBe(8);
  });
});

describe('explainMissingLambda (qec-r-84)', () => {
  const zero = (d: number, p: number): QecCampaignStatsRow => ({ ...row(d, p, 0.01), errors: 0 });

  it('names the distances that have errors at a shared p and those that had none', () => {
    const data = [row(3, 0.001, 0.01), row(5, 0.001, 0.001), zero(7, 0.001), zero(9, 0.001), zero(11, 0.001)];
    const msg = explainMissingLambda(data, 'pymatching');
    expect(msg).toBe('Λ not estimated: only d = 3 and 5 have logical errors at a shared p (d = 7, 9 and 11 had none)');
  });

  it('falls back to the generic need when fewer than three distances exist at all', () => {
    const msg = explainMissingLambda([row(3, 0.001, 0.01), row(5, 0.001, 0.001)], 'pymatching');
    expect(msg).toBe('Λ not estimated: needs ≥ 3 distances at the same p (this data has d = 3 and 5)');
  });

  it('says so when no distance has errors', () => {
    const msg = explainMissingLambda([zero(3, 0.001), zero(5, 0.001), zero(7, 0.001)], 'pymatching');
    expect(msg).toBe('Λ not estimated: no distance has logical errors at a shared p (d = 3, 5 and 7 had none)');
  });

  it('uses the p with the most distances that have errors', () => {
    const data = [row(3, 0.001, 0.01), zero(5, 0.001), row(5, 0.002, 0.01), row(7, 0.002, 0.001), zero(9, 0.002), zero(3, 0.002)];
    const msg = explainMissingLambda(data, 'pymatching');
    expect(msg).toContain('only d = 5 and 7 have logical errors');
    expect(msg).toContain('d = 3 and 9 had none');
  });

  it('falls back to the generic wording when three distances do have errors (the estimator disagreed for another reason)', () => {
    const data = [row(3, 0.001, 0.01), row(5, 0.001, 0.001), row(7, 0.001, 0.0001)];
    const msg = explainMissingLambda(data, 'pymatching');
    expect(msg).not.toMatch(/only d = 3, 5 and 7/);
  });

  it('separates distances that were not measured at that p from those with zero errors', () => {
    const data = [row(3, 0.001, 0.01), row(5, 0.001, 0.001), zero(7, 0.001), row(9, 0.002, 0.01)];
    const msg = explainMissingLambda(data, 'pymatching');
    expect(msg).toContain('only d = 3 and 5 have logical errors at a shared p');
    expect(msg).toContain('d = 7 had none');
    expect(msg).toContain('d = 9 was not measured at that p');
  });
});
