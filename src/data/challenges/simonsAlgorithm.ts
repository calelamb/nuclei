import type { QuantumChallenge } from '../../types/challenge';

export const simonsAlgorithm: QuantumChallenge = {
  id: 'simons-algorithm',
  title: "Simon's Algorithm",
  difficulty: 'hard',
  category: 'algorithms',
  description: `## Simon's Algorithm

**Simon's algorithm** finds the hidden period \`s\` of a 2-to-1 function
\`f: {0,1}^n \u2192 {0,1}^n\` where \`f(x) = f(x \u2295 s)\` for a secret bitstring
\`s \u2260 0\`. Classically this requires \`O(2^{n/2})\` queries; Simon's algorithm
solves it with \`O(n)\` quantum queries.

### Problem Structure

The function \`f\` satisfies the **Simon promise**: for every pair of inputs
\`x\` and \`y\`, \`f(x) = f(y)\` if and only if \`y = x\` or \`y = x \u2295 s\`.

For \`n = 2\` with \`s = "01"\`:

| \`x\` | \`f(x)\` | Note |
|-------|---------|------|
| 00 | 00 | \`f(00) = f(00 \u2295 01) = f(01)\` |
| 01 | 00 | same as f(00) |
| 10 | 10 | \`f(10) = f(10 \u2295 01) = f(11)\` |
| 11 | 10 | same as f(10) |

### Circuit Architecture

The circuit uses \`2n\` qubits: \`n\` input qubits and \`n\` output qubits.

1. **Hadamard** on all \`n\` input qubits to create uniform superposition.

2. **Oracle \`U_f\`** that maps \`|x\u27E9|0\u27E9 \u2192 |x\u27E9|f(x)\u27E9\`. The oracle is built from:
   - **Copy step**: CNOT from each input qubit \`i\` to the corresponding
     output qubit \`n + i\`. This computes \`f(x) = x\` as a baseline.
   - **Period step**: for each bit position \`j\` where \`s[j] = "1"\`, apply
     CNOT from a **trigger qubit** (the first input qubit where \`s\` has a
     \`"1"\`) to output qubit \`n + j\`. This XORs \`s\` into the output when
     the trigger qubit is \`|1\u27E9\`, creating the 2-to-1 property.

3. **Hadamard** on all input qubits again.

4. **Measure** only the input qubits.

### Oracle Construction Example

For \`s = "01"\` with 2 input + 2 output qubits (q0, q1 = input; q2, q3 = output):

\`\`\`python
# Copy step: CNOT from each input to its output
CNOT(q0, q2)  # input[0] -> output[0]
CNOT(q1, q3)  # input[1] -> output[1]

# Period step: s = "01", so s[1] = "1"
# Trigger qubit = q1 (first input where s has a "1")
CNOT(q1, q2)  # XOR output[0] when s[0]="0"? No -- only XOR positions where s="1"
# Actually: CNOT from trigger (q1) to output positions where s has "1"
CNOT(q1, q3)  # s[1]="1", so CNOT(trigger, output[1])
\`\`\`

Wait -- let's simplify. The canonical construction:
- Copy: CNOT(input[i], output[i]) for all i
- Find the first index \`t\` where \`s[t] = "1"\`
- For every index \`j\` where \`s[j] = "1"\`: CNOT(input[t], output[j])

### Measurement Outcomes

Every measured bitstring \`b\` satisfies \`b \u00B7 s = 0 mod 2\`. After \`O(n)\`
runs, enough independent equations accumulate to solve for \`s\` via
Gaussian elimination.

| Hidden period \`s\` | Orthogonality constraint | Valid outcomes |
|-------------------|------------------------|----------------|
| \`01\` | \`b\u2081 = 0\` | \`|00\u27E9, |10\u27E9\` each ~50% |
| \`10\` | \`b\u2080 = 0\` | \`|00\u27E9, |01\u27E9\` each ~50% |
| \`11\` | \`b\u2080 \u2295 b\u2081 = 0\` | \`|00\u27E9, |11\u27E9\` each ~50% |

### Your Task

Given a \`hidden_period\` bitstring, implement Simon's circuit so that
measuring the input qubits yields only bitstrings orthogonal to \`s\`.`,

  constraints: [
    'Use 2*n qubits (n input + n output) and n classical bits',
    'Hadamard all input qubits before and after the oracle',
    'The oracle must implement a valid 2-to-1 function with period s',
    'Measure only the input qubits (qubits 0 to n-1)',
    'You may use H and CNOT gates',
  ],

  examples: [
    {
      input: 'hidden_period = "01"',
      output: '{ "00": 0.5, "10": 0.5 }',
      explanation:
        'Bitstrings b where b\u00B701 = 0 mod 2, meaning b\u2081 = 0. Valid outcomes: 00 and 10.',
    },
    {
      input: 'hidden_period = "10"',
      output: '{ "00": 0.5, "01": 0.5 }',
      explanation:
        'Bitstrings b where b\u00B710 = 0 mod 2, meaning b\u2080 = 0. Valid outcomes: 00 and 01.',
    },
  ],

  testCases: [
    {
      id: 'simon-01',
      label: 'Period s = "01"',
      description: 'hidden_period="01": measure bitstrings orthogonal to 01',
      params: { hidden_period: '01' },
      validation: {
        type: 'probability_match',
        expected: { '00': 0.5, '10': 0.5 },
        tolerance: 0.1,
      },
      hidden: false,
      weight: 0.35,
    },
    {
      id: 'simon-10',
      label: 'Period s = "10"',
      description: 'hidden_period="10": measure bitstrings orthogonal to 10',
      params: { hidden_period: '10' },
      validation: {
        type: 'probability_match',
        expected: { '00': 0.5, '01': 0.5 },
        tolerance: 0.1,
      },
      hidden: false,
      weight: 0.35,
    },
    {
      id: 'simon-11',
      label: 'Period s = "11" (hidden)',
      description: 'hidden_period="11": measure bitstrings orthogonal to 11',
      params: { hidden_period: '11' },
      validation: {
        type: 'probability_match',
        expected: { '00': 0.5, '11': 0.5 },
        tolerance: 0.1,
      },
      hidden: true,
      weight: 0.3,
    },
  ],

  starterCode: {
    qiskit: `from qiskit import QuantumCircuit

# hidden_period is provided (e.g., "01", "10", "11")
n = len(hidden_period)

qc = QuantumCircuit(2 * n, n)  # n input + n output qubits

# Step 1: Hadamard on input qubits
for i in range(n):
    qc.h(i)

# Step 2: TODO - Oracle for f(x) = f(x ^ s)
# The oracle copies input to output: CNOT from input[i] to output[i]
# Then XORs with s on a specific qubit when triggered

# Step 3: Hadamard on input qubits
for i in range(n):
    qc.h(i)

# Measure input qubits only
qc.measure(list(range(n)), list(range(n)))
`,
    cirq: `import cirq

# hidden_period is provided (e.g., "01", "10", "11")
n = len(hidden_period)

input_qubits = cirq.LineQubit.range(n)
output_qubits = cirq.LineQubit.range(n, 2 * n)

circuit = cirq.Circuit()

# Step 1: Hadamard on input qubits
circuit.append(cirq.H.on_each(*input_qubits))

# Step 2: TODO - Oracle for f(x) = f(x ^ s)
# Copy step: CNOT from input[i] to output[i]
# Period step: find first index t where s[t]="1",
#   then CNOT(input[t], output[j]) for every j where s[j]="1"

# Step 3: Hadamard on input qubits
circuit.append(cirq.H.on_each(*input_qubits))

# Measure input qubits only
circuit.append(cirq.measure(*input_qubits, key='result'))
`,
    'cuda-q': `import cudaq

# hidden_period is provided (e.g., "01", "10", "11")
n = len(hidden_period)

@cudaq.kernel
def simon():
    qubits = cudaq.qvector(2 * n)

    # Step 1: Hadamard on input qubits
    for i in range(n):
        h(qubits[i])

    # Step 2: TODO - Oracle for f(x) = f(x ^ s)
    # Copy: cx(qubits[i], qubits[n + i]) for each i
    # Period: find first t where s[t]="1",
    #   then cx(qubits[t], qubits[n + j]) for every j where s[j]="1"

    # Step 3: Hadamard on input qubits
    for i in range(n):
        h(qubits[i])

    # Measure input qubits only
    for i in range(n):
        mz(qubits[i])
`,
  },

  hints: [
    'The simplest oracle: CNOT from each input qubit to the corresponding output qubit, then CNOT from the first input qubit where s has a \'1\' to all output qubits where s has a \'1\'',
    'After measuring, all results b satisfy b\u00B7s = 0 mod 2',
    "For s='01': the oracle just needs CNOT(0,2), CNOT(1,3), CNOT(1,2) \u2014 the extra CNOT makes f(x) = f(x\u229501)",
  ],

  tags: ['simons', 'hidden-period', 'oracle', 'linear-algebra'],
  estimatedMinutes: 35,
  totalSubmissions: 156,
  acceptanceRate: 0.29,
};
