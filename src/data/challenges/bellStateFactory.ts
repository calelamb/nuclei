import type { QuantumChallenge } from '../../types/challenge';

export const bellStateFactory: QuantumChallenge = {
  id: 'bell-state-factory',
  title: 'Bell State Factory',
  difficulty: 'easy',
  category: 'state-preparation',
  description: `## Bell State Factory

The four **Bell states** are the simplest examples of maximally entangled two-qubit states.
They form a complete orthonormal basis for the two-qubit Hilbert space and are the
building blocks of quantum teleportation, superdense coding, and entanglement-based
key distribution.

### The Four Bell States

| Index | Name | State |
|-------|------|-------|
| 0 | \`|\\u03A6\\u207A\\u27E9\` | \`(|00\\u27E9 + |11\\u27E9) / \\u221A2\` |
| 1 | \`|\\u03A6\\u207B\\u27E9\` | \`(|00\\u27E9 - |11\\u27E9) / \\u221A2\` |
| 2 | \`|\\u03A8\\u207A\\u27E9\` | \`(|01\\u27E9 + |10\\u27E9) / \\u221A2\` |
| 3 | \`|\\u03A8\\u207B\\u27E9\` | \`(|01\\u27E9 - |10\\u27E9) / \\u221A2\` |

### Your Task

Given a \`bell_index\` (0 through 3), construct the corresponding Bell state on a
two-qubit circuit. After measurement, the probability distribution must match the
expected outcome for that state.

> **Note:** \`|\\u03A6\\u207A\\u27E9\` and \`|\\u03A6\\u207B\\u27E9\` produce the same measurement
> probabilities (\`{00: 0.5, 11: 0.5}\`) but differ in relative phase. The same is
> true for the \`|\\u03A8\\u27E9\` pair. This challenge validates measurement distributions only.`,

  constraints: [
    'Use exactly 2 qubits and 2 classical bits',
    'The circuit must produce the correct Bell state for any bell_index in {0, 1, 2, 3}',
    'You may only use H, X, Z, and CNOT gates',
  ],

  examples: [
    {
      input: 'bell_index = 0',
      output: '{ "00": 0.5, "11": 0.5 }',
      explanation:
        '|Phi+> = (|00> + |11>) / sqrt(2). Measuring gives |00> or |11> with equal probability.',
    },
    {
      input: 'bell_index = 2',
      output: '{ "01": 0.5, "10": 0.5 }',
      explanation:
        '|Psi+> = (|01> + |10>) / sqrt(2). Measuring gives |01> or |10> with equal probability.',
    },
  ],

  testCases: [
    {
      id: 'bell-0',
      label: 'Phi+',
      description: 'bell_index=0: produce |Phi+> = (|00> + |11>) / sqrt(2)',
      params: { bell_index: 0 },
      validation: {
        type: 'probability_match',
        expected: { '00': 0.5, '11': 0.5 },
        tolerance: 0.08,
      },
      hidden: false,
      weight: 0.25,
    },
    {
      id: 'bell-1',
      label: 'Phi-',
      description: 'bell_index=1: produce |Phi-> = (|00> - |11>) / sqrt(2)',
      params: { bell_index: 1 },
      validation: {
        type: 'probability_match',
        expected: { '00': 0.5, '11': 0.5 },
        tolerance: 0.08,
      },
      hidden: false,
      weight: 0.25,
    },
    {
      id: 'bell-2',
      label: 'Psi+',
      description: 'bell_index=2: produce |Psi+> = (|01> + |10>) / sqrt(2)',
      params: { bell_index: 2 },
      validation: {
        type: 'probability_match',
        expected: { '01': 0.5, '10': 0.5 },
        tolerance: 0.08,
      },
      hidden: false,
      weight: 0.25,
    },
    {
      id: 'bell-3',
      label: 'Psi-',
      description: 'bell_index=3: produce |Psi-> = (|01> - |10>) / sqrt(2)',
      params: { bell_index: 3 },
      validation: {
        type: 'probability_match',
        expected: { '01': 0.5, '10': 0.5 },
        tolerance: 0.08,
      },
      hidden: false,
      weight: 0.25,
    },
  ],

  starterCode: {
    qiskit: `from qiskit import QuantumCircuit

# bell_index is provided: 0=Phi+, 1=Phi-, 2=Psi+, 3=Psi-

qc = QuantumCircuit(2, 2)

# TODO: Build the Bell state based on bell_index
# Phi+ = (|00> + |11>) / sqrt(2)
# Phi- = (|00> - |11>) / sqrt(2)
# Psi+ = (|01> + |10>) / sqrt(2)
# Psi- = (|01> - |10>) / sqrt(2)

qc.measure([0, 1], [0, 1])
`,
    cirq: `import cirq

# bell_index is provided: 0=Phi+, 1=Phi-, 2=Psi+, 3=Psi-

q0, q1 = cirq.LineQubit.range(2)

circuit = cirq.Circuit()

# TODO: Build the Bell state based on bell_index
# Phi+ = (|00> + |11>) / sqrt(2)
# Phi- = (|00> - |11>) / sqrt(2)
# Psi+ = (|01> + |10>) / sqrt(2)
# Psi- = (|01> - |10>) / sqrt(2)

circuit.append(cirq.measure(q0, q1, key='result'))
`,
    'cuda-q': `import cudaq

# bell_index is provided: 0=Phi+, 1=Phi-, 2=Psi+, 3=Psi-

@cudaq.kernel
def bell_state(bell_index: int):
    qubits = cudaq.qvector(2)

    # TODO: Build the Bell state based on bell_index
    # Phi+ = (|00> + |11>) / sqrt(2)
    # Phi- = (|00> - |11>) / sqrt(2)
    # Psi+ = (|01> + |10>) / sqrt(2)
    # Psi- = (|01> - |10>) / sqrt(2)

    mz(qubits)
`,
  },

  hints: [
    'All Bell states start with H on qubit 0 followed by CNOT(0, 1)',
    'For Phi-, add a Z gate to qubit 0 after making Phi+',
    'For Psi states, add an X gate to qubit 1 before or after',
  ],

  tags: ['bell-state', 'entanglement', 'hadamard', 'cnot'],
  estimatedMinutes: 10,
  totalSubmissions: 1247,
  acceptanceRate: 0.82,
};
