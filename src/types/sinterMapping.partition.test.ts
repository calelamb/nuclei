import { describe, it, expect } from 'vitest';
import type { QecCampaignStatsRow } from './qec';
import { lambdaEstimates, likelihoodSeries } from '../lib/qecFit';
import { applyMapping, findCollisions, findPartitionKeys, guessMapping } from './sinterMapping';

function row(id: string, meta: Record<string, unknown>, errors: number): QecCampaignStatsRow {
  return {
    strong_id: id, decoder: 'pymatching', json_metadata: meta, shots: 100000, errors,
    discards: 0, seconds: 1, custom_counts: {},
  };
}

/** Surface d=3,5,7 (Λ=10) and color d=9,11,13 (Λ=2) at the same p: disjoint d grids. */
const disjointD = [
  ...[3, 5, 7].map((d, i) => row(`s${d}`, { code: 'surface', d, p: 0.01, r: d }, 10000 / 10 ** i)),
  ...[9, 11, 13].map((d, i) => row(`c${d}`, { code: 'color', d, p: 0.01, r: d }, 8000 / 2 ** i)),
];

/** Two noise models on disjoint p grids, same d. */
const disjointP = [
  ...[0.001, 0.002, 0.003].flatMap((p, i) => [3, 5, 7].map((d, j) =>
    row(`a${i}${d}`, { noise_model: 'A', d, p, r: d }, Math.round(2000 * (i + 1) / 4 ** j)))),
  ...[0.01, 0.02, 0.03].flatMap((p, i) => [3, 5, 7].map((d, j) =>
    row(`b${i}${d}`, { noise_model: 'B', d, p, r: d }, Math.round(9000 * (i + 1) / 1.5 ** j)))),
];

describe('unmapped keys that partition tasks into blocks', () => {
  it('disjoint d grids: the key becomes part of identity, one Λ per code', () => {
    const m = guessMapping(disjointD);
    expect(m.groupBy).toEqual(['code']);
    const lam = lambdaEstimates(applyMapping(disjointD, m), { units: 'per_shot' });
    expect(lam).toHaveLength(2);
    const byCode = Object.fromEntries(lam.map((l) => [l.decoder, l.estimate.lambda.best]));
    expect(byCode['pymatching [code=surface]']).toBeCloseTo(10, 0);
    expect(byCode['pymatching [code=color]']).toBeCloseTo(2, 0);
  });

  it('disjoint p grids: not joined into one polyline', () => {
    const m = guessMapping(disjointP);
    expect(m.groupBy).toEqual(['noise_model']);
    const { series } = likelihoodSeries(applyMapping(disjointP, m), { units: 'per_shot' });
    expect(series).toHaveLength(6);
    expect(series.every((s) => s.points.length === 3)).toBe(true);
  });

  it('a user who unticks the key gets a visible partition finding', () => {
    const m = { ...guessMapping(disjointD), groupBy: [] };
    expect(findCollisions(applyMapping(disjointD, m))).toEqual([]);
    expect(findPartitionKeys(disjointD, m).map((k) => k.key)).toEqual(['code']);
    expect(findPartitionKeys(disjointD, guessMapping(disjointD))).toEqual([]);
  });

  it('per-task seeds (all distinct) are not partitions', () => {
    const seeded = disjointD.map((r, i) => ({ ...r, json_metadata: { ...(r.json_metadata as object), code: 'surface', seed: i } }));
    expect(guessMapping(seeded).groupBy).toEqual([]);
    expect(findPartitionKeys(seeded, guessMapping(seeded))).toEqual([]);
  });

  it('a key that is just a function of d (e.g. qubit count) is not a partition', () => {
    const derived = disjointD.map((r) => {
      const md = r.json_metadata as { d: number };
      return { ...r, json_metadata: { ...md, code: 'surface', n_qubits: 2 * md.d * md.d - 1 } };
    });
    expect(guessMapping(derived).groupBy).toEqual([]);
  });
});
