/**
 * Starter templates for the Discovery Engine wizard (PRD 14 §7.4, addendum
 * §B): four complete seed programs plus their `*.discovery.yaml`. Seeds are
 * deliberately simple and honest (noiseless Stim with DETECTORs and an
 * OBSERVABLE_INCLUDE for QEC, elementary gates only for the circuit tasks,
 * independent parameters for the frontier ansatz) so they pass the real
 * evaluator guardrails and leave room to improve.
 */

import { stringify } from 'yaml';
import {
  discoverySpecSchema,
  type DiscoveryEvaluatorKind,
  type DiscoverySpec,
  type ModelTier,
  type MutatorKind,
  type RedQueenConfig,
} from '../../types/discovery';
import { DEFAULT_RED_QUEEN } from './redQueen';

export type DiscoveryTemplateId =
  | 'qec-repetition-schedule'
  | 'w-state-synthesis'
  | 'tfim-ansatz'
  | 'trainability-frontier';

export interface DiscoveryTemplate {
  id: DiscoveryTemplateId;
  title: string;
  summary: string;
  evaluatorKind: DiscoveryEvaluatorKind;
  description: string;
  evaluatorConfig: Record<string, unknown>;
  archive: { descriptors: [string, string]; bins: [number, number] };
  seedProgram: string;
}

const QEC_SEED = `"""Seed program: bit-flip repetition-code memory experiment in Stim.

Qubits: data on even indices 0, 2, ..., ancillas on odd indices. Each round
measures every neighbouring data-pair parity with two CX layers, then resets
the ancillas (MR). The circuit is noiseless; the evaluator applies the noise
model itself. The Discovery Engine evolves only the CX schedule between the
EVOLVE markers.
"""
import stim


# EVOLVE-BLOCK-START
def cx_layers(distance):
    """CX layers for one syndrome round: lists of (control, target) pairs.

    Every pair in a layer must act on distinct qubits.
    """
    ancillas = range(1, 2 * distance - 1, 2)
    left = [(a - 1, a) for a in ancillas]
    right = [(a + 1, a) for a in ancillas]
    return [left, right]
# EVOLVE-BLOCK-END


def build(distance, rounds):
    data = [2 * i for i in range(distance)]
    ancillas = [2 * i + 1 for i in range(distance - 1)]
    m = len(ancillas)
    circuit = stim.Circuit()
    circuit.append("R", data + ancillas)
    circuit.append("TICK")
    for round_index in range(rounds):
        for layer in cx_layers(distance):
            circuit.append("CX", [qubit for pair in layer for qubit in pair])
            circuit.append("TICK")
        circuit.append("MR", ancillas)
        for i in range(m):
            records = [stim.target_rec(-m + i)]
            if round_index > 0:
                records.append(stim.target_rec(-2 * m + i))
            circuit.append("DETECTOR", records)
        circuit.append("TICK")
    circuit.append("M", data)
    for i in range(m):
        circuit.append(
            "DETECTOR",
            [
                stim.target_rec(-distance - m + i),
                stim.target_rec(-distance + i),
                stim.target_rec(-distance + i + 1),
            ],
        )
    circuit.append("OBSERVABLE_INCLUDE", [stim.target_rec(-distance)], 0)
    return circuit
`;

const W_STATE_SEED = `"""Seed program: prepare an n-qubit W state from elementary gates.

The Discovery Engine evolves only the code between the EVOLVE markers. The
trusted evaluator computes the fidelity itself and counts two-qubit gates;
this program only builds the circuit.

Seed cost: each cascade step is a controlled-RY (RY, CX, RY, CX) plus a CX,
so 3(n-1) two-qubit gates in total.
"""
import numpy as np
from qiskit import QuantumCircuit


def build(n_qubits: int) -> QuantumCircuit:
    qc = QuantumCircuit(n_qubits)
    # EVOLVE-BLOCK-START
    # Put the excitation on qubit 0, then share it down the chain: a
    # controlled-RY "beam splitter" followed by a CX that clears the control.
    qc.x(0)
    for k in range(n_qubits - 1):
        remaining = n_qubits - k
        angle = 2 * np.arccos(np.sqrt(1 / remaining))
        qc.ry(angle / 2, k + 1)
        qc.cx(k, k + 1)
        qc.ry(-angle / 2, k + 1)
        qc.cx(k, k + 1)
        qc.cx(k + 1, k)
    # EVOLVE-BLOCK-END
    return qc
`;

const TFIM_SEED = `"""Seed program: hardware-efficient RY/CZ ansatz for the transverse-field Ising model.

The evaluator trains the free parameters itself and compares against the
exact ground energy. The Discovery Engine evolves only the code between the
EVOLVE markers; fewer parameters at the same accuracy scores better.
"""
from qiskit import QuantumCircuit
from qiskit.circuit import ParameterVector


def build(n_qubits: int) -> QuantumCircuit:
    qc = QuantumCircuit(n_qubits)
    # EVOLVE-BLOCK-START
    layers = 2
    theta = ParameterVector("theta", n_qubits * (layers + 1))
    k = 0
    for _ in range(layers):
        for q in range(n_qubits):
            qc.ry(theta[k], q)
            k += 1
        for q in range(n_qubits - 1):
            qc.cz(q, q + 1)
    for q in range(n_qubits):
        qc.ry(theta[k], q)
        k += 1
    # EVOLVE-BLOCK-END
    return qc
`;

const FRONTIER_SEED = `"""Seed program: RY/RZ + CZ-brick ansatz on an open chain.

Every rotation has its own independent parameter and the only fixed gate is
CZ (Clifford), so the trusted Pauli-propagation estimator applies at every
size. The Discovery Engine searches for ansatzes that stay trainable while
resisting that estimator. Hardness here means resistance to this estimator
under this budget, not a proof of classical hardness.
"""
from qiskit import QuantumCircuit
from qiskit.circuit import ParameterVector


def build(n_qubits: int, n_layers: int) -> QuantumCircuit:
    qc = QuantumCircuit(n_qubits)
    # EVOLVE-BLOCK-START
    theta = ParameterVector("theta", 2 * n_qubits * n_layers)
    k = 0
    for _ in range(n_layers):
        for q in range(n_qubits):
            qc.ry(theta[k], q)
            k += 1
            qc.rz(theta[k], q)
            k += 1
        for start in (0, 1):
            for q in range(start, n_qubits - 1, 2):
                qc.cz(q, q + 1)
    # EVOLVE-BLOCK-END
    return qc
`;

export const DISCOVERY_TEMPLATES: readonly DiscoveryTemplate[] = [
  {
    id: 'qec-repetition-schedule',
    title: 'QEC memory schedule',
    summary: 'Evolve the CX schedule of a repetition-code memory under si1000 noise.',
    evaluatorKind: 'qec_memory',
    description: 'Find a repetition-code CX schedule with a lower logical error rate per round at the same qubit count.',
    evaluatorConfig: { distances: [3, 5], rounds: 'd', noise: { model: 'si1000', p: 0.001 } },
    archive: { descriptors: ['qubits', 'two_qubit_gates_per_round'], bins: [8, 8] },
    seedProgram: QEC_SEED,
  },
  {
    id: 'w-state-synthesis',
    title: 'W-state synthesis',
    summary: 'Find a 5-qubit W-state preparation with fewer two-qubit gates.',
    evaluatorKind: 'state_synthesis',
    description: 'Find a W-state preparation with fewer two-qubit gates.',
    evaluatorConfig: { target: { kind: 'w', n_qubits: 5 }, fidelity_threshold: 0.999, cost: 'two_qubit_gates' },
    archive: { descriptors: ['two_qubit_gates', 'depth'], bins: [8, 8] },
    seedProgram: W_STATE_SEED,
  },
  {
    id: 'tfim-ansatz',
    title: 'TFIM ground-state ansatz',
    summary: 'Evolve an RY/CZ ansatz for the 6-qubit transverse-field Ising model at h = 1.',
    evaluatorKind: 'vqe_ground_state',
    description: 'Find an ansatz that reaches the TFIM ground energy with fewer parameters.',
    evaluatorConfig: { hamiltonian: { kind: 'tfim', n_qubits: 6, h: 1.0 } },
    archive: { descriptors: ['parameters', 'two_qubit_gates'], bins: [8, 8] },
    seedProgram: TFIM_SEED,
  },
  {
    id: 'trainability-frontier',
    title: 'Trainability frontier',
    summary: 'Search for ansatzes that are trainable yet resist exact Pauli-propagation estimation.',
    evaluatorKind: 'trainability_frontier',
    description:
      'Search for trainable ansatzes (low barren-plateau exponent) whose expectation values resist the Pauli-propagation estimator. A high score is a lead to investigate, not a counterexample to the simulability conjecture.',
    evaluatorConfig: { qubits: [8, 16, 32, 64], n_layers: 4 },
    archive: { descriptors: ['log2_dla_dimension', 'two_qubit_gates_per_layer'], bins: [8, 8] },
    seedProgram: FRONTIER_SEED,
  },
];

export function getTemplate(id: string): DiscoveryTemplate | undefined {
  return DISCOVERY_TEMPLATES.find((t) => t.id === id);
}

export interface ScaffoldBudgets {
  max_evaluations?: number;
  max_llm_calls?: number;
  max_wall_minutes?: number;
  max_concurrent_evaluations?: number;
}

export interface ScaffoldMutator {
  kind?: MutatorKind;
  /** Written only for `red_queen`. */
  red_queen?: Partial<RedQueenConfig>;
  llm_share?: number;
  breadth?: ModelTier;
  depth?: ModelTier;
  depth_share?: number;
  depth_thinking?: boolean;
  batch_mode?: boolean;
}

export interface ScaffoldFile {
  /** Project-relative path. */
  path: string;
  content: string;
}

export type ScaffoldResult =
  | { ok: true; spec: DiscoverySpec; definitionPath: string; programPath: string; files: ScaffoldFile[] }
  | { ok: false; error: string };

export function slugifyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Pure: returns the files to write (definition YAML + seed program) for a
 * new discovery. The YAML records the chosen budgets and mutator explicitly
 * and leaves everything else at schema defaults.
 */
export function scaffoldDiscovery(
  templateId: string,
  name: string,
  budgets: ScaffoldBudgets = {},
  mutator: ScaffoldMutator = {},
): ScaffoldResult {
  const template = getTemplate(templateId);
  if (!template) return { ok: false, error: `Unknown discovery template "${templateId}".` };
  const slug = slugifyName(name);
  if (!slug) return { ok: false, error: 'Give the discovery a name using letters or numbers.' };

  const programPath = `discovery/${slug}.py`;
  const definitionPath = `experiments/${slug}.discovery.yaml`;
  const doc = {
    schema: 1,
    type: 'discovery',
    name: slug,
    description: template.description,
    program: programPath,
    entry: 'build',
    evaluator: { kind: template.evaluatorKind, config: template.evaluatorConfig },
    search: { archive: template.archive },
    mutator: {
      kind: mutator.kind ?? 'hybrid',
      llm_share: mutator.llm_share ?? 0.75,
      models: {
        breadth: mutator.breadth ?? 'haiku',
        depth: mutator.depth ?? 'opus',
        depth_share: mutator.depth_share ?? 0.2,
        depth_thinking: mutator.depth_thinking ?? true,
      },
      batch_mode: mutator.batch_mode ?? false,
    },
    ...(mutator.kind === 'red_queen' ? { red_queen: { ...DEFAULT_RED_QUEEN, ...mutator.red_queen } } : {}),
    budget: {
      max_evaluations: budgets.max_evaluations ?? 200,
      max_llm_calls: budgets.max_llm_calls ?? 160,
      max_wall_minutes: budgets.max_wall_minutes ?? 90,
      max_concurrent_evaluations: budgets.max_concurrent_evaluations ?? 3,
    },
    confirm: { seeds: 3 },
    seed: 7,
  };
  const parsed = discoverySpecSchema.safeParse(doc);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, error: `Invalid discovery settings: ${issues}` };
  }
  return {
    ok: true,
    spec: parsed.data,
    definitionPath,
    programPath,
    files: [
      { path: definitionPath, content: stringify(doc) },
      { path: programPath, content: template.seedProgram },
    ],
  };
}
