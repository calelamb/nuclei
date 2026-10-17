import { describe, it, expect } from 'vitest';
import type { QecCampaignStatsRow } from '../types/qec';
import { decoderComparison, formatSecondsPerShot } from './qecWorkbench';
import { applyMapping } from '../types/sinterMapping';

function mk(over: Partial<QecCampaignStatsRow> & { meta?: Record<string, unknown> }): QecCampaignStatsRow {
  const { meta, ...rest } = over;
  return {
    shots: 1000, errors: 10, discards: 0, seconds: 2, decoder: 'pymatching',
    strong_id: `${JSON.stringify(meta)}-${rest.errors}-${rest.decoder}`,
    json_metadata: meta ?? { d: 3, p: 0.01, label: 'x' }, custom_counts: {}, ...rest,
  };
}

describe('decoderComparison (workbench rows)', () => {
  it('is discard-aware: errors / (shots - discards), not errors / shots', () => {
    const [r] = decoderComparison([mk({ shots: 1000, discards: 900, errors: 10 })]).rows;
    expect(r.kept).toBe(100);
    expect(r.rate.p).toBeCloseTo(0.1, 12);
    expect(r.discards).toBe(900);
  });

  it('never pools across p or d: one row per (experiment, decoder, d, p)', () => {
    const rows = [
      mk({ meta: { d: 3, p: 0.01, label: 'x' }, errors: 100 }),
      mk({ meta: { d: 3, p: 0.001, label: 'x' }, errors: 1 }),
      mk({ meta: { d: 5, p: 0.01, label: 'x' }, errors: 30 }),
    ];
    const { rows: out } = decoderComparison(rows);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.rate.p).sort()).toEqual([0.001, 0.03, 0.1].sort());
  });

  it('keeps different experiments of one decoder apart (disjoint grids)', () => {
    const a = [3, 5].map((d) => mk({ meta: { d, p: 0.01, label: 'x', noise_model: 'A' }, errors: 20 }));
    const b = [3, 5].map((d) => mk({ meta: { d, p: 0.01, label: 'x', noise_model: 'B' }, errors: 50 }));
    const { rows } = decoderComparison([...a, ...b]);
    expect(new Set(rows.map((r) => r.experiment)).size).toBe(2);
  });

  it('uses the sinter likelihood interval and skips (and counts) malformed rows', () => {
    const { rows, skipped } = decoderComparison([
      mk({ errors: 10 }),
      mk({ shots: 100, discards: 0, errors: 200, meta: { d: 5, p: 0.01 } }),
      mk({ shots: 100, discards: 100, errors: 0, meta: { d: 7, p: 0.01 } }),
    ]);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(2);
    expect(rows[0].rate.lo).toBeLessThan(rows[0].rate.p);
    expect(rows[0].rate.hi).toBeGreaterThan(rows[0].rate.p);
    expect(rows[0].secondsPerShot).toBeCloseTo(0.002, 9);
  });

  it('keeps tasks with identical metadata but different strong_ids apart and flags them', () => {
    const plain = mk({ shots: 100000, errors: 441, strong_id: 'plain', meta: { d: 7, p: 0.004, label: 'x' } });
    const ps = mk({ shots: 100000, discards: 58290, errors: 170, strong_id: 'ps', meta: { d: 7, p: 0.004, label: 'x' } });
    const solo = mk({ shots: 1000, errors: 5, strong_id: 'solo', meta: { d: 5, p: 0.004, label: 'x' } });
    const { rows } = decoderComparison([plain, ps, solo]);
    expect(rows).toHaveLength(3);
    const d7 = rows.filter((r) => r.distance === 7);
    expect(d7.map((r) => r.errors).sort((a, b) => a - b)).toEqual([170, 441]);
    expect(d7.every((r) => r.collides && r.strongId !== '')).toBe(true);
    expect(rows.find((r) => r.distance === 5)!.collides).toBe(false);
  });
});

describe('decoderComparison context (distinguishing experiment metadata)', () => {
  it('describes the experiment by its non-sweep metadata, not the import label', () => {
    const [r] = decoderComparison([
      mk({ meta: { d: 3, r: 3, p: 0.01, label: 'stats', b: 'X', q: 17, decoder: 'pymatching', c: 'surface_code' } }),
    ]).rows;
    expect(r.context).toBe('rounds = d · b=X · c=surface_code · q=17');
  });

  it('is just the rounds scheme when there is no other metadata', () => {
    const rows = decoderComparison([
      mk({ meta: { d: 3, r: 3, p: 0.01, label: 'x' } }), mk({ meta: { d: 5, r: 5, p: 0.01, label: 'x' }, errors: 3 }),
    ]).rows;
    expect(rows.map((r) => r.context)).toEqual(['rounds = d', 'rounds = d']);
  });

  it('falls back to the experiment name when nothing else distinguishes it', () => {
    const [r] = decoderComparison([mk({ meta: { d: 3, p: 0.01, label: 'run7' } })]).rows;
    expect(r.context).toBe('run7');
  });
});

describe('formatSecondsPerShot', () => {
  it.each([
    [1.2e-5, '12 µs'],
    [2.4e-3, '2.4 ms'],
    [0.5, '500 ms'],
    [1.5, '1.5 s'],
    [1e-7, '100 ns'],
    [0, '—'],
    [Number.NaN, '—'],
  ])('%s -> %s', (v, text) => {
    expect(formatSecondsPerShot(v)).toBe(text);
  });
});

describe('decoderComparison context ignores keys derived from d', () => {
  it('omits numeric metadata that is a function of d (e.g. qubit count) but keeps real splits', () => {
    const rows = decoderComparison([
      mk({ meta: { d: 3, r: 3, p: 0.01, label: 'x', q: 17, b: 'X' } }),
      mk({ meta: { d: 5, r: 5, p: 0.01, label: 'x', q: 49, b: 'X' }, errors: 3 }),
    ]).rows;
    expect(rows.map((r) => r.context)).toEqual(['rounds = d · b=X', 'rounds = d · b=X']);
  });

  it('keeps a numeric key that differs at the same d', () => {
    const rows = decoderComparison([
      mk({ meta: { d: 3, r: 3, p: 0.01, label: 'x', shots_per_task: 10 } }),
      mk({ meta: { d: 3, r: 3, p: 0.01, label: 'x', shots_per_task: 20 }, errors: 3 }),
    ]).rows;
    expect(rows.map((r) => r.context)).toEqual(['rounds = d · shots_per_task=10', 'rounds = d · shots_per_task=20']);
  });
});

describe('decoderComparison context follows the active mapping', () => {
  const mapping = { p: 'noise', d: 'distance', rounds: 'rounds', decoder: 'decoder_name', groupBy: ['s'] };
  const raw = (noise: number, d: number) => mk({
    meta: { noise, distance: d, rounds: d, decoder_name: 'fusion', s: 0, b: 'X' },
    decoder: 'stats-col', errors: d,
  });

  it('does not show the mapped p / d / decoder / group-by keys as experiment metadata', () => {
    const rows = decoderComparison(applyMapping([raw(0.001, 3), raw(0.002, 3), raw(0.002, 5)], mapping)).rows;
    for (const r of rows) {
      expect(r.context).not.toMatch(/noise=|distance=|decoder_name=|s=0/);
      expect(r.context).toBe('rounds = d · b=X');
    }
    expect(new Set(rows.map((r) => r.context)).size).toBe(1);
  });

  it('leaves the context empty when only the default import label would remain', () => {
    const [r] = decoderComparison([mk({ meta: { d: 3, p: 0.01, label: 'stats' } })]).rows;
    expect(r.context).toBe('');
  });
});

describe('decoderComparison units (qec-12)', () => {
  const r = { shots: 100000, errors: 1000, discards: 0, seconds: 1, decoder: 'pm', strong_id: 'a', custom_counts: {}, json_metadata: { d: 5, p: 0.001, r: 5 } };
  it('reports per-shot by default and per-round on request', () => {
    const shot = decoderComparison([r]).rows[0];
    const round = decoderComparison([r], { units: 'per_round' }).rows[0];
    expect(shot.units).toBe('per_shot');
    expect(round.units).toBe('per_round');
    expect(round.rate.p).toBeLessThan(shot.rate.p);
  });
  it('falls back to per-shot when rounds are unknown', () => {
    const noRounds = { ...r, json_metadata: { d: 5, p: 0.001 } };
    expect(decoderComparison([noRounds], { units: 'per_round' }).rows[0].units).toBe('per_shot');
  });
});
