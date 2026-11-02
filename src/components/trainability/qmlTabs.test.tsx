// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QmlKernelTab } from './tabs/QmlKernelTab';
import { VariationalTrainTab } from './tabs/VariationalTrainTab';
import type { QuantumKernelResult, VariationalTrainResult } from '../../types/trainability';

afterEach(() => cleanup());

const kernelFixture: QuantumKernelResult = {
  dataset: 'blobs',
  n_samples: 4,
  n_features: 2,
  noise: 0.1,
  n_train: 3,
  n_test: 1,
  parameters: ['x0', 'x1'],
  labels: [0, 0, 1, 1],
  train_indices: [0, 1, 2],
  kernel: [
    [1, 0.9, 0.1, 0.1],
    [0.9, 1, 0.1, 0.2],
    [0.1, 0.1, 1, 0.8],
    [0.1, 0.2, 0.8, 1],
  ],
  alignment: 0.82,
  eigenvalues: [2.6, 1.1, 0.2, 0.1],
  effective_dimension: 1.9,
  top_eigenvalue_share: 0.65,
  ridge_lambda: 1,
  train_accuracy: 1,
  test_accuracy: 1,
  n_qubits: 2,
  backend: 'numpy',
  elapsed_ms: 12,
  notes: ['Synthetic binary benchmark.'],
};

const trainFixture: VariationalTrainResult = {
  dataset: 'blobs',
  n_samples: 40,
  n_features: 2,
  noise: 0.1,
  n_train: 28,
  n_test: 12,
  data_params: ['x0', 'x1'],
  trainable_params: ['theta0'],
  observable: 'Z0',
  epochs: 3,
  learning_rate: 0.1,
  optimizer: 'adam',
  initial_parameters: { theta0: 0.5 },
  final_parameters: { theta0: 1.25 },
  initial_loss: 0.9,
  final_loss: 0.2,
  final_train_accuracy: 0.95,
  final_test_accuracy: 0.92,
  final_test_loss: 0.25,
  history: [
    { epoch: 0, loss: 0.9, train_accuracy: 0.5, test_accuracy: 0.5 },
    { epoch: 1, loss: 0.5, train_accuracy: 0.8, test_accuracy: 0.75 },
    { epoch: 2, loss: 0.2, train_accuracy: 0.95, test_accuracy: 0.92 },
  ],
  n_qubits: 2,
  backend: 'numpy',
  elapsed_ms: 30,
  notes: ['Full-batch Adam.'],
};

describe('QmlKernelTab', () => {
  it('renders alignment, accuracies, the heatmap and the spectrum', () => {
    render(<QmlKernelTab data={kernelFixture} />);
    expect(screen.getByRole('img', { name: 'Quantum kernel matrix heatmap' })).toBeTruthy();
    expect(screen.getByText('Alignment')).toBeTruthy();
    expect(screen.getAllByText('100.0%').length).toBeGreaterThan(0);
    expect(screen.getByRole('table', { name: 'Kernel spectrum' }).querySelectorAll('tbody tr')).toHaveLength(4);
    expect(document.querySelector('figcaption')?.textContent).toMatch(/Centred kernel-target alignment/);
  });

  it('hides the noise pill for an exact channel and shows it when noisy', () => {
    const { rerender } = render(<QmlKernelTab data={kernelFixture} />);
    expect(screen.queryByText(/noise:/)).toBeNull();
    rerender(
      <QmlKernelTab
        data={{ ...kernelFixture, channel_noise: { shots: 1000, depolarizing_p: 0.1, readout_flip_p: 0 }, kernel_shot_variance: 0.0002 }}
      />,
    );
    expect(screen.getByText(/noise: 1000 shots/)).toBeTruthy();
    expect(screen.getByText(/kernel shot variance/)).toBeTruthy();
  });
});

describe('VariationalTrainTab', () => {
  it('renders the loss curve, KPIs and the trained-parameter table', () => {
    render(<VariationalTrainTab data={trainFixture} />);
    expect(screen.getByRole('img', { name: 'Variational training loss curve' })).toBeTruthy();
    expect(screen.getByText('Final loss')).toBeTruthy();
    expect(screen.getByText('92.0%')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Trained parameters' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(table.textContent).toContain('theta0');
  });

  it('shows the optimizer, gradient method, early stop and noise echo', () => {
    render(
      <VariationalTrainTab
        data={{
          ...trainFixture,
          optimizer: 'gd',
          gradient_method: 'parameter_shift',
          epochs: 10,
          epochs_run: 4,
          stopped_early: true,
          channel_noise: { shots: 0, depolarizing_p: 0.05, readout_flip_p: 0 },
        }}
      />,
    );
    expect(screen.getByText('Optimizer')).toBeTruthy();
    expect(screen.getAllByText(/gd/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/parameter-shift/).length).toBeGreaterThan(0);
    expect(screen.getByText(/stopped early at 4\/10/)).toBeTruthy();
    expect(screen.getByText(/noise:/)).toBeTruthy();
    expect(document.querySelector('figcaption')?.textContent).toMatch(/4 epochs of gd/);
  });

  it('falls back to history length for older kernels without epochs_run', () => {
    render(<VariationalTrainTab data={trainFixture} />);
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
    expect(screen.queryByText(/stopped early/)).toBeNull();
    expect(screen.queryByText(/noise:/)).toBeNull();
  });
});
