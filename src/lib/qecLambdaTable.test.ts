import { describe, it, expect } from 'vitest';
import { lambdaEstimates } from './qecFit';
import { buildLambdaTable } from './qecLambdaTable';
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
