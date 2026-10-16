import { describe, it, expect } from 'vitest';
import golden from './__fixtures__/qec_fit_golden.json';
import syntheticCsv from './__fixtures__/synthetic_rounds.csv?raw';
import campaignCsv from '../components/qec/__fixtures__/campaign_stats.csv?raw';
import type { QecCampaignStatsRow } from '../types/qec';
import { parseSinterCsv } from '../types/qecStats';
import {
  fitBinomial, shotErrorRateToPieceErrorRate, fitLineSlope, rowRate, lambdaEstimates,
  estimateLambda, roundsFromMetadata, likelihoodSeries, qecFigureMetadata,
} from './qecFit';

const REL = 1e-9;
/** Measured gap to sinter's numeric fit_line_slope on the fixture Λ fits (see qecFit.ts header). */
const SINTER_FIT_REL = 5e-3;

/** Display name qecFit gives an experiment, from the generator's rounds scheme. */
function experimentName(label: string | null, scheme: string): string {
  const base = label ?? 'unlabeled';
  const [kind, v] = scheme.split('=');
  if (kind === 'ratio') return Number(v) === 1 ? `${base} r=d` : `${base} r=${v}d`;
  if (kind === 'fixed') return `${base} r=${v}`;
  return base;
}
function near(actual: number, expected: number, rel = REL) {
  const tol = rel * Math.max(Math.abs(expected), 1e-300);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}
function nearFit(a: { low: number; best: number; high: number }, e: { low: number; best: number; high: number }, rel = REL) {
  near(a.low, e.low, rel); near(a.best, e.best, rel); near(a.high, e.high, rel);
}

describe('golden: scalar sinter functions', () => {
  it.each(golden.conversions)('shot_error_rate_to_piece_error_rate($shot, $pieces, $values)', (c) => {
    near(shotErrorRateToPieceErrorRate(c.shot, { pieces: c.pieces, values: c.values }), c.expected);
  });
  it.each(golden.binomials)('fit_binomial(shots=$shots, hits=$hits, factor=$factor)', (c) => {
    nearFit(fitBinomial({ numShots: c.shots, numHits: c.hits, maxLikelihoodFactor: c.factor }), c);
  });
  it.each(golden.lineSlopes)('fit_line_slope extra=$extra', (c) => {
    const f = fitLineSlope({ xs: c.xs, ys: c.ys, maxExtraSquaredError: c.extra });
    near(f.slope.best, c.best);
    // Deliberate difference: sinter bisects a numerically-solved constrained
    // fit; ours is the closed form. They agree to ~1e-6 on these cases.
    near(f.slope.low, c.low, 1e-5);
    near(f.slope.high, c.high, 1e-5);
  });
});

describe('golden: per-row rates (discards and rounds)', () => {
  const sets = [
    ['campaign_stats.csv', golden.campaign.rows, campaignCsv],
    ['synthetic_rounds.csv', golden.synthetic.rows, syntheticCsv],
  ] as const;
  for (const [name, cases, csv] of sets) {
    const rows = parseSinterCsv(csv);
    it(`${name}: parses to the golden row set`, () => {
      expect(rows.map((r) => r.strong_id).sort()).toEqual(cases.map((c) => c.strong_id).sort());
    });
    for (const c of cases) {
      it(`${name}: ${c.strong_id}`, () => {
        const row = rows.find((r) => r.strong_id === c.strong_id)!;
        for (const [factor, exp] of Object.entries(c.perShot)) {
          const got = rowRate(row, { units: 'per_shot', maxLikelihoodFactor: Number(factor) });
          expect(got.units).toBe('per_shot');
          nearFit(got.fit, exp);
        }
        for (const [factor, exp] of Object.entries(c.perRound)) {
          const got = rowRate(row, { units: 'per_round', maxLikelihoodFactor: Number(factor) });
          expect(got.units).toBe('per_round');
          nearFit(got.fit, exp as { low: number; best: number; high: number });
        }
      });
    }
  }

  it('discards shrink the denominator', () => {
    const row = parseSinterCsv(syntheticCsv)[0];
    expect(row.discards).toBeGreaterThan(0);
    expect(rowRate(row).kept).toBe(row.shots - row.discards);
  });

  it('falls back to per-shot (and says so) when rounds are unknown', () => {
    const row = parseSinterCsv(campaignCsv)[0];
    expect(roundsFromMetadata(row.json_metadata)).toBeNull();
    expect(rowRate(row, { units: 'per_round' }).units).toBe('per_shot');
  });
});

describe('golden: Λ regression', () => {
  const sets = [
    ['synthetic', golden.synthetic.lambda, parseSinterCsv(syntheticCsv)],
    ['campaign', golden.campaign.lambda, parseSinterCsv(campaignCsv)],
  ] as const;
  for (const [name, cases, rows] of sets) {
    const withFit = cases.filter((c) => 'slope' in c);
    it(`${name}: reports Λ exactly for groups with >= 3 distances`, () => {
      for (const units of ['per_shot', 'per_round'] as const) {
        const got = lambdaEstimates(rows, { units });
        const want = withFit.filter((c) => c.perRound === (units === 'per_round'));
        expect(got.length).toBe(want.length);
      }
    });
    for (const c of withFit as Array<(typeof cases)[number] & Record<string, number | string | boolean>>) {
      it(`${name}: p=${c.p} ${c.perRound ? 'per-round' : 'per-shot'}`, () => {
        const units = c.perRound ? 'per_round' : 'per_shot';
        const name = experimentName(c.label as string | null, c.scheme);
        const g = lambdaEstimates(rows, { units }).find((x) => x.noise === c.p && x.decoder === c.decoder && x.label === name)!;
        expect(g).toBeTruthy();
        expect(g.estimate.nPoints).toBe(c.n);
        near(g.estimate.slope.best, c.slope);
        // stderr comes from rss, which cancels catastrophically on near-perfect fits.
        expect(Math.abs(g.estimate.stderr - c.stderr)).toBeLessThanOrEqual(1e-9);
        nearFit(g.estimate.slope, c.slopeAnalytic);
        nearFit(g.estimate.lambda, c.lambda);
        // slopeAnalytic's budget comes from an independent numpy sandwich-variance
        // computation; sinter's fit_line_slope is the independent interval solver.
        near(g.estimate.slope.low, c.slopeSinter.low, SINTER_FIT_REL);
        near(g.estimate.slope.high, c.slopeSinter.high, SINTER_FIT_REL);
        nearFit(g.estimate.lambda, c.lambdaSinter, SINTER_FIT_REL);
      });
    }
  }
  it('campaign fixture has only 2 distances: no Λ reported', () => {
    expect(lambdaEstimates(parseSinterCsv(campaignCsv))).toEqual([]);
  });
});

describe('Λ behavior', () => {
  it('requires >= 3 distinct distances', () => {
    const two = [{ distance: 3, errors: 50, rate: 1e-2 }, { distance: 5, errors: 5, rate: 1e-3 }];
    expect(estimateLambda(two)).toBeNull();
    expect(estimateLambda([...two, { distance: 5, errors: 6, rate: 1.1e-3 }])).toBeNull();
  });
  it('drops zero-error points (ln 0) and then enforces the minimum again', () => {
    const pts = [
      { distance: 3, errors: 50, rate: 1e-2 }, { distance: 5, errors: 5, rate: 1e-3 },
      { distance: 7, errors: 0, rate: 0 },
    ];
    expect(estimateLambda(pts)).toBeNull();
  });
  it('does not drop Λ <= 1 (above threshold) and brackets the best value', () => {
    const pts = [
      { distance: 3, errors: 100, rate: 0.010 }, { distance: 5, errors: 120, rate: 0.012 },
      { distance: 7, errors: 150, rate: 0.015 },
    ];
    const e = estimateLambda(pts)!;
    expect(e.lambda.best).toBeLessThan(1);
    expect(e.lambda.low).toBeLessThanOrEqual(e.lambda.best);
    expect(e.lambda.high).toBeGreaterThanOrEqual(e.lambda.best);
  });
  it('recovers an exact exponential Λ', () => {
    const pts = [3, 5, 7, 9].map((d) => ({ distance: d, errors: 100, rate: 0.1 * 4 ** (-(d - 3) / 2) }));
    near(estimateLambda(pts)!.lambda.best, 4, 1e-12);
  });
});

describe('input validation', () => {
  it('rejects bad arguments', () => {
    expect(() => fitBinomial({ numShots: 10, numHits: 11, maxLikelihoodFactor: 2 })).toThrow(RangeError);
    expect(() => fitBinomial({ numShots: 10, numHits: 1, maxLikelihoodFactor: 0.5 })).toThrow(RangeError);
    expect(() => shotErrorRateToPieceErrorRate(1.5, { pieces: 2 })).toThrow(RangeError);
    expect(() => shotErrorRateToPieceErrorRate(0.1, { pieces: 0 })).toThrow(RangeError);
  });
});

describe('likelihoodSeries and metadata', () => {
  const rows = parseSinterCsv(syntheticCsv);
  it('per-round differs from per-shot and nothing is excluded when rounds are known', () => {
    const shot = likelihoodSeries(rows, { units: 'per_shot' });
    const round = likelihoodSeries(rows, { units: 'per_round' });
    expect(round.excluded).toBe(0);
    expect(round.series.length).toBe(shot.series.length);
    expect(round.series[0].points[0].rate.p).toBeLessThan(shot.series[0].points[0].rate.p);
  });
  it('excludes (does not mix in) rows without rounds in per-round mode', () => {
    const r = likelihoodSeries(parseSinterCsv(campaignCsv), { units: 'per_round' });
    expect(r.series).toEqual([]);
    expect(r.excluded).toBe(8);
  });
  it('names units, CI method and estimators', () => {
    const m = qecFigureMetadata('per_round');
    expect(m.units).toBe('logical error per round');
    expect(m.ci_method).toMatch(/likelihood-ratio/);
    expect(m.lambda_estimator).toMatch(/3 distances/);
  });
});

describe('Λ with colliding tasks', () => {
  const row = (d: number, errors: number, strong_id: string): QecCampaignStatsRow => ({
    shots: 100000, errors, discards: 0, seconds: 1, decoder: 'pymatching', strong_id,
    json_metadata: { d, p: 0.004, r: d, label: 'x' }, custom_counts: {},
  });
  it('flags distances where distinct strong_ids share one cell', () => {
    const rows = [row(3, 900, 'a'), row(5, 400, 'b'), row(7, 200, 'c'), row(7, 600, 'c2')];
    const [g] = lambdaEstimates(rows, { units: 'per_shot' });
    expect(g.collidingDistances).toEqual([7]);
  });
  it('reports no collisions for clean data', () => {
    const [g] = lambdaEstimates([row(3, 900, 'a'), row(5, 400, 'b'), row(7, 200, 'c')], { units: 'per_shot' });
    expect(g.collidingDistances).toEqual([]);
  });
});
