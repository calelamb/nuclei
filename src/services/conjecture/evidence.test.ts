import { describe, expect, it } from 'vitest';
import { normalizeEvidence } from './evidence';
import { fixtureEvidenceItem } from './fixtures';

describe('normalizeEvidence', () => {
  it('reads the kernel item', () => {
    const row = normalizeEvidence(fixtureEvidenceItem(3, 'violates'), 0);
    expect(row).toMatchObject({ circuitIndex: 3, variantId: 'v3', outcome: 'violates', beta: 0.34, seed: 1003, note: 'beta_upper95 0.36 is not below 0.1' });
    expect(row.betaCi![1]).toBeCloseTo(0.36);
    expect(row.betaUpper95).toBeCloseTo(0.36);
    expect(row.observed).toBeCloseTo(0.36);
    expect(row.points.map((p) => p.n)).toEqual([8, 16, 32, 64, 128]);
    expect(row.points[0].lo).not.toBeNull();
  });

  it('handles interval observations, null fits and a missing outcome', () => {
    const row = normalizeEvidence({ circuit_index: 1, meets: true, fit: null, quantity: { observed: [1.5, null] }, points: [{ n_qubits: 8, variance: 0.5, interval: [0.4, 0.6] }] }, 9);
    expect(row).toMatchObject({ circuitIndex: 1, outcome: 'meets', beta: null, observed: [1.5, null] });
    expect(row.points[0]).toMatchObject({ n: 8, lo: 0.4, hi: 0.6 });
  });

  it('degrades to indeterminate rather than inventing a verdict', () => {
    expect(normalizeEvidence(null, 4)).toMatchObject({ circuitIndex: 4, outcome: 'indeterminate', beta: null, points: [] });
    expect(normalizeEvidence({ outcome: 'weird' }, 0).outcome).toBe('indeterminate');
  });
});
