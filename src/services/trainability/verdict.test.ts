import { describe, expect, it } from 'vitest';
import { deriveSimulabilityVerdict, deriveTrainabilityVerdict, primaryFit, SIMULABILITY_CAVEAT } from './verdict';
import {
  gradientsFixture,
  gradientsPpeFixture,
  lieFixture,
  lieSimulableFixture,
  lieTruncatedFixture,
  lintDiagnosticsFixture,
  resultsFixture,
  scalingFixture,
  scalingInconclusiveFixture,
} from './fixtures';

describe('deriveTrainabilityVerdict', () => {
  it('is unknown with no evidence', () => {
    expect(deriveTrainabilityVerdict({}, [])).toEqual({ risk: 'unknown', evidence: [] });
  });

  it('is high when the scaling fit says barren plateau', () => {
    const v = deriveTrainabilityVerdict(resultsFixture, []);
    expect(v.risk).toBe('high');
    expect(v.evidence[0].level).toBe('high');
  });

  it('is low for polynomial scaling, bumped to medium by a global-cost lint', () => {
    const polynomial = {
      scaling: { ...scalingFixture, fits: [{ ...scalingFixture.fits[0], verdict: 'polynomial' as const, summary: 'poly' }] },
    };
    expect(deriveTrainabilityVerdict(polynomial, []).risk).toBe('low');
    expect(deriveTrainabilityVerdict(polynomial, lintDiagnosticsFixture).risk).toBe('medium');
  });

  it('falls back to theory when scaling is inconclusive or absent', () => {
    expect(deriveTrainabilityVerdict({ scaling: scalingInconclusiveFixture, lie: lieFixture }, []).risk).toBe('high');
    expect(deriveTrainabilityVerdict({ lie: lieSimulableFixture }, []).risk).toBe('low');
    // A truncated exponential DLA is a lower bound: medium, not high.
    expect(deriveTrainabilityVerdict({ lie: lieTruncatedFixture }, []).risk).toBe('medium');
  });

  it('uses lint alone as medium evidence', () => {
    expect(deriveTrainabilityVerdict({}, lintDiagnosticsFixture).risk).toBe('medium');
  });

  it('notes very small gradient variance', () => {
    const v = deriveTrainabilityVerdict({ gradients: { ...gradientsFixture, variance_mean: 1e-9 } }, []);
    expect(v.evidence.some((e) => e.source === 'gradients' && e.level === 'medium')).toBe(true);
  });
});

describe('deriveSimulabilityVerdict', () => {
  it('reports the Lie verdict and no PPE evidence for sampling', () => {
    const v = deriveSimulabilityVerdict({ lie: lieSimulableFixture, gradients: gradientsFixture });
    expect(v.kind).toBe('g_sim_feasible');
    expect(v.ppe.used).toBe(false);
    expect(v.caveat).toBe(SIMULABILITY_CAVEAT);
  });

  it('collects PPE estimability evidence from gradients and scaling points', () => {
    const v = deriveSimulabilityVerdict({ lie: lieFixture, gradients: gradientsPpeFixture, scaling: scalingFixture });
    expect(v.ppe.used).toBe(true);
    expect(v.ppe.points).toBe(3);
    expect(v.ppe.maxQubits).toBe(48);
    expect(v.ppe.worstRelativeWidth).toBeGreaterThan(0);
    expect(v.evidence.join(' ')).toContain('up to 48 qubits');
  });

  it('is unknown without a Lie result', () => {
    expect(deriveSimulabilityVerdict({}).kind).toBe('unknown');
  });
});

describe('primaryFit', () => {
  it('prefers the fit with the most layers', () => {
    const fits = [
      { ...scalingFixture.fits[0], n_layers: 2 },
      { ...scalingFixture.fits[0], n_layers: 6 },
    ];
    expect(primaryFit(fits)?.n_layers).toBe(6);
    expect(primaryFit([])).toBeNull();
    expect(primaryFit(undefined)).toBeNull();
  });
});
