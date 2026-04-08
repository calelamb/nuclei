import type { QuantumChallenge } from '../../types/challenge';

export const quantumParity: QuantumChallenge = {
  id: 'quantum-parity-check',
  title: 'Quantum Parity Check',
  difficulty: 'easy',
  category: 'algorithms',
  description: `## Quantum Parity Check

**Parity** is one of the most fundamental operations in both classical and quantum
computing. The parity of a bit-string is the XOR of all its bits:

\`parity("0110") = 0 XOR 1 XOR 1 XOR 0 = 0  (even)\`
\`parity("0100") = 0 XOR 1 XOR 0 XOR 0 = 1  (odd)\`

### The Quantum Approach

In a quantum circuit you can compute parity without destroying the original data.
The trick uses an **ancilla qubit** and the CNOT gate:

- CNOT flips the target qubit whenever the control qubit is \`|1\\u27E9\`
- Chaining CNOTs from every data qubit into a single ancilla accumulates the XOR

After the cascade, the ancilla holds the parity of the entire register.

### Your Task

1. **Encode** the given classical \`bitstring\` into quantum data qubits (apply X where the bit is \`'1'\`)
2. **Compute** the parity into an ancilla qubit using CNOT gates
3. **Measure** only the ancilla qubit

### Example

For \`bitstring = "01"\`:
- Qubit 0 stays \`|0\\u27E9\`, qubit 1 is flipped to \`|1\\u27E9\`
- CNOT(0, ancilla) leaves ancilla as \`|0\\u27E9\`
- CNOT(1, ancilla) flips ancilla to \`|1\\u27E9\`
- Measurement yields \`"1"\` with certainty (odd parity)`,

  constraints: [
    'Use n + 1 qubits: n data qubits plus 1 ancilla',
    'Measure only the ancilla qubit (1 classical bit)',
    'Do not use any gates besides X and CNOT',
  ],

  examples: [
    {
      input: 'bitstring = "01"',
      output: '{ "1": 1.0 }',
      explanation:
        'XOR of bits 0 and 1 is 1 (odd parity). Ancilla measures |1> with certainty.',
    },
    {
      input: 'bitstring = "110"',
      output: '{ "0": 1.0 }',
      explanation:
        'XOR of bits 1, 1, 0 is 0 (even parity). Ancilla measures |0> with certainty.',
    },
  ],

  testCases: [
    {
      id: 'parity-01',
      label: '"01" (odd)',
      description: 'bitstring="01": parity is 1 (odd)',
      params: { bitstring: '01' },
      validation: {
        type: 'probability_match',
        expected: { '1': 1.0 },
        tolerance: 0.05,
      },
      hidden: false,
      weight: 0.25,
    },
    {
      id: 'parity-110',
      label: '"110" (even)',
      description: 'bitstring="110": parity is 0 (even)',
      params: { bitstring: '110' },
      validation: {
        type: 'probability_match',
        expected: { '0': 1.0 },
        tolerance: 0.05,
      },
      hidden: false,
      weight: 0.25,
    },
    {
      id: 'parity-1010',
      label: '"1010" (hidden)',
      description: 'bitstring="1010": parity is 0 (even)',
      params: { bitstring: '1010' },
      validation: {
        type: 'probability_match',
        expected: { '0': 1.0 },
        tolerance: 0.05,
      },
      hidden: true,
      weight: 0.25,
    },
    {
      id: 'parity-1111',
      label: '"1111" (hidden)',
      description: 'bitstring="1111": parity is 0 (even)',
      params: { bitstring: '1111' },
      validation: {
        type: 'probability_match',
        expected: { '0': 1.0 },
        tolerance: 0.05,
      },
      hidden: true,
      weight: 0.25,
    },
  ],

  starterCode: {
    qiskit: `from qiskit import QuantumCircuit

# bitstring is provided (e.g., "01", "110", "1010")
n = len(bitstring)

qc = QuantumCircuit(n + 1, 1)  # n data qubits + 1 ancilla

# Step 1: Encode the bitstring into qubits
for i, bit in enumerate(bitstring):
    if bit == '1':
        qc.x(i)

# Step 2: TODO - Compute parity into the ancilla qubit (qubit n)
# Hint: CNOT from each data qubit to the ancilla

# Measure only the ancilla
qc.measure(n, 0)
`,
    cirq: `import cirq

# bitstring is provided (e.g., "01", "110", "1010")
n = len(bitstring)

data_qubits = cirq.LineQubit.range(n)
ancilla = cirq.LineQubit(n)

circuit = cirq.Circuit()

# Step 1: Encode the bitstring into qubits
for i, bit in enumerate(bitstring):
    if bit == '1':
        circuit.append(cirq.X(data_qubits[i]))

# Step 2: TODO - Compute parity into the ancilla qubit
# Hint: CNOT from each data qubit to the ancilla

# Measure only the ancilla
circuit.append(cirq.measure(ancilla, key='result'))
`,
    'cuda-q': `import cudaq

# bitstring is provided (e.g., "01", "110", "1010")

@cudaq.kernel
def parity_check(bits: list[int]):
    n = len(bits)
    qubits = cudaq.qvector(n + 1)  # n data + 1 ancilla

    # Step 1: Encode the bitstring into qubits
    for i in range(n):
        if bits[i] == 1:
            x(qubits[i])

    # Step 2: TODO - Compute parity into the ancilla qubit (qubit n)
    # Hint: CNOT from each data qubit to the ancilla

    # Measure only the ancilla
    mz(qubits[n])
`,
  },

  hints: [
    'CNOT flips the target if the control is |1>',
    'Apply CNOT from each data qubit to the ancilla qubit',
    'for i in range(n): qc.cx(i, n)',
  ],

  tags: ['parity', 'cnot', 'ancilla'],
  estimatedMinutes: 15,
  totalSubmissions: 876,
  acceptanceRate: 0.78,
};
