import type { QuantumChallenge } from '../../types/challenge';

export const bernsteinVazirani: QuantumChallenge = {
  id: 'bernstein-vazirani',
  title: 'Bernstein-Vazirani Algorithm',
  difficulty: 'medium',
  category: 'algorithms',
  description: `## Bernstein-Vazirani Algorithm

The **Bernstein-Vazirani algorithm** recovers a hidden bit-string \`s\` from a
black-box function using a **single quantum query** — where any classical
strategy needs \`n\`.

### The Problem

You are handed an opaque **oracle** — a gate on \`n + 1\` qubits (\`n\` input +
1 output) that computes

\`f(x) = s \\u00B7 x  (mod 2)\`

into the output qubit, where \`s \\u00B7 x = s\\u2080x\\u2080 \\u2295 s\\u2081x\\u2081 \\u2295 \\u2026\`.
**You are not given \`s\`.** You must recover it by *querying* the oracle — a
hardcoded guess can't work, because the secret differs across the hidden tests.

### The Algorithm

1. Put the output qubit into \`|\\u2212\\u27E9\` (X then H) so the oracle kicks its
   result back as a **phase**.
2. Apply H to all \`n\` input qubits.
3. **Query the oracle once.**
4. Apply H to all \`n\` input qubits again.
5. Measure the input register — it now reads \`s\` directly.

### Your Task

Implement \`solve(oracle)\`. Read \`n\` from \`oracle.num_qubits - 1\`, build the
Bernstein-Vazirani circuit around the oracle, and return it. **One query** is
optimal — the \\u2605 rewards using exactly one.`,

  constraints: [
    'You receive an opaque `oracle` gate — the secret string is never given to you',
    'Recover the hidden string with a SINGLE oracle query',
    'Use n + 1 qubits (n input + 1 output) and measure only the n input qubits',
    'Read n from oracle.num_qubits - 1',
  ],

  examples: [
    {
      input: 'oracle for s = "101"',
      output: '{ "101": ~1.0 }',
      explanation:
        'One query + the Hadamard sandwich makes the input register read "101" with certainty.',
    },
    {
      input: 'oracle for s = "110"',
      output: '{ "110": ~1.0 }',
      explanation:
        'The same circuit recovers any secret — you never had to know it in advance.',
    },
  ],

  testCases: [
    {
      id: 'bv-101',
      label: 's = "101"',
      description: 'Recover a 3-bit secret in one query',
      params: { hidden_string: '101' },
      validation: { type: 'state_fidelity' },
      hidden: false,
      weight: 0.25,
    },
    {
      id: 'bv-110',
      label: 's = "110"',
      description: 'Recover a 3-bit secret in one query',
      params: { hidden_string: '110' },
      validation: { type: 'state_fidelity' },
      hidden: false,
      weight: 0.25,
    },
    {
      id: 'bv-1011',
      label: 's = "1011" (hidden)',
      description: 'Recover a 4-bit secret in one query',
      params: { hidden_string: '1011' },
      validation: { type: 'state_fidelity' },
      hidden: true,
      weight: 0.25,
    },
    {
      id: 'bv-0110',
      label: 's = "0110" (hidden)',
      description: 'Recover a 4-bit secret in one query',
      params: { hidden_string: '0110' },
      validation: { type: 'state_fidelity' },
      hidden: true,
      weight: 0.25,
    },
  ],

  starterCode: {
    qiskit: `from qiskit import QuantumCircuit

# \`oracle\` is a black-box gate on n+1 qubits (n input + 1 output) computing
# f(x) = s . x (mod 2) into the output qubit. You are NOT given s — query it.
n = oracle.num_qubits - 1
qc = QuantumCircuit(n + 1, n)

# 1. Output qubit into |-> for phase kickback
qc.x(n)
qc.h(n)
# 2. Hadamard the input register
for i in range(n):
    qc.h(i)
# 3. TODO: query the oracle once  ->  qc.append(oracle, range(n + 1))

# 4. Hadamard the input register again
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
    'n = oracle.num_qubits - 1 tells you how many input qubits there are.',
    'Sandwich a single oracle query between two layers of Hadamards on the input register.',
    'The |-> output qubit turns the oracle output into a phase (phase kickback) that the final Hadamards decode into s.',
  ],

  tags: ['bernstein-vazirani', 'oracle', 'phase-kickback', 'query-complexity'],
  estimatedMinutes: 20,
  totalSubmissions: 654,
  acceptanceRate: 0.67,
  // Bernstein-Vazirani is the canonical single-query result. Raw gate counts
  // are dominated by the injected oracle's internals, so the meaningful,
  // un-spoofable efficiency metric is the number of oracle queries — 1.
  efficiency: { oracleQueries: 1 },
  oracle: {
    solveParams: [],
    queryLabel: 'oracle',
    builderCode: `from qiskit import QuantumCircuit

def build_oracle(hidden_string, **_):
    n = len(hidden_string)
    sub = QuantumCircuit(n + 1, name="oracle")
    for i, b in enumerate(hidden_string):
        if b == '1':
            sub.cx(i, n)
    return sub.to_gate(label="oracle")
`,
  },
  referenceCode: `def reference(hidden_string, **_):
    from qiskit import QuantumCircuit
    n = len(hidden_string)
    qc = QuantumCircuit(n + 1, n)
    qc.x(n)
    qc.h(n)
    for i in range(n):
        qc.h(i)
    qc.append(build_oracle(hidden_string), range(n + 1))
    for i in range(n):
        qc.h(i)
    qc.measure(range(n), range(n))
    return qc
`,
};
