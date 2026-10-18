// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GradientsTab } from './tabs/GradientsTab';
import { ScalingTab } from './tabs/ScalingTab';
import { LieTab } from './tabs/LieTab';
import { EntanglementPanel, ExpressibilityPanel } from './tabs/DistributionsTab';
import { LandscapeTab } from './tabs/LandscapeTab';
import { centerPercent } from './tabs/landscapeDraw';
import { AnalysisPanel } from './AnalysisPanel';
import { analysisView } from './analysisState';
import {
  entanglementFixture,
  expressibilityFixture,
  gradientsFixture,
  gradientsPpeFixture,
  jobFixture,
  landscapeFixture,
  lieFixture,
  lieSimulableFixture,
  lieTruncatedFixture,
  scalingFixture,
  scalingInconclusiveFixture,
} from '../../services/trainability/fixtures';

beforeEach(() => {
  // jsdom has no canvas; the landscape draws into a stub.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GradientsTab', () => {
  it('renders a named chart with a text summary, KPIs and a per-parameter table', () => {
    render(<GradientsTab data={gradientsFixture} />);
    expect(screen.getByRole('img', { name: 'Per-parameter gradient variance' })).toBeTruthy();
    expect(document.querySelector('figcaption')?.textContent).toMatch(/6 parameters on a log axis/);
    expect(screen.getAllByText('95% bootstrap CI').length).toBeGreaterThan(0);
    const table = screen.getByRole('table', { name: 'Per-parameter gradient statistics' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(6);
    expect(screen.getAllByText('dead').length).toBe(1);
  });

  it('labels PPE whiskers as a rigorous truncation interval, not a CI', () => {
    render(<GradientsTab data={gradientsPpeFixture} />);
    expect(screen.getAllByText('rigorous truncation interval').length).toBeGreaterThan(0);
    expect(screen.getByText(/not a confidence interval/)).toBeTruthy();
    expect(screen.queryByText('95% bootstrap CI')).toBeNull();
    expect(screen.getByText('Truncation interval')).toBeTruthy();
  });
});

describe('ScalingTab', () => {
  it('shows the fit, β with its CI, ΔAIC and the verdict pill', () => {
    render(<ScalingTab data={scalingFixture} />);
    expect(screen.getByText('Barren plateau')).toBeTruthy();
    expect(screen.getByLabelText('Fitted scaling law').textContent).toMatch(/β = 0\.93.*\[0\.81, 1\.05\]/);
    expect(screen.getByText('ΔAIC')).toBeTruthy();
    expect(screen.getByText('8.3')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Gradient variance scaling with qubit count' })).toBeTruthy();
  });

  it('marks PPE points and states the interval kind, up to the largest n', () => {
    render(<ScalingTab data={scalingFixture} />);
    expect(screen.getByText(/Pauli propagation \(rigorous truncation interval, not a CI\)/)).toBeTruthy();
    expect(screen.getByText(/Squares mark Pauli-propagation points \(2, up to 48 qubits\)/)).toBeTruthy();
    expect(document.querySelectorAll('figure rect[style*="fill"]').length).toBeGreaterThanOrEqual(2);
  });

  it('reports inconclusive honestly when there are too few points', () => {
    render(<ScalingTab data={scalingInconclusiveFixture} />);
    expect(screen.getByText('Inconclusive')).toBeTruthy();
    expect(screen.getByText('Few qubit counts')).toBeTruthy();
    expect(screen.getByText('Too few qubit counts for a reliable fit.')).toBeTruthy();
  });

  it('switches between layer counts', () => {
    const second = {
      ...scalingFixture,
      points: [...scalingFixture.points, ...scalingFixture.points.slice(0, 5).map((p) => ({ ...p, n_layers: 8 }))],
      fits: [...scalingFixture.fits, { ...scalingFixture.fits[0], n_layers: 8, verdict: 'polynomial' as const, summary: 'poly at 8' }],
    };
    render(<ScalingTab data={second} />);
    expect(screen.getByText('poly at 8')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '4 layers' }));
    expect(screen.getByText('Barren plateau')).toBeTruthy();
  });
});

describe('LieTab', () => {
  it('shows the meter, classification, purities and predicted vs empirical variance', () => {
    render(<LieTab data={lieFixture} gradients={gradientsFixture} />);
    expect(screen.getByRole('meter', { name: 'dim 𝔤 (log scale)' })).toBeTruthy();
    expect(screen.getByText('so(16)')).toBeTruthy();
    expect(screen.getByText('complete')).toBeTruthy();
    expect(screen.getByText('g-purity of ρ₀')).toBeTruthy();
    expect(screen.getByText('0.0089')).toBeTruthy();
    expect(screen.getByText('0.0115')).toBeTruthy();
    expect(screen.getByText('Deep-circuit (approximate 2-design over e^𝔤) regime.')).toBeTruthy();
    expect(screen.getByText('Simulability verdict')).toBeTruthy();
  });

  it('says trainable and classically simulable for a small algebra', () => {
    render(<LieTab data={lieSimulableFixture} />);
    expect(screen.getByText('Trainable and classically simulable (𝔤-sim)')).toBeTruthy();
    expect(screen.getByText('run gradients')).toBeTruthy();
  });

  it('shows a truncated lower bound and marks the prediction not applicable', () => {
    render(<LieTab data={lieTruncatedFixture} />);
    expect(screen.getByText('truncated')).toBeTruthy();
    expect(screen.getByText('Closure truncated')).toBeTruthy();
    expect(screen.getByText('not applicable')).toBeTruthy();
    expect(screen.getByRole('meter', { name: 'dim 𝔤 (lower bound, log scale)' })).toBeTruthy();
  });

  it('explains an unsupported circuit', () => {
    render(<LieTab data={{ ...lieFixture, status: 'unsupported', reason: 'non-Clifford fixed gates at n = 12' }} />);
    expect(screen.getByText('Lie-algebra analysis unsupported')).toBeTruthy();
    expect(screen.getByText(/non-Clifford fixed gates/)).toBeTruthy();
  });
});

describe('Expressibility and entanglement', () => {
  it('renders the histogram against Haar with KL and its CI', () => {
    render(<ExpressibilityPanel data={expressibilityFixture} />);
    expect(screen.getByRole('img', { name: 'Fidelity histogram against the Haar curve' })).toBeTruthy();
    expect(screen.getByText('KL to Haar')).toBeTruthy();
    expect(screen.getAllByText(/\[0\.009, 0\.016\]/).length).toBeGreaterThan(0);
    expect(document.querySelector('figure polyline')).toBeTruthy();
    expect(document.querySelectorAll('figure rect').length).toBeGreaterThanOrEqual(expressibilityFixture.histogram.length);
  });

  it('renders Meyer–Wallach against the Haar mean', () => {
    render(<EntanglementPanel data={entanglementFixture} />);
    expect(screen.getByRole('img', { name: 'Meyer–Wallach entanglement distribution' })).toBeTruthy();
    expect(screen.getAllByText('Haar mean').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0.824').length).toBeGreaterThan(0);
  });
});

describe('LandscapeTab', () => {
  it('renders an accessible canvas, a colorbar legend and a center marker', () => {
    render(<LandscapeTab data={landscapeFixture} />);
    expect(screen.getByRole('img', { name: 'Loss landscape heatmap' })).toBeTruthy();
    expect(screen.getByLabelText(/cost: .* to /)).toBeTruthy();
    expect(document.querySelector('figure svg circle')).toBeTruthy();
    expect(document.querySelector('figcaption')?.textContent).toMatch(/11 by 11 points/);
  });

  it('places the center marker at the axis origin', () => {
    expect(centerPercent([-1, 0, 1])).toBe(50);
    expect(centerPercent([-1, 3])).toBe(25);
    expect(centerPercent([0])).toBe(50);
  });
});

describe('AnalysisPanel states', () => {
  const body = (text: string) => () => <span>{text}</span>;

  it('renders an empty state', () => {
    render(<AnalysisPanel view={analysisView(null, 'gradients')} title="Gradients" emptyBody="Run to see">{body('x')}</AnalysisPanel>);
    expect(screen.getByText('Gradients: nothing to show yet')).toBeTruthy();
    expect(screen.getByText('Run to see')).toBeTruthy();
  });

  it('renders a loading skeleton with progress and the kernel message', () => {
    const job = jobFixture({ status: 'running', results: {}, progress: { gradients: { fraction: 0.5, message: 'sample 100/200' } } });
    render(<AnalysisPanel view={analysisView(job, 'gradients')} title="Gradients" emptyBody="">{body('x')}</AnalysisPanel>);
    expect(screen.getByRole('status', { name: 'Gradients is running' })).toBeTruthy();
    expect(screen.getByText('sample 100/200')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Gradients progress' }).getAttribute('aria-valuenow')).toBe('50');
  });

  it('renders an error callout and a not-requested state', () => {
    const failed = jobFixture({ results: {}, errors: { gradients: { code: 'oom', message: 'out of memory' } } });
    const { rerender } = render(<AnalysisPanel view={analysisView(failed, 'gradients')} title="Gradients" emptyBody="">{body('x')}</AnalysisPanel>);
    expect(screen.getByRole('alert').textContent).toContain('out of memory');
    const skipped = jobFixture({ results: {}, analyses: ['lie'] });
    rerender(<AnalysisPanel view={analysisView(skipped, 'gradients')} title="Gradients" emptyBody="">{body('x')}</AnalysisPanel>);
    expect(screen.getByText('Gradients was not requested')).toBeTruthy();
  });

  it('renders children when ready', () => {
    render(<AnalysisPanel view={analysisView(jobFixture(), 'lie')} title="Lie" emptyBody="">{(d) => <span>{`dim ${d.dimension}`}</span>}</AnalysisPanel>);
    expect(screen.getByText('dim 120')).toBeTruthy();
  });
});
