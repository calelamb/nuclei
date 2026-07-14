import type { QuantumChallenge } from '../../types/challenge';

export const simonsAlgorithm: QuantumChallenge = {
  id: 'simons-algorithm',
  title: "Simon's Algorithm",
  difficulty: 'hard',
  category: 'algorithms',
  description: `## Simon's Algorithm

**Simon's algorithm** finds the hidden period \`s\` of a 2-to-1 function
\`f(x) = f(x \\u2295 s)\` with an **exponential** quantum speedup — the first
problem to prove one over classical query complexity.

### The Problem

You are handed an opaque **oracle** on \`2n\` qubits (\`n\` input + \`n\` output)
that computes such an \`f\`. **You are not given \`s\`.** A single run of Simon's
circuit yields a random bit-string \`y\` satisfying

\`y \\u00B7 s = 0  (mod 2)\`.

Collecting \`n\\u22121\` independent \`y\`'s and solving the linear system recovers
\`s\` — but that post-processing is classical. Your job is the **quantum circuit**,
which needs just **one oracle query**.

### The Circuit

1. Apply H to all \`n\` input qubits.
2. **Query the oracle once** (entangling input with output).
3. Apply H to all \`n\` input qubits again.
4. Measure the input register — every outcome is orthogonal to \`s\`.

### Your Task

Implement \`solve(oracle)\`. Read \`n = oracle.num_qubits // 2\`, build Simon's
circuit, and return it. The \\u2605 rewards the single-query solution.`,

  constraints: [
    'You receive an opaque `oracle` gate on 2n qubits — the period is never given',
    'Read n from oracle.num_qubits // 2',
    'Use a SINGLE oracle query',
    'Measure only the n input qubits',
  ],

  examples: [
    {
      input: 'oracle with period s = "11" (n = 2)',
      output: '{ "00": 0.5, "11": 0.5 }',
      explanation: 'Both measured strings satisfy y . s = 0: 00.11=0 and 11.11=0 (mod 2).',
    },
    {
      input: 'oracle with period s = "101" (n = 3)',
      output: 'uniform over the 4 strings y with y . 101 = 0',
      explanation: 'Each measurement gives one linear constraint on s.',
    },
  ],

  testCases: [
    {
      id: 'simon-11',
      label: 's = "11"',
      description: 'Period 11 over 2 input qubits',
      params: { hidden_period: '11' },
      validation: { type: 'state_fidelity' },
      hidden: false,
      weight: 0.25,
    },
    {
      id: 'simon-101',
      label: 's = "101"',
      description: 'Period 101 over 3 input qubits',
      params: { hidden_period: '101' },
      validation: { type: 'state_fidelity' },
      hidden: false,
      weight: 0.25,
    },
    {
      id: 'simon-110',
      label: 's = "110" (hidden)',
      description: 'Period 110 over 3 input qubits',
      params: { hidden_period: '110' },
      validation: { type: 'state_fidelity' },
      hidden: true,
      weight: 0.25,
    },
    {
      id: 'simon-011',
      label: 's = "011" (hidden)',
      description: 'Period 011 over 3 input qubits',
      params: { hidden_period: '011' },
      validation: { type: 'state_fidelity' },
      hidden: true,
      weight: 0.25,
    },
  ],

  starterCode: {
    qiskit: `from qiskit import QuantumCircuit

# \`oracle\` computes a 2-to-1 function f with hidden period s: f(x) = f(x XOR s).
# It acts on 2n qubits (n input + n output). You are NOT given s. One query
# yields a random y with y . s = 0 (mod 2).
n = oracle.num_qubits // 2
qc = QuantumCircuit(2 * n, n)

# 1. Hadamard the input register
for i in range(n):
    qc.h(i)
# 2. TODO: query the oracle once  ->  qc.append(oracle, range(2 * n))

# 3. Hadamard the input register again
for i in range(n):
    qc.h(i)

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
    'n = oracle.num_qubits // 2 — half the qubits are the input register, half the output.',
    'The circuit is a Hadamard sandwich around a single oracle query, measuring only the input register.',
    'Every measured y is orthogonal to s (y . s = 0 mod 2) — the classical linear algebra to finish is outside the circuit.',
  ],

  tags: ['simon', 'oracle', 'hidden-period', 'query-complexity'],
  estimatedMinutes: 30,
  totalSubmissions: 287,
  acceptanceRate: 0.49,
  // Simon's circuit is single-query — the exponential speedup. Query count is
  // unambiguous (one Hadamard sandwich), so the ★ marks the optimal solution.
  efficiency: { oracleQueries: 1 },
  oracle: {
    solveParams: [],
    queryLabel: 'oracle',
    builderCode: `from qiskit import QuantumCircuit

def build_oracle(hidden_period, **_):
    n = len(hidden_period)
    sub = QuantumCircuit(2 * n, name="oracle")
    for i in range(n):
        sub.cx(i, n + i)
    if '1' in hidden_period:
        j = hidden_period.index('1')
        for i, b in enumerate(hidden_period):
            if b == '1':
                sub.cx(j, n + i)
    return sub.to_gate(label="oracle")
`,
  },
  referenceCode: `def reference(hidden_period, **_):
    from qiskit import QuantumCircuit
    n = len(hidden_period)
    qc = QuantumCircuit(2 * n, n)
    for i in range(n):
        qc.h(i)
    qc.append(build_oracle(hidden_period), range(2 * n))
    for i in range(n):
        qc.h(i)
    qc.measure(range(n), range(n))
    return qc
`,
};
