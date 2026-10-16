import { describe, it, expect, beforeEach } from 'vitest';
import golden from '../types/__fixtures__/sinter_golden.json';
import { useQecCampaignStore } from './qecCampaignStore';
import { DECODER_COLUMN } from '../types/sinterMapping';
import { likelihoodSeries } from '../lib/qecFit';

const dup = golden.cases[0];
const get = () => useQecCampaignStore.getState();

beforeEach(() => get().reset());

describe('qecCampaignStore.loadFromCsv', () => {
  it('loads aggregated rows keyed by strong_id with guessed mapping', () => {
    const res = get().loadFromCsv(dup.csv, 'stats.csv');
    expect(res).toEqual({ ok: true, fatal: null, issues: [] });
    const s = get();
    expect(Object.keys(s.rowsByStrongId)).toHaveLength(dup.expected.length);
    expect(s.rowsByStrongId[dup.expected[0].strong_id].shots).toBe(dup.expected[0].shots);
    expect(s.csvImport?.sourceName).toBe('stats.csv');
    expect(s.csvImport?.mapping).toMatchObject({ p: 'p', d: 'd', rounds: 'r', decoder: DECODER_COLUMN });
    expect(s.campaignName).toBe('stats.csv');
    expect(s.running).toBe(false);
    expect(likelihoodSeries(Object.values(s.rowsByStrongId)).series.length).toBeGreaterThan(0);
  });

  it('keeps discards and custom_counts in the exported statsCsv', () => {
    get().loadFromCsv(dup.csv, 'stats.csv');
    const csv = get().statsCsv!;
    expect(csv).toContain('dets');
    const again = get();
    again.loadFromCsv(csv, 'roundtrip.csv');
    const first = get().rowsByStrongId[dup.expected[0].strong_id];
    expect(first.discards).toBe(dup.expected[0].discards);
    expect(first.custom_counts).toEqual(dup.expected[0].custom_counts);
  });

  it('re-derives the plotted rows when the mapping changes', () => {
    get().loadFromCsv(dup.csv, 'stats.csv');
    const before = get().rowsByStrongId;
    get().setCsvMapping({ ...get().csvImport!.mapping, p: null });
    expect(likelihoodSeries(Object.values(get().rowsByStrongId)).series).toEqual([]);
    expect(get().rowsByStrongId).not.toBe(before);
    // raw aggregated rows are untouched by remapping
    expect(get().csvImport!.rows[0].json_metadata).toHaveProperty('p');
  });

  it('on a fatal error keeps the previous data and exposes the message', () => {
    get().loadFromCsv(dup.csv, 'good.csv');
    const prev = get().rowsByStrongId;
    const res = get().loadFromCsv('a,b\n1,2', 'bad.csv');
    expect(res.ok).toBe(false);
    expect(get().rowsByStrongId).toBe(prev);
    expect(get().csvError).toMatch(/missing column/);
    expect(get().csvImport?.sourceName).toBe('good.csv');
  });

  it('reports row issues but still loads the good rows', () => {
    const csv = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata\n10,1,0,0.1,m,a,"{""p"":0.1,""d"":3}"\n10,1,0,0.1,m,b,"{oops"\n';
    const res = get().loadFromCsv(csv, 'x.csv');
    expect(res.ok).toBe(true);
    expect(res.issues).toHaveLength(1);
    expect(get().csvImport!.issues).toHaveLength(1);
    expect(Object.keys(get().rowsByStrongId)).toEqual(['a']);
  });

  it('replaces (not merges into) a previous campaign and clears the error', () => {
    get().loadFromCsv('a,b\n1,2', 'bad.csv');
    expect(get().csvError).not.toBeNull();
    get().loadFromCsv(dup.csv, 'one.csv');
    expect(get().csvError).toBeNull();
    get().loadFromCsv(golden.cases[2].csv, 'two.csv');
    expect(Object.keys(get().rowsByStrongId).sort()).toEqual(['9c31908e2b', 'deadbeef08']);
  });

  it('startCampaign and reset drop the csv import', () => {
    get().loadFromCsv(dup.csv, 'stats.csv');
    get().startCampaign('run', 3);
    expect(get().csvImport).toBeNull();
    get().loadFromCsv(dup.csv, 'stats.csv');
    get().reset();
    expect(get().csvImport).toBeNull();
    expect(get().csvError).toBeNull();
  });

  it('treats a hostile strong_id as data', () => {
    const csv = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata\n10,1,0,0.1,m,__proto__,"{""p"":0.1,""d"":3}"\n';
    get().loadFromCsv(csv, 'x.csv');
    expect(Object.keys(get().rowsByStrongId)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(get().rowsByStrongId)).toBe(Object.prototype);
  });

  it('refuses to replace a running campaign', () => {
    get().startCampaign('live', 2);
    const res = get().loadFromCsv(dup.csv, 'x.csv');
    expect(res.ok).toBe(false);
    expect(get().running).toBe(true);
    expect(get().csvImport).toBeNull();
  });
});
