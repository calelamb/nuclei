import { describe, expect, it } from 'vitest';
import { inspectionFixture } from './fixtures';
import {
  DEFAULT_TARGET_SETTINGS,
  channelNoiseSettings,
  clampNoiseProbability,
  clampNoiseShots,
  formatChannelNoise,
  isChannelNoiseActive,
  isExactChannelNoise,
  toKernelSettings,
} from './settings';

describe('clampNoiseShots (kernel shots rule: 0 exact, else 32..100000)', () => {
  it('keeps 0 exact and clamps the 1..31 gap up to 32', () => {
    expect(clampNoiseShots(0)).toBe(0);
    expect(clampNoiseShots(1)).toBe(32);
    expect(clampNoiseShots(16)).toBe(32);
    expect(clampNoiseShots(31)).toBe(32);
    expect(clampNoiseShots(32)).toBe(32);
    expect(clampNoiseShots(1000)).toBe(1000);
  });

  it('clamps negatives, overflow and non-finite values', () => {
    expect(clampNoiseShots(-5)).toBe(0);
    expect(clampNoiseShots(999_999)).toBe(100_000);
    expect(clampNoiseShots(Number.NaN)).toBe(0);
    expect(clampNoiseShots(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('clampNoiseProbability', () => {
  it('clamps to [0, 0.5]', () => {
    expect(clampNoiseProbability(0)).toBe(0);
    expect(clampNoiseProbability(0.1)).toBe(0.1);
    expect(clampNoiseProbability(0.5)).toBe(0.5);
    expect(clampNoiseProbability(0.9)).toBe(0.5);
    expect(clampNoiseProbability(-0.2)).toBe(0);
    expect(clampNoiseProbability(Number.NaN)).toBe(0);
  });
});

describe('channelNoiseSettings / isChannelNoiseActive', () => {
  it('is null (omit) when the channel is exact', () => {
    expect(channelNoiseSettings(DEFAULT_TARGET_SETTINGS)).toBeNull();
    expect(isChannelNoiseActive(DEFAULT_TARGET_SETTINGS)).toBe(false);
    expect(isExactChannelNoise({ shots: 0, depolarizing_p: 0, readout_flip_p: 0 })).toBe(true);
    expect(isExactChannelNoise(undefined)).toBe(true);
  });

  it('returns the clamped echo when any component is active', () => {
    expect(channelNoiseSettings({ noiseShots: 10, noiseDepolarizingP: 0.9, noiseReadoutFlipP: -1 })).toEqual({
      shots: 32,
      depolarizing_p: 0.5,
      readout_flip_p: 0,
    });
    expect(isChannelNoiseActive({ noiseShots: 0, noiseDepolarizingP: 0.05, noiseReadoutFlipP: 0 })).toBe(true);
  });

  it('formats exact vs noisy echoes for pills and certificates', () => {
    expect(formatChannelNoise(null)).toBe('exact (no simulated noise)');
    expect(formatChannelNoise({ shots: 0, depolarizing_p: 0, readout_flip_p: 0 })).toBe('exact (no simulated noise)');
    expect(formatChannelNoise({ shots: 1000, depolarizing_p: 0.1, readout_flip_p: 0 })).toContain('1000 shots');
    expect(formatChannelNoise({ shots: 0, depolarizing_p: 0.1, readout_flip_p: 0.05 })).toContain('depolarizing');
  });
});

describe('toKernelSettings noise gating (C1)', () => {
  it('omits settings.noise when exact, even for noise-aware analyses', () => {
    expect(toKernelSettings(DEFAULT_TARGET_SETTINGS, ['gradients'], inspectionFixture).noise).toBeUndefined();
    expect(toKernelSettings(DEFAULT_TARGET_SETTINGS, ['quantum_kernel'], inspectionFixture).noise).toBeUndefined();
    expect(toKernelSettings(DEFAULT_TARGET_SETTINGS, ['variational_train'], inspectionFixture).noise).toBeUndefined();
  });

  it('emits clamped noise for gradients / kernel / training', () => {
    const noisy = { ...DEFAULT_TARGET_SETTINGS, noiseShots: 500, noiseDepolarizingP: 0.1, noiseReadoutFlipP: 0.02 };
    for (const analyses of [['gradients'], ['quantum_kernel'], ['variational_train']] as const) {
      expect(toKernelSettings(noisy, [...analyses], inspectionFixture).noise).toEqual({
        shots: 500,
        depolarizing_p: 0.1,
        readout_flip_p: 0.02,
      });
    }
  });

  it('does not emit noise for non-noise-aware analyses alone', () => {
    const noisy = { ...DEFAULT_TARGET_SETTINGS, noiseShots: 500, noiseDepolarizingP: 0.1 };
    expect(toKernelSettings(noisy, ['scaling', 'lie'], inspectionFixture).noise).toBeUndefined();
    expect(toKernelSettings(noisy, ['landscape'], inspectionFixture).noise).toBeUndefined();
  });

  it('clamps instead of emitting an invalid_request payload', () => {
    const out = toKernelSettings(
      { ...DEFAULT_TARGET_SETTINGS, noiseShots: 5, noiseDepolarizingP: 2, noiseReadoutFlipP: 2 },
      ['gradients'],
      inspectionFixture,
    );
    expect(out.noise).toEqual({ shots: 32, depolarizing_p: 0.5, readout_flip_p: 0.5 });
  });
});
