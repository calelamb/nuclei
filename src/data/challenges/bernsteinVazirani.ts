import type { QuantumChallenge } from '../../types/challenge';

export const bernsteinVazirani: QuantumChallenge = {
  id: 'bernstein-vazirani',
  title: 'Bernstein-Vazirani Algorithm',
  difficulty: 'medium',
  category: 'algorithms',
  description: `## Bernstein-Vazirani Algorithm

The **Bernstein-Vazirani algorithm** demonstrates an exponential separation
between classical and quantum query complexity for a specific promise problem.

### The Problem

You are given a black-box function (oracle) that computes:

\`f(x) = s \\u00B7 x  mod 2\`

where \`s\` is a hidden bit-string and \`s \\u00B7 x\` denotes the bitwise inner product:

\`s \\u00B7 x = s\\u2080 x\\u2080 \\u2295 s\\u2081 x\\u2081 \\u2295 ... \\u2295 s\\u2099\\u208B\\u2081 x\\u2099\\u208B\\u2081\`

**Classically**, finding \`s\` requires \`n\` queries (one per bit).
**Quantumly**, a single query suffices.

### The Circuit

\`\`\`
|0\\u27E9 \\u2500 H \\u2500\\u2500\\u2500 Oracle \\u2500\\u2500\\u2500 H \\u2500 Measure
|0\\u27E9 \\u2500 H \\u2500\\u2500\\u2500   ...   \\u2500\\u2500\\u2500 H \\u2500 Measure
 ...          ...           ...
|1\\u27E9 \\u2500 H \\u2500\\u2500\\u2500 (ancilla) \\u2500
\`\`\`

1. Prepare the ancilla in the \`|\\u2212\\u27E9\` state: apply X then H to the last qubit
2. Apply H to all input qubits
3. Apply the oracle: for each position \`i\` where \`s[i] = 1\`, apply CNOT from qubit \`i\` to the ancilla
4. Apply H to all input qubits again
5. Measure the input register \u2014 the result is \`s\` directly

### Why It Works

The \`|\\u2212\\u27E9\` ancilla causes **phase kickback**: each CNOT that fires
flips the sign of the corresponding input qubit's \`|1\\u27E9\` component.
The final Hadamard layer converts these phase differences back into
bit values, revealing \`s\` in a single shot.

### Your Task

Given a \`hidden_string\`, implement the oracle and the surrounding
Bernstein-Vazirani circuit. The measurement outcome must equal the
hidden string with high probability.`,

  constraints: [
    'Use n + 1 qubits: n input qubits plus 1 ancilla',
    'The oracle must implement f(x) = s . x mod 2 using only CNOT gates',
    'The hidden string must be recovered in a single query (no repeated measurements needed)',
    'Measure only the n input qubits',
  ],

  examples: [
    {
      input: 'hidden_string = "101"',
      output: '{ "101": ~1.0 }',
      explanation:
        'After one query, measuring the 3 input qubits yields "101" with near certainty.',
    },
    {
      input: 'hidden_string = "110"',
      output: '{ "110": ~1.0 }',
      explanation:
        'The oracle CNOTs from qubits 0 and 1 (where s has 1s) to the ancilla. The result directly reveals "110".',
    },
  ],

  testCases: [
    {
      id: 'bv-101',
      label: 's = "101"',
      description: 'hidden_string="101": recover 3-bit secret in one query',
      params: { hidden_string: '101' },
      validation: {
        type: 'probability_match',
        expected: { '101': 1.0 },
        tolerance: 0.15,
      },
      hidden: false,
      weight: 0.25,
    },
    {
      id: 'bv-110',
      label: 's = "110"',
      description: 'hidden_string="110": recover 3-bit secret in one query',
      params: { hidden_string: '110' },
      validation: {
        type: 'probability_match',
        expected: { '110': 1.0 },
        tolerance: 0.15,
      },
      hidden: false,
      weight: 0.25,
    },
    {
      id: 'bv-1001',
      label: 's = "1001" (hidden)',
      description: 'hidden_string="1001": recover 4-bit secret in one query',
      params: { hidden_string: '1001' },
      validation: {
        type: 'probability_match',
        expected: { '1001': 1.0 },
        tolerance: 0.15,
      },
      hidden: true,
      weight: 0.25,
    },
    {
      id: 'bv-0011',
      label: 's = "0011" (hidden)',
      description: 'hidden_string="0011": recover 4-bit secret in one query',
      params: { hidden_string: '0011' },
      validation: {
        type: 'probability_match',
        expected: { '0011': 1.0 },
        tolerance: 0.15,
      },
      hidden: true,
      weight: 0.25,
    },
  ],

  starterCode: {
    qiskit: `from qiskit import QuantumCircuit

# hidden_string is provided (e.g., "101")
n = len(hidden_string)

qc = QuantumCircuit(n + 1, n)  # n input qubits + 1 ancilla

# Step 1: Prepare ancilla in |-> state
qc.x(n)
qc.h(n)

# Step 2: Apply H to all input qubits
for i in range(n):
    qc.h(i)

# Step 3: TODO - Apply the oracle
# For each position i where hidden_string[i] == '1', apply CNOT(i, n)

# Step 4: Apply H to all input qubits again
for i in range(n):
    qc.h(i)

# Measure input qubits only
qc.measure(list(range(n)), list(range(n)))
`,
    cirq: `import cirq

# hidden_string is provided (e.g., "101")
n = len(hidden_string)

input_qubits = cirq.LineQubit.range(n)
ancilla = cirq.LineQubit(n)

circuit = cirq.Circuit()

# Step 1: Prepare ancilla in |-> state
circuit.append([cirq.X(ancilla), cirq.H(ancilla)])

# Step 2: Apply H to all input qubits
circuit.append(cirq.H.on_each(*input_qubits))

# Step 3: TODO - Apply the oracle
# For each position i where hidden_string[i] == '1',
# apply CNOT(input_qubits[i], ancilla)

# Step 4: Apply H to all input qubits again
circuit.append(cirq.H.on_each(*input_qubits))

# Measure input qubits only
circuit.append(cirq.measure(*input_qubits, key='result'))
`,
    'cuda-q': `import cudaq

# hidden_string is provided (e.g., "101")

@cudaq.kernel
def bernstein_vazirani(secret: list[int]):
    n = len(secret)
    qubits = cudaq.qvector(n + 1)  # n input + 1 ancilla

    # Step 1: Prepare ancilla in |-> state
    x(qubits[n])
    h(qubits[n])

    # Step 2: Apply H to all input qubits
    for i in range(n):
        h(qubits[i])

    # Step 3: TODO - Apply the oracle
    # For each position i where secret[i] == 1,
    # apply cx(qubits[i], qubits[n])

    # Step 4: Apply H to all input qubits again
    for i in range(n):
        h(qubits[i])

    # Measure input qubits only
    for i in range(n):
        mz(qubits[i])
`,
  },

  hints: [
    'The oracle applies CNOT(i, ancilla) for each bit of s that is 1',
    'After the final Hadamards, measuring the input register gives s directly',
    'This works because of phase kickback from the |-> ancilla',
  ],

  tags: ['bernstein-vazirani', 'oracle', 'phase-kickback'],
  estimatedMinutes: 20,
  totalSubmissions: 654,
  acceptanceRate: 0.67,
};
