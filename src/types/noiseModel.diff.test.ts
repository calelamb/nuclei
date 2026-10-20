import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_NOISE_MODELS,
  noiseModelToYaml,
  parseNoiseModelYaml,
  diffNoiseModels,
} from './noiseModel';

const byName = (n: string) => BUILT_IN_NOISE_MODELS.find((m) => m.name === n)!;

describe('noiseModelToYaml', () => {
  it('round-trips a generator-arg model through parse (file stays the truth)', () => {
    const model = byName('SI1000');
    const yaml = noiseModelToYaml({ ...model, name: 'si1000-copy', builtin: false });
    const parsed = parseNoiseModelYaml(yaml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.model.name).toBe('si1000-copy');
    expect(parsed.model.builtin).toBe(false); // provenance from disk, never written
    expect(parsed.model.generator_args).toEqual(model.generator_args);
  });

  it('round-trips an entry-only (null generator_args) model', () => {
    const model = byName('biased_z');
    const parsed = parseNoiseModelYaml(noiseModelToYaml(model));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.model.generator_args).toBeNull();
  });
});

describe('diffNoiseModels', () => {
  it('returns only the channels that differ', () => {
    const diff = diffNoiseModels(byName('uniform_depolarizing'), byName('SI1000'));
    // uniform is all-1; SI1000 differs on data-depol (0.1), measure (5), reset (2).
    const args = diff.map((d) => d.arg).sort();
    expect(args).toEqual(['after_reset_flip_probability', 'before_measure_flip_probability', 'before_round_data_depolarization']);
  });

  it('is empty for identical models', () => {
    expect(diffNoiseModels(byName('SI1000'), byName('SI1000'))).toEqual([]);
  });

  it('treats an entry-only model as all channels absent', () => {
    const diff = diffNoiseModels(byName('uniform_depolarizing'), byName('biased_z'));
    expect(diff.every((d) => d.b === null)).toBe(true);
    expect(diff.length).toBe(4);
  });

  it('reports 0 (not null) for a channel a generator model leaves unset, so a dash only ever means entry-only', () => {
    const diff = diffNoiseModels(byName('uniform_depolarizing'), byName('measurement_heavy'));
    const unset = diff.find((d) => d.arg === 'before_round_data_depolarization');
    expect(unset).toEqual({ arg: 'before_round_data_depolarization', a: 1, b: 0 });
    expect(diff.some((d) => (d.a === null && d.b !== null) || (d.b === null && d.a !== null))).toBe(false);
  });

  it('does not report a channel set to 0 on one side and unset on the other as different', () => {
    const a = { ...byName('SI1000'), generator_args: { after_clifford_depolarization: 0 } };
    const b = { ...byName('SI1000'), generator_args: {} };
    expect(diffNoiseModels(a, b)).toEqual([]);
  });
});
