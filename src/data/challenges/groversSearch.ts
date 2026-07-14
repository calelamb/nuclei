import type { QuantumChallenge } from '../../types/challenge';

export const groversSearch: QuantumChallenge = {
  id: 'grovers-search',
  title: "Grover's Search",
  difficulty: 'medium',
  category: 'algorithms',
  description: `## Grover's Search

**Grover's algorithm** finds a marked item in an unstructured database of \`N =
2^n\` items in \`~\\u221AN\` queries — a quadratic speedup over the \`N/2\`
classical average.

### The Problem

You are handed an opaque **oracle** on \`n\` qubits that phase-marks the hidden
solution \`|s\\u27E9\` (it flips the sign of that one amplitude and leaves the rest
alone). **You are not given \`s\`.** Recover it by amplifying its amplitude with
Grover iterations.

### The Algorithm

1. Put all \`n\` qubits into equal superposition (H on each).
2. Repeat **\`k = \\u230A\\u03C0/4 \\u00B7 \\u221AN\\u230B\`** times:
   - **Query the oracle** (phase-flip the solution).
   - Apply the **diffuser** — reflect every amplitude about their mean:
     H\\u00B7X on all, a multi-controlled Z, then X\\u00B7H on all.
3. Measure — the solution \`|s\\u27E9\` dominates.

> Use exactly \`k = \\u230A\\u03C0/4 \\u00B7 \\u221A(2^n)\\u230B\` iterations. Too few
> or too many and the amplitude swings away from the solution.

### Your Task

Implement \`solve(oracle)\`. Read \`n = oracle.num_qubits\`, run Grover with the
optimal number of iterations, and return the measured circuit. The \\u2605
rewards using the optimal query count.`,

  constraints: [
    'You receive an opaque `oracle` gate that phase-marks the hidden solution',
    'Read n from oracle.num_qubits',
    'Use exactly floor(pi/4 * sqrt(2**n)) Grover iterations',
    'Implement the diffuser (reflection about the mean) yourself',
  ],

  examples: [
    {
      input: 'oracle marking |11> (n = 2)',
      output: '{ "11": ~1.0 }',
      explanation: 'For N=4 a single Grover iteration lands the solution exactly.',
    },
    {
      input: 'oracle marking |101> (n = 3)',
      output: '{ "101": ~0.95 }',
      explanation: 'For N=8 two iterations bring the solution to ~95% probability.',
    },
  ],

  testCases: [
    {
      id: 'grover-2a',
      label: 'n = 2 solution',
      description: 'Find the marked 2-qubit state',
      // Deliberately non-|0…0>: an empty circuit sits in |0…0>, so an all-zeros
      // marked state would let a do-nothing spoof pass this visible case.
      params: { marked_state: '11' },
      validation: { type: 'state_fidelity' },
      hidden: false,
      weight: 0.25,
    },
    {
      id: 'grover-3a',
      label: 'n = 3 solution',
      description: 'Find the marked 3-qubit state',
      params: { marked_state: '011' },
      validation: { type: 'state_fidelity' },
      hidden: false,
      weight: 0.25,
    },
    {
      id: 'grover-2b',
      label: 'n = 2 solution (hidden)',
      description: 'Find the marked 2-qubit state',
      params: { marked_state: '10' },
      validation: { type: 'state_fidelity' },
      hidden: true,
      weight: 0.25,
    },
    {
      id: 'grover-3b',
      label: 'n = 3 solution (hidden)',
      description: 'Find the marked 3-qubit state',
      params: { marked_state: '101' },
      validation: { type: 'state_fidelity' },
      hidden: true,
      weight: 0.25,
    },
  ],

  starterCode: {
    qiskit: `from qiskit import QuantumCircuit
import numpy as np

# \`oracle\` phase-marks the hidden solution |s> (flips its sign). You are NOT
# given s — amplify it with Grover's algorithm.
n = oracle.num_qubits
iterations = max(1, int(np.floor(np.pi / 4 * np.sqrt(2 ** n))))
qc = QuantumCircuit(n, n)

# 1. Equal superposition
for i in range(n):
    qc.h(i)

# 2. Repeat \`iterations\` times: query the oracle, then apply the diffuser
for _ in range(iterations):
    # TODO: qc.append(oracle, range(n))
    # TODO: diffuser -> H,X on all; H + multi-controlled-X on the last qubit + H; X,H on all
    pass

qc.measure(range(n), range(n))
`,
    cirq: `# This challenge is graded on the desktop Qiskit kernel.
# Implement solve(oracle) with Qiskit — see the Qiskit starter.
`,
    'cuda-q': `# This challenge is graded on the desktop Qiskit kernel.
# Implement solve(oracle) with Qiskit — see the Qiskit starter.
`,
  },

  hints: [
    'n = oracle.num_qubits, and the optimal iteration count is floor(pi/4 * sqrt(2**n)).',
    'The diffuser reflects about the mean: H then X on all qubits, an n-controlled Z (H + mcx + H on the last qubit), then X then H on all.',
    'One iteration is exact for n=2; two iterations reach ~95% for n=3.',
  ],

  tags: ['grover', 'oracle', 'amplitude-amplification', 'query-complexity'],
  estimatedMinutes: 25,
  totalSubmissions: 512,
  acceptanceRate: 0.58,
  // Grover's query complexity: floor(pi/4 * sqrt(N)) oracle calls. Worst graded
  // case is n=3 -> 2. Correctness already pins the count (over/under-iterating
  // swings the amplitude away and fails fidelity), and the ★ marks the optimum.
  efficiency: { oracleQueries: 2 },
  oracle: {
    solveParams: [],
    queryLabel: 'oracle',
    builderCode: `from qiskit import QuantumCircuit

def build_oracle(marked_state, **_):
    n = len(marked_state)
    sub = QuantumCircuit(n, name="oracle")
    for i, b in enumerate(marked_state):
        if b == '0':
            sub.x(i)
    sub.h(n - 1)
    sub.mcx(list(range(n - 1)), n - 1)
    sub.h(n - 1)
    for i, b in enumerate(marked_state):
        if b == '0':
            sub.x(i)
    return sub.to_gate(label="oracle")
`,
  },
  referenceCode: `def reference(marked_state, **_):
    from qiskit import QuantumCircuit
    import numpy as np
    n = len(marked_state)
    iterations = max(1, int(np.floor(np.pi / 4 * np.sqrt(2 ** n))))
    qc = QuantumCircuit(n, n)
    for i in range(n):
        qc.h(i)
    for _ in range(iterations):
        qc.append(build_oracle(marked_state), range(n))
        for i in range(n):
            qc.h(i)
        for i in range(n):
            qc.x(i)
        qc.h(n - 1)
        qc.mcx(list(range(n - 1)), n - 1)
        qc.h(n - 1)
        for i in range(n):
            qc.x(i)
        for i in range(n):
            qc.h(i)
    qc.measure(range(n), range(n))
    return qc
`,
};
