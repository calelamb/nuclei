import { describe, expect, it } from 'vitest';
import { inspectionFixture } from './fixtures';
import { DEFAULT_TARGET_SETTINGS, availableAnalyses, defaultAnalyses, toKernelSettings } from './settings';

describe('QML settings wiring', () => {
  it('offers the QML analyses but keeps them out of the default run', () => {
    expect(availableAnalyses(inspectionFixture)).toContain('quantum_kernel');
    expect(availableAnalyses(inspectionFixture)).toContain('variational_train');
    expect(defaultAnalyses(inspectionFixture)).not.toContain('quantum_kernel');
    expect(defaultAnalyses(inspectionFixture)).not.toContain('variational_train');
    expect(defaultAnalyses(inspectionFixture)).toContain('gradients');
  });

  it('sends qml, kernel and variational sections only for QML analyses', () => {
    const plain = toKernelSettings(DEFAULT_TARGET_SETTINGS, ['gradients'], inspectionFixture);
    expect(plain.qml).toBeUndefined();
    expect(plain.kernel).toBeUndefined();
    expect(plain.variational).toBeUndefined();

    const kernelOnly = toKernelSettings(DEFAULT_TARGET_SETTINGS, ['quantum_kernel'], inspectionFixture);
    expect(kernelOnly.qml).toEqual({ dataset: 'moons', samples: 48, noise: 0.1, train_fraction: 0.7 });
    expect(kernelOnly.kernel).toEqual({ ridge_lambda: 1 });
    expect(kernelOnly.variational).toBeUndefined();

    const trainOnly = toKernelSettings(
      { ...DEFAULT_TARGET_SETTINGS, qmlDataset: 'blobs', epochs: 9999, learningRate: 99 },
      ['variational_train'],
      inspectionFixture,
    );
    expect(trainOnly.qml?.dataset).toBe('blobs');
    expect(trainOnly.variational).toEqual({
      epochs: 500,
      learning_rate: 2,
      optimizer: 'adam',
      gradient_method: 'adjoint',
      early_stop_patience: 0,
      spsa_a: 0.05,
      spsa_c: 0.1,
    });
    expect(trainOnly.kernel).toBeUndefined();
  });
});
