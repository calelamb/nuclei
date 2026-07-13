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
});
