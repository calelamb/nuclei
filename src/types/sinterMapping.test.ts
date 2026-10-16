import { describe, it, expect } from 'vitest';
import type { QecCampaignStatsRow } from './qec';
import { thresholdSeries } from './qecStats';
import {
  metadataKeys,
  guessMapping,
  applyMapping,
  DECODER_COLUMN,
} from './sinterMapping';

function row(id: string, meta: Record<string, unknown>, over: Partial<QecCampaignStatsRow> = {}): QecCampaignStatsRow {
  return {
    strong_id: id, decoder: 'pymatching', json_metadata: meta, shots: 1000, errors: 10,
    discards: 0, seconds: 1, custom_counts: {}, ...over,
  };
}

const rows = [
  row('a', { distance: 3, noise: 0.001, num_rounds: 3, basis: 'X' }),
  row('b', { distance: 5, noise: 0.001, num_rounds: 5, basis: 'X' }),
  row('c', { distance: 5, noise: 0.002, num_rounds: 5, basis: 'X' }),
];

describe('metadataKeys', () => {
  it('lists keys with their value kinds and samples', () => {
    const keys = metadataKeys(rows);
    expect(keys.map((k) => k.key)).toEqual(['basis', 'distance', 'noise', 'num_rounds']);
    expect(keys.find((k) => k.key === 'noise')?.numeric).toBe(true);
    expect(keys.find((k) => k.key === 'basis')?.numeric).toBe(false);
  });
});

describe('guessMapping', () => {
  it('guesses conventional names', () => {
    expect(guessMapping(rows)).toEqual({ p: 'noise', d: 'distance', rounds: 'num_rounds', decoder: DECODER_COLUMN, groupBy: [] });
  });
  it('prefers exact p/d/r', () => {
    const m = guessMapping([row('a', { p: 0.01, d: 3, r: 3, decoder: 'x' })]);
    expect(m).toEqual({ p: 'p', d: 'd', rounds: 'r', decoder: 'decoder', groupBy: [] });
  });
  it('falls back to a varying numeric key for p and leaves unknowns null', () => {
    const m = guessMapping([row('a', { strength: 0.1 }), row('b', { strength: 0.2 })]);
    expect(m.p).toBe('strength');
    expect(m.d).toBeNull();
    expect(m.rounds).toBeNull();
  });
});

describe('applyMapping', () => {
  it('normalizes mapped keys so the threshold series sees p and d', () => {
    const mapped = applyMapping(rows, { p: 'noise', d: 'distance', rounds: null, decoder: DECODER_COLUMN, groupBy: [] });
    const series = thresholdSeries(mapped);
    expect(series.map((s) => s.distance).sort()).toEqual([3, 5]);
    expect(series.find((s) => s.distance === 5)?.points.map((p) => p.noise)).toEqual([0.001, 0.002]);
  });

  it('re-plots when the x-axis key changes', () => {
    const two = [row('a', { p: 0.01, q: 0.5, d: 3 }), row('b', { p: 0.02, q: 0.6, d: 3 })];
    const onP = thresholdSeries(applyMapping(two, { p: 'p', d: 'd', rounds: null, decoder: DECODER_COLUMN, groupBy: [] }));
    const onQ = thresholdSeries(applyMapping(two, { p: 'q', d: 'd', rounds: null, decoder: DECODER_COLUMN, groupBy: [] }));
    expect(onP[0].points.map((x) => x.noise)).toEqual([0.01, 0.02]);
    expect(onQ[0].points.map((x) => x.noise)).toEqual([0.5, 0.6]);
  });

  it('does not mutate its input and keeps unmapped metadata', () => {
    const before = JSON.stringify(rows);
    const out = applyMapping(rows, { p: 'noise', d: 'distance', rounds: null, decoder: DECODER_COLUMN, groupBy: [] });
    expect(JSON.stringify(rows)).toBe(before);
    expect((out[0].json_metadata as Record<string, unknown>).basis).toBe('X');
    expect(out[0]).not.toBe(rows[0]);
  });

  it('drops p when unmapped or non-numeric so the row is not plotted', () => {
    const none = applyMapping(rows, { p: null, d: 'distance', rounds: null, decoder: DECODER_COLUMN, groupBy: [] });
    expect(thresholdSeries(none)).toEqual([]);
    const text = applyMapping(rows, { p: 'basis', d: 'distance', rounds: null, decoder: DECODER_COLUMN, groupBy: [] });
    expect(thresholdSeries(text)).toEqual([]);
  });

  it('accepts numeric strings for p and d', () => {
    const r = [row('a', { p: '0.01', d: '3' })];
    const s = thresholdSeries(applyMapping(r, { p: 'p', d: 'd', rounds: null, decoder: DECODER_COLUMN, groupBy: [] }));
    expect(s[0].distance).toBe(3);
    expect(s[0].points[0].noise).toBe(0.01);
  });

  it('takes the decoder from a metadata key when mapped', () => {
    const r = [row('a', { p: 0.01, d: 3, dec: 'sparse_blossom' })];
    const out = applyMapping(r, { p: 'p', d: 'd', rounds: null, decoder: 'dec', groupBy: [] });
    expect(out[0].decoder).toBe('sparse_blossom');
  });

  it('gives unlabeled rows one shared label (not one series per strong_id)', () => {
    const out = thresholdSeries(applyMapping(rows, { p: 'noise', d: 'distance', rounds: null, decoder: DECODER_COLUMN, groupBy: [] }));
    expect(new Set(out.map((s) => s.label)).size).toBe(1);
  });

  it('splits series by rounds when rounds is mapped and varies at fixed d', () => {
    const r = [
      row('a', { p: 0.01, d: 5, r: 5 }), row('b', { p: 0.01, d: 5, r: 10 }),
    ];
    const out = thresholdSeries(applyMapping(r, { p: 'p', d: 'd', rounds: 'r', decoder: DECODER_COLUMN, groupBy: [] }));
    expect(out).toHaveLength(2);
  });
});
