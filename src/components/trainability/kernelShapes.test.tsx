// @vitest-environment jsdom
/**
 * Regression tests for the wave-4 review findings that came from the kernel
 * emitting shapes the UI did not expect: null variances, failed scaling
 * points, null `preferred`, object-valued `interval`, PPE results without
 * samples. Every test renders real components against kernel-shaped payloads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { GradientsTab } from './tabs/GradientsTab';
import { ScalingTab } from './tabs/ScalingTab';
import { LieTab } from './tabs/LieTab';
import { AnalysisTabs } from './AnalysisTabs';
import { ragoneComparison } from './tabs/lieMath';
import { splitScalingPoints } from './tabs/scalingMath';
import { useTrainabilityStore } from '../../stores/trainabilityStore';
import {
  gradientsFixture,
  gradientsPpeFixture,
  gradientsPpeUnresolvedFixture,
  jobFixture,
  lieFixture,
  lieSimulableFixture,
  scalingFailedPointFixture,
  scalingFixture,
} from '../../services/trainability/fixtures';
import type { LieAlgebraResult, ScalingStudy } from '../../types/trainability';

const BAD_TEXT = /\bnull\b|\bundefined\b|\bNaN\b/;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  useTrainabilityStore.getState().reset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const textOf = (el: Element) => el.textContent ?? '';

describe('ScalingTab: failed points and a null preferred model (CR-C2, UI-1)', () => {
  it('renders without throwing and lists the failed point separately', () => {
    render(<ScalingTab data={scalingFailedPointFixture} />);
    const failed = screen.getByRole('region', { name: 'Failed points' });
    expect(textOf(failed)).toMatch(/n = 9, 4 layers/);
    expect(textOf(failed)).toMatch(/ppe_budget_exceeded/);
    // The failed point is not plotted.
    expect(screen.getByRole('img', { name: 'Gradient variance scaling with qubit count' })).toBeTruthy();
    expect(screen.getByLabelText('Model comparison')).toBeTruthy();
  });

  it('treats preferred: null as "none" and strips the repeated Inconclusive prefix', () => {
    render(<ScalingTab data={scalingFailedPointFixture} />);
    expect(screen.getByText(/No scaling model is preferred/)).toBeTruthy();
    expect(screen.getByText(/preferred: none/)).toBeTruthy();
    // Pill says Inconclusive once; the reason does not start with it again.
    expect(screen.getAllByText(/^Inconclusive/).length).toBe(1);
    expect(screen.getAllByText(/1 point failed and uninformative intervals were excluded/).length).toBeGreaterThan(0);
  });

  it('never prints null, undefined or NaN', () => {
    const { container } = render(<ScalingTab data={scalingFailedPointFixture} />);
    expect(textOf(container)).not.toMatch(BAD_TEXT);
  });

  it('splits kernel points into resolved, interval-only and failed', () => {
    const sets = splitScalingPoints([
      ...scalingFixture.points.slice(0, 2),
      { n_qubits: 24, n_layers: 4, n_params: 96, variance: null, variance_ci95: [0, 0.9], method: 'ppe' },
      { n_qubits: 9, n_layers: 4, n_params: null, variance: null, variance_ci95: null, method: null, error: { code: 'x', message: 'y' } },
      { n_qubits: 10, n_layers: 4, n_params: null, variance: null, variance_ci95: null },
    ]);
    expect(sets.resolved).toHaveLength(2);
    expect(sets.intervalOnly).toHaveLength(1);
    expect(sets.failed).toHaveLength(2);
  });

  it('draws an interval-only point as a hollow whisker, with no marker and a stated reason', () => {
    const study: ScalingStudy = {
      ...scalingFixture,
      points: [
        ...scalingFixture.points.slice(0, 5),
        { n_qubits: 24, n_layers: 4, n_params: 96, variance: null, variance_ci95: [1e-9, 0.9], method: 'ppe', interval_kind: 'truncation' },
      ],
    };
    const { container } = render(<ScalingTab data={study} />);
    expect(screen.getByText('Interval-only points')).toBeTruthy();
    const withHollow = container.querySelectorAll('figure circle').length;
    expect(textOf(container)).not.toMatch(BAD_TEXT);
    cleanup();
    const baseline = render(<ScalingTab data={{ ...study, points: study.points.slice(0, 5) }} />);
    // The hollow whisker adds no marker: same circle count as without it.
    expect(baseline.container.querySelectorAll('figure circle').length).toBe(withHollow);
  });

  it('shows a legend only for the methods present and the fits that exist', () => {
    const samplingOnly: ScalingStudy = {
      ...scalingFixture,
      points: scalingFixture.points.filter((p) => p.method === 'sampling'),
      fits: [{ ...scalingFixture.fits[0], power_law: null }],
    };
    render(<ScalingTab data={samplingOnly} />);
    const legend = document.querySelector('.lab-chart__legend')!;
    expect(textOf(legend)).toContain('sampling (95% bootstrap CI)');
    expect(textOf(legend)).not.toContain('Pauli propagation');
    expect(textOf(legend)).not.toContain('power-law alternative');
    expect(textOf(legend)).toContain('exponential fit');
  });

  it('leads with the preferred model: a preferred power law is the headline', () => {
    const power: ScalingStudy = {
      ...scalingFixture,
      fits: [{ ...scalingFixture.fits[0], preferred: 'power_law', verdict: 'polynomial', summary: 'Var ∝ n^−2.7' }],
    };
    render(<ScalingTab data={power} />);
    const headline = screen.getByLabelText('Preferred scaling model');
    expect(textOf(headline)).toMatch(/Preferred: power law.*α = 2\.7/);
    expect(textOf(headline)).not.toMatch(/β/);
  });

  it('renders every failure mode at once without crashing', () => {
    const everything: ScalingStudy = {
      points: [{ n_qubits: 3, n_layers: 2, n_params: null, variance: null, variance_ci95: null, method: null, error: { code: 'e', message: 'm' } }],
      fits: [{ n_layers: 2, exponential: null, power_law: null, preferred: null, delta_aic: null, verdict: 'inconclusive', summary: '' }],
    };
    const { container } = render(<ScalingTab data={everything} />);
    expect(screen.getByText('No plottable points')).toBeTruthy();
    expect(textOf(container)).not.toMatch(BAD_TEXT);
    cleanup();
    const { container: empty } = render(<ScalingTab data={{ points: [], fits: [] }} />);
    expect(textOf(empty)).toMatch(/No scaling points/);
  });
});

describe('GradientsTab: PPE and unresolved results (CR-H1, UI-4)', () => {
  it('prints no null / NaN for a complete PPE result and says it is exact', () => {
    const { container } = render(<GradientsTab data={gradientsPpeFixture} />);
    expect(textOf(container)).not.toMatch(BAD_TEXT);
    expect(textOf(container)).toMatch(/exact Pauli propagation, no sampling/);
    expect(screen.getAllByText('rigorous truncation interval').length).toBeGreaterThan(0);
    // The interval object is never treated as a pair: numbers come from variance_mean_ci95.
    expect(textOf(container)).toContain('[0.011, 0.012]');
  });

  it('labels a sampling result by interval_kind: bootstrap', () => {
    render(<GradientsTab data={gradientsFixture} />);
    expect(screen.getAllByText('95% bootstrap CI').length).toBeGreaterThan(0);
  });

  it('shows unresolved gates as interval-only with a hatch, never as a number', () => {
    const { container } = render(<GradientsTab data={gradientsPpeUnresolvedFixture} />);
    expect(textOf(container)).not.toMatch(BAD_TEXT);
    expect(screen.getByText('Mean variance is unresolved')).toBeTruthy();
    expect(screen.getAllByText('unresolved (interval only)').length).toBeGreaterThan(0);
    const table = screen.getByRole('table', { name: 'Per-parameter gradient statistics' });
    const rows = within(table).getAllByRole('row').slice(1);
    // Parameter 0 resolved, the other five unresolved.
    expect(within(rows[0]).queryByText('unresolved')).toBeNull();
    expect(rows.slice(1).every((r) => within(r).queryByText('unresolved'))).toBe(true);
    expect(container.querySelector('figure pattern')).toBeTruthy();
    expect(screen.getByText(/Pauli propagation hit its budget/)).toBeTruthy();
  });

  it('shows the empirical cost variance when the kernel reports it', () => {
    render(<GradientsTab data={gradientsFixture} />);
    expect(screen.getByText('Cost variance Var[C]')).toBeTruthy();
    expect(screen.getByText('0.0107')).toBeTruthy();
  });
});

describe('LieTab: Ragone predicts COST variance (PH-C2)', () => {
  it('compares predicted Var[C] with the empirical cost variance, not the gradient variance', () => {
    render(<LieTab data={lieFixture} gradients={gradientsFixture} />);
    expect(screen.getByText('Predicted vs empirical cost variance')).toBeTruthy();
    expect(screen.getByText('Predicted Var[C] (Ragone et al.)')).toBeTruthy();
    expect(screen.getByText('Empirical Var[C]')).toBeTruthy();
    // 0.0107 / 0.0089 = 1.2; the gradient variance (0.0115 / 0.0089 = 1.29) must not be used.
    expect(screen.getByText('1.2×')).toBeTruthy();
    expect(screen.queryByText('0.0115')).toBeNull();
  });

  it('shows the ratio only when both quantities exist', () => {
    const noCost = { ...gradientsFixture, cost_variance: null, cost_variance_ci95: null };
    render(<LieTab data={lieFixture} gradients={noCost} />);
    expect(screen.getByText('not measured')).toBeTruthy();
    expect(screen.queryByText('Empirical / predicted')).toBeNull();
    cleanup();
    render(<LieTab data={lieFixture} gradients={gradientsPpeFixture} />);
    expect(screen.queryByText('Empirical / predicted')).toBeNull();
    expect(screen.getByText(/Pauli propagation does not/)).toBeTruthy();
    cleanup();
    render(<LieTab data={{ ...lieFixture, prediction_applicable: false, predicted_variance: null }} gradients={gradientsFixture} />);
    expect(screen.getByText('not applicable')).toBeTruthy();
    expect(screen.queryByText('Empirical / predicted')).toBeNull();
  });

  it('computes the comparison in lieMath', () => {
    expect(ragoneComparison(lieFixture, gradientsFixture)).toEqual({ predicted: 0.0089, empirical: 0.0107, ratio: 0.0107 / 0.0089 });
    expect(ragoneComparison(lieFixture, undefined).ratio).toBeNull();
    expect(ragoneComparison({ ...lieFixture, predicted_variance: 0 }, gradientsFixture).ratio).toBeNull();
  });
});

describe('LieTab: verdict honesty and exact integers (UI-3, PH-M3, medium 4)', () => {
  const smallButNotInG: LieAlgebraResult = {
    ...lieSimulableFixture,
    purity: { initial_state: 0, observable: 0, observable_in_algebra: false, state_in_algebra: false },
    prediction_applicable: false,
    predicted_variance: null,
  };

  it('is neutral, not green, when 𝔤-sim does not apply to this observable/state', () => {
    const { container } = render(<LieTab data={smallButNotInG} />);
    expect(screen.getAllByText('Small DLA; 𝔤-sim does not apply to this observable/state').length).toBeGreaterThanOrEqual(2);
    const pill = screen.getAllByText('Small DLA; 𝔤-sim does not apply to this observable/state')[0].closest('.lab-pill');
    expect(pill?.className).not.toContain('success');
    expect(container.querySelector('.lab-callout--success')).toBeNull();
    expect(screen.queryByText(/Trainable and classically simulable/)).toBeNull();
  });

  it('shows the meter as an exact integer (4095, not 4,100)', () => {
    render(<LieTab data={{ ...lieFixture, n_qubits: 6, dimension: 4095, dimension_lower_bound: 4095 }} />);
    const meter = screen.getByRole('meter', { name: 'dim 𝔤 (log scale)' });
    expect(textOf(meter.parentElement ?? meter)).toContain('4,095');
    expect(textOf(meter.parentElement ?? meter)).not.toContain('4,100');
  });

  it('does not call "Clifford / none" a fixed-gates fact when there are no fixed gates', () => {
    render(<LieTab data={{ ...lieFixture, fixed_gates: { clifford: true, handled_by: 'none' } }} />);
    expect(screen.getByText('no fixed gates in the circuit')).toBeTruthy();
    expect(screen.queryByText('Clifford')).toBeNull();
  });
});

describe('AnalysisTabs error boundary (CR-C2)', () => {
  it('contains a crashing tab to a designed in-panel error and recovers on tab change', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const malformed = jobFixture({
      results: { scaling: { points: [{ n_qubits: 2, n_layers: 4 }], fits: null } as never, lie: lieFixture },
    });
    useTrainabilityStore.setState({ activeTab: 'scaling' });
    render(<AnalysisTabs job={malformed} />);
    expect(screen.getByText('This panel hit an error')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reload panel/ })).toBeTruthy();
    // The tab bar is still there and another tab still renders.
    fireEvent.click(screen.getByRole('tab', { name: 'Lie algebra' }));
    expect(screen.queryByText('This panel hit an error')).toBeNull();
    expect(screen.getByText('Simulability verdict')).toBeTruthy();
  });
});
