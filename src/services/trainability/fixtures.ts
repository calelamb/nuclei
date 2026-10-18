/**
 * PRD 14 — realistic fixtures matching the spec §5.5/§5.6 JSON shapes. Used
 * by the unit/render tests (and available to a stubbed-kernel e2e spec).
 */

import type {
  EntanglingCapabilityResult,
  ExpressibilityResult,
  GradientStatistics,
  LandscapeResult,
  LieAlgebraResult,
  ScalingStudy,
  TrainabilityDiagnostic,
  TrainabilityInspection,
  TrainabilityJobRecord,
  TrainabilityLintSummary,
  TrainabilityProvenance,
  TrainabilityResults,
} from '../../types/trainability';

export const FIXTURE_CODE = `from qiskit import QuantumCircuit
from qiskit.circuit import ParameterVector

n_qubits = params.get("n_qubits", 6)
n_layers = params.get("n_layers", 2)
theta = ParameterVector("θ", n_qubits * n_layers)
qc = QuantumCircuit(n_qubits)
for layer in range(n_layers):
    for q in range(n_qubits):
        qc.ry(theta[layer * n_qubits + q], q)
    for q in range(n_qubits - 1):
        qc.cz(q, q + 1)
`;

export const inspectionFixture: TrainabilityInspection = {
  framework: 'qiskit',
  n_qubits: 4,
  parameters: ['θ[0]', 'θ[1]', 'θ[2]', 'θ[3]', 'θ[4]', 'θ[5]'],
  gate_count: 9,
  param_gates: [
    { source_index: 0, parameter: 'θ[0]', gate: 'RY' },
    { source_index: 1, parameter: 'θ[1]', gate: 'RY' },
    { source_index: 2, parameter: 'θ[2]', gate: 'RY' },
    { source_index: 3, parameter: 'θ[3]', gate: 'RY' },
    { source_index: 7, parameter: 'θ[4]', gate: 'RY' },
    { source_index: 8, parameter: 'θ[5]', gate: 'RY' },
  ],
  sweepable_params: ['n_qubits', 'n_layers'],
  observable_declared: 'preset:global_z',
  notes: [],
};

export const lintDiagnosticsFixture: TrainabilityDiagnostic[] = [
  {
    code: 'TRN001',
    severity: 'warning',
    title: 'Global cost function',
    message: 'The observable acts on all 4 qubits. Global costs exhibit barren plateaus even for shallow circuits.',
    citation: { label: 'Cerezo et al., Nat. Commun. 12, 1791 (2021)', url: 'https://doi.org/10.1038/s41467-021-21728-w' },
    line: 9,
    source_indices: [0, 1],
  },
  {
    code: 'TRN004',
    severity: 'info',
    title: 'Dead parameter',
    message: 'θ[5] cannot affect the cost: its generator commutes with the observable.',
    citation: null,
    line: 8,
    source_indices: [8],
  },
  {
    code: 'TRN002',
    severity: 'warning',
    title: 'Exponentially large Lie algebra',
    message: 'dim 𝔤 = 120 matches so(2ⁿ) for n = 4: exponential gradient concentration is expected.',
    citation: { label: 'Ragone et al., Nat. Commun. 15, 7172 (2024)', url: 'https://doi.org/10.1038/s41467-024-49909-3' },
    line: null,
    source_indices: [],
  },
];

export const lintSummaryFixture: TrainabilityLintSummary = {
  n_qubits: 4,
  n_parameters: 6,
  dla: { status: 'complete', dimension: 120 },
  observable: '1*Z0*Z1*Z2*Z3',
  elapsed_ms: 87,
};

export const gradientsFixture: GradientStatistics = {
  samples: 200,
  init: 'uniform',
  per_parameter: inspectionFixture.parameters.map((name, i) => {
    const variance = [0.031, 0.0078, 0.026, 0.0041, 2.3e-5, 0][i];
    return {
      name,
      mean: 0.0012 * (i + 1),
      variance,
      abs_mean: Math.sqrt(variance) * 0.8,
      variance_ci95: [variance * 0.86, variance * 1.18] as [number, number],
    };
  }),
  variance_mean: 0.0115,
  variance_mean_ci95: [0.0099, 0.0133],
  gradient_norm_mean: 0.34,
  gate_values: inspectionFixture.param_gates.map((g, i) => ({
    source_index: g.source_index,
    parameter: g.parameter,
    variance: [0.031, 0.0078, 0.026, 0.0041, 2.3e-5, 0][i],
    abs_mean: Math.sqrt([0.031, 0.0078, 0.026, 0.0041, 2.3e-5, 0][i]) * 0.8,
  })),
  elapsed_ms: 412,
  method: 'sampling',
  backend: 'numpy',
};

export const gradientsPpeFixture: GradientStatistics = {
  ...gradientsFixture,
  method: 'ppe',
  interval: [0.0114, 0.0116],
  per_parameter: gradientsFixture.per_parameter.map((p) => ({
    ...p,
    variance_ci95: [p.variance * 0.999, p.variance * 1.001] as [number, number],
  })),
};

const SCALING_QUBITS = [2, 3, 4, 5, 6, 7, 8, 24, 48];

export const scalingFixture: ScalingStudy = {
  observable: 'preset:global_z',
  points: SCALING_QUBITS.map((n) => {
    const variance = 0.5 * 2 ** (-0.93 * n);
    const ppe = n > 20;
    return {
      n_qubits: n,
      n_layers: 4,
      n_params: n * 4,
      variance,
      variance_ci95: [variance * (ppe ? 0.995 : 0.82), variance * (ppe ? 1.005 : 1.2)] as [number, number],
      method: ppe ? ('ppe' as const) : ('sampling' as const),
      backend: 'numpy',
      ...(ppe ? { interval: [variance * 0.995, variance * 1.005] as [number, number] } : {}),
    };
  }),
  fits: [
    {
      n_layers: 4,
      exponential: { beta: 0.93, beta_ci95: [0.81, 1.05], log2_intercept: -1.1, r2: 0.995, aic: -12.3 },
      power_law: { alpha: 2.7, alpha_ci95: [2.1, 3.3], r2: 0.94, aic: -4.0 },
      preferred: 'exponential',
      delta_aic: 8.3,
      verdict: 'barren_plateau',
      summary: 'Var[∂C] ∝ 2^(−0.93 n) (95% CI 0.81–1.05); exponential preferred over power law (ΔAIC 8.3).',
    },
  ],
  notes: [],
};

export const scalingInconclusiveFixture: ScalingStudy = {
  ...scalingFixture,
  points: scalingFixture.points.slice(0, 3),
  fits: [
    {
      n_layers: 4,
      exponential: null,
      power_law: null,
      preferred: 'none',
      delta_aic: null,
      verdict: 'inconclusive',
      summary: 'Only 3 distinct n values; at least 4 are needed for a fit.',
    },
  ],
  notes: ['Too few qubit counts for a reliable fit.'],
};

export const lieFixture: LieAlgebraResult = {
  status: 'complete',
  reason: null,
  n_qubits: 4,
  dimension: 120,
  dimension_lower_bound: 120,
  max_dimension: 255,
  classification: {
    label: 'so(16)',
    family: 'so',
    confidence: 'exact_dimension_match',
    note: 'Dimension match only (2³·(2⁴−1) = 120 = dim so(2⁴)); this is not an isomorphism proof.',
  },
  generators: { count: 12, unique: 7, examples: ['Y0', 'Y1', 'Y2', 'Y3'] },
  fixed_gates: { clifford: true, handled_by: 'clifford_conjugation' },
  purity: { initial_state: 0.25, observable: 1.0, observable_in_algebra: true, state_in_algebra: false },
  predicted_variance: 0.0089,
  prediction_applicable: true,
  assumptions: [
    'Deep-circuit (approximate 2-design over e^𝔤) regime.',
    '𝔤 treated as simple; for reductive 𝔤 this is the leading term.',
  ],
  simulability: {
    kind: 'exponential_dla',
    summary: 'dim 𝔤 = 120 = dim so(2ⁿ) for n = 4: exponentially large; gradient concentration is expected at scale.',
  },
  elapsed_ms: 93,
};

export const lieSimulableFixture: LieAlgebraResult = {
  ...lieFixture,
  n_qubits: 3,
  dimension: 15,
  dimension_lower_bound: 15,
  max_dimension: 63,
  classification: { label: 'free-fermion so(2n)', family: 'free_fermion', confidence: 'exact_dimension_match', note: 'Dimension match only.' },
  simulability: {
    kind: 'g_sim_feasible',
    summary:
      'dim 𝔤 = 15 = n(2n−1): free-fermion algebra. Expectations are classically simulable in poly(dim 𝔤) time (𝔤-sim, Goh et al. 2023).',
  },
};

export const lieTruncatedFixture: LieAlgebraResult = {
  ...lieFixture,
  status: 'truncated',
  reason: 'Hit max_dimension = 4096.',
  dimension: null,
  dimension_lower_bound: 4096,
  max_dimension: 4_194_303,
  classification: null,
  predicted_variance: null,
  prediction_applicable: false,
};

export const expressibilityFixture: ExpressibilityResult = {
  kl: 0.012,
  kl_ci95: [0.009, 0.016],
  pairs: 2000,
  bins: 20,
  dimension: 16,
  histogram: Array.from({ length: 20 }, (_, i) => {
    const lo = i / 20;
    const hi = (i + 1) / 20;
    const haar = Math.max(0, (1 - lo) ** 14 - (1 - hi) ** 14);
    return { lo, hi, observed: haar * (1 + 0.1 * Math.sin(i * 1.7)), haar };
  }),
  reference: { idle_kl: 4.97, note: 'KL of a circuit that always outputs the same state (upper reference) at this bin count.' },
};

export const entanglementFixture: EntanglingCapabilityResult = {
  mean: 0.46,
  std: 0.09,
  ci95: [0.45, 0.47],
  histogram: Array.from({ length: 12 }, (_, i) => ({
    lo: i / 12,
    hi: (i + 1) / 12,
    count: Math.round(1000 * Math.exp(-(((i + 0.5) / 12 - 0.46) ** 2) / (2 * 0.09 ** 2)) * 0.08),
  })),
  haar_mean: 14 / 17,
};

export const landscapeFixture: LandscapeResult = (() => {
  const resolution = 11;
  const span = Math.PI;
  const axis = Array.from({ length: resolution }, (_, i) => -span + (2 * span * i) / (resolution - 1));
  const values = axis.map((y) => axis.map((x) => Math.cos(x) * Math.cos(y) * 0.5 + 0.05 * Math.sin(3 * x)));
  const flat = values.flat();
  return {
    resolution,
    span,
    axis,
    values,
    center: [0.31, -1.2, 0.77],
    min: Math.min(...flat),
    max: Math.max(...flat),
    center_value: values[5][5],
  };
})();

export const resultsFixture: TrainabilityResults = {
  gradients: gradientsFixture,
  scaling: scalingFixture,
  lie: lieFixture,
  expressibility: expressibilityFixture,
  entanglement: entanglementFixture,
  landscape: landscapeFixture,
};

export const provenanceFixture: TrainabilityProvenance = {
  code_sha256: 'a'.repeat(64),
  observable: '1*Z0*Z1*Z2*Z3',
  settings: { samples: 200, seed: 0, init: 'uniform', method: 'auto', backend: 'auto' },
  kernel: { nuclei_protocol: '1.3', python: '3.12.4', numpy: '2.1.0', stim: '1.14.0', qiskit: '1.2.0', cirq: null },
  analyses_fingerprint: 'b'.repeat(64),
  backend: 'numpy',
  created_at: '2026-10-18T12:00:00.000Z',
};

export function jobFixture(overrides: Partial<TrainabilityJobRecord> = {}): TrainabilityJobRecord {
  return {
    id: 'trn-fixture-1',
    status: 'complete',
    target: {
      fileName: 'hardware_efficient.py',
      filePath: 'ansatz/hardware_efficient.py',
      framework: 'qiskit',
      nQubits: 4,
      nParameters: 6,
      observable: 'preset:global_z',
    },
    analyses: ['gradients', 'scaling', 'lie', 'expressibility', 'entanglement', 'landscape'],
    settings: { samples: 200, seed: 0, init: 'uniform', method: 'auto' },
    progress: {},
    results: resultsFixture,
    errors: {},
    startedAt: 1_760_000_000_000,
    finishedAt: 1_760_000_004_000,
    elapsedMs: 4000,
    provenance: provenanceFixture,
    error: null,
    codeKey: 'fixture-code-key',
    ...overrides,
  };
}

export const SCALING_FIXTURE_QUBITS = SCALING_QUBITS;
