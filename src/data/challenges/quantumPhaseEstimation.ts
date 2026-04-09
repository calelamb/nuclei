import type { QuantumChallenge } from '../../types/challenge';

export const quantumPhaseEstimation: QuantumChallenge = {
  id: 'quantum-phase-estimation',
  title: 'Quantum Phase Estimation',
  difficulty: 'hard',
  category: 'algorithms',
  description: `## Quantum Phase Estimation

**Quantum Phase Estimation** (QPE) is a cornerstone subroutine that extracts
the eigenphase of a unitary operator. Given a unitary \`U\` and one of its
eigenstates \`|\u03C8\u27E9\`, where:

\`\`\`
U|\u03C8\u27E9 = e^{2\u03C0i\u03C6} |\u03C8\u27E9
\`\`\`

QPE encodes the phase \`\u03C6\` into an \`n\`-bit binary register with precision
\`1 / 2^n\`.

### Circuit Structure

The circuit uses \`n\` **precision qubits** (register) plus one **eigenvector
qubit** (target):

| Qubits | Role |
|--------|------|
| 0 to n\u22121 | Precision register \u2014 stores the binary representation of \u03C6 |
| n | Eigenvector qubit \u2014 prepared in eigenstate \`|1\u27E9\` |

### Algorithm Steps

1. **Prepare the eigenvector** in state \`|1\u27E9\` (eigenstate of T, S, and Z).

2. **Hadamard** all precision qubits to create uniform superposition.

3. **Controlled-\`U^{2^k}\`** operations: for each precision qubit \`k\`,
   apply \`U\` a total of \`2^k\` times, controlled on qubit \`k\`:
   \`\`\`python
   for k in range(n):
       # Apply controlled-U^(2^k)
       # control = qubit k, target = eigenvector qubit
       controlled_gate(k, n, repetitions=2**k)
   \`\`\`

4. **Inverse QFT** on the precision register to convert the phase-encoded
   amplitudes into a computational basis state.

5. **Measure** the precision register.

### Phase Encoding

| Gate | Phase \u03C6 | Binary (3-bit) | Expected measurement |
|------|---------|----------------|---------------------|
| T | 1/8 | 0.001 | \`|001\u27E9\` |
| S | 1/4 | 0.010 | \`|010\u27E9\` |
| Z | 1/2 | 0.100 | \`|100\u27E9\` |

### Gate Powers

Since \`T = RZ(\u03C0/4)\`, applying \`T\` a total of \`2^k\` times is equivalent to:

\`\`\`
T^{2^k} = RZ(\u03C0/4 \u00B7 2^k)
\`\`\`

Similarly, \`S = RZ(\u03C0/2)\` and \`Z = RZ(\u03C0)\`.

### Inverse QFT (3 qubits)

For 3 precision qubits, the inverse QFT circuit is:

\`\`\`
SWAP(0, 2)
H(0)
CPhase(-\u03C0/2, control=1, target=0)
H(1)
CPhase(-\u03C0/4, control=2, target=0)
CPhase(-\u03C0/2, control=2, target=1)
H(2)
\`\`\`

### Your Task

Given a \`gate\` (\`"t"\`, \`"s"\`, or \`"z"\`) and \`n_precision\` qubits,
implement QPE to estimate the phase. The precision register should
measure the correct binary encoding of \u03C6.`,

  constraints: [
    'Use n_precision + 1 qubits total (n_precision register + 1 eigenvector)',
    'The eigenvector qubit must be prepared in |1\u27E9',
    'Apply controlled-U^(2^k) for each precision qubit k',
    'Implement the inverse QFT on the precision register',
    'Measure only the precision qubits',
  ],

  examples: [
    {
      input: 'gate = "t", n_precision = 3',
      output: '{ "001": 1.0 }',
      explanation:
        'The T gate has phase 1/8 = 0.001 in binary. QPE maps this to |001\u27E9.',
    },
    {
      input: 'gate = "s", n_precision = 3',
      output: '{ "010": 1.0 }',
      explanation:
        'The S gate has phase 1/4 = 0.010 in binary. QPE maps this to |010\u27E9.',
    },
  ],

  testCases: [
    {
      id: 'qpe-t-gate',
      label: 'T gate (\u03C6 = 1/8)',
      description: 'gate="t", n_precision=3: estimate phase 1/8 \u2192 |001\u27E9',
      params: { gate: 't', n_precision: 3 },
      validation: {
        type: 'probability_match',
        expected: { '001': 1.0 },
        tolerance: 0.15,
      },
      hidden: false,
      weight: 0.35,
    },
    {
      id: 'qpe-s-gate',
      label: 'S gate (\u03C6 = 1/4)',
      description: 'gate="s", n_precision=3: estimate phase 1/4 \u2192 |010\u27E9',
      params: { gate: 's', n_precision: 3 },
      validation: {
        type: 'probability_match',
        expected: { '010': 1.0 },
        tolerance: 0.15,
      },
      hidden: false,
      weight: 0.35,
    },
    {
      id: 'qpe-z-gate',
      label: 'Z gate (\u03C6 = 1/2) (hidden)',
      description: 'gate="z", n_precision=3: estimate phase 1/2 \u2192 |100\u27E9',
      params: { gate: 'z', n_precision: 3 },
      validation: {
        type: 'probability_match',
        expected: { '100': 1.0 },
        tolerance: 0.15,
      },
      hidden: true,
      weight: 0.3,
    },
  ],

  starterCode: {
    qiskit: `from qiskit import QuantumCircuit
import numpy as np

# gate is provided: "t", "s", or "z"
# n_precision is provided: 3

n_total = n_precision + 1  # precision qubits + eigenvector qubit
qc = QuantumCircuit(n_total, n_precision)

# Prepare eigenvector in |1> (eigenstate of T, S, and Z gates)
qc.x(n_precision)

# Step 1: Hadamard on all precision qubits
for i in range(n_precision):
    qc.h(i)

# Step 2: TODO - Controlled-U^(2^k) operations
# For each precision qubit k (k=0,1,...,n_precision-1):
#   Apply controlled-U^(2^k) with control=k, target=n_precision
#   For T gate: U = T, so U^(2^k) means applying T gate 2^k times
#     T = RZ(pi/4), so T^(2^k) = RZ(pi/4 * 2^k)
#     Use: qc.cp(pi/4 * 2**k, k, n_precision)
#   For S gate: S = RZ(pi/2), so S^(2^k) = RZ(pi/2 * 2^k)
#   For Z gate: Z = RZ(pi), so Z^(2^k) = RZ(pi * 2^k)

# Step 3: TODO - Inverse QFT on precision qubits
# Swap qubits, then controlled rotations in reverse
# For 3 qubits:
#   qc.swap(0, 2)
#   qc.h(0)
#   qc.cp(-np.pi/2, 1, 0)
#   qc.h(1)
#   qc.cp(-np.pi/4, 2, 0)
#   qc.cp(-np.pi/2, 2, 1)
#   qc.h(2)

# Measure precision qubits
qc.measure(list(range(n_precision)), list(range(n_precision)))
`,
    cirq: `import cirq
import numpy as np

# gate is provided: "t", "s", or "z"
# n_precision is provided: 3

n_total = n_precision + 1
qubits = cirq.LineQubit.range(n_total)
prec = qubits[:n_precision]
eigen = qubits[n_precision]

circuit = cirq.Circuit()

# Prepare eigenvector in |1>
circuit.append(cirq.X(eigen))

# Step 1: Hadamard on all precision qubits
circuit.append(cirq.H.on_each(*prec))

# Step 2: TODO - Controlled-U^(2^k) operations
# For each precision qubit k:
#   Apply controlled phase rotation on the eigenvector qubit
#   For T gate: phase_angle = pi/4 * 2^k
#   Use: cirq.CZPowGate(exponent=angle/pi).on(prec[k], eigen)

# Step 3: TODO - Inverse QFT on precision qubits

# Measure precision qubits
circuit.append(cirq.measure(*prec, key='result'))
`,
    'cuda-q': `import cudaq
import numpy as np

# gate is provided: "t", "s", or "z"
# n_precision is provided: 3

@cudaq.kernel
def qpe():
    n_total = n_precision + 1
    qubits = cudaq.qvector(n_total)

    # Prepare eigenvector in |1>
    x(qubits[n_precision])

    # Step 1: Hadamard on all precision qubits
    for i in range(n_precision):
        h(qubits[i])

    # Step 2: TODO - Controlled-U^(2^k) operations
    # For each precision qubit k:
    #   Apply controlled phase gate to eigenvector
    #   For T gate: angle = pi/4 * 2^k

    # Step 3: TODO - Inverse QFT on precision qubits

    # Measure precision qubits
    for i in range(n_precision):
        mz(qubits[i])
`,
  },

  hints: [
    'For controlled-T^(2^k), note that T = RZ(\u03C0/4), so T^(2^k) = RZ(\u03C0/4 \u00B7 2^k)',
    'The inverse QFT reverses the order of controlled rotations and includes qubit swaps',
    'For 3 qubits, inverse QFT is: SWAP(0,2), H(0), CPhase(-\u03C0/2, 1\u21920), H(1), CPhase(-\u03C0/4, 2\u21920), CPhase(-\u03C0/2, 2\u21921), H(2)',
  ],

  tags: ['qpe', 'phase-estimation', 'qft', 'eigenvalue'],
  estimatedMinutes: 40,
  totalSubmissions: 287,
  acceptanceRate: 0.31,
};
