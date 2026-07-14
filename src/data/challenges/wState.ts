import type { QuantumChallenge } from '../../types/challenge';

export const wState: QuantumChallenge = {
  id: 'w-state',
  title: 'W State',
  difficulty: 'hard',
  category: 'state-preparation',
  description: `## W State

The **W state** is the other genuinely-multipartite three-qubit entangled state —
an equal superposition of every single-excitation basis state:

\`|W_n\\u27E9 = (|10\\u20260\\u27E9 + |01\\u20260\\u27E9 + \\u2026 + |0\\u20260 1\\u27E9) / \\u221A n\`

Unlike GHZ, a W state keeps its entanglement when any one qubit is lost — which
makes it valuable for robust quantum memory and leader-election protocols. It's
also much harder to build: the amplitudes are spread evenly across \`n\` basis
states, so you can't get there with a single Hadamard and a CNOT chain.

### Your Task

Given \`n_qubits\`, prepare \`|W_n\\u27E9\`. Exactly the \`n\` single-excitation
outcomes should appear, each with probability 1/n.

> **Graded by state fidelity.** The specific amplitude pattern (all equal, all in
> phase) can't be faked — a nearly-right histogram with the wrong amplitudes fails.

### Note

Building a W state takes controlled rotations, not just Hadamards. Efficiency is
reported for your circuit, but there's no fixed optimal par on this one — focus
on getting the exact state.`,

  constraints: [
    'Use exactly n_qubits qubits and n_qubits classical bits',
    'Only the n single-excitation outcomes may appear, each with probability 1/n',
    'A Hadamard-and-CNOT construction will NOT produce a W state',
  ],

  examples: [
    {
      input: 'n_qubits = 3',
      output: '{ "001": 0.333, "010": 0.333, "100": 0.333 }',
      explanation: '|W_3> = (|100> + |010> + |001>) / sqrt(3). Each single-excitation state at 1/3.',
    },
  ],

  testCases: [
    {
      id: 'w-3',
      label: '3 qubits',
      description: 'n_qubits=3: prepare |W_3>',
      params: { n_qubits: 3 },
      validation: { type: 'state_fidelity' },
      hidden: false,
      weight: 0.5,
    },
    {
      id: 'w-4',
      label: '4 qubits (hidden)',
      description: 'n_qubits=4: prepare |W_4>',
      params: { n_qubits: 4 },
      validation: { type: 'state_fidelity' },
      hidden: true,
      weight: 0.5,
    },
  ],

  starterCode: {
    qiskit: `from qiskit import QuantumCircuit
import numpy as np

# n_qubits is provided (3 or 4)

qc = QuantumCircuit(n_qubits, n_qubits)

# TODO: Prepare the W state — an equal superposition of the single-excitation
# basis states |10...0>, |01...0>, ..., |0...01>, each with amplitude 1/sqrt(n).
# Hint: seed one excitation, then "spread" it with controlled rotations.
# A controlled-RY of angle 2*arccos(sqrt(1/(n-i))) shares the excitation onward.

qc.measure(range(n_qubits), range(n_qubits))
`,
    cirq: `import cirq
import numpy as np

# n_qubits is provided (3 or 4)

qubits = cirq.LineQubit.range(n_qubits)

circuit = cirq.Circuit()

# TODO: Prepare the W state — equal superposition of single-excitation states.

circuit.append(cirq.measure(*qubits, key='result'))
`,
    'cuda-q': `import cudaq

# n_qubits is provided (3 or 4)

@cudaq.kernel
def w(n: int):
    qubits = cudaq.qvector(n)

    # TODO: Prepare the W state — equal superposition of single-excitation states.

    mz(qubits)
`,
  },

  hints: [
    'Start from |10...0> by applying X to qubit 0.',
    'Share the excitation forward: a controlled-RY of angle 2*arccos(sqrt(1/(n - i))) from qubit i to i+1, then a CNOT back to keep exactly one excitation.',
    'Check each single-excitation outcome ends up at probability 1/n.',
  ],

  tags: ['w-state', 'entanglement', 'multi-qubit', 'controlled-rotation'],
  estimatedMinutes: 25,
  totalSubmissions: 218,
  acceptanceRate: 0.51,
  // No efficiency par: unlike GHZ, the minimal two-qubit-gate count for a W
  // state isn't a clean, universally-agreed lower bound, so metrics stay
  // informational rather than claim a false optimum.
  referenceCode: `from qiskit import QuantumCircuit
import numpy as np

def reference(n_qubits):
    qc = QuantumCircuit(n_qubits, n_qubits)
    qc.x(0)
    for i in range(n_qubits - 1):
        theta = 2 * np.arccos(np.sqrt(1.0 / (n_qubits - i)))
        qc.cry(theta, i, i + 1)
        qc.cx(i + 1, i)
    qc.measure(range(n_qubits), range(n_qubits))
    return qc
`,
};
