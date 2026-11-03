/** UI-side settings model for the target bar, clamped like the kernel (§5.6). */

import {
  TRAINABILITY_ANALYSES,
  type ChannelNoiseEcho,
  type ChannelNoiseSettings,
  type GradientInit,
  type GradientMethod,
  type KernelAlignmentMode,
  type QmlDataset,
  type QmlOptimizer,
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

export const QML_SAMPLES_RANGE = { min: 8, max: 200, default: 48 } as const;
export const QML_EPOCHS_RANGE = { min: 1, max: 500, default: 60 } as const;
export const EARLY_STOP_RANGE = { min: 0, max: 100, default: 0 } as const;
export const SPSA_A_RANGE = { min: 0.001, max: 2, default: 0.05 } as const;
export const SPSA_C_RANGE = { min: 0.001, max: 2, default: 0.1 } as const;
export const ALIGN_STEPS_RANGE = { min: 1, max: 500, default: 40 } as const;
export const METRIC_REGULARIZATION_RANGE = { min: 1e-6, max: 1, default: 1e-3 } as const;
export const METRIC_EVERY_RANGE = { min: 1, max: 50, default: 1 } as const;
export const MAX_METRIC_PARAMS_RANGE = { min: 1, max: 64, default: 32 } as const;
export const NOISE_SHOTS_MIN_FINITE = 32;
export const NOISE_SHOTS_MAX = 100_000;
export const NOISE_P_RANGE = { min: 0, max: 0.5, default: 0 } as const;

/** Analyses that honour the simulated channel; others ignore it with a note. */
export const NOISE_AWARE_ANALYSES: readonly TrainabilityAnalysis[] = [
  'gradients',
  'quantum_kernel',
  'variational_train',
  'classical_baseline',
  'kernel_alignment_search',
  'variational_qng',
];

export interface TargetSettings {
  samples: number;
  seed: number;
  init: GradientInit;
  method: TrainabilityMethod;
  scalingQubitsText: string;
  scalingLayersText: string;
  qmlDataset: QmlDataset;
  qmlSamples: number;
  qmlNoise: number;
  qmlTrainFraction: number;
  ridgeLambda: number;
  epochs: number;
  learningRate: number;
  optimizer: QmlOptimizer;
  gradientMethod: GradientMethod;
  earlyStopPatience: number;
  spsaA: number;
  spsaC: number;
  baselineIncludeLinear: boolean;
  alignMode: KernelAlignmentMode;
  alignSteps: number;
  alignLearningRate: number;
  alignSpsaA: number;
  alignSpsaC: number;
  qngMetricRegularization: number;
  qngMetricEvery: number;
  qngMaxMetricParams: number;
  noiseShots: number;
  noiseDepolarizingP: number;
  noiseReadoutFlipP: number;
}

export const DEFAULT_TARGET_SETTINGS: TargetSettings = {
  samples: SAMPLES_RANGE.default,
  seed: 0,
  init: 'uniform',
  method: 'auto',
  scalingQubitsText: DEFAULT_SCALING_QUBITS_TEXT,
  scalingLayersText: DEFAULT_SCALING_LAYERS_TEXT,
  qmlDataset: 'moons',
  qmlSamples: QML_SAMPLES_RANGE.default,
  qmlNoise: 0.1,
  qmlTrainFraction: 0.7,
  ridgeLambda: 1,
  epochs: QML_EPOCHS_RANGE.default,
  learningRate: 0.1,
  optimizer: 'adam',
  gradientMethod: 'adjoint',
  earlyStopPatience: EARLY_STOP_RANGE.default,
  spsaA: SPSA_A_RANGE.default,
  spsaC: SPSA_C_RANGE.default,
  baselineIncludeLinear: true,
  alignMode: 'bandwidth',
  alignSteps: ALIGN_STEPS_RANGE.default,
  alignLearningRate: 0.1,
  alignSpsaA: SPSA_A_RANGE.default,
  alignSpsaC: SPSA_C_RANGE.default,
  qngMetricRegularization: METRIC_REGULARIZATION_RANGE.default,
  qngMetricEvery: METRIC_EVERY_RANGE.default,
  qngMaxMetricParams: MAX_METRIC_PARAMS_RANGE.default,
  noiseShots: 0,
  noiseDepolarizingP: 0,
  noiseReadoutFlipP: 0,
};

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Kernel shots rule: 0 = exact, otherwise 32..100000 (1..31 is invalid_request). */
export function clampNoiseShots(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  if (rounded < NOISE_SHOTS_MIN_FINITE) return NOISE_SHOTS_MIN_FINITE;
  return Math.min(NOISE_SHOTS_MAX, rounded);
}

export function clampNoiseProbability(value: number): number {
  return clampNumber(value, NOISE_P_RANGE.min, NOISE_P_RANGE.max, 0);
}

export function clampEarlyStopPatience(value: number): number {
  if (!Number.isFinite(value)) return EARLY_STOP_RANGE.default;
  return Math.min(EARLY_STOP_RANGE.max, Math.max(EARLY_STOP_RANGE.min, Math.round(value)));
}

export function clampSpsaGain(value: number, kind: 'a' | 'c'): number {
  const range = kind === 'a' ? SPSA_A_RANGE : SPSA_C_RANGE;
  return clampNumber(value, range.min, range.max, range.default);
}

export function isChannelNoiseActive(settings: Pick<TargetSettings, 'noiseShots' | 'noiseDepolarizingP' | 'noiseReadoutFlipP'>): boolean {
  return clampNoiseShots(settings.noiseShots) > 0 || clampNoiseProbability(settings.noiseDepolarizingP) > 0 || clampNoiseProbability(settings.noiseReadoutFlipP) > 0;
}

/** Clamped `settings.noise` payload, or null when the channel is exact (omit for back-compat). */
export function channelNoiseSettings(
  settings: Pick<TargetSettings, 'noiseShots' | 'noiseDepolarizingP' | 'noiseReadoutFlipP'>,
): ChannelNoiseSettings | null {
  const echo: ChannelNoiseEcho = {
    shots: clampNoiseShots(settings.noiseShots),
    depolarizing_p: clampNoiseProbability(settings.noiseDepolarizingP),
    readout_flip_p: clampNoiseProbability(settings.noiseReadoutFlipP),
  };
  return echo.shots === 0 && echo.depolarizing_p === 0 && echo.readout_flip_p === 0 ? null : echo;
}

export function isExactChannelNoise(echo: ChannelNoiseEcho | undefined | null): boolean {
  return !echo || (echo.shots === 0 && echo.depolarizing_p === 0 && echo.readout_flip_p === 0);
}

export function formatChannelNoise(echo: ChannelNoiseEcho | undefined | null): string {
  if (isExactChannelNoise(echo)) return 'exact (no simulated noise)';
  const e = echo as ChannelNoiseEcho;
  const parts: string[] = [];
  parts.push(e.shots === 0 ? 'exact expectations' : `${e.shots} shots`);
  if (e.depolarizing_p > 0) parts.push(`depolarizing p=${e.depolarizing_p}`);
  if (e.readout_flip_p > 0) parts.push(`readout flip q=${e.readout_flip_p}`);
  return parts.join(', ');
}

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

/** QML analyses are opt-in: they only make sense for feature-map / classifier circuits. */
export const OPT_IN_QML_ANALYSES: readonly TrainabilityAnalysis[] = [
  'quantum_kernel',
  'variational_train',
  'classical_baseline',
  'kernel_alignment_search',
  'variational_qng',
];

export function defaultAnalyses(inspection: TrainabilityInspection | null): TrainabilityAnalysis[] {
  // A default run keeps the original six analyses (see OPT_IN_QML_ANALYSES).
  return availableAnalyses(inspection).filter((a) => !OPT_IN_QML_ANALYSES.includes(a));
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
  if (analyses.some((a) => OPT_IN_QML_ANALYSES.includes(a))) {
    out.qml = {
      dataset: settings.qmlDataset,
      samples: Math.min(QML_SAMPLES_RANGE.max, Math.max(QML_SAMPLES_RANGE.min, Math.round(settings.qmlSamples))),
      noise: Math.min(0.5, Math.max(0, settings.qmlNoise)),
      train_fraction: Math.min(0.9, Math.max(0.5, settings.qmlTrainFraction)),
    };
  }
  if (
    analyses.includes('quantum_kernel') ||
    analyses.includes('classical_baseline') ||
    analyses.includes('kernel_alignment_search')
  ) {
    out.kernel = { ridge_lambda: Math.min(100, Math.max(1e-4, settings.ridgeLambda)) };
  }
  // variational_qng shares epochs/learning_rate/data_params with variational_train.
  if (analyses.includes('variational_train') || analyses.includes('variational_qng')) {
    out.variational = {
      epochs: Math.min(QML_EPOCHS_RANGE.max, Math.max(QML_EPOCHS_RANGE.min, Math.round(settings.epochs))),
      learning_rate: Math.min(2, Math.max(1e-4, settings.learningRate)),
      optimizer: settings.optimizer,
      gradient_method: settings.gradientMethod,
      early_stop_patience: clampEarlyStopPatience(settings.earlyStopPatience),
      spsa_a: clampSpsaGain(settings.spsaA, 'a'),
      spsa_c: clampSpsaGain(settings.spsaC, 'c'),
    };
  }
  if (analyses.includes('classical_baseline')) {
    out.baseline = { include_linear: settings.baselineIncludeLinear };
  }
  if (analyses.includes('kernel_alignment_search')) {
    out.align = {
      mode: settings.alignMode,
      steps: Math.min(ALIGN_STEPS_RANGE.max, Math.max(ALIGN_STEPS_RANGE.min, Math.round(settings.alignSteps))),
      learning_rate: Math.min(2, Math.max(1e-4, settings.alignLearningRate)),
      spsa_a: clampSpsaGain(settings.alignSpsaA, 'a'),
      spsa_c: clampSpsaGain(settings.alignSpsaC, 'c'),
    };
  }
  if (analyses.includes('variational_qng')) {
    out.qng = {
      metric_regularization: Math.min(
        METRIC_REGULARIZATION_RANGE.max,
        Math.max(METRIC_REGULARIZATION_RANGE.min, settings.qngMetricRegularization),
      ),
      metric_every: Math.min(METRIC_EVERY_RANGE.max, Math.max(METRIC_EVERY_RANGE.min, Math.round(settings.qngMetricEvery))),
      max_metric_params: Math.min(
        MAX_METRIC_PARAMS_RANGE.max,
        Math.max(MAX_METRIC_PARAMS_RANGE.min, Math.round(settings.qngMaxMetricParams)),
      ),
    };
  }
  if (analyses.some((a) => NOISE_AWARE_ANALYSES.includes(a))) {
    const noise = channelNoiseSettings(settings);
    if (noise) out.noise = noise;
  }
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
