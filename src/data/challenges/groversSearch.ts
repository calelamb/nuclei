import type { QuantumChallenge } from '../../types/challenge';

export const groversSearch: QuantumChallenge = {
  id: 'grovers-search',
  title: "Grover's Search (2-qubit)",
  difficulty: 'medium',
  category: 'algorithms',
  description: `## Grover's Search (2-qubit)

**Grover's algorithm** finds a marked item in an unstructured database of
\`N\` elements using only \`O(\u221AN)\` queries, compared to \`O(N)\` classically.
For a 2-qubit system (\`N = 4\`), a single iteration is both necessary and
sufficient to find the target with certainty.

### Algorithm Structure

The algorithm has three stages:

1. **Initialization** -- put all qubits into uniform superposition with
   Hadamard gates:
   \`\`\`
   |\u03C8\u2080\u27E9 = H\u2297\u00B2 |00\u27E9 = (|00\u27E9 + |01\u27E9 + |10\u27E9 + |11\u27E9) / 2
   \`\`\`

2. **Oracle** -- flip the phase of the marked state \`|w\u27E9\`:
   \`\`\`
   O|x\u27E9 = -|x\u27E9  if x = w
   O|x\u27E9 =  |x\u27E9  otherwise
   \`\`\`
   For a 2-qubit oracle marking state \`|ab\u27E9\`:
   - Flip qubits where the target bit is \`0\` (using X gates)
   - Apply CZ to mark the all-\`|1\u27E9\` state
   - Undo the X gates

3. **Diffuser** (amplitude amplification) -- reflect about the mean
   amplitude. For 2 qubits:
   \`\`\`
   H \u2192 X \u2192 CZ \u2192 X \u2192 H   (on both qubits)
   \`\`\`

### Why One Iteration Suffices

For \`N = 4\`, the initial amplitude of each state is \`1/2\`. After one
oracle + diffuser cycle the marked state's amplitude reaches \`1\`
(probability \`\u2248 1.0\`), so a single Grover iteration is optimal.

### Oracle Construction Examples

| Target | Oracle Circuit |
|--------|---------------|
| \`\|11\u27E9\` | CZ(0, 1) |
| \`\|01\u27E9\` | X(0), CZ(0, 1), X(0) |
| \`\|10\u27E9\` | X(1), CZ(0, 1), X(1) |
| \`\|00\u27E9\` | X(0), X(1), CZ(0, 1), X(1), X(0) |

### Your Task

Given a \`marked_state\` string (\`"00"\`, \`"01"\`, \`"10"\`, or \`"11"\`),
implement the full Grover iteration so that measuring the circuit
returns the marked state with probability > 90%.`,

  constraints: [
    'Use exactly 2 qubits and 2 classical bits',
    'Apply exactly one Grover iteration (oracle + diffuser)',
    'The marked state must be measured with probability > 0.90',
    'You may only use H, X, Z, and CZ gates',
  ],

  examples: [
    {
      input: 'marked_state = "11"',
      output: '{ "11": 1.0 }',
      explanation:
        'The oracle is just CZ(0,1). After the diffuser, |11> has amplitude 1.',
    },
    {
      input: 'marked_state = "01"',
      output: '{ "01": 1.0 }',
      explanation:
        'X on qubit 0 before and after CZ converts the oracle to mark |01>.',
    },
  ],

  testCases: [
    {
      id: 'grover-00',
      label: 'Search for |00\u27E9',
      description: 'marked_state="00": find |00\u27E9 in a 4-element database',
      params: { marked_state: '00' },
      validation: {
        type: 'probability_match',
        expected: { '00': 1.0 },
        tolerance: 0.15,
      },
      hidden: false,
      weight: 0.25,
    },
    {
      id: 'grover-01',
      label: 'Search for |01\u27E9',
      description: 'marked_state="01": find |01\u27E9 in a 4-element database',
      params: { marked_state: '01' },
      validation: {
        type: 'probability_match',
        expected: { '01': 1.0 },
        tolerance: 0.15,
      },
      hidden: false,
      weight: 0.25,
    },
    {
      id: 'grover-10',
      label: 'Search for |10\u27E9 (hidden)',
      description: 'marked_state="10": find |10\u27E9 in a 4-element database',
      params: { marked_state: '10' },
      validation: {
        type: 'probability_match',
        expected: { '10': 1.0 },
        tolerance: 0.15,
      },
      hidden: true,
      weight: 0.25,
    },
    {
      id: 'grover-11',
      label: 'Search for |11\u27E9 (hidden)',
      description: 'marked_state="11": find |11\u27E9 in a 4-element database',
      params: { marked_state: '11' },
      validation: {
        type: 'probability_match',
        expected: { '11': 1.0 },
        tolerance: 0.15,
      },
      hidden: true,
      weight: 0.25,
    },
  ],

  starterCode: {
    qiskit: `from qiskit import QuantumCircuit

# marked_state is provided (e.g., "00", "01", "10", "11")

qc = QuantumCircuit(2, 2)

# Step 1: Initialize in uniform superposition
qc.h(0)
qc.h(1)

# Step 2: TODO - Oracle (mark the target state)
# Flip the phase of |marked_state>
# For "11": apply CZ(0, 1)
# For other states: flip qubits with X first, then CZ, then X again

# Step 3: TODO - Diffuser (amplitude amplification)
# H on both -> X on both -> CZ -> X on both -> H on both

qc.measure([0, 1], [0, 1])
`,
    cirq: `import cirq

# marked_state is provided (e.g., "00", "01", "10", "11")

q0, q1 = cirq.LineQubit.range(2)

circuit = cirq.Circuit()

# Step 1: Initialize in uniform superposition
circuit.append([cirq.H(q0), cirq.H(q1)])

# Step 2: TODO - Oracle (mark the target state)
# Flip the phase of |marked_state>
# For "11": apply CZ(q0, q1)
# For other states: wrap CZ with X gates on the appropriate qubits

# Step 3: TODO - Diffuser (amplitude amplification)
# H on both -> X on both -> CZ -> X on both -> H on both

circuit.append(cirq.measure(q0, q1, key='result'))
`,
    'cuda-q': `import cudaq

# marked_state is provided (e.g., "00", "01", "10", "11")

@cudaq.kernel
def grover():
    qubits = cudaq.qvector(2)

    # Step 1: Initialize in uniform superposition
    h(qubits[0])
    h(qubits[1])

    # Step 2: TODO - Oracle (mark the target state)
    # Flip the phase of |marked_state>
    # For "11": cz(qubits[0], qubits[1])
    # For other states: wrap with x gates

    # Step 3: TODO - Diffuser (amplitude amplification)
    # h -> x -> cz -> x -> h on both qubits

    mz(qubits)
`,
  },

  hints: [
    'The oracle flips the phase of exactly the marked state using X gates and CZ',
    "For marked_state '01': X on qubit 0, CZ, X on qubit 0",
    'The diffuser is: H \u2192 X \u2192 CZ \u2192 X \u2192 H on both qubits',
  ],

  tags: ['grovers', 'search', 'oracle', 'amplitude-amplification'],
  estimatedMinutes: 20,
  totalSubmissions: 789,
  acceptanceRate: 0.58,
};
