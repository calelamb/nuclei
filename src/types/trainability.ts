/**
 * PRD 14 — Trainability Lab ("the Microscope") wire types, Kernel Protocol
 * v1.3. These mirror `kernel/trainability/*` payloads exactly; see
 * docs/research/PRD_14_QUANTUM_AI_LAB.md §5. UI-only types belong below the
 * "UI types" marker so the protocol block stays a faithful mirror.
 */

import type { KernelLanguage } from './quantum';

export type TrainabilityAnalysis =
  | 'gradients'
  | 'scaling'
  | 'lie'
  | 'expressibility'
  | 'entanglement'
  | 'landscape';

export const TRAINABILITY_ANALYSES: readonly TrainabilityAnalysis[] = [
  'gradients',
  'scaling',
  'lie',
  'expressibility',
  'entanglement',
  'landscape',
];

export type GradientInit = 'uniform' | 'small';

export interface TrainabilitySettings {
  samples?: number;
  seed?: number;
  init?: GradientInit;
  scaling?: {
    qubits?: number[];
    layers?: number[];
    qubit_param?: string;
    layer_param?: string;
  };
  expressibility?: { pairs?: number; bins?: number };
  entanglement?: { samples?: number };
  landscape?: { resolution?: number; span?: number };
  lie?: { max_dimension?: number; time_budget_s?: number };
}

export type Interval = [number, number];

// ── Analysis results ────────────────────────────────────────────────────

export interface GradientStatistics {
  samples: number;
  init: GradientInit;
  per_parameter: Array<{
    name: string;
    mean: number;
    variance: number;
    abs_mean: number;
    variance_ci95: Interval;
  }>;
  variance_mean: number;
  variance_mean_ci95: Interval;
  gradient_norm_mean: number;
  gate_values: Array<{ source_index: number; parameter: string; variance: number; abs_mean: number }>;
  elapsed_ms: number;
}

export type ScalingVerdict = 'barren_plateau' | 'polynomial' | 'inconclusive';

export interface ScalingFit {
  n_layers: number;
  exponential: { beta: number; beta_ci95: Interval; log2_intercept: number; r2: number; aic: number } | null;
  power_law: { alpha: number; alpha_ci95: Interval; r2: number; aic: number } | null;
  preferred: 'exponential' | 'power_law' | 'none';
  delta_aic: number | null;
  verdict: ScalingVerdict;
  summary: string;
}

export interface ScalingStudy {
  points: Array<{
    n_qubits: number;
    n_layers: number;
    n_params: number;
    variance: number;
    variance_ci95: Interval;
  }>;
  fits: ScalingFit[];
  observable?: string;
  notes?: string[];
}

export interface LieAlgebraResult {
  status: 'complete' | 'truncated' | 'unsupported';
  reason: string | null;
  n_qubits: number;
  dimension: number | null;
  dimension_lower_bound: number;
  max_dimension: number;
  classification: {
    label: string;
    family: 'su' | 'so' | 'sp' | 'free_fermion' | 'other' | 'unknown';
    confidence: string;
    note: string;
  } | null;
  generators: { count: number; unique: number; examples: string[] };
  fixed_gates: { clifford: boolean; handled_by: 'clifford_conjugation' | 'dense' | 'none' };
  purity: {
    initial_state: number | null;
    observable: number | null;
    observable_in_algebra: boolean | null;
    state_in_algebra: boolean | null;
  };
  predicted_variance: number | null;
  prediction_applicable: boolean;
  assumptions: string[];
  simulability: { kind: 'g_sim_feasible' | 'exponential_dla' | 'unknown'; summary: string };
  elapsed_ms: number;
}

export interface ExpressibilityResult {
  kl: number;
  kl_ci95: Interval;
  pairs: number;
  bins: number;
  dimension: number;
  histogram: Array<{ lo: number; hi: number; observed: number; haar: number }>;
  reference: { idle_kl: number; note: string };
}

export interface EntanglingCapabilityResult {
  mean: number;
  std: number;
  ci95: Interval;
  histogram: Array<{ lo: number; hi: number; count: number }>;
  haar_mean: number;
}

export interface LandscapeResult {
  resolution: number;
  span: number;
  axis: number[];
  /** Row-major, y outer: values[iy][ix]. */
  values: number[][];
  center: number[];
  min: number;
  max: number;
  center_value: number;
}

export interface TrainabilityResults {
  gradients?: GradientStatistics;
  scaling?: ScalingStudy;
  lie?: LieAlgebraResult;
  expressibility?: ExpressibilityResult;
  entanglement?: EntanglingCapabilityResult;
  landscape?: LandscapeResult;
}

// ── Lint ────────────────────────────────────────────────────────────────

export type TrainabilitySeverity = 'error' | 'warning' | 'info';

export interface TrainabilityDiagnostic {
  code: string;
  severity: TrainabilitySeverity;
  title: string;
  message: string;
  citation: { label: string; url: string } | null;
  line: number | null;
  source_indices: number[];
}

export interface TrainabilityLintSummary {
  n_qubits: number;
  n_parameters: number;
  dla: { status: LieAlgebraResult['status']; dimension: number | null } | null;
  observable: string | null;
  elapsed_ms: number;
}

// ── Inspect ─────────────────────────────────────────────────────────────

export interface TrainabilityInspection {
  framework: string;
  n_qubits: number;
  parameters: string[];
  gate_count: number;
  param_gates: Array<{ source_index: number; parameter: string; gate: string }>;
  sweepable_params: string[];
  observable_declared: string | null;
  notes: string[];
}

// ── Messages ────────────────────────────────────────────────────────────

export type TrainabilityRequest =
  | { type: 'trainability_inspect'; code: string; language?: KernelLanguage; params?: Record<string, number> }
  | {
      type: 'trainability_lint';
      code: string;
      language?: KernelLanguage;
      observable?: string;
      params?: Record<string, number>;
    }
  | {
      type: 'trainability_start';
      job_id: string;
      code: string;
      language?: KernelLanguage;
      observable: string;
      analyses: TrainabilityAnalysis[];
      settings?: TrainabilitySettings;
      params?: Record<string, number>;
    }
  | { type: 'trainability_cancel'; job_id: string };

export type TrainabilityResponse =
  | ({ type: 'trainability_inspected' } & TrainabilityInspection)
  | { type: 'trainability_lint_result'; diagnostics: TrainabilityDiagnostic[]; summary: TrainabilityLintSummary }
  | { type: 'trainability_started'; job_id: string }
  | { type: 'trainability_progress'; job_id: string; analysis: TrainabilityAnalysis; fraction: number; message: string }
  | {
      type: 'trainability_partial';
      job_id: string;
      analysis: TrainabilityAnalysis;
      result: TrainabilityResults[TrainabilityAnalysis];
    }
  | {
      type: 'trainability_result';
      job_id: string;
      status: 'complete' | 'cancelled' | 'failed';
      results: TrainabilityResults;
      errors: Partial<Record<TrainabilityAnalysis, { code: string; message: string }>>;
      elapsed_ms: number;
    }
  | { type: 'trainability_cancelled'; job_id: string; accepted: boolean };

// ── UI types ────────────────────────────────────────────────────────────
