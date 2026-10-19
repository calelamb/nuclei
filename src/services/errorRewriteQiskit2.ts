/**
 * Qiskit 2 migration hints (PRD 15 R-14).
 *
 * Nuclei supports Qiskit 1.2 through 2.x, but a program written against 1.x
 * fails on a 2.x install with an ImportError/AttributeError that says nothing
 * about the real cause. This table recognises the removed APIs and gives the
 * replacement deterministically, so the answer is right and available even with
 * no Dirac API key. Hints are for Research-mode code only.
 */

export interface Qiskit2Migration {
  id: string;
  /** Matches the traceback of the failure this API removal causes. */
  pattern: RegExp;
  explanation: string;
  fix: string;
}

export interface Qiskit2Hint {
  id: string;
  explanation: string;
  fix: string;
}

const V2_PRIMITIVES =
  'Use the V2 primitives, which take a list of (circuit, parameter_values) tuples:\n' +
  'from qiskit.primitives import StatevectorSampler, StatevectorEstimator\n' +
  'result = StatevectorSampler().run([qc]).result()\n' +
  'counts = result[0].data.meas.get_counts()   # register name is "meas" for measure_all()';

export const QISKIT2_MIGRATIONS: readonly Qiskit2Migration[] = [
  {
    id: 'backend-primitives-v1',
    pattern: /cannot import name '(BackendSampler|BackendEstimator)' from 'qiskit\.primitives'/,
    explanation:
      'Qiskit 2 removed the V1 BackendSampler and BackendEstimator; only the V2 primitives remain.',
    fix:
      'from qiskit.primitives import BackendSamplerV2, BackendEstimatorV2\n' +
      'sampler = BackendSamplerV2(backend=backend)   # run([(circuit, params)])',
  },
  {
    id: 'primitives-v1',
    pattern: /cannot import name '(Sampler|Estimator)' from 'qiskit\.primitives'/,
    explanation:
      'Qiskit 2 removed the V1 Sampler and Estimator from qiskit.primitives; the V2 classes replace them.',
    fix: V2_PRIMITIVES,
  },
  {
    id: 'c-if',
    pattern: /'[A-Za-z]*(?:Gate|InstructionSet|Instruction)' object has no attribute 'c_if'/,
    explanation:
      'Qiskit 2 removed Instruction.c_if(); classical control flow is written with if_test.',
    fix: 'with qc.if_test((creg, 1)):\n    qc.x(0)   # runs when the classical register equals 1',
  },
  {
    id: 'bind-parameters',
    pattern: /has no attribute 'bind_parameters'/,
    explanation: 'Qiskit 2 removed QuantumCircuit.bind_parameters(); assign_parameters replaces it.',
    fix: 'bound = qc.assign_parameters({theta: 0.5})',
  },
  {
    id: 'qasm',
    pattern: /'QuantumCircuit' object has no attribute 'qasm'/,
    explanation: 'Qiskit 2 removed QuantumCircuit.qasm(); export OpenQASM through the qasm2 or qasm3 module.',
    fix: 'from qiskit import qasm2\ntext = qasm2.dumps(qc)   # or qiskit.qasm3.dumps(qc)',
  },
  {
    id: 'execute',
    pattern: /cannot import name 'execute' from 'qiskit'/,
    explanation: 'Qiskit removed qiskit.execute(); transpile for the backend and call backend.run (or use a primitive).',
    fix:
      'from qiskit import transpile\n' +
      'job = backend.run(transpile(qc, backend), shots=1024)\n' +
      'counts = job.result().get_counts()',
  },
  {
    id: 'aer',
    pattern: /cannot import name 'Aer' from 'qiskit'/,
    explanation: 'Qiskit no longer re-exports Aer; it lives in the separate qiskit_aer package.',
    fix: 'from qiskit_aer import AerSimulator\nbackend = AerSimulator()',
  },
  {
    id: 'pulse',
    pattern: /No module named 'qiskit\.pulse'|cannot import name '[A-Za-z]+' from 'qiskit\.pulse'/,
    explanation:
      'Qiskit 2 removed the pulse module. Pulse-level programs need Qiskit 1.x (pip install "qiskit<2").',
    fix: 'Pulse support was removed in Qiskit 2; pin "qiskit<2" in a separate environment to run pulse code.',
  },
  {
    id: 'fake-backends-v1',
    pattern: /cannot import name '(Fake[A-Za-z0-9_]+)' from 'qiskit\.providers\.fake_provider'/,
    explanation:
      'Qiskit 2 removed the V1 fake backends from qiskit.providers.fake_provider; the V2 fakes ship with qiskit-ibm-runtime.',
    fix: 'from qiskit_ibm_runtime.fake_provider import FakeSherbrooke   # pip install qiskit-ibm-runtime',
  },
  {
    id: 'opflow',
    pattern: /No module named 'qiskit\.opflow'/,
    explanation: 'Qiskit removed qiskit.opflow; operators are built with qiskit.quantum_info.',
    fix: 'from qiskit.quantum_info import SparsePauliOp\nop = SparsePauliOp.from_list([("ZZ", 1.0), ("XI", 0.5)])',
  },
  {
    id: 'algorithms',
    pattern: /No module named 'qiskit\.algorithms'/,
    explanation: 'Qiskit moved qiskit.algorithms into its own package, qiskit_algorithms.',
    fix: 'pip install qiskit-algorithms\nfrom qiskit_algorithms import VQE',
  },
  {
    id: 'quantum-instance',
    pattern: /cannot import name 'QuantumInstance' from 'qiskit\.utils'/,
    explanation: 'Qiskit removed QuantumInstance; pass a primitive (Sampler or Estimator) to the algorithm instead.',
    fix: 'from qiskit.primitives import StatevectorSampler\nsampler = StatevectorSampler()',
  },
];

/** The migration for a traceback caused by an API Qiskit 2 removed, if any. */
export function qiskit2MigrationHint(traceback: string): Qiskit2Hint | null {
  if (!traceback) return null;
  for (const entry of QISKIT2_MIGRATIONS) {
    if (entry.pattern.test(traceback)) {
      return { id: entry.id, explanation: entry.explanation, fix: entry.fix };
    }
  }
  return null;
}
