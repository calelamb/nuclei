import { describe, expect, it } from 'vitest';
import { normalizeEvidence } from './evidence';
import { fixtureEvidenceItem } from './fixtures';

describe('normalizeEvidence', () => {
  it('reads the canonical item', () => {
    const row = normalizeEvidence(fixtureEvidenceItem(3, 'violates'), 0);
    expect(row).toMatchObject({ circuitIndex: 3, outcome: 'violates', beta: 0.34, seed: 1003 });
    expect(row.betaCi).toEqual([0.33, 0.36]);
    expect(row.points.map((p) => p.n)).toEqual([8, 16, 32, 64, 128]);
    expect(row.points[0].lo).not.toBeNull();
  });

  it('accepts spelling variants and nested fits', () => {
    const row = normalizeEvidence({ index: 1, meets: true, fit: { beta: 0.1, beta_ci95: [0.05, 0.15] }, points: [{ n: 8, variance: 0.5, interval: [0.4, 0.6] }] }, 9);
    expect(row).toMatchObject({ circuitIndex: 1, outcome: 'meets', beta: 0.1, betaUpper95: 0.15 });
    expect(row.points[0]).toMatchObject({ n: 8, lo: 0.4, hi: 0.6 });
  });

  it('degrades to indeterminate rather than inventing a verdict', () => {
    expect(normalizeEvidence(null, 4)).toMatchObject({ circuitIndex: 4, outcome: 'indeterminate', beta: null, points: [] });
    expect(normalizeEvidence({ outcome: 'weird' }, 0).outcome).toBe('indeterminate');
  });
});
