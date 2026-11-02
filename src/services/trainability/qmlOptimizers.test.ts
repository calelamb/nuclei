import { describe, expect, it } from 'vitest';
import { inspectionFixture } from './fixtures';
import { DEFAULT_TARGET_SETTINGS, toKernelSettings } from './settings';

describe('toKernelSettings optimizer / gradient-method shaping (C3)', () => {
  it('omits variational entirely for non-QML runs (backward-compat)', () => {
    const out = toKernelSettings(DEFAULT_TARGET_SETTINGS, ['gradients'], inspectionFixture);
    expect(out.variational).toBeUndefined();
    expect(out.qml).toBeUndefined();
    // Even with non-default optimizer fields set, they must not leak.
    const custom = toKernelSettings(
      { ...DEFAULT_TARGET_SETTINGS, optimizer: 'spsa', gradientMethod: 'parameter_shift', earlyStopPatience: 5 },
      ['gradients', 'scaling'],
      inspectionFixture,
    );
    expect(custom.variational).toBeUndefined();
  });

  it('emits optimizer + gradient method only for variational_train, with defaults', () => {
    const out = toKernelSettings(DEFAULT_TARGET_SETTINGS, ['variational_train'], inspectionFixture);
    expect(out.variational).toEqual({
      epochs: 60,
      learning_rate: 0.1,
      optimizer: 'adam',
      gradient_method: 'adjoint',
      early_stop_patience: 0,
      spsa_a: 0.05,
      spsa_c: 0.1,
    });
  });

  it('passes through gd + parameter_shift and spsa choices', () => {
    const gd = toKernelSettings(
      { ...DEFAULT_TARGET_SETTINGS, optimizer: 'gd', gradientMethod: 'parameter_shift' },
      ['variational_train'],
      inspectionFixture,
    );
    expect(gd.variational?.optimizer).toBe('gd');
    expect(gd.variational?.gradient_method).toBe('parameter_shift');

    const spsa = toKernelSettings(
      { ...DEFAULT_TARGET_SETTINGS, optimizer: 'spsa', spsaA: 0.2, spsaC: 0.3 },
      ['variational_train'],
      inspectionFixture,
    );
    expect(spsa.variational?.optimizer).toBe('spsa');
    expect(spsa.variational?.spsa_a).toBe(0.2);
    expect(spsa.variational?.spsa_c).toBe(0.3);
  });

  it('clamps early-stop patience and SPSA gains like the kernel', () => {
    const out = toKernelSettings(
      { ...DEFAULT_TARGET_SETTINGS, earlyStopPatience: 999, spsaA: 99, spsaC: -1 },
      ['variational_train'],
      inspectionFixture,
    );
    expect(out.variational?.early_stop_patience).toBe(100);
    expect(out.variational?.spsa_a).toBe(2);
    expect(out.variational?.spsa_c).toBeCloseTo(0.001);

    const low = toKernelSettings(
      { ...DEFAULT_TARGET_SETTINGS, earlyStopPatience: -5 },
      ['variational_train'],
      inspectionFixture,
    );
    expect(low.variational?.early_stop_patience).toBe(0);
  });

  it('does not emit optimizer fields for quantum_kernel alone', () => {
    const out = toKernelSettings(
      { ...DEFAULT_TARGET_SETTINGS, optimizer: 'gd' },
      ['quantum_kernel'],
      inspectionFixture,
    );
    expect(out.variational).toBeUndefined();
    expect(out.kernel).toEqual({ ridge_lambda: 1 });
    expect(out.qml?.dataset).toBe('moons');
  });
});
