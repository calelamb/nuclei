import { describe, expect, it } from 'vitest';
import { TRAINABILITY_ANALYSES } from '../../types/trainability';
import { inspectionFixture } from './fixtures';
import { DEFAULT_TARGET_SETTINGS, availableAnalyses, defaultAnalyses, toKernelSettings } from './settings';

const EXTENSIONS = ['classical_baseline', 'kernel_alignment_search', 'variational_qng'] as const;

describe('QML extension settings wiring', () => {
  it('registers the three extensions and offers them as opt-in analyses', () => {
    for (const analysis of EXTENSIONS) {
      expect(TRAINABILITY_ANALYSES).toContain(analysis);
      expect(availableAnalyses(inspectionFixture)).toContain(analysis);
      expect(defaultAnalyses(inspectionFixture)).not.toContain(analysis);
    }
    expect(defaultAnalyses(inspectionFixture)).toContain('gradients');
  });

  it('has the kernel defaults on DEFAULT_TARGET_SETTINGS', () => {
    expect(DEFAULT_TARGET_SETTINGS.baselineIncludeLinear).toBe(true);
    expect(DEFAULT_TARGET_SETTINGS.alignMode).toBe('bandwidth');
    expect(DEFAULT_TARGET_SETTINGS.alignSteps).toBe(40);
    expect(DEFAULT_TARGET_SETTINGS.alignLearningRate).toBe(0.1);
    expect(DEFAULT_TARGET_SETTINGS.alignSpsaA).toBe(0.05);
    expect(DEFAULT_TARGET_SETTINGS.alignSpsaC).toBe(0.1);
    expect(DEFAULT_TARGET_SETTINGS.qngMetricRegularization).toBe(1e-3);
    expect(DEFAULT_TARGET_SETTINGS.qngMetricEvery).toBe(1);
    expect(DEFAULT_TARGET_SETTINGS.qngMaxMetricParams).toBe(32);
  });

  it('sends no extension sections for a plain run', () => {
    const plain = toKernelSettings(DEFAULT_TARGET_SETTINGS, ['gradients'], inspectionFixture);
    expect(plain.qml).toBeUndefined();
    expect(plain.kernel).toBeUndefined();
    expect(plain.variational).toBeUndefined();
    expect(plain.baseline).toBeUndefined();
    expect(plain.align).toBeUndefined();
    expect(plain.qng).toBeUndefined();
  });

  it('sends qml, kernel and baseline sections only for classical_baseline', () => {
    const out = toKernelSettings(DEFAULT_TARGET_SETTINGS, ['classical_baseline'], inspectionFixture);
    expect(out.qml).toEqual({ dataset: 'moons', samples: 48, noise: 0.1, train_fraction: 0.7 });
    expect(out.kernel).toEqual({ ridge_lambda: 1 });
    expect(out.baseline).toEqual({ include_linear: true });
    expect(out.align).toBeUndefined();
    expect(out.qng).toBeUndefined();
    expect(out.variational).toBeUndefined();

    const noLinear = toKernelSettings(
      { ...DEFAULT_TARGET_SETTINGS, baselineIncludeLinear: false },
      ['classical_baseline'],
      inspectionFixture,
    );
    expect(noLinear.baseline).toEqual({ include_linear: false });
  });

  it('sends qml, kernel and align sections only for kernel_alignment_search', () => {
    const out = toKernelSettings(DEFAULT_TARGET_SETTINGS, ['kernel_alignment_search'], inspectionFixture);
    expect(out.qml).toEqual({ dataset: 'moons', samples: 48, noise: 0.1, train_fraction: 0.7 });
    expect(out.kernel).toEqual({ ridge_lambda: 1 });
    expect(out.align).toEqual({ mode: 'bandwidth', steps: 40, learning_rate: 0.1, spsa_a: 0.05, spsa_c: 0.1 });
    expect(out.baseline).toBeUndefined();
    expect(out.qng).toBeUndefined();
    expect(out.variational).toBeUndefined();
  });

  it('sends qml, variational and qng sections only for variational_qng', () => {
    const out = toKernelSettings(DEFAULT_TARGET_SETTINGS, ['variational_qng'], inspectionFixture);
    expect(out.qml).toEqual({ dataset: 'moons', samples: 48, noise: 0.1, train_fraction: 0.7 });
    // variational_qng shares epochs/learning_rate with variational_train.
    expect(out.variational).toEqual({
      epochs: 60,
      learning_rate: 0.1,
      optimizer: 'adam',
      gradient_method: 'adjoint',
      early_stop_patience: 0,
      spsa_a: 0.05,
      spsa_c: 0.1,
    });
    expect(out.qng).toEqual({ metric_regularization: 1e-3, metric_every: 1, max_metric_params: 32 });
    expect(out.kernel).toBeUndefined();
    expect(out.baseline).toBeUndefined();
    expect(out.align).toBeUndefined();
  });

  it('clamps align and qng values to the kernel ranges', () => {
    const align = toKernelSettings(
      {
        ...DEFAULT_TARGET_SETTINGS,
        alignMode: 'both',
        alignSteps: 9999,
        alignLearningRate: 99,
        alignSpsaA: 99,
        alignSpsaC: -1,
      },
      ['kernel_alignment_search'],
      inspectionFixture,
    );
    expect(align.align).toEqual({ mode: 'both', steps: 500, learning_rate: 2, spsa_a: 2, spsa_c: 0.001 });

    const qng = toKernelSettings(
      { ...DEFAULT_TARGET_SETTINGS, qngMetricRegularization: 99, qngMetricEvery: 999, qngMaxMetricParams: 0 },
      ['variational_qng'],
      inspectionFixture,
    );
    expect(qng.qng).toEqual({ metric_regularization: 1, metric_every: 50, max_metric_params: 1 });
  });
});
