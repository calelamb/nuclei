import { describe, expect, it } from 'vitest';
import { inspectionFixture } from './fixtures';
import { DEFAULT_TARGET_SETTINGS, availableAnalyses, parseIntList, toKernelSettings, validateScaling } from './settings';
import { OBSERVABLE_PRESETS, observableErrorFrom, presetForSpec } from './observablePresets';

describe('parseIntList', () => {
  it('parses lists and ranges, sorted and unique', () => {
    expect(parseIntList('4, 2 3;3', 2, 128, 12)).toEqual({ values: [2, 3, 4], error: null });
    expect(parseIntList('2-5', 2, 128, 12).values).toEqual([2, 3, 4, 5]);
  });
  it('rejects junk, out-of-range and too many values', () => {
    expect(parseIntList('a', 2, 128, 12).error).toMatch(/not a whole number/);
    expect(parseIntList('1', 2, 128, 12).error).toMatch(/between 2 and 128/);
    expect(parseIntList('', 2, 128, 12).error).toMatch(/at least one/);
    expect(parseIntList('2-20', 2, 128, 4).error).toMatch(/At most 4/);
    expect(parseIntList('9-3', 2, 128, 4).error).toMatch(/Bad range/);
  });
});

describe('analyses and kernel settings', () => {
  it('disables scaling without a sweepable n_qubits', () => {
    expect(availableAnalyses(null)).not.toContain('scaling');
    expect(availableAnalyses({ ...inspectionFixture, sweepable_params: ['n_layers'] })).not.toContain('scaling');
    expect(availableAnalyses(inspectionFixture)).toContain('scaling');
  });

  it('clamps samples and wires scaling parameters', () => {
    const settings = toKernelSettings({ ...DEFAULT_TARGET_SETTINGS, samples: 99999 }, ['gradients', 'scaling'], inspectionFixture);
    expect(settings.samples).toBe(4096);
    expect(settings.scaling).toEqual({ qubits: [2, 3, 4, 5, 6, 7, 8], layers: [4], qubit_param: 'n_qubits', layer_param: 'n_layers' });
    expect(toKernelSettings(DEFAULT_TARGET_SETTINGS, ['gradients'], inspectionFixture).scaling).toBeUndefined();
  });

  it('validates scaling text', () => {
    expect(validateScaling({ ...DEFAULT_TARGET_SETTINGS, scalingQubitsText: 'x' }).qubits.error).not.toBeNull();
  });
});

describe('observable presets', () => {
  it('exposes the four spec presets as preset: strings', () => {
    expect(OBSERVABLE_PRESETS.map((p) => p.spec)).toEqual(['preset:local_z', 'preset:global_z', 'preset:zz_chain', 'preset:tfim']);
    expect(presetForSpec(' PRESET:TFIM ')?.id).toBe('tfim');
    expect(presetForSpec('Z0')).toBeNull();
  });

  it('extracts the parse-error column from the envelope or the message', () => {
    expect(observableErrorFrom({ code: 'observable_error', message: 'bad', column: 3 })).toEqual({ message: 'bad', column: 3 });
    expect(observableErrorFrom({ message: 'Invalid observable at column 7' })).toEqual({ message: 'Invalid observable at column 7', column: 7 });
    expect(observableErrorFrom({ message: 'Invalid observable' })?.column).toBeNull();
    expect(observableErrorFrom({ code: 'trainability_busy', message: 'too many jobs' })).toBeNull();
  });
});
