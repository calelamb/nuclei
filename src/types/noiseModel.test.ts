import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_NOISE_MODELS,
  generatorArgsFor,
  noiseDictFor,
  parseNoiseModelYaml,
  resolveNoiseModel,
} from './noiseModel';

describe('built-in noise models', () => {
  it('ships the four PRD 10 D5 built-ins', () => {
    expect(BUILT_IN_NOISE_MODELS.map((m) => m.name)).toEqual([
      'uniform_depolarizing',
      'SI1000',
      'biased_z',
      'measurement_heavy',
    ]);
    for (const m of BUILT_IN_NOISE_MODELS) {
      expect(m.builtin).toBe(true);
      expect(m.description.length).toBeGreaterThan(20);
    }
  });

  it('uniform_depolarizing maps every generator arg to p', () => {
    const model = resolveNoiseModel('uniform_depolarizing')!;
    expect(generatorArgsFor(model, 0.003)).toEqual({
      after_clifford_depolarization: 0.003,
      before_round_data_depolarization: 0.003,
      before_measure_flip_probability: 0.003,
      after_reset_flip_probability: 0.003,
    });
  });

  it('SI1000 approximation: measurement 5p, reset 2p, cliffords p, data idle p/10', () => {
    const model = resolveNoiseModel('SI1000')!;
    const args = generatorArgsFor(model, 0.001)!;
    expect(args.before_measure_flip_probability).toBeCloseTo(0.005, 12);
    expect(args.after_reset_flip_probability).toBeCloseTo(0.002, 12);
    expect(args.after_clifford_depolarization).toBeCloseTo(0.001, 12);
    expect(args.before_round_data_depolarization).toBeCloseTo(0.0001, 12);
    // Honesty in the description: it says it is an approximation.
    expect(model.description).toMatch(/approximation/i);
  });

  it('biased_z is entry-only: no generator args', () => {
    const model = resolveNoiseModel('biased_z')!;
    expect(model.generator_args).toBeNull();
    expect(generatorArgsFor(model, 0.001)).toBeNull();
    // The nuclei_circuits(noise) dict still carries p.
    expect(noiseDictFor(model, 0.001)).toEqual({ p: 0.001 });
  });

  it('noiseDictFor includes p plus resolved args for generator models', () => {
    const model = resolveNoiseModel('measurement_heavy')!;
    expect(noiseDictFor(model, 0.002)).toEqual({
      p: 0.002,
      after_clifford_depolarization: 0.002,
      before_measure_flip_probability: 0.02,
    });
  });
});

describe('parseNoiseModelYaml', () => {
  const VALID = `
schema: 1
name: my_custom
description: Measurement-only noise for a decoder ablation.
citation: internal notebook 12
generator_args:
  before_measure_flip_probability: 3
`;

  it('parses a valid project model (builtin: false)', () => {
    const result = parseNoiseModelYaml(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.name).toBe('my_custom');
    expect(result.model.builtin).toBe(false);
    expect(generatorArgsFor(result.model, 0.01)).toEqual({
      before_measure_flip_probability: 0.03,
    });
  });

  it('accepts an explicitly entry-only file (generator_args: null)', () => {
    const result = parseNoiseModelYaml(VALID.replace(/generator_args:[\s\S]*$/, 'generator_args: null\n'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.generator_args).toBeNull();
  });

  it('rejects unknown generator arg names with a path-scoped error', () => {
    const result = parseNoiseModelYaml(VALID.replace('before_measure_flip_probability', 'bogus_knob'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/generator_args/);
  });

  it('never throws on malformed YAML', () => {
    const result = parseNoiseModelYaml('::: not yaml {{{');
    expect(result.ok).toBe(false);
  });
});

describe('resolveNoiseModel', () => {
  it('project models shadow built-ins of the same name (files are the truth)', () => {
    const custom = {
      name: 'SI1000',
      description: 'project-local override',
      generator_args: { after_clifford_depolarization: 2 },
      builtin: false,
    } as const;
    const resolved = resolveNoiseModel('SI1000', [custom]);
    expect(resolved).toBe(custom);
  });

  it('unknown names resolve to null', () => {
    expect(resolveNoiseModel('nope')).toBeNull();
  });
});
