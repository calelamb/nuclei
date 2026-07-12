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
