// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ClassicalBaselineTab } from './tabs/ClassicalBaselineTab';
import { KernelAlignmentTab } from './tabs/KernelAlignmentTab';
import { VariationalQngTab } from './tabs/VariationalQngTab';
import type { ClassicalBaselineResult, KernelAlignmentResult, VariationalQngResult } from '../../types/trainability';

afterEach(() => cleanup());

const baselineFixture: ClassicalBaselineResult = {
  dataset: 'blobs',
  n_samples: 40,
  n_features: 2,
  noise: 0.1,
  channel_noise: { shots: 0, depolarizing_p: 0, readout_flip_p: 0 },
  n_train: 28,
  n_test: 12,
  labels: [0, 0, 1, 1],
  train_indices: [0, 1, 2],
  gamma_median_heuristic: 0.5,
  ridge_lambda: 1,
  baselines: [
    { name: 'rbf', gamma: 0.25, alignment: 0.4, train_accuracy: 0.8, test_accuracy: 0.75, effective_dimension: 2 },
    { name: 'rbf', gamma: 0.5, alignment: 0.6, train_accuracy: 0.9, test_accuracy: 0.83, effective_dimension: 2.4 },
    { name: 'linear', gamma: null, alignment: 0.2, train_accuracy: 0.6, test_accuracy: 0.5, effective_dimension: 1.5 },
  ],
  best_baseline: 'rbf',
  best_baseline_gamma: 0.5,
  quantum: { alignment: 0.82, train_accuracy: 1, test_accuracy: 0.92, effective_dimension: 1.9 },
  geometric_difference: 1.8,
  delta_test_accuracy: 0.09,
  verdict: 'quantum_ahead',
  n_qubits: 2,
  backend: 'numpy',
  elapsed_ms: 15,
  notes: ['Synthetic binary benchmark; not a quantum advantage claim.'],
};

const alignmentFixture: KernelAlignmentResult = {
  dataset: 'blobs',
  n_samples: 40,
  n_features: 2,
  noise: 0.1,
  channel_noise: { shots: 0, depolarizing_p: 0, readout_flip_p: 0 },
  n_train: 28,
  n_test: 12,
  mode: 'bandwidth',
  data_params: ['x0', 'x1'],
  trainable_params: ['theta0'],
  initial: { alignment: 0.1, train_accuracy: 0.6, test_accuracy: 0.5 },
  final: { alignment: 0.65, train_accuracy: 0.9, test_accuracy: 0.88 },
  best: { alignment: 0.7, train_accuracy: 0.95, test_accuracy: 0.92 },
  bandwidth: [1.5, 0.5],
  final_parameters: { theta0: 1.25 },
  history: [
    { step: 0, alignment: 0.1, train_accuracy: 0.6, test_accuracy: 0.5 },
    { step: 1, alignment: 0.4, train_accuracy: 0.8, test_accuracy: 0.75 },
    { step: 2, alignment: 0.7, train_accuracy: 0.95, test_accuracy: 0.92 },
  ],
  concentration: {
    before: { offdiag_mean: 0.8, offdiag_var: 0.01, effective_dimension: 1.2 },
    after: { offdiag_mean: 0.3, offdiag_var: 0.05, effective_dimension: 2.4 },
  },
  rbf_baseline_test_accuracy: 0.83,
  kernel: [
    [1, 0.9, 0.1, 0.1],
    [0.9, 1, 0.1, 0.2],
    [0.1, 0.1, 1, 0.8],
    [0.1, 0.2, 0.8, 1],
  ],
  labels: [0, 0, 1, 1],
  train_indices: [0, 1, 2],
  steps: 3,
  steps_run: 3,
  ridge_lambda: 1,
  n_qubits: 2,
  backend: 'numpy',
  elapsed_ms: 40,
  notes: ['Alignment is optimized on the train split only.'],
};

const qngFixture: VariationalQngResult = {
  dataset: 'blobs',
  n_samples: 40,
  n_features: 2,
  noise: 0.1,
  channel_noise: { shots: 0, depolarizing_p: 0, readout_flip_p: 0 },
  n_train: 28,
  n_test: 12,
  data_params: ['x0', 'x1'],
  trainable_params: ['theta0'],
  observable: 'Z0',
  epochs: 3,
  epochs_run: 3,
  learning_rate: 0.1,
  optimizer: 'qng',
  metric_regularization: 0.001,
  metric_every: 1,
  max_metric_params: 32,
  initial_parameters: { theta0: 0.5 },
  final_parameters: { theta0: 1.25 },
  initial_loss: 0.9,
  final_loss: 0.2,
  final_train_accuracy: 0.95,
  final_test_accuracy: 0.92,
  final_test_loss: 0.25,
  history: [
    { epoch: 0, loss: 0.9, train_accuracy: 0.5, test_accuracy: 0.5, grad_norm: 0.4, natural_grad_norm: 1.6, metric_condition: 10 },
    { epoch: 1, loss: 0.5, train_accuracy: 0.8, test_accuracy: 0.75, grad_norm: 0.3, natural_grad_norm: 1.2, metric_condition: 25.5 },
    { epoch: 2, loss: 0.2, train_accuracy: 0.95, test_accuracy: 0.92, grad_norm: 0.1, natural_grad_norm: 0.4, metric_condition: null },
  ],
  metric_eigenvalues: [0.25],
  metric_effective_dimension: 1,
  fallbacks: 0,
  n_qubits: 2,
  backend: 'numpy',
  elapsed_ms: 35,
  notes: ['Quantum natural gradient on the exact adjoint gradient.'],
};

describe('ClassicalBaselineTab', () => {
  it('renders the quantum-versus-baselines table, verdict pill and geometric difference', () => {
    render(<ClassicalBaselineTab data={baselineFixture} />);
    expect(screen.getByText('verdict: quantum ahead')).toBeTruthy();
    expect(screen.getByText('Geometric diff.')).toBeTruthy();
    expect(screen.getByText('+9.0 pp')).toBeTruthy();
    expect(screen.getAllByText('92.0%').length).toBeGreaterThan(0);
    const table = screen.getByRole('table', { name: 'Quantum kernel versus classical baselines' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(4);
    expect(table.textContent).toContain('quantum');
    expect(table.textContent).toContain('rbf (best)');
    expect(screen.queryByText(/noise:/)).toBeNull();
  });

  it('renders baselines alone when there is no quantum kernel', () => {
    render(
      <ClassicalBaselineTab
        data={{ ...baselineFixture, quantum: null, geometric_difference: null, delta_test_accuracy: null, verdict: 'no_quantum_kernel' }}
      />,
    );
    expect(screen.getByText('verdict: no quantum kernel')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Quantum kernel versus classical baselines' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(screen.getAllByText('83.0%').length).toBeGreaterThan(0);
  });
});

describe('KernelAlignmentTab', () => {
  it('renders before/after alignment, the history, heatmap and best parameters', () => {
    render(<KernelAlignmentTab data={alignmentFixture} />);
    expect(screen.getByRole('img', { name: 'Kernel alignment search history' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Best quantum kernel matrix heatmap' })).toBeTruthy();
    expect(screen.getByText('Best alignment')).toBeTruthy();
    expect(screen.getByText('mode: bandwidth')).toBeTruthy();
    expect(screen.getAllByText('83.0%').length).toBeGreaterThan(0);
    const beforeAfter = screen.getByRole('table', { name: 'Alignment before and after search' });
    expect(beforeAfter.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(beforeAfter.textContent).toContain('best (restored)');
    const bestParams = screen.getByRole('table', { name: 'Best parameters' });
    expect(bestParams.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(bestParams.textContent).toContain('theta0');
    expect(document.querySelector('figcaption')?.textContent).toMatch(/Train alignment rose/);
  });

  it('shows the noise pill when the channel is not exact', () => {
    render(
      <KernelAlignmentTab
        data={{ ...alignmentFixture, channel_noise: { shots: 1000, depolarizing_p: 0, readout_flip_p: 0 } }}
      />,
    );
    expect(screen.getByText(/noise: 1000 shots/)).toBeTruthy();
  });
});

describe('VariationalQngTab', () => {
  it('renders the loss curve, natural-gradient history and trained-parameter table', () => {
    render(<VariationalQngTab data={qngFixture} />);
    expect(screen.getByRole('img', { name: 'Variational QNG loss curve' })).toBeTruthy();
    expect(screen.getByText('Final loss')).toBeTruthy();
    expect(screen.getByText('Natural-grad norm')).toBeTruthy();
    expect(screen.getAllByText('Metric condition').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('92.0%').length).toBeGreaterThan(0);
    const history = screen.getByRole('table', { name: 'Natural gradient history' });
    expect(history.querySelectorAll('tbody tr')).toHaveLength(3);
    const table = screen.getByRole('table', { name: 'Trained parameters' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(table.textContent).toContain('theta0');
    expect(screen.queryByText(/metric fallback/)).toBeNull();
    expect(screen.queryByText(/noise:/)).toBeNull();
  });

  it('counts metric fallbacks when the solve degraded', () => {
    render(<VariationalQngTab data={{ ...qngFixture, fallbacks: 2 }} />);
    expect(screen.getByText(/2 metric fallbacks/)).toBeTruthy();
  });
});
