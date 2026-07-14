import type { QuantumChallenge } from '../../types/challenge';

export const ghzState: QuantumChallenge = {
  id: 'ghz-state',
  title: 'GHZ State',
  difficulty: 'medium',
  category: 'state-preparation',
  description: `## GHZ State

The **Greenberger–Horne–Zeilinger** state is the \`n\`-qubit generalization of a Bell
state — every qubit maximally entangled with every other:

\`|GHZ_n\\u27E9 = (|0\\u2026 0\\u27E9 + |1\\u2026 1\\u27E9) / \\u221A2\`

Measuring any one qubit instantly determines all the others. GHZ states are the
workhorses of multi-party entanglement: quantum secret sharing, anonymous
broadcasting, and the sharpest tests of quantum non-locality all rely on them.

### Your Task

Given \`n_qubits\`, prepare \`|GHZ_n\\u27E9\`. Only two outcomes should ever appear —
all-zeros and all-ones — each with probability 1/2.

> **Graded by state fidelity.** A product state can reproduce a 50/50 histogram
> but never the genuine entanglement, so only the real GHZ state passes.

### Efficiency

Connecting \`n\` qubits into one entangled block needs at least \`n\\u22121\`
two-qubit gates — that's a provable lower bound. The \\u2605 rewards hitting it.`,

  constraints: [
    'Use exactly n_qubits qubits and n_qubits classical bits',
    'Only all-zeros and all-ones outcomes may appear, each with probability 1/2',
    'The optimal solution uses n_qubits - 1 entangling gates',
  ],

  examples: [
    {
      input: 'n_qubits = 3',
      output: '{ "000": 0.5, "111": 0.5 }',
      explanation: '|GHZ_3> = (|000> + |111>) / sqrt(2). One H and two CNOTs.',
    },
    {
      input: 'n_qubits = 4',
      output: '{ "0000": 0.5, "1111": 0.5 }',
      explanation: '|GHZ_4> = (|0000> + |1111>) / sqrt(2). One H and three CNOTs.',
    },
  ],

  testCases: [
    {
      id: 'ghz-3',
      label: '3 qubits',
      description: 'n_qubits=3: prepare |GHZ_3>',
      params: { n_qubits: 3 },
      validation: { type: 'state_fidelity' },
      hidden: false,
      weight: 0.3,
    },
    {
      id: 'ghz-4',
      label: '4 qubits',
      description: 'n_qubits=4: prepare |GHZ_4>',
      params: { n_qubits: 4 },
      validation: { type: 'state_fidelity' },
      hidden: false,
      weight: 0.3,
    },
    {
      id: 'ghz-5',
      label: '5 qubits (hidden)',
      description: 'n_qubits=5: prepare |GHZ_5>',
      params: { n_qubits: 5 },
      validation: { type: 'state_fidelity' },
      hidden: true,
      weight: 0.4,
    },
  ],

  starterCode: {
    qiskit: `from qiskit import QuantumCircuit

# n_qubits is provided (3, 4, or 5)

qc = QuantumCircuit(n_qubits, n_qubits)

# TODO: Prepare the GHZ state (|0...0> + |1...1>) / sqrt(2)
# Hint: one Hadamard, then a chain of CNOTs

qc.measure(range(n_qubits), range(n_qubits))
`,
    cirq: `import cirq

# n_qubits is provided (3, 4, or 5)

qubits = cirq.LineQubit.range(n_qubits)

circuit = cirq.Circuit()

# TODO: Prepare the GHZ state (|0...0> + |1...1>) / sqrt(2)

circuit.append(cirq.measure(*qubits, key='result'))
`,
    'cuda-q': `import cudaq

# n_qubits is provided (3, 4, or 5)

@cudaq.kernel
def ghz(n: int):
    qubits = cudaq.qvector(n)

    # TODO: Prepare the GHZ state (|0...0> + |1...1>) / sqrt(2)

    mz(qubits)
`,
  },

  hints: [
    'Put qubit 0 into superposition with H, then entangle the rest into it.',
    'A CNOT chain works: for i in range(1, n): qc.cx(i - 1, i)',
    'Exactly n_qubits - 1 CNOTs is optimal — no more are needed.',
  ],

  tags: ['ghz', 'entanglement', 'multi-qubit', 'cnot'],
  estimatedMinutes: 12,
  totalSubmissions: 634,
  acceptanceRate: 0.74,
  // n qubits need >= n-1 two-qubit gates to form one connected entangled block
  // (a provable lower bound). Worst graded case is n=5 -> 4. Metrics aggregate
  // to the worst case, so a clean (n-1)-CNOT solution hits par on every size.
  efficiency: { twoQubitGates: 4 },
  referenceCode: `from qiskit import QuantumCircuit

def reference(n_qubits):
    qc = QuantumCircuit(n_qubits, n_qubits)
    qc.h(0)
    for i in range(1, n_qubits):
        qc.cx(i - 1, i)
    qc.measure(range(n_qubits), range(n_qubits))
    return qc
`,
};
