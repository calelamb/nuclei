import { describe, it, expect } from 'vitest';
import syntheticCsv from './__fixtures__/synthetic_rounds.csv?raw';
import { parseSinterCsv } from '../types/qecStats';
import type { QecCampaignStatsRow } from '../types/qec';
import { lambdaEstimates, likelihoodSeries, estimateLambda, rowProblem, qecFigureMetadata } from './qecFit';
import { qecRatesToCsv } from './qecExport';

function mk(
  meta: Record<string, unknown>,
  errors: number,
  o: { shots?: number; discards?: number; decoder?: string } = {},
): QecCampaignStatsRow {
  const shots = o.shots ?? 100000;
  return {
    shots, errors, discards: o.discards ?? 0, seconds: 1, decoder: o.decoder ?? 'pymatching',
    strong_id: `${JSON.stringify(meta)}-${errors}`, json_metadata: meta, custom_counts: {},
  };
}

describe('experiments are not pooled (synthetic r=d vs r=3d share a label)', () => {
  const rows = parseSinterCsv(syntheticCsv);
  it('Λ: one fit per (experiment, p), each over exactly 3 points', () => {
    const got = lambdaEstimates(rows, { units: 'per_shot' });
    expect(got).toHaveLength(6);
    for (const g of got) {
      expect(g.estimate.nPoints).toBe(3);
      expect(g.estimate.distances).toEqual([3, 5, 7]);
    }
    expect(new Set(got.map((g) => g.label))).toEqual(new Set(['synth r=d', 'synth r=3d']));
  });
  it('series: one monotone-in-p curve per (experiment, d), no repeated p', () => {
    const { series } = likelihoodSeries(rows, { units: 'per_shot' });
    expect(series).toHaveLength(6);
    for (const s of series) {
      const ps = s.points.map((p) => p.noise);
      expect(ps).toHaveLength(3);
      expect(new Set(ps).size).toBe(3);
      expect(ps).toEqual([...ps].sort((a, b) => a - b));
    }
    expect(new Set(series.map((s) => s.key)).size).toBe(6);
  });
});

describe('experiment identity', () => {
  const sweep = (extra: Record<string, unknown>, errs: number[]) =>
    [3, 5, 7].map((d, i) => mk({ d, p: 0.01, label: 'x', ...extra }, errs[i]));

  it('fixed rounds across distances stay one experiment', () => {
    const rows = sweep({ r: 10 }, [900, 300, 100]);
    expect(lambdaEstimates(rows)).toHaveLength(1);
  });
  it('different noise models with the same label are separate', () => {
    const rows = [...sweep({ noise_model: 'A' }, [900, 300, 100]), ...sweep({ noise_model: 'B' }, [800, 400, 150])];
    const got = lambdaEstimates(rows);
    expect(got).toHaveLength(2);
    expect(got.every((g) => g.estimate.nPoints === 3)).toBe(true);
    expect(new Set(got.map((g) => g.label)).size).toBe(2);
  });
  it('unlabeled rows are grouped by context, not pooled across noise models nor split per row', () => {
    const rows = [
      ...[3, 5, 7].map((d, i) => mk({ d, p: 0.01, noise_model: 'A' }, [900, 300, 100][i])),
      ...[3, 5, 7].map((d, i) => mk({ d, p: 0.01, noise_model: 'B' }, [800, 400, 150][i])),
    ];
    expect(lambdaEstimates(rows)).toHaveLength(2);
    const { series } = likelihoodSeries(
      [...rows, ...[3, 5, 7].map((d, i) => mk({ d, p: 0.02, noise_model: 'A' }, [1900, 700, 300][i]))],
    );
    expect(series).toHaveLength(6);
    expect(series.filter((s) => s.points.length === 2)).toHaveLength(3);
  });
});

describe('malformed and empty rows never throw', () => {
  const bad = mk({ d: 3, p: 0.01, label: 'x' }, 500, { shots: 100, discards: 0 });
  const allDiscarded = mk({ d: 5, p: 0.01, label: 'x', r: 5 }, 0, { shots: 100, discards: 100 });
  it('rowProblem classifies', () => {
    expect(rowProblem(bad)).toBe('invalid');
    expect(rowProblem(mk({ d: 3, p: 0.1 }, 5, { shots: 10, discards: 10 }))).toBe('invalid');
    expect(rowProblem(allDiscarded)).toBe('no_kept');
    expect(rowProblem(mk({ d: 3, p: 0.1 }, 5))).toBeNull();
  });
  it('series skip and count them, separately from rounds exclusions', () => {
    const good = mk({ d: 3, p: 0.01, label: 'x', r: 3 }, 50);
    for (const units of ['per_shot', 'per_round'] as const) {
      const r = likelihoodSeries([good, bad, allDiscarded], { units });
      expect(r.invalid).toBe(1);
      expect(r.noKept).toBe(1);
      expect(r.excluded).toBe(0);
      expect(r.series.flatMap((s) => s.points)).toHaveLength(1);
    }
    expect(() => lambdaEstimates([good, bad, allDiscarded])).not.toThrow();
  });
});

describe('Λ interval uses heteroscedastic slope variance', () => {
  it('matches sum((x-xbar)^2 sigma_i^2)/Sxx^2 for errors (1000,100,5)', () => {
    const errs = [1000, 100, 5];
    const pts = [3, 5, 7].map((d, i) => ({ distance: d, errors: errs[i], rate: errs[i] / 1e6 }));
    const e = estimateLambda(pts)!;
    const xs = [3, 5, 7];
    const sxx = 8;
    const varSlope = xs.reduce((s, x, i) => s + (x - 5) ** 2 / errs[i], 0) / sxx ** 2;
    const half = (e.slope.high - e.slope.low) / 2;
    expect(half).toBeGreaterThanOrEqual(Math.sqrt(varSlope) * (1 - 1e-12));
    // The old mean-variance shortcut is narrower than the correct sampling interval.
    const meanVar = errs.reduce((s, k) => s + 1 / k, 0) / 3;
    expect(half).toBeGreaterThan(Math.sqrt(meanVar / sxx));
  });
  it('reports zero-error distances it dropped', () => {
    const pts = [
      { distance: 3, errors: 500, rate: 5e-3 }, { distance: 5, errors: 50, rate: 5e-4 },
      { distance: 7, errors: 5, rate: 5e-5 }, { distance: 9, errors: 0, rate: 0 },
    ];
    const e = estimateLambda(pts)!;
    expect(e.droppedZeroError).toEqual([9]);
    expect(e.distances).toEqual([3, 5, 7]);
  });
});

describe('provenance metadata names both interval conventions', () => {
  it('states the confidence level of the whiskers and of Λ', () => {
    const m = qecFigureMetadata('per_shot');
    expect(m.ci_method).toMatch(/3\.7/);
    expect(m.lambda_ci).toMatch(/95%/);
  });
});

describe('qecRatesToCsv matches the figure', () => {
  const rows = parseSinterCsv(syntheticCsv);
  const parse = (csv: string) => {
    const [h, ...lines] = csv.trim().split('\n');
    const cols = h.split(',');
    return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
  };
  it('per-shot rate/low/high equal the plotted series, with provenance columns', () => {
    const out = parse(qecRatesToCsv(rows, { units: 'per_shot' }));
    const { series } = likelihoodSeries(rows, { units: 'per_shot' });
    const plotted = series.flatMap((s) => s.points.map((p) => p.rate.p));
    expect(out).toHaveLength(rows.length);
    for (const r of out) {
      expect(plotted.some((v) => Math.abs(v - Number(r.rate)) <= 1e-7 * v)).toBe(true);
      expect(r.units).toBe('per_shot');
      expect(r.ci_method).toBe('likelihood_ratio');
      expect(r.max_likelihood_factor).toBe('1000');
      expect(Number(r.kept_shots)).toBe(Number(r.shots) - Number(r.discards));
      expect(Number(r.rate_low)).toBeLessThanOrEqual(Number(r.rate));
      expect(Number(r.rate_high)).toBeGreaterThanOrEqual(Number(r.rate));
    }
  });
  it('exports at most 8 significant figures, never binary noise like 0.010375899999999999 (qec-r-11)', () => {
    const csv = qecRatesToCsv(rows, { units: 'per_shot' });
    const longDigits = csv.split('\n').slice(1).flatMap((l) => l.split(',')).filter((c) => /^[\d.]+$/.test(c) && c.replace(/^0\.0*/, '').replace('.', '').length > 8);
    expect(longDigits).toEqual([]);
  });
  it('per-round export uses per-round rates and says so', () => {
    const out = parse(qecRatesToCsv(rows, { units: 'per_round' }));
    const shot = parse(qecRatesToCsv(rows, { units: 'per_shot' }));
    expect(out.every((r) => r.units === 'per_round')).toBe(true);
    expect(Number(out[0].rate)).toBeLessThan(Number(shot[0].rate));
  });
  it('flags invalid and empty rows instead of throwing', () => {
    const bad = mk({ d: 3, p: 0.01, label: 'x' }, 500, { shots: 100 });
    const none = mk({ d: 5, p: 0.01, label: 'x' }, 0, { shots: 100, discards: 100 });
    const out = parse(qecRatesToCsv([bad, none], { units: 'per_shot' }));
    expect(out.map((r) => r.note)).toEqual(['invalid: errors exceed kept shots', 'no kept shots']);
    expect(out.every((r) => r.rate === '')).toBe(true);
  });
});

describe('rounds scheme names when r=d and fixed r share a decoder and label', () => {
  const sweep = (rounds: (d: number) => number, errs: number[]) =>
    [3, 5, 7].map((d, i) => mk({ d, p: 0.01, label: 'x', r: rounds(d) }, errs[i]));
  it('r=d family and fixed r=15 family are two experiments with honest names', () => {
    const rows = [...sweep((d) => d, [900, 300, 100]), ...sweep(() => 15, [500, 200, 90])];
    const got = lambdaEstimates(rows);
    expect(got).toHaveLength(2);
    expect(got.map((g) => g.label).sort()).toEqual(['x r=15', 'x r=d']);
    const { series } = likelihoodSeries(rows);
    expect(new Set(series.map((s) => s.label))).toEqual(new Set(['x r=15', 'x r=d']));
  });
});

describe('qecRatesToCsv decoder column and figure source metadata', () => {
  it('exports the original decoder, not the group-by-decorated one', () => {
    const decorated = mk({ d: 3, p: 0.01, label: 'x' }, 10, { decoder: 'pymatching [basis=X]' });
    const original = { ...decorated, decoder: 'pymatching' };
    const csv = qecRatesToCsv([decorated], { originals: new Map([[decorated.strong_id, original]]) });
    const [h, line] = csv.trim().split('\n');
    expect(line.split(',')[h.split(',').indexOf('decoder')]).toBe('pymatching');
    expect(h.split(',')).toContain('series');
    expect(csv).toContain('pymatching [basis=X]');
  });
  it('figure metadata ties the figure to its data', () => {
    const rows = [mk({ d: 3, p: 0.01 }, 10), mk({ d: 5, p: 0.01 }, 5)];
    const m = qecFigureMetadata('per_shot', undefined, [], { file: 'run1.csv', rows });
    expect(m.source.file).toBe('run1.csv');
    expect(m.source.tasks).toBe(2);
    expect(m.source.strong_ids).toHaveLength(2);
    expect(m.source.strong_id_digest).toMatch(/^[0-9a-f]{16}$/);
    const again = qecFigureMetadata('per_shot', undefined, [], { file: 'run1.csv', rows: [...rows].reverse() });
    expect(again.source.strong_id_digest).toBe(m.source.strong_id_digest);
    expect(qecFigureMetadata('per_shot').source).toBeNull();
  });
  it('states the Λ interval degrees-of-freedom caveat', () => {
    expect(qecFigureMetadata('per_shot').lambda_ci).toMatch(/degrees of freedom/);
  });
});
