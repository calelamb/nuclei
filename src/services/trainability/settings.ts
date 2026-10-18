/** UI-side settings model for the target bar, clamped like the kernel (§5.6). */

import {
  TRAINABILITY_ANALYSES,
  type GradientInit,
  type TrainabilityAnalysis,
  type TrainabilityInspection,
  type TrainabilityMethod,
  type TrainabilitySettings,
} from '../../types/trainability';

export const SAMPLES_RANGE = { min: 16, max: 4096, default: 200 } as const;
export const MAX_SCALING_QUBITS = 12;
export const MAX_SCALING_LAYERS = 4;
export const STATEVECTOR_UI_CAP = 14;
export const DEFAULT_SCALING_QUBITS_TEXT = '2, 3, 4, 5, 6, 7, 8';
export const DEFAULT_SCALING_LAYERS_TEXT = '4';

export interface TargetSettings {
  samples: number;
  seed: number;
  init: GradientInit;
  method: TrainabilityMethod;
  scalingQubitsText: string;
  scalingLayersText: string;
}

export const DEFAULT_TARGET_SETTINGS: TargetSettings = {
  samples: SAMPLES_RANGE.default,
  seed: 0,
  init: 'uniform',
  method: 'auto',
  scalingQubitsText: DEFAULT_SCALING_QUBITS_TEXT,
  scalingLayersText: DEFAULT_SCALING_LAYERS_TEXT,
};

export interface IntListResult {
  values: number[];
  error: string | null;
}

/** Parse "2, 3, 4" / "2 3 4" / "2-6" into sorted unique ints within [min, max]. */
export function parseIntList(text: string, min: number, max: number, maxCount: number): IntListResult {
  const values = new Set<number>();
  for (const token of text.split(/[\s,;]+/).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      if (hi < lo || hi - lo > 200) return { values: [], error: `Bad range "${token}".` };
      for (let v = lo; v <= hi; v += 1) values.add(v);
      continue;
    }
    if (!/^\d+$/.test(token)) return { values: [], error: `"${token}" is not a whole number.` };
    values.add(Number(token));
  }
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { values: [], error: 'Enter at least one value.' };
  if (sorted.some((v) => v < min || v > max)) return { values: [], error: `Values must be between ${min} and ${max}.` };
  if (sorted.length > maxCount) return { values: [], error: `At most ${maxCount} values.` };
  return { values: sorted, error: null };
}

export function validateScaling(settings: TargetSettings): { qubits: IntListResult; layers: IntListResult } {
  return {
    qubits: parseIntList(settings.scalingQubitsText, 2, 128, MAX_SCALING_QUBITS),
    layers: parseIntList(settings.scalingLayersText, 1, 64, MAX_SCALING_LAYERS),
  };
}

/** Analyses that can run for this circuit (scaling needs a sweepable n_qubits). */
export function availableAnalyses(inspection: TrainabilityInspection | null): TrainabilityAnalysis[] {
  const hasQubitParam = inspection?.sweepable_params.includes('n_qubits') ?? false;
  return TRAINABILITY_ANALYSES.filter((a) => a !== 'scaling' || hasQubitParam);
}

export function defaultAnalyses(inspection: TrainabilityInspection | null): TrainabilityAnalysis[] {
  return availableAnalyses(inspection);
}

export function toKernelSettings(
  settings: TargetSettings,
  analyses: readonly TrainabilityAnalysis[],
  inspection: TrainabilityInspection | null,
): TrainabilitySettings {
  const out: TrainabilitySettings = {
    samples: Math.min(SAMPLES_RANGE.max, Math.max(SAMPLES_RANGE.min, Math.round(settings.samples))),
    seed: Math.round(settings.seed),
    init: settings.init,
    method: settings.method,
  };
  if (analyses.includes('scaling') && inspection) {
    const { qubits, layers } = validateScaling(settings);
    const sweep = inspection.sweepable_params;
    return {
      ...out,
      scaling: {
        qubits: qubits.values,
        layers: layers.values,
        ...(sweep.includes('n_qubits') ? { qubit_param: 'n_qubits' } : {}),
        ...(sweep.includes('n_layers') ? { layer_param: 'n_layers' } : {}),
      },
    };
  }
  return out;
}
