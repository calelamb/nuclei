/**
 * Realistic Conjecture Engine fixtures for tests and render checks: a
 * Frontier-evaluator run with structural features, the kernel's schema reply,
 * a conjecture and results of each verdict.
 */

import type { CandidateRecord, DiscoveryEvaluation, RunRecord } from '../../types/discovery';
import type { Conjecture, ConjectureResult, ConjectureResponse, EvidenceRow } from '../../types/conjecture';
import { axisFromDescriptor, createArchive, eliteFromEvaluation, insertElite } from '../discovery/archive';
import { fixtureRun } from '../discovery/fixtures';
import { normalizeSchemaResult } from './schema';

export const FRONTIER_RUN_ID = '20261018-141530-f00d';

export const FIXTURE_SCHEMA_REPLY: Extract<ConjectureResponse, { type: 'discovery_conjecture_schema_result' }> = {
  type: 'discovery_conjecture_schema_result',
  features: [
    { key: 'n_layers', type: 'integer', description: 'Number of repeated layers.' },
    { key: 'entangler', type: 'string', description: 'Two-qubit gate used (cz, cx, mixed, none).' },
    { key: 'entangler_pattern', type: 'string', description: 'brick, ladder, ring, all_to_all, nearest_neighbor, long_range or none.' },
    { key: 'rotation_axes', type: 'string', description: 'Axes of the parametric rotations, for example "YZ".' },
    { key: 'params_per_qubit', type: 'number', description: 'Parameters divided by qubits.' },
  ],
  quantities: [
    { key: 'beta_upper95', description: 'Upper 95% bound of the exponential variance-decay rate beta.' },
    { key: 'verdict', description: 'The scaling verdict (polynomial, exponential, inconclusive).' },
    { key: 'variance_at_max_n', description: 'Gradient variance at the largest n.' },
    { key: 'log2_dla_dimension', description: 'log2 of the dynamical Lie algebra dimension.' },
  ],
  families: {
    type: 'object',
    properties: {
      family: { const: 'layered' },
      rotation_axes: { type: 'string', enum: ['X', 'Y', 'Z', 'XY', 'YZ', 'XZ', 'XYZ'] },
      entangler: { type: 'string', enum: ['cz', 'cx'] },
      pattern: { type: 'string', enum: ['brick', 'ladder', 'ring', 'all_to_all'] },
      layers: { type: 'integer', minimum: 1, maximum: 64 },
      rotations_per_qubit_per_layer: { type: 'integer', minimum: 1, maximum: 3 },
      observable: { type: 'string' },
      variants: { type: 'integer', minimum: 1, maximum: 8 },
    },
    required: ['family', 'rotation_axes', 'entangler', 'pattern', 'layers', 'rotations_per_qubit_per_layer', 'observable', 'variants'],
    additionalProperties: false,
  },
  predicate: {
    $defs: {
      node: {
        anyOf: [
          {
            type: 'object',
            properties: { feature: { type: 'string' }, op: { enum: ['==', '!=', '<', '<=', '>', '>=', 'in'] }, value: {} },
            required: ['feature', 'op', 'value'],
          },
          { type: 'object', properties: { all: { type: 'array', items: { $ref: '#/$defs/node' } } }, required: ['all'] },
          { type: 'object', properties: { any: { type: 'array', items: { $ref: '#/$defs/node' } } }, required: ['any'] },
        ],
      },
    },
    type: 'object',
    anyOf: [{ required: ['all'] }, { required: ['any'] }],
    properties: {
      all: { type: 'array', items: { $ref: '#/$defs/node' }, minItems: 1 },
      any: { type: 'array', items: { $ref: '#/$defs/node' }, minItems: 1 },
    },
  },
};

export function fixtureSchema() {
  const info = normalizeSchemaResult(FIXTURE_SCHEMA_REPLY);
  if (!info) throw new Error('fixture schema failed to normalise');
  return info;
}

export function fixtureConjecture(patch: Partial<Conjecture> = {}): Conjecture {
  return {
    id: 'cj-20261018-141600-1',
    statement: 'Brick-pattern CZ circuits with YZ rotations keep beta_upper95 below 0.1 up to 128 qubits at six layers.',
    feature_predicate: { all: [{ feature: 'entangler_pattern', op: '==', value: 'brick' }, { feature: 'n_layers', op: '<=', value: 6 }] },
    prediction: { quantity: 'beta_upper95', op: '<', value: 0.1 },
    test_family: {
      family: 'layered', rotation_axes: 'YZ', entangler: 'cz', pattern: 'brick', layers: 6,
      rotations_per_qubit_per_layer: 2, observable: 'preset:local_z', variants: 4,
    },
    n_range: [8, 128],
    circuits: 8,
    points: 5,
    ...patch,
  };
}

const ENTANGLERS = ['brick', 'ladder', 'ring', 'brick', 'ladder', 'all_to_all'] as const;

function frontierEvaluation(i: number, withFeatures: boolean): DiscoveryEvaluation {
  const id = `c-${String(i).padStart(4, '0')}`;
  const beta = 0.05 + (i % 6) * 0.07;
  const features = {
    n_qubits: 16, n_params: 32 + i, parametric_gates: 32 + i, params_per_qubit: 2,
    two_qubit_gates: 15 * (1 + (i % 4)), two_qubit_depth: 2 + (i % 4),
    rotation_axes: i % 2 ? 'YZ' : 'XY', rotation_axis_counts: { X: 0, Y: 16, Z: 16 },
    entangler: 'cz', entangler_pattern: ENTANGLERS[i % ENTANGLERS.length],
    distinct_bonds: 15, connectivity_fraction: 0.12, n_layers: 2 + (i % 5), two_qubit_gates_per_layer: 15,
  };
  return {
    candidate_id: id,
    run_id: FRONTIER_RUN_ID,
    status: 'scored',
    fitness: 1 + i * 0.1,
    objectives: {
      beta: { value: beta, ci95: [beta - 0.02, beta + 0.03], direction: 'minimize', label: 'beta' },
      estimation_hardness: { value: 3 + (i % 3), direction: 'maximize', label: 'Estimation hardness' },
    },
    descriptors: { log2_dla_dimension: 4 + (i % 8), two_qubit_gates_per_layer: 15 },
    metrics: {
      ...(withFeatures ? { features } : {}),
      points: [8, 16, 32, 64].map((n) => ({ n_qubits: n, variance: 2 ** (-beta * n) })),
      hardness_censored: i % 4 === 0,
    },
    guardrails: [], rejection: null, failure: null, stdout: '', stderr: '',
    timings_ms: { total: 10 },
    evaluator: { kind: 'trainability_frontier', version: '1.0.0', fingerprint: 'ab'.repeat(32) },
    seed: i, stage: 'full',
  };
}

function candidateFor(i: number, evaluation: DiscoveryEvaluation): CandidateRecord {
  const id = `c-${String(i).padStart(4, '0')}`;
  return {
    id, parent_id: i === 0 ? null : 'c-0000', island: i % 2, generation: Math.floor(i / 4), mutator: i === 0 ? 'seed' : 'ast',
    program: `# ${id}\n`, program_sha256: `sha-${id}`.padEnd(64, '0'), llm: null, ast_ops: null, evaluation,
    created_at: '2026-10-18T14:15:30.000Z', outcome: 'evaluated', eval_seed: i, inspiration_ids: [], screen: null,
    duplicate_of: null, proposal_error: null, in_archive: true, region_warning: false, reevaluations: [],
  };
}

export interface FrontierFixture {
  run: RunRecord;
  candidates: Record<string, CandidateRecord>;
}

/** A finished Frontier run with `count` scored archive candidates. */
export function frontierFixture(count = 12, withFeatures = true): FrontierFixture {
  const base = fixtureRun({ run_id: FRONTIER_RUN_ID });
  const axes = [
    axisFromDescriptor({ key: 'log2_dla_dimension', label: 'log2 DLA', min: 0, max: 16, default_bins: 8 }, 8),
    axisFromDescriptor({ key: 'two_qubit_gates_per_layer', label: 'CZ per layer', min: 0, max: 64, default_bins: 8 }, 8),
  ] as const;
  let archive = createArchive(
    axes,
    [{ key: 'beta', label: 'beta', direction: 'minimize' }, { key: 'estimation_hardness', label: 'Hardness', direction: 'maximize' }],
    2,
  );
  const candidates: Record<string, CandidateRecord> = {};
  for (let i = 0; i < count; i += 1) {
    const evaluation = frontierEvaluation(i, withFeatures);
    const c = candidateFor(i, evaluation);
    candidates[c.id] = c;
    const elite = eliteFromEvaluation(archive, { candidateId: c.id, island: c.island, programHash: c.program_sha256 }, evaluation);
    if (elite) archive = insertElite(archive, { ...elite, cell: [i % 8, Math.floor(i / 8) % 8] as const }).archive;
  }
  const run: RunRecord = {
    ...base,
    evaluator: { kind: 'trainability_frontier', version: '1.0.0', fingerprint: 'ab'.repeat(32) },
    archive,
  };
  return { run, candidates };
}

export function fixtureEvidenceItem(index: number, outcome: EvidenceRow['outcome'] = 'meets'): Record<string, unknown> {
  const beta = outcome === 'violates' ? 0.34 : 0.04;
  return {
    circuit_index: index,
    outcome,
    seed: 1000 + index,
    features: { n_layers: 6, entangler_pattern: 'brick', rotation_axes: 'YZ' },
    beta,
    beta_ci95: [beta - 0.01, beta + 0.02],
    beta_upper95: beta + 0.02,
    points: [8, 16, 32, 64, 128].map((n) => ({ n_qubits: n, variance: 2 ** (-beta * n) / 4, variance_ci95: [2 ** (-beta * n) / 5, 2 ** (-beta * n) / 3] })),
  };
}

export const FIXTURE_IR = {
  version: 1,
  n_qubits: 3,
  parameters: ['t0', 't1', 't2'],
  framework: 'native',
  notes: [],
  gates: [
    { name: 'H', qubits: [0], angles: [], source_index: 0, source_line: null },
    { name: 'RY', qubits: [0], angles: [{ param: 't0', coeff: 1, offset: 0 }], source_index: 1, source_line: null },
    { name: 'RZ', qubits: [1], angles: [{ param: 't1', coeff: 2, offset: 0.5 }], source_index: 2, source_line: null },
    { name: 'CZ', qubits: [0, 1], angles: [], source_index: 3, source_line: null },
    { name: 'CX', qubits: [1, 2], angles: [], source_index: 4, source_line: null },
    { name: 'RX', qubits: [2], angles: [{ param: 't2', coeff: 1, offset: 0 }], source_index: 5, source_line: null },
    { name: 'S', qubits: [2], angles: [], source_index: 6, source_line: null },
    { name: 'RZ', qubits: [0], angles: [0.25], source_index: 7, source_line: null },
  ],
};

export function fixtureResult(verdict: ConjectureResult['verdict'] = 'supported'): ConjectureResult {
  const refuted = verdict === 'refuted';
  const n = verdict === 'inconclusive' ? 3 : 8;
  return {
    verdict,
    summary:
      verdict === 'supported'
        ? 'supported on 8 held-out circuits up to n = 128'
        : verdict === 'refuted'
          ? 'refuted: 1 of 8 held-out circuits violates beta_upper95 < 0.1 (n up to 128)'
          : 'inconclusive: 3 of 8 held-out circuits could not be decided at the exactness budget',
    evidence: Array.from({ length: n }, (_, i) => fixtureEvidenceItem(i, refuted && i === 2 ? 'violates' : verdict === 'inconclusive' ? 'indeterminate' : 'meets')),
    counterexamples: refuted
      ? [{ family_params: { pattern: 'brick', layers: 6, variant: 2 }, seed: 1002, ir: FIXTURE_IR, circuit_index: 2, beta_upper95: 0.36 }]
      : [],
    ledger_markdown: `### ${verdict}\n\nKernel evidence table goes here.`,
    fingerprint: 'cd'.repeat(32),
    elapsed_ms: 18_450,
  };
}
