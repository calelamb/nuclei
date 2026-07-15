/**
 * QEC Studio wire types (protocol v1.2, PRD 10 Phase A).
 *
 * Mirrors `kernel/qec/dem.py`'s payload — the `qec_snapshot` sidecar sent
 * for Stim circuits and returnable on demand — plus `qec_generate`.
 */

/** One pairwise detector-graph edge, parallel mechanisms already merged. */
export interface DemEdge {
  d1: number;
  d2: number;
  /** Logical observables this edge flips (indices). */
  obs: number[];
  p: number;
}

/** An edge from a detector to the (virtual) boundary node. */
export interface DemBoundaryEdge {
  d: number;
  obs: number[];
  p: number;
}

export interface DetectorErrorModelGraph {
  nodes: number;
  /** Full counts — preserved even when the edge lists are truncated. */
  edge_count: number;
  boundary_edge_count: number;
  /** >0 means the model isn't purely matchable; render with a badge. */
  hyperedges_count: number;
  /** True when the payload exceeded the edge cap: lists below are empty,
   * counts above are real. Re-request `qec_snapshot` with a higher
   * `max_edges` to render anyway. Never silent. */
  truncated: boolean;
  edges: DemEdge[];
  boundary_edges: DemBoundaryEdge[];
}

export interface QecSnapshot {
  num_qubits: number;
  num_detectors: number;
  num_observables: number;
  num_ticks: number;
  coords: {
    /** Index-aligned: entry i = qubit i's [x, y], null when stim has no
     * coordinates for it. */
    qubits: Array<[number, number] | null>;
    /** Entry i = detector i's [x, y, t], null when unset. */
    detectors: Array<[number, number, number] | null>;
  };
  /** Null when stim couldn't build any detector error model — see
   * `dem_error` for the reason. */
  dem: DetectorErrorModelGraph | null;
  dem_error?: string;
  /** Present only when `dem.truncated` — the flattened DEM text, so the
   * frontend can parse + render the full graph client-side (WASM) with no
   * kernel-side edge cap. */
  dem_text?: string;
  /** Reserved for qec_decode_sample (PRD 10 Phase B). */
  sample_decode: null;
}

/** Stim's built-in generator targets accepted by `qec_generate`. */
export type QecGeneratedCode =
  | 'repetition_code:memory'
  | 'surface_code:rotated_memory_x'
  | 'surface_code:rotated_memory_z'
  | 'surface_code:unrotated_memory_x'
  | 'surface_code:unrotated_memory_z'
  | 'color_code:memory_xyz';

/** Noise arguments stim's generator applies at generation time. */
export interface QecGenerateNoise {
  after_clifford_depolarization?: number;
  before_round_data_depolarization?: number;
  before_measure_flip_probability?: number;
  after_reset_flip_probability?: number;
}

// ───────── campaigns (protocol v1.2, PRD 10 Phase B) ─────────

/** One sinter task on the wire: a circuit, a decoder, and free metadata
 * that comes back verbatim on every stats row. */
export interface QecCampaignTask {
  circuit_text: string;
  decoder: string;
  json_metadata?: unknown;
}

/** Accumulated per-task statistics — sinter's standard CSV columns,
 * JSON-encoded. Merge by `strong_id`; progress updates carry totals for
 * changed tasks only. */
export interface QecCampaignStatsRow {
  strong_id: string;
  decoder: string;
  json_metadata: unknown;
  shots: number;
  errors: number;
  discards: number;
  seconds: number;
  custom_counts: Record<string, number>;
}

export interface QecCampaignProgress {
  campaign_id: string;
  /** Accumulated totals for tasks whose numbers changed since the last
   * update — never the full table. */
  tasks: QecCampaignStatsRow[];
  tasks_complete: number;
  tasks_total: number;
  /** sinter's free-form ETA/status text — display only, never parse. */
  status_message: string;
}

export interface QecCampaignResult {
  campaign_id: string;
  /** True after a cancel or worker failure — stats hold everything
   * collected (plus resumed prior data). */
  partial: boolean;
  /** Shots newly sampled THIS run — 0 when resume found nothing to do. */
  sampled_shots: number;
  stats: QecCampaignStatsRow[];
  /** sinter-native CSV — write to stats.csv as-is (the on-disk truth,
   * loadable by researchers' existing scripts). */
  csv: string;
  /** First line of the failure, present only when a worker died. */
  error?: string;
}

/** One decoded shot for the detector-graph overlay. `d2: null` marks a
 * boundary match. Deterministic for a given seed. */
export interface QecDecodeSampleResult {
  num_detectors: number;
  syndrome: number[];
  matched_edges: Array<{ d1: number; d2: number | null }>;
  predicted_observable_flips: number[];
  actual_observable_flips: number[];
}

// ───────── Resource Estimator (protocol v1.2, PRD 10 Phase F) ─────────

export const QEC_QUBIT_PRESETS = [
  'qubit_gate_ns_e3',
  'qubit_gate_ns_e4',
  'qubit_gate_us_e3',
  'qubit_gate_us_e4',
  'qubit_maj_ns_e4',
  'qubit_maj_ns_e6',
] as const;
export type QecQubitPreset = (typeof QEC_QUBIT_PRESETS)[number];
export const QEC_ESTIMATE_SCHEMES = ['surface_code', 'floquet_code'] as const;
export type QecEstimateScheme = (typeof QEC_ESTIMATE_SCHEMES)[number];

export interface QecEstimateOptions {
  qubit_params?: QecQubitPreset;
  qec_scheme?: QecEstimateScheme;
  error_budget?: number;
}

/** The `qec_estimate_result` payload — headline numbers + the estimator's
 * pre-formatted strings + the full document (for collapsible detail/export). */
export interface QecEstimate {
  physical_qubits: number | null;
  runtime_ns: number | null;
  rqops: number | null;
  code_distance: number | null;
  logical_error_rate: number | null;
  num_tfactories: number | null;
  physical_qubits_algorithm: number | null;
  physical_qubits_tfactories: number | null;
  qubit_params: string | null;
  qec_scheme: string | null;
  formatted: Record<string, string>;
  full: unknown;
}
