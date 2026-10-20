import { describe, it, expect } from 'vitest';
import type { QecCampaignStatsRow } from './qec';
import { applyMapping, findCollisions, guessMapping, isFallbackPGuess, DECODER_COLUMN } from './sinterMapping';
import { likelihoodSeries, lambdaEstimates } from '../lib/qecFit';

function row(meta: Record<string, unknown>, shots: number, errors: number, discards = 0): QecCampaignStatsRow {
  return {
    strong_id: JSON.stringify(meta), decoder: 'pymatching', json_metadata: meta,
    shots, errors, discards, seconds: 1, custom_counts: {},
  };
}
// basis X: LER 0.01 -> 0.001 -> 0.0001 (Lambda 10); basis Z: ~0.005 -> 0.004 (Lambda ~1.1)
const ROWS = [
  row({ d: 3, p: 0.001, basis: 'X' }, 10000, 100),
  row({ d: 5, p: 0.001, basis: 'X' }, 10000, 10),
  row({ d: 3, p: 0.001, basis: 'Z' }, 10000, 50),
  row({ d: 5, p: 0.001, basis: 'Z' }, 10000, 45),
  row({ d: 7, p: 0.001, basis: 'X' }, 10000, 1),
  row({ d: 7, p: 0.001, basis: 'Z' }, 10000, 40),
];

describe('series grouping on unmapped metadata keys', () => {
  it('guessMapping auto-groups by the key that disambiguates colliding tasks', () => {
    const m = guessMapping(ROWS);
    expect(m.groupBy).toEqual(['basis']);
    expect(findCollisions(applyMapping(ROWS, m))).toEqual([]);
  });

  it('keeps bases in separate series and gives each its own Lambda', () => {
    const mapped = applyMapping(ROWS, guessMapping(ROWS));
    expect(likelihoodSeries(mapped).series).toHaveLength(6);
    const fits = lambdaEstimates(mapped);
    expect(fits).toHaveLength(2);
    const lambdas = fits.map((f) => f.estimate.lambda.best).sort((a, b) => a - b);
    expect(lambdas[0]).toBeGreaterThan(1.05);
    expect(lambdas[0]).toBeLessThan(1.2);
    expect(lambdas[1]).toBeCloseTo(10, 6);
  });

  it('reports a collision when the user clears the group-by', () => {
    const m = { ...guessMapping(ROWS), groupBy: [] };
    const hits = findCollisions(applyMapping(ROWS, m));
    expect(hits.length).toBe(3);
    expect(hits[0].count).toBe(2);
  });

  it('does not group when nothing collides', () => {
    const rows = [row({ d: 3, p: 0.001, seed: 1 }, 100, 1), row({ d: 5, p: 0.001, seed: 2 }, 100, 1)];
    expect(guessMapping(rows).groupBy).toEqual([]);
  });

  it('ignores rows without a plottable p when counting collisions', () => {
    const rows = [row({ d: 3, basis: 'X' }, 100, 1), row({ d: 3, basis: 'Z' }, 100, 1)];
    expect(findCollisions(applyMapping(rows, { p: null, d: 'd', rounds: null, decoder: DECODER_COLUMN, groupBy: [] }))).toEqual([]);
  });
});

describe('isFallbackPGuess', () => {
  it('is true only when p is not a conventional name', () => {
    const rows = [row({ d: 3, q: 0.1 }, 10, 1), row({ d: 3, q: 0.2 }, 10, 1)];
    expect(isFallbackPGuess(guessMapping(rows))).toBe(true);
    expect(isFallbackPGuess(guessMapping(ROWS))).toBe(false);
  });
});
