import { describe, expect, it } from 'vitest';
import {
  deriveSimulabilityVerdict,
  deriveTrainabilityVerdict,
  G_SIM_NOT_APPLICABLE_TEXT,
  gSimNotApplicable,
  NO_PARAMETERS_TEXT,
  primaryFit,
  SIMULABILITY_CAVEAT,
  stripVerdictPrefix,
} from './verdict';
import {
  gradientsFixture,
  gradientsPpeFixture,
  gradientsPpeUnresolvedFixture,
  lieFixture,
  lieSimulableFixture,
  lieTruncatedFixture,
  lintDiagnosticsFixture,
  resultsFixture,
  scalingFailedPointFixture,
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

describe('kernel-shaped gradients (CR-H1)', () => {
  it('derives evidence from a complete PPE result without touching the interval object', () => {
    const v = deriveTrainabilityVerdict({ gradients: gradientsPpeFixture }, []);
    const text = v.evidence.map((e) => e.text).join(' ');
    expect(text).toContain('exact Pauli propagation, no sampling');
    expect(text).not.toMatch(/\bnull\b|NaN|undefined/);
  });

  it('says the mean variance is unresolved for an incomplete PPE run, and why', () => {
    const v = deriveTrainabilityVerdict({ gradients: gradientsPpeUnresolvedFixture }, []);
    const g = v.evidence.find((e) => e.source === 'gradients')!;
    expect(g.level).toBe('info');
    expect(g.text).toContain('unresolved');
    expect(g.text).toContain('rigorous truncation interval [0, 0.97]');
    expect(g.text).toContain('Pauli propagation hit its budget');
    expect(g.text).not.toMatch(/\bnull\b|NaN/);
  });

  it('never reports "low" from gradients alone and tolerates a null mean in simulability', () => {
    expect(deriveTrainabilityVerdict({ gradients: gradientsPpeUnresolvedFixture }, []).risk).toBe('unknown');
    const sim = deriveSimulabilityVerdict({ gradients: gradientsPpeUnresolvedFixture, scaling: scalingFailedPointFixture });
    expect(sim.ppe.used).toBe(true);
    expect(sim.ppe.worstRelativeWidth).toBeNull();
  });
});

describe('scaling evidence', () => {
  it('does not repeat "Inconclusive" and counts failed points as excluded', () => {
    const v = deriveTrainabilityVerdict({ scaling: scalingFailedPointFixture }, []);
    const texts = v.evidence.map((e) => e.text);
    expect(texts.some((t) => /^Scaling is inconclusive: 1 point failed/.test(t))).toBe(true);
    expect(texts.join(' ')).not.toMatch(/Inconclusive: Inconclusive|inconclusive: Inconclusive/i);
    expect(texts).toContain('1 scaling point failed and is excluded from the fit.');
  });

  it('strips the verdict prefix only at the start', () => {
    expect(stripVerdictPrefix('Inconclusive: too few points')).toBe('too few points');
    expect(stripVerdictPrefix('inconclusive - spread too wide')).toBe('spread too wide');
    expect(stripVerdictPrefix('The fit is inconclusive: x')).toBe('The fit is inconclusive: x');
    expect(stripVerdictPrefix(null)).toBe('');
  });
});

describe('verdict honesty (UI-3, PH-M3)', () => {
  const noOverlap = {
    ...lieSimulableFixture,
    purity: { initial_state: 0, observable: 0, observable_in_algebra: false, state_in_algebra: false },
  };

  it('treats a small DLA with no overlap as neutral: no "low" risk, no 𝔤-sim claim', () => {
    expect(gSimNotApplicable(noOverlap)).toBe(true);
    expect(gSimNotApplicable(lieSimulableFixture)).toBe(false);
    expect(gSimNotApplicable({ ...lieSimulableFixture, purity: { ...lieSimulableFixture.purity, observable: 0 } })).toBe(true);
    const v = deriveTrainabilityVerdict({ lie: noOverlap }, []);
    expect(v.risk).toBe('unknown');
    expect(v.evidence[0]).toMatchObject({ source: 'lie', level: 'info', text: G_SIM_NOT_APPLICABLE_TEXT });
    const sim = deriveSimulabilityVerdict({ lie: noOverlap });
    expect(sim.kind).toBe('g_sim_not_applicable');
    expect(sim.summary).toBe('Small DLA; 𝔤-sim does not apply to this observable/state');
  });

  it('still says low risk / simulable when O or ρ does overlap 𝔤', () => {
    expect(deriveTrainabilityVerdict({ lie: lieSimulableFixture }, []).risk).toBe('low');
    expect(deriveSimulabilityVerdict({ lie: lieSimulableFixture }).kind).toBe('g_sim_feasible');
  });

  it('is not applicable, never "low", for a parameter-free circuit (m = 0)', () => {
    const v = deriveTrainabilityVerdict(
      { lie: lieSimulableFixture, scaling: { ...scalingFixture, fits: [{ ...scalingFixture.fits[0], verdict: 'polynomial', summary: 'p' }] } },
      [],
      { nParameters: 0 },
    );
    expect(v.risk).toBe('unknown');
    expect(v.notApplicable).toBe(true);
    expect(v.evidence).toHaveLength(1);
    expect(v.evidence[0].text).toBe(NO_PARAMETERS_TEXT);
    expect(deriveTrainabilityVerdict({}, [], { nParameters: 6 }).notApplicable).toBeUndefined();
  });

  it('uses the addendum wording for the caveat, without literal asterisks', () => {
    expect(SIMULABILITY_CAVEAT).not.toContain('*');
    expect(SIMULABILITY_CAVEAT).toContain('It is not a proof of classical hardness.');
    expect(SIMULABILITY_CAVEAT).toContain('A high score is a lead to investigate, not a counterexample.');
  });
});
