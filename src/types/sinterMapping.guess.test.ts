import { describe, it, expect } from 'vitest';
import type { QecCampaignStatsRow } from './qec';
import { lambdaEstimates, likelihoodSeries } from '../lib/qecFit';
import {
  applyMapping, findCollisions, guessMapping, isFallbackPGuess, metadataKeys, splitMetadataKeys,
} from './sinterMapping';

function row(id: string, meta: Record<string, unknown>, errors = 10, shots = 1000): QecCampaignStatsRow {
  return {
    strong_id: id, decoder: 'pymatching', json_metadata: meta, shots, errors,
    discards: 0, seconds: 1, custom_counts: {},
  };
}

const grid = (extra: (d: number) => Record<string, unknown>, ps = [0.001, 0.002, 0.004]) =>
  [3, 5, 7].flatMap((d) => ps.map((p) => row(`${d}-${p}`, { d, p, r: d, ...extra(d) }, Math.round(1000 * p * 100 / d))));

describe('guessMapping: keys missing on some rows (qec-02)', () => {
  it('does not split by q when only p=0 rows lack it', () => {
    const rows = [
      ...grid((d) => ({ q: 2 * d * d - 1 })),
      ...[3, 5, 7].map((d) => row(`z${d}`, { d, p: 0, r: d }, 0)),
    ];
    expect(guessMapping(rows).groupBy).toEqual([]);
  });

  it('never auto-groups by a key absent from some plotted rows', () => {
    const rows = [
      ...grid(() => ({})),
      ...grid(() => ({ tag: 'extra' })).map((r) => ({ ...r, strong_id: `x${r.strong_id}` })),
    ];
    // collisions at every (d, p); "tag" is missing on half the rows so must not be used
    expect(guessMapping(rows).groupBy).not.toContain('tag');
  });
});

describe('guessMapping: replicate seeds (qec-03)', () => {
  const seeded = [3, 5, 7].flatMap((d) => [0.001, 0.002, 0.004].flatMap((p) =>
    [0, 1, 2].map((s) => row(`${d}-${p}-${s}`, { d, p, r: d, s }, Math.round(100000 * p / d)))));

  it('merges the seed key like sinter instead of splitting series', () => {
    const m = guessMapping(seeded);
    expect(m.groupBy).toEqual([]);
    expect(m.mergeKeys).toEqual(['s']);
    const mapped = applyMapping(seeded, m);
    expect(findCollisions(mapped)).toEqual([]);
    expect(mapped.length).toBeLessThan(seeded.length);
    const { series } = likelihoodSeries(mapped, { units: 'per_shot' });
    expect(series).toHaveLength(3);
    expect(series[0].points[0]).toMatchObject({ kept: 3000 });
    expect(lambdaEstimates(mapped, { units: 'per_shot' }).length).toBeGreaterThan(0);
  });

  it('sums shots/errors across replicates', () => {
    const m = guessMapping(seeded);
    const merged = applyMapping(seeded, m).find((r) => (r.json_metadata as { d: number; p: number }).d === 3 && (r.json_metadata as { p: number }).p === 0.001);
    const parts = seeded.filter((r) => (r.json_metadata as { d: number; p: number }).d === 3 && (r.json_metadata as { p: number }).p === 0.001);
    expect(merged?.shots).toBe(parts.reduce((n, r) => n + r.shots, 0));
    expect(merged?.errors).toBe(parts.reduce((n, r) => n + r.errors, 0));
  });
});

describe('p origin (qec-19)', () => {
  it('flags an unconventional p only while it is a guess', () => {
    const rows = [row('a', { strength: 0.1, d: 3 }), row('b', { strength: 0.2, d: 3 })];
    const m = guessMapping(rows);
    expect(isFallbackPGuess(m)).toBe(true);
    expect(isFallbackPGuess({ ...m, pOrigin: 'user' })).toBe(false);
  });
});

describe('splitMetadataKeys (qec-20)', () => {
  it('separates constant keys from varying ones', () => {
    const rows = grid(() => ({ b: 'X', c: 'surface' }));
    const { varying, constant } = splitMetadataKeys(metadataKeys(rows));
    expect(constant.map((k) => k.key)).toEqual(['b', 'c']);
    expect(varying.map((k) => k.key)).toEqual(['d', 'p', 'r']);
  });
});
