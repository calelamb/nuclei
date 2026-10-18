/**
 * Realistic Discovery Engine fixtures for render tests and the e2e stub:
 * a W-state-synthesis run with seed, improvements (LLM and AST), rejected,
 * failed, screened-out, duplicate and invalid candidates, a gradient map and
 * a confirmed champion. Built from the real archive and KPI helpers so they
 * stay consistent with what the runner produces.
 */

import {
  discoverySpecSchema,
  type CandidateRecord,
  type DiscoveryEvaluation,
  type DiscoveryEvaluatorInfo,
  type DiscoverySpec,
  type GradientMap,
  type RunRecord,
} from '../../types/discovery';
import { axisFromDescriptor, createArchive, eliteFromEvaluation, insertElite } from './archive';
import type { DiscoveryDefinition } from './definitions';
import { createRunView, type RunView } from './runView';

export const FIXTURE_DEFINITION_FILE = 'w-state-synthesis.discovery.yaml';
export const FIXTURE_RUN_ID = '20261018-141530-a1b2';
const FINGERPRINT = 'ab12'.repeat(16);

export const FIXTURE_EVALUATOR: DiscoveryEvaluatorInfo = {
  kind: 'state_synthesis',
  version: '1.2.0',
  title: 'State preparation',
  description: 'Fidelity to a target state, penalised by two-qubit gate count.',
  task: 'quantum_circuit',
  entry_signature: 'build(n_qubits: int) -> QuantumCircuit',
  objectives: [
    { key: 'infidelity', label: 'Infidelity', direction: 'minimize' },
    { key: 'two_qubit_gates', label: 'Two-qubit gates', direction: 'minimize', unit: 'gates' },
  ],
  descriptors: [
    { key: 'two_qubit_gates', label: 'Two-qubit gates', min: 0, max: 16, default_bins: 4 },
    { key: 'depth', label: 'Circuit depth', min: 0, max: 32, default_bins: 4 },
  ],
  config_schema: {},
  default_config: {},
};

export function fixtureSpec(overrides: Record<string, unknown> = {}): DiscoverySpec {
  return discoverySpecSchema.parse({
    schema: 1,
    type: 'discovery',
    name: 'w-state-synthesis',
    description: 'Find a W-state preparation with fewer two-qubit gates.',
    program: 'discovery/w_state.py',
    evaluator: { kind: 'state_synthesis', config: { target: { kind: 'w', n_qubits: 5 } } },
    search: { islands: 2, generations: 12, candidates_per_generation: 4, archive: { descriptors: ['two_qubit_gates', 'depth'], bins: [4, 4] } },
    mutator: { kind: 'hybrid', models: { breadth: 'haiku', depth: 'opus', depth_share: 0.2, depth_thinking: true } },
    budget: { max_evaluations: 60, max_llm_calls: 40, max_wall_minutes: 30, max_concurrent_evaluations: 3 },
    confirm: { seeds: 3 },
    seed: 7,
    ...overrides,
  });
}

export function fixtureDefinition(overrides: Record<string, unknown> = {}): DiscoveryDefinition {
  return { fileName: FIXTURE_DEFINITION_FILE, path: `/proj/experiments/${FIXTURE_DEFINITION_FILE}`, spec: fixtureSpec(overrides) };
}

export const FIXTURE_GRADIENT_MAP: GradientMap = {
  method: 'pauli_propagation_exact',
  n_qubits: 5,
  dead_fraction: 0.25,
  lines: [
    { line: 3, parameters: ['θ[0]'], variance: 4.2e-2, dead: false },
    { line: 4, parameters: ['θ[1]'], variance: 8.1e-3, dead: false },
    { line: 5, parameters: ['θ[2]'], variance: 3.0e-10, dead: true },
    { line: 7, parameters: ['θ[3]'], variance: 1.4e-3, dead: false },
  ],
};

interface EvalOptions {
  id: string;
  fitness: number | null;
  infidelity?: number;
  gates?: number;
  depth?: number;
  status?: DiscoveryEvaluation['status'];
  stage?: DiscoveryEvaluation['stage'];
  rejection?: DiscoveryEvaluation['rejection'];
  failure?: DiscoveryEvaluation['failure'];
  gradient?: boolean;
}

function evaluation(o: EvalOptions): DiscoveryEvaluation {
  const status = o.status ?? 'scored';
  const infidelity = o.infidelity ?? 0.01;
  const gates = o.gates ?? 12;
  const scored = status === 'scored';
  return {
    candidate_id: o.id,
    run_id: FIXTURE_RUN_ID,
    status,
    fitness: o.fitness,
    objectives: scored
      ? {
          infidelity: { value: infidelity, ci95: [infidelity * 0.6, infidelity * 1.5], direction: 'minimize', label: 'Infidelity' },
          two_qubit_gates: { value: gates, direction: 'minimize', label: 'Two-qubit gates' },
        }
      : {},
    descriptors: scored ? { two_qubit_gates: gates, depth: o.depth ?? 14 } : {},
    metrics: o.gradient ? { gradient_map: FIXTURE_GRADIENT_MAP } : {},
    guardrails: guardrailList(status, o.rejection ?? null),
    rejection: o.rejection ?? null,
    failure: o.failure ?? null,
    stdout: scored ? 'built 5-qubit circuit\n' : '',
    stderr: status === 'failed' ? 'Traceback (most recent call last):\n  ValueError: boom\n' : '',
    timings_ms: { sandbox: 180, score: 420, total: 640 },
    evaluator: { kind: 'state_synthesis', version: '1.2.0', fingerprint: FINGERPRINT },
    seed: 11,
    stage: o.stage ?? 'full',
    program_key: `key-${o.id}`,
    cache_hit: o.id === 'c-0003',
    isolation: 'sandbox-exec',
    isolation_detail: { reads: 'restricted' },
    compute: { backend: 'numpy', method: 'statevector_sampling' },
  };
}

function guardrailList(status: DiscoveryEvaluation['status'], rejection: DiscoveryEvaluation['rejection']): DiscoveryEvaluation['guardrails'] {
  const ids: Array<[string, string]> = [
    ['entry_returns_circuit', 'Entry returns a circuit'],
    ['elementary_gates', 'Elementary gates only'],
    ['qubit_count', 'Qubit count matches target'],
    ['no_noise', 'No noise channels'],
  ];
  let failed = false;
  return ids.map(([id, label]) => {
    if (failed) return { id, label, status: 'skipped' as const, detail: null };
    if (status === 'rejected' && rejection?.guardrail === id) {
      failed = true;
      return { id, label, status: 'fail' as const, detail: rejection.message };
    }
    return { id, label, status: 'pass' as const, detail: null };
  });
}

interface CandOptions {
  id: string;
  parent: string | null;
  island: number;
  generation: number;
  mutator: CandidateRecord['mutator'];
  evaluation: DiscoveryEvaluation | null;
  outcome?: CandidateRecord['outcome'];
  screen?: DiscoveryEvaluation | null;
  inArchive?: boolean;
  duplicateOf?: string | null;
  proposalError?: string | null;
  touchedDead?: number;
}

function candidate(o: CandOptions): CandidateRecord {
  const llm = o.mutator === 'llm';
  return {
    id: o.id,
    parent_id: o.parent,
    island: o.island,
    generation: o.generation,
    mutator: o.mutator,
    program: `# program ${o.id}\nimport numpy as np\nfrom qiskit import QuantumCircuit\n\ndef build(n_qubits):\n    qc = QuantumCircuit(n_qubits)\n    qc.x(0)\n    return qc  # ${o.id}\n`,
    program_sha256: `sha-${o.id}`.padEnd(64, '0'),
    llm: llm
      ? {
          model: 'claude-haiku-5-5',
          tier: 'haiku',
          depth: false,
          thinking: false,
          rationale: 'Share the excitation with a single controlled rotation instead of a CX pair.',
          expected_effect: 'Two fewer CX gates at the same fidelity.',
          edits: [{ search: 'qc.x(0)', replace: 'qc.x(0)\n    qc.h(1)' }],
          usage: { input_tokens: 1800, output_tokens: 240, cache_creation_input_tokens: 0, cache_read_input_tokens: 1500 },
          prompt_sha256: 'p'.repeat(64),
          touched_dead_lines: o.touchedDead ?? 0,
          batch_id: null,
        }
      : null,
    ast_ops: o.mutator === 'ast' ? ['perturb_constant'] : null,
    evaluation: o.evaluation,
    created_at: '2026-10-18T14:15:30.000Z',
    outcome: o.outcome ?? 'evaluated',
    eval_seed: 11,
    inspiration_ids: [],
    screen: o.screen ?? null,
    duplicate_of: o.duplicateOf ?? null,
    proposal_error: o.proposalError ?? null,
    in_archive: o.inArchive ?? false,
    region_warning: false,
    reevaluations: [],
  };
}

export function fixtureCandidates(): CandidateRecord[] {
  const rejection = { guardrail: 'no_noise', message: 'Circuit contains a depolarizing channel' };
  return [
    candidate({ id: 'c-0000', parent: null, island: 0, generation: 0, mutator: 'seed', inArchive: true, evaluation: evaluation({ id: 'c-0000', fitness: 1.0, infidelity: 0.04, gates: 12, depth: 14, gradient: true }) }),
    candidate({ id: 'c-0001', parent: 'c-0000', island: 0, generation: 1, mutator: 'llm', inArchive: true, touchedDead: 1, evaluation: evaluation({ id: 'c-0001', fitness: 1.6, infidelity: 0.02, gates: 10, depth: 12, gradient: true }) }),
    candidate({ id: 'c-0002', parent: 'c-0000', island: 1, generation: 1, mutator: 'ast', inArchive: true, evaluation: evaluation({ id: 'c-0002', fitness: 1.3, infidelity: 0.03, gates: 11, depth: 13 }) }),
    candidate({ id: 'c-0003', parent: 'c-0001', island: 0, generation: 2, mutator: 'llm', inArchive: true, touchedDead: 2, evaluation: evaluation({ id: 'c-0003', fitness: 2.4, infidelity: 0.008, gates: 8, depth: 9 }) }),
    candidate({ id: 'c-0004', parent: 'c-0001', island: 0, generation: 2, mutator: 'llm', evaluation: evaluation({ id: 'c-0004', status: 'rejected', fitness: null, rejection }) }),
    candidate({ id: 'c-0005', parent: 'c-0002', island: 1, generation: 2, mutator: 'ast', evaluation: evaluation({ id: 'c-0005', status: 'failed', fitness: null, failure: { stage: 'sandbox', code: 'entry_raised', message: 'ValueError: boom' } }) }),
    candidate({ id: 'c-0006', parent: 'c-0002', island: 1, generation: 2, mutator: 'llm', outcome: 'screened_out', evaluation: null, screen: evaluation({ id: 'c-0006', fitness: 0.6, infidelity: 0.09, gates: 14, stage: 'screen' }) }),
    candidate({ id: 'c-0007', parent: 'c-0003', island: 0, generation: 3, mutator: 'ast', outcome: 'duplicate', evaluation: null, duplicateOf: 'c-0003' }),
    candidate({ id: 'c-0008', parent: 'c-0003', island: 1, generation: 3, mutator: 'llm', outcome: 'invalid_proposal', evaluation: null, proposalError: 'search text matched 2 times' }),
    candidate({ id: 'c-0009', parent: 'c-0003', island: 0, generation: 3, mutator: 'llm', inArchive: true, touchedDead: 0, evaluation: evaluation({ id: 'c-0009', fitness: 2.9, infidelity: 0.005, gates: 6, depth: 8, gradient: true }) }),
    candidate({ id: 'c-0010', parent: 'c-0002', island: 1, generation: 3, mutator: 'ast', evaluation: evaluation({ id: 'c-0010', status: 'rejected', fitness: null, rejection: { guardrail: 'qubit_count', message: 'Expected 5 qubits, got 6' } }) }),
  ];
}

export function fixtureRun(overrides: Partial<RunRecord> = {}): RunRecord {
  const spec = fixtureSpec();
  let archive = createArchive(
    [axisFromDescriptor(FIXTURE_EVALUATOR.descriptors[0], 4), axisFromDescriptor(FIXTURE_EVALUATOR.descriptors[1], 4)],
    FIXTURE_EVALUATOR.objectives,
    2,
  );
  for (const c of fixtureCandidates()) {
    if (!c.in_archive || !c.evaluation) continue;
    const elite = eliteFromEvaluation(archive, { candidateId: c.id, island: c.island, programHash: c.program_sha256 }, c.evaluation);
    if (elite) archive = insertElite(archive, elite).archive;
  }
  return {
    schema: 1,
    run_id: FIXTURE_RUN_ID,
    definition_file: FIXTURE_DEFINITION_FILE,
    spec,
    evaluator: { kind: 'state_synthesis', version: '1.2.0', fingerprint: FINGERPRINT },
    status: 'completed',
    stop_reason: 'generations',
    message: null,
    started_at: '2026-10-18T14:15:30.000Z',
    updated_at: '2026-10-18T14:41:02.000Z',
    finished_at: '2026-10-18T14:41:02.000Z',
    generation: 3,
    next_candidate_index: 11,
    rng: [1, 2, 3, 4],
    archive,
    usage: {
      evaluations: 9, llm_calls: 6, wall_ms: 1_532_000,
      input_tokens: 10_800, output_tokens: 1_440, cache_read_tokens: 9_000, cache_write_tokens: 0,
      proposals: { llm: 6, ast: 3, duplicate: 1, invalid: 1 },
    },
    champion_id: 'c-0009',
    seed_fitness: 1.0,
    best_fitness_history: [1.0, 1.6, 2.4, 2.9],
    stale_generations: 0,
    pending_batch: null,
    notices: [],
    confirmation: null,
    ...overrides,
  };
}

export function fixtureConfirmation(): NonNullable<RunRecord['confirmation']> {
  return {
    champion_id: 'c-0009',
    seeds: [101, 102, 103],
    n_scored: 3,
    fitness_mean: 2.7,
    fitness_ci95: [2.5, 2.9],
    fitness_drop: 0.2,
    objectives: [
      { key: 'infidelity', label: 'Infidelity', direction: 'minimize', mean: 0.0062, ci95: [0.0041, 0.0083], n: 3 },
      { key: 'two_qubit_gates', label: 'Two-qubit gates', direction: 'minimize', mean: 6, ci95: null, n: 3 },
    ],
    evaluations: [],
    created_at: '2026-10-18T14:41:02.000Z',
  };
}

export function fixtureView(runPatch: Partial<RunRecord> = {}): RunView {
  return createRunView(fixtureRun(runPatch), fixtureCandidates());
}
