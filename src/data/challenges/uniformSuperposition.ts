import type { QuantumChallenge } from '../../types/challenge';

export const uniformSuperposition: QuantumChallenge = {
  id: 'uniform-superposition',
  title: 'Uniform Superposition',
  difficulty: 'easy',
  category: 'state-preparation',
  description: `## Uniform Superposition

A **uniform superposition** places every computational basis state at equal amplitude.
For an \`n\`-qubit register this means each of the \`2^n\` basis states has probability
\`1 / 2^n\`.

### Why It Matters

Uniform superposition is the starting point for nearly every quantum algorithm:

- **Grover's search** begins by querying all inputs simultaneously
- **QAOA** initialises the mixer ground state with equal superposition
- **Quantum Fourier Transform** outputs are uniform when the input is a basis state

### Mathematical Form

For \`n\` qubits:

\`|\\u03C8\\u27E9 = (1 / \\u221A(2^n)) \\u2211_{x=0}^{2^n - 1} |x\\u27E9\`

### Your Task

Given \`n_qubits\`, prepare the uniform superposition state so that measuring the
register yields every bit-string with equal probability.

### Example

For \`n_qubits = 2\` the state is:

\`|\\u03C8\\u27E9 = (|00\\u27E9 + |01\\u27E9 + |10\\u27E9 + |11\\u27E9) / 2\`

and each outcome appears with probability **0.25**.`,

  constraints: [
    'Use exactly n_qubits qubits',
    'Every basis state must have equal probability 1/2^n within tolerance',
    'Only single-qubit gates are needed',
  ],

  examples: [
    {
      input: 'n_qubits = 2',
      output: '{ "00": 0.25, "01": 0.25, "10": 0.25, "11": 0.25 }',
      explanation:
        'Four basis states, each with probability 1/4.',
    },
    {
      input: 'n_qubits = 3',
      output: '{ "000": 0.125, "001": 0.125, ..., "111": 0.125 }',
      explanation:
        'Eight basis states, each with probability 1/8.',
    },
  ],

  testCases: [
    {
      id: 'sup-2',
      label: '2 qubits',
      description: 'n_qubits=2: equal superposition over 4 basis states',
      params: { n_qubits: 2 },
      validation: {
        type: 'probability_match',
        expected: { '00': 0.25, '01': 0.25, '10': 0.25, '11': 0.25 },
        tolerance: 0.06,
      },
      hidden: false,
      weight: 0.35,
    },
    {
      id: 'sup-3',
      label: '3 qubits',
      description: 'n_qubits=3: equal superposition over 8 basis states',
      params: { n_qubits: 3 },
      validation: {
        type: 'probability_match',
        expected: {
          '000': 0.125,
          '001': 0.125,
          '010': 0.125,
          '011': 0.125,
          '100': 0.125,
          '101': 0.125,
          '110': 0.125,
          '111': 0.125,
        },
        tolerance: 0.06,
      },
      hidden: false,
      weight: 0.35,
    },
    {
      id: 'sup-4',
      label: '4 qubits (hidden)',
      description: 'n_qubits=4: equal superposition over 16 basis states',
      params: { n_qubits: 4 },
      validation: {
        type: 'probability_match',
        expected: {
          '0000': 0.0625,
          '0001': 0.0625,
          '0010': 0.0625,
          '0011': 0.0625,
          '0100': 0.0625,
          '0101': 0.0625,
          '0110': 0.0625,
          '0111': 0.0625,
          '1000': 0.0625,
          '1001': 0.0625,
          '1010': 0.0625,
          '1011': 0.0625,
          '1100': 0.0625,
          '1101': 0.0625,
          '1110': 0.0625,
          '1111': 0.0625,
        },
        tolerance: 0.04,
      },
      hidden: true,
      weight: 0.3,
    },
  ],

  starterCode: {
    qiskit: `from qiskit import QuantumCircuit

# n_qubits is provided (2, 3, or 4)

qc = QuantumCircuit(n_qubits, n_qubits)

# TODO: Put all qubits into equal superposition
# Each basis state should have probability 1/2^n

qc.measure_all()
`,
    cirq: `import cirq

# n_qubits is provided (2, 3, or 4)

qubits = cirq.LineQubit.range(n_qubits)

circuit = cirq.Circuit()

# TODO: Put all qubits into equal superposition
# Each basis state should have probability 1/2^n

circuit.append(cirq.measure(*qubits, key='result'))
`,
    'cuda-q': `import cudaq

# n_qubits is provided (2, 3, or 4)

@cudaq.kernel
def uniform(n: int):
    qubits = cudaq.qvector(n)

    # TODO: Put all qubits into equal superposition
    # Each basis state should have probability 1/2^n

    mz(qubits)
`,
  },

  hints: [
    'The Hadamard gate puts a single qubit into equal superposition of |0> and |1>',
    'Use a loop: for i in range(n_qubits): qc.h(i)',
  ],

  tags: ['superposition', 'hadamard'],
  estimatedMinutes: 5,
  totalSubmissions: 2103,
  acceptanceRate: 0.91,
};
