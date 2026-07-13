import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { QecGenerateNoise } from './qec';

/**
 * Noise model library (PRD 10 D5) — built-ins plus in-project
 * `noise/*.noise.yaml` files. Files remain the truth; built-ins are the
 * curated defaults every project gets for free.
 *
 * A model maps a single strength parameter `p` onto stim's generator
 * noise arguments as LINEAR COEFFICIENTS (arg = coeff × p). That is the
 * honest scope of what `stim.Circuit.generated` can express: circuit-level
 * models (true SI1000's per-gate structure, Z-biased channels) can only be
 * approximated here — a model that can't be expressed sets
 * `generator_args: null` and is usable exclusively with Python `entry:`
 * sources, where the resolved dict goes to `nuclei_circuits(noise)` and
 * the user applies it exactly.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export const GENERATOR_ARG_NAMES = [
  'after_clifford_depolarization',
  'before_round_data_depolarization',
  'before_measure_flip_probability',
  'after_reset_flip_probability',
] as const;
export type GeneratorArgName = (typeof GENERATOR_ARG_NAMES)[number];

export interface NoiseModelDef {
  name: string;
  description: string;
  /** Where the definition comes from — shown in the UI and docs. */
  citation?: string;
  /** Linear coefficients over p for stim's generator args, or null when
   * the model cannot be expressed through the generator (entry-only). */
  generator_args: Partial<Record<GeneratorArgName, number>> | null;
  /** True for models shipped with Nuclei (not read from a project file). */
  builtin: boolean;
}

/** `*.noise.yaml` document schema. */
export const noiseModelFileSchema = z.strictObject({
  schema: z.literal(1),
  name: z.string().min(1),
  description: z.string().min(1),
  citation: z.string().optional(),
  // NOT z.record(z.enum(...)) — zod treats enum-keyed records as
  // exhaustive; models list only the channels they use.
  generator_args: z
    .strictObject({
      after_clifford_depolarization: z.number().nonnegative().optional(),
      before_round_data_depolarization: z.number().nonnegative().optional(),
      before_measure_flip_probability: z.number().nonnegative().optional(),
      after_reset_flip_probability: z.number().nonnegative().optional(),
    })
    .nullable(),
});

// ---------------------------------------------------------------------------
// Built-ins
// ---------------------------------------------------------------------------

export const BUILT_IN_NOISE_MODELS: readonly NoiseModelDef[] = [
  {
    name: 'uniform_depolarizing',
    description:
      'Every generator channel at strength p: depolarization after Cliffords and between rounds, flip before measurement and after reset. The standard textbook baseline.',
    citation: 'stim.Circuit.generated noise arguments (Gidney, Stim, Quantum 5, 497 (2021))',
    generator_args: {
      after_clifford_depolarization: 1,
      before_round_data_depolarization: 1,
      before_measure_flip_probability: 1,
      after_reset_flip_probability: 1,
    },
    builtin: true,
  },
  {
    name: 'SI1000',
    description:
      'Superconducting-inspired: measurement is the dominant error (5p), reset 2p, two-qubit gates p, data idling p/10. NOTE: this is the generator-argument approximation of SI1000 — the true model has per-gate structure stim\'s generator can\'t express; use a Python entry source for the exact channel set.',
    citation: 'McEwen, Bacon & Gidney, "Relaxing hardware requirements for surface code circuits using time-dynamics", arXiv:2302.02192 (SI1000 from arXiv:2108.10457)',
    generator_args: {
      after_clifford_depolarization: 1,
      before_round_data_depolarization: 0.1,
      before_measure_flip_probability: 5,
      after_reset_flip_probability: 2,
    },
    builtin: true,
  },
  {
    name: 'biased_z',
    description:
      'Z-biased noise (dephasing-dominated, e.g. cat qubits). Pauli bias cannot be expressed through stim\'s uniform generator arguments, so this model is entry-only: nuclei_circuits(noise) receives {p, bias} and applies Z_ERROR/PAULI_CHANNEL_1 itself.',
    citation: 'Bonilla Ataides et al., "The XZZX surface code", Nat. Commun. 12, 2172 (2021)',
    generator_args: null,
    builtin: true,
  },
  {
    name: 'measurement_heavy',
    description:
      'Measurement flip at 10p with gate depolarization at p — for studying readout-limited regimes and comparing measurement-robust decoders.',
    generator_args: {
      after_clifford_depolarization: 1,
      before_measure_flip_probability: 10,
    },
    builtin: true,
  },
];

// ---------------------------------------------------------------------------
// Parsing + resolution
// ---------------------------------------------------------------------------

export type ParseNoiseModelResult =
  | { ok: true; model: NoiseModelDef }
  | { ok: false; errors: string[] };

/** Parse + validate a `*.noise.yaml` document. Never throws. */
export function parseNoiseModelYaml(text: string): ParseNoiseModelResult {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [`YAML parse error: ${msg}`] };
  }
  const parsed = noiseModelFileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => {
        const path = i.path.join('.');
        return path ? `${path}: ${i.message}` : i.message;
      }),
    };
  }
  return {
    ok: true,
    model: { ...parsed.data, builtin: false },
  };
}

/**
 * Resolve a campaign's `noise.model` name against built-ins plus any
 * project-discovered models. Project models shadow built-ins of the same
 * name (files are the truth).
 */
export function resolveNoiseModel(
  name: string,
  projectModels: readonly NoiseModelDef[] = [],
): NoiseModelDef | null {
  return (
    projectModels.find((m) => m.name === name) ??
    BUILT_IN_NOISE_MODELS.find((m) => m.name === name) ??
    null
  );
}

/** stim generator arguments for strength p — null for entry-only models. */
export function generatorArgsFor(model: NoiseModelDef, p: number): QecGenerateNoise | null {
  if (model.generator_args === null) return null;
  const args: Record<string, number> = {};
  for (const [key, coeff] of Object.entries(model.generator_args)) {
    args[key] = coeff * p;
  }
  return args as QecGenerateNoise;
}

/**
 * The dict handed to `nuclei_circuits(noise)` for entry sources: the
 * strength plus the model's resolved arguments (when it has them), so
 * user code can be generic over models or apply custom structure.
 */
export function noiseDictFor(model: NoiseModelDef, p: number): Record<string, number> {
  return { p, ...(generatorArgsFor(model, p) ?? {}) };
}
