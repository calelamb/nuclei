import { describe, expect, it } from 'vitest';
import { buildDigest, DIGEST_CAPS, MIN_SCORED_ELITES } from './digest';
import { frontierFixture } from './fixtures';

describe('buildDigest', () => {
  it('caps elites at the best 30 and weakest 10 and discloses N of M', () => {
    const digest = buildDigest(frontierFixture(60));
    expect(digest.payload.elites).toHaveLength(DIGEST_CAPS.topElites + DIGEST_CAPS.bottomElites);
    expect(digest.payload.elites.filter((e) => e.rank === 'top')).toHaveLength(30);
    expect(digest.disclosure).toContain('Digest shows 40 of 60 scored archive elites');
    expect(digest.disclosure).toContain('Per-feature summaries use 60 of 60');
    const top = digest.payload.elites.filter((e) => e.rank === 'top').map((e) => e.fitness);
    expect(top).toEqual([...top].sort((a, b) => b - a));
  });

  it('keeps small archives whole and reads beta, hardness and DLA', () => {
    const digest = buildDigest(frontierFixture(10));
    expect(digest.payload.elites).toHaveLength(10);
    expect(digest.scoredElites).toBeGreaterThanOrEqual(MIN_SCORED_ELITES);
    const e = digest.payload.elites[0];
    expect(e.features).toMatchObject({ n_layers: expect.any(Number), entangler: 'cz' });
    expect(e.beta).not.toBeNull();
    expect(e.beta_ci95).toHaveLength(2);
    expect(e.hardness).not.toBeNull();
    expect(typeof e.hardness_censored).toBe('boolean');
    expect(e.log2_dla_dimension).not.toBeNull();
    expect(e.scaling_points).toBe(4);
  });

  it('summarises every feature against fitness with capped buckets', () => {
    const { payload } = buildDigest(frontierFixture(40));
    const layers = payload.feature_summaries.find((f) => f.feature === 'n_layers');
    expect(layers?.kind).toBe('numeric');
    expect(layers!.buckets.length).toBeLessThanOrEqual(DIGEST_CAPS.numericBins);
    const pattern = payload.feature_summaries.find((f) => f.feature === 'entangler_pattern');
    expect(pattern?.kind).toBe('categorical');
    expect(pattern!.buckets.reduce((s, b) => s + b.n, 0)).toBe(40);
    expect(payload.feature_summaries.find((f) => f.feature === 'rotation_axis_counts')).toBeUndefined();
  });

  it('says so when the evaluator records no features', () => {
    const digest = buildDigest(frontierFixture(10, false));
    expect(digest.payload.feature_source).toBe('descriptors_only');
    expect(digest.payload.feature_summaries).toEqual([]);
    expect(digest.disclosure).toContain('records no structural features');
    expect(digest.payload.elites[0].features).toBeNull();
    expect(Object.keys(digest.payload.elites[0].descriptors)).toContain('log2_dla_dimension');
  });

  it('is deterministic and counts non-scored candidates', () => {
    const fx = frontierFixture(9);
    expect(buildDigest(fx).text).toBe(buildDigest(fx).text);
    const failed = { ...fx.candidates['c-0001'], id: 'c-0099', evaluation: { ...fx.candidates['c-0001'].evaluation!, status: 'failed' as const } };
    const digest = buildDigest({ ...fx, candidates: { ...fx.candidates, [failed.id]: failed } });
    expect(digest.payload.counts).toMatchObject({ candidates: 10, scored: 9, failed: 1 });
    expect(digest.disclosure).toContain('1 failed');
  });
});
