import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  splitCsvLine,
  parseSinterCsv,
  wilsonInterval,
  thresholdSeries,
  lambdaFit,
  projectedDistanceForTarget,
  decoderWorkbench,
  statsPointsToCsv,
} from './qecStats';
import type { QecCampaignStatsRow } from './qec';

const campaignCsv = readFileSync(
  fileURLToPath(new URL('../components/qec/__fixtures__/campaign_stats.csv', import.meta.url)),
  'utf8',
);

function row(over: Partial<QecCampaignStatsRow> & { meta?: Record<string, unknown> }): QecCampaignStatsRow {
  const { meta, ...rest } = over;
  return {
    strong_id: 's', decoder: 'pymatching', json_metadata: meta ?? {},
    shots: 10000, errors: 0, discards: 0, seconds: 1, custom_counts: {}, ...rest,
  };
}

describe('splitCsvLine', () => {
  it('parses quoted JSON fields with doubled-quote escaping', () => {
    const line = '  1000,   12,  0, 0.5,pymatching,abc,"{""d"":3,""p"":0.01}",';
    expect(splitCsvLine(line)).toEqual([
      '  1000', '   12', '  0', ' 0.5', 'pymatching', 'abc', '{"d":3,"p":0.01}', '',
    ]);
  });
});

describe('parseSinterCsv (native format is the on-disk truth)', () => {
  it('round-trips a real sinter stats.csv into typed rows', () => {
    const rows = parseSinterCsv(campaignCsv);
    expect(rows.length).toBe(8);
    const r = rows[0];
    expect(r.shots).toBe(20000);
    expect(r.decoder).toBe('pymatching');
    expect((r.json_metadata as Record<string, unknown>).d).toBe(3);
    expect((r.json_metadata as Record<string, unknown>).label).toBe('surface');
  });

  it('returns [] for non-sinter text and skips malformed rows', () => {
    expect(parseSinterCsv('not,a,sinter,csv\n1,2,3,4')).toEqual([]);
    // A valid header with one broken data row keeps the good rows only.
    const header = campaignCsv.split('\n')[0];
    const good = campaignCsv.split('\n')[1];
    expect(parseSinterCsv(`${header}\n${good}\ngarbage,row`).length).toBe(1);
  });
});

describe('wilsonInterval', () => {
  it('brackets the point estimate and stays within [0,1]', () => {
    const w = wilsonInterval(50, 1000);
    expect(w.p).toBeCloseTo(0.05, 10);
    expect(w.lo).toBeGreaterThan(0);
    expect(w.lo).toBeLessThan(w.p);
    expect(w.hi).toBeGreaterThan(w.p);
    expect(w.hi).toBeLessThan(1);
  });

  it('matches the exact Wilson value (12/100 at z=1.96)', () => {
    const w = wilsonInterval(12, 100);
    expect(w.lo).toBeCloseTo(0.069993, 5);
    expect(w.hi).toBeCloseTo(0.198123, 5);
  });

  it('handles zero errors without going negative', () => {
    const w = wilsonInterval(0, 1000);
    expect(w.p).toBe(0);
    expect(w.lo).toBe(0);
    expect(w.hi).toBeGreaterThan(0);
  });

  it('returns zeros for zero shots', () => {
    expect(wilsonInterval(0, 0)).toEqual({ p: 0, lo: 0, hi: 0 });
  });
});

describe('thresholdSeries', () => {
  it('groups by label×distance×decoder, noise-sorted', () => {
    const series = thresholdSeries(parseSinterCsv(campaignCsv));
    // 2 distances × 2 decoders = 4 series, each with 2 noise points.
    expect(series.length).toBe(4);
    for (const s of series) {
      expect(s.points.length).toBe(2);
      expect(s.points[0].noise).toBeLessThan(s.points[1].noise);
      expect(s.label).toBe('surface');
    }
    const keys = series.map((s) => s.key).sort();
    expect(keys).toContain('surface·d3·pymatching');
    expect(keys).toContain('surface·d5·fusion_blossom');
  });
});

describe('lambdaFit — recovers a known Λ', () => {
  it('fits Λ=2 from synthetic rates that halve each distance step', () => {
    // LER halves d=3 → d=5 → d=7 at each noise point ⇒ Λ = 2.
    const rows: QecCampaignStatsRow[] = [];
    for (const p of [0.001, 0.002]) {
      const base = 0.04;
      [3, 5, 7].forEach((d, i) => {
        const ler = base / 2 ** i; // 0.04, 0.02, 0.01
        rows.push(row({ meta: { label: 'x', d, p }, shots: 100000, errors: Math.round(ler * 100000) }));
      });
    }
    const fits = lambdaFit(rows);
    expect(fits.length).toBe(1);
    expect(fits[0].decoder).toBe('pymatching');
    expect(fits[0].lambda).toBeCloseTo(2, 1);
    // Per-noise ratios are ~2 for each successive-distance pair.
    for (const e of fits[0].perNoise) expect(e.lambda).toBeCloseTo(2, 1);
  });

  it('reports null Λ when there is no suppression (rates flat/increasing)', () => {
    const rows = [3, 5].map((d) => row({ meta: { label: 'x', d, p: 0.1 }, shots: 1000, errors: 300 }));
    expect(lambdaFit(rows)[0].lambda).toBeNull();
  });
});

describe('projectedDistanceForTarget', () => {
  it('projects the distance to hit a target rate given Λ', () => {
    // base LER 0.04 at d=3, Λ=2, target 0.005 → need 3 halvings → d = 3 + 2*3 = 9.
    expect(projectedDistanceForTarget(3, 0.04, 2, 0.005)).toBe(9);
  });
  it('returns the base distance when already below target', () => {
    expect(projectedDistanceForTarget(5, 0.001, 2, 0.01)).toBe(5);
  });
  it('returns null when Λ ≤ 1 (unreachable)', () => {
    expect(projectedDistanceForTarget(3, 0.04, 1, 0.005)).toBeNull();
  });
});

describe('decoderWorkbench', () => {
  it('aggregates per decoder with pooled CI + decode time per shot', () => {
    const wb = decoderWorkbench(parseSinterCsv(campaignCsv));
    expect(wb.map((w) => w.decoder).sort()).toEqual(['fusion_blossom', 'pymatching']);
    for (const w of wb) {
      expect(w.shots).toBe(80000); // 2 distances × 2 noise × 20000 per decoder
      expect(w.rate.lo).toBeLessThanOrEqual(w.rate.p);
      expect(w.secondsPerShot).toBeGreaterThan(0);
    }
  });
});

describe('statsPointsToCsv export', () => {
  it('emits a derived analysis CSV with LER + CI columns', () => {
    const csv = statsPointsToCsv(parseSinterCsv(campaignCsv));
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('label,distance,noise,decoder,shots,errors,ler,ler_lo,ler_hi');
    expect(lines.length).toBe(9); // header + 8 rows
    expect(lines[1]).toContain('surface');
  });
});
