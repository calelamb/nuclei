import { describe, it, expect } from 'vitest';
import type { QecCampaignStatsRow } from '../types/qec';
import { decoderComparison } from './qecWorkbench';

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
