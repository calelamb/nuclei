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

/** Spec v2 §5.5/§5.6: how gradient variance is estimated. */
export type TrainabilityMethod = 'auto' | 'sampling' | 'ppe';
/** The method that actually produced a result (never `auto`). */
export type ResolvedMethod = 'sampling' | 'ppe';
export type TrainabilityBackendChoice = 'auto' | 'numpy' | 'cupy' | 'jax';

export interface TrainabilitySettings {
  samples?: number;
  seed?: number;
  init?: GradientInit;
  method?: TrainabilityMethod;
  backend?: TrainabilityBackendChoice;
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

/**
 * How an interval was obtained. The kernel's `interval` field is an OBJECT
 * `{kind, ...}` for both estimators (never `[lo, hi]`): read numbers from
 * `variance_mean_ci95` / `variance_ci95` and label them with `kind`.
 */
export type IntervalKind = 'bootstrap' | 'truncation';
export interface IntervalInfo {
  kind: IntervalKind;
  [extra: string]: unknown;
}

export interface GradientStatistics {
  /** Null for PPE results (no sampling happened). */
  samples: number | null;
  init: GradientInit;
  per_parameter: Array<{
    name: string;
    mean: number | null;
    /** Null when the PPE run did not resolve this parameter: interval only. */
    variance: number | null;
    abs_mean: number | null;
    variance_ci95: Interval | null;
  }>;
  /** Null when a PPE run was incomplete or uninformative; see `variance_mean_ci95`. */
  variance_mean: number | null;
  variance_mean_ci95: Interval | null;
  gradient_norm_mean: number | null;
  gate_values: Array<{
    source_index: number;
    parameter: string;
    /** Null = unresolved (interval only). Never paint the heatmap from null. */
    variance: number | null;
    abs_mean: number | null;
    variance_ci95?: Interval | null;
  }>;
  elapsed_ms: number;
  /** Spec v2: the estimator used. */
  method?: ResolvedMethod;
  backend?: string;
  /** The interval's provenance object (never a `[lo, hi]` pair). */
  interval?: IntervalInfo | null;
  interval_kind?: IntervalKind | null;
  /** Why a result is incomplete or uninformative, in the kernel's words. */
  notes?: string[];
  /** Empirical Var[C] of the cost itself (sampling path; may be null on PPE). */
  cost_variance?: number | null;
  cost_variance_ci95?: Interval | null;
  cost_mean?: number | null;
}

export type ScalingVerdict = 'barren_plateau' | 'polynomial' | 'inconclusive';

export interface ScalingFit {
  n_layers: number;
  exponential: { beta: number; beta_ci95: Interval; log2_intercept: number; r2: number; aic: number } | null;
  power_law: { alpha: number; alpha_ci95: Interval; r2: number; aic: number } | null;
  /** Null when no model could be preferred (too few points, or all excluded). */
  preferred: 'exponential' | 'power_law' | 'none' | null;
  delta_aic: number | null;
  verdict: ScalingVerdict;
  /** Carries the reason for an inconclusive verdict and any excluded points. */
  summary: string;
}

export interface ScalingPoint {
  n_qubits: number;
  n_layers: number;
  /** The next four are null on a failed point (see `error`). */
  n_params: number | null;
  variance: number | null;
  variance_ci95: Interval | null;
  method?: ResolvedMethod | null;
  backend?: string;
  /** PPE only: the interval's provenance object. */
  interval?: IntervalInfo | null;
  interval_kind?: IntervalKind | null;
  error?: { code: string; message: string } | null;
}

export interface ScalingStudy {
  points: ScalingPoint[];
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
  /** Ragone prediction of the COST variance Var[C] (not the gradient variance). */
  predicted_variance: number | null;
  prediction_quantity?: 'cost_variance';
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
  /** `qubits` is additive (kernel ≥ PRD 14 final); older kernels omit it. */
  param_gates: Array<{ source_index: number; parameter: string; gate: string; qubits?: number[] }>;
  sweepable_params: string[];
  observable_declared: string | null;
  notes: string[];
}

/** Addendum §D — certificate provenance carried on `trainability_result`. */
export interface TrainabilityProvenance {
  code_sha256: string;
  observable: string;
  settings: TrainabilitySettings;
  kernel: {
    nuclei_protocol: string;
    python: string;
    numpy: string;
    stim: string | null;
    qiskit?: string | null;
    cirq?: string | null;
  };
  analyses_fingerprint: string;
  backend: string;
  created_at: string;
}

// ── Messages ────────────────────────────────────────────────────────────

export type TrainabilityRequest =
  | {
      type: 'trainability_inspect';
      code: string;
      language?: KernelLanguage;
      params?: Record<string, number>;
      /** Echoed on the reply and on its errors; lets the client drop stale replies. */
      request_id?: string;
    }
  | {
      type: 'trainability_lint';
      code: string;
      language?: KernelLanguage;
      observable?: string;
      params?: Record<string, number>;
      request_id?: string;
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
  | ({ type: 'trainability_inspected'; request_id?: string } & TrainabilityInspection)
  | {
      type: 'trainability_lint_result';
      diagnostics: TrainabilityDiagnostic[];
      summary: TrainabilityLintSummary;
      request_id?: string;
    }
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
      /** Addendum §D. Optional so older kernels still parse. */
      provenance?: TrainabilityProvenance;
    }
  | { type: 'trainability_cancelled'; job_id: string; accepted: boolean };

// ── UI types ────────────────────────────────────────────────────────────

export type TrainabilityTabId = 'gradients' | 'scaling' | 'lie' | 'expressibility' | 'landscape';

export type TrainabilityJobStatus = 'starting' | 'running' | 'cancelling' | 'complete' | 'cancelled' | 'failed';

export const ACTIVE_JOB_STATUSES: readonly TrainabilityJobStatus[] = ['starting', 'running', 'cancelling'];

export interface TrainabilityTargetSnapshot {
  fileName: string;
  filePath: string | null;
  framework: string;
  nQubits: number | null;
  nParameters: number | null;
  observable: string;
}

export interface TrainabilityJobRecord {
  id: string;
  status: TrainabilityJobStatus;
  target: TrainabilityTargetSnapshot;
  analyses: TrainabilityAnalysis[];
  settings: TrainabilitySettings;
  progress: Partial<Record<TrainabilityAnalysis, { fraction: number; message: string }>>;
  /** Per-analysis results, filled as `trainability_partial` messages arrive. */
  results: TrainabilityResults;
  errors: Partial<Record<TrainabilityAnalysis, { code: string; message: string }>>;
  startedAt: number;
  finishedAt: number | null;
  elapsedMs: number | null;
  provenance: TrainabilityProvenance | null;
  /** Job-level failure (kernel error envelope, timeout, disconnect). */
  error: { code: string; message: string } | null;
  /** Hash of the analysed source, used to flag stale results. */
  codeKey: string;
}

export type AsyncStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface InspectState {
  status: AsyncStatus;
  data: TrainabilityInspection | null;
  error: string | null;
  /** Key (hash of code + params) the data belongs to. */
  codeKey: string | null;
}

export interface LintState {
  status: AsyncStatus;
  diagnostics: TrainabilityDiagnostic[];
  summary: TrainabilityLintSummary | null;
  error: string | null;
  codeKey: string | null;
}

export interface SavedCertificate {
  jsonPath: string;
  markdownPath: string;
  savedAt: number;
  fileName: string;
  jobId: string;
}

/** Addendum §D — the `.trainability.json` document. */
export interface TrainabilityCertificateJson {
  schema: 'nuclei.trainability.certificate/1';
  file: string;
  framework: string;
  n_qubits: number | null;
  n_parameters: number | null;
  observable: string;
  created_at: string;
  job_id: string;
  provenance: TrainabilityProvenance | null;
  settings: TrainabilitySettings;
  verdicts: {
    trainability: { risk: 'high' | 'medium' | 'low' | 'unknown'; evidence: Array<{ source: string; level: string; text: string }> };
    simulability: { kind: string; summary: string; ppe_points: number; caveat: string };
    scaling: ScalingVerdict | null;
  };
  results: TrainabilityResults;
  errors: Partial<Record<TrainabilityAnalysis, { code: string; message: string }>>;
  lint: TrainabilityDiagnostic[];
}
