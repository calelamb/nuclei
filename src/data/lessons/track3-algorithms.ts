import type { Lesson } from './types';

export const TRACK3_LESSONS: Lesson[] = [
  // ── Lesson 3.1 ──
  {
    id: '3.1',
    title: 'Deutsch-Jozsa Deep Dive',
    description: 'Scale the Deutsch-Jozsa algorithm to N qubits — constant vs balanced in one shot.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['1.10'],
    tags: ['deutsch-jozsa', 'oracle', 'quantum-speedup', 'n-qubit'],
    diracContext: 'The student saw the 1-qubit Deutsch algorithm in Track 1. Now they scale to N qubits. Emphasize that ONE query replaces 2^(N-1)+1 classical queries. The oracle is a black box — focus on the structure (H on all qubits, oracle, H again, measure). If they struggle with the oracle implementation, walk through the bit-flip pattern.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## From Deutsch to Deutsch-Jozsa

In Track 1 you saw the **Deutsch algorithm** — distinguishing constant from balanced for a 1-bit function with a single query. The **Deutsch-Jozsa algorithm** generalizes this to **N-bit inputs**.

**The promise:** Given a function f(x) on N-bit strings, it is either:
- **Constant** — same output for all inputs
- **Balanced** — outputs 0 for exactly half the inputs, 1 for the other half

Classically, you need up to **2^(N-1) + 1** evaluations in the worst case. Quantum? **One query. Always.**`,
      },
      {
        type: 'concept-card',
        title: 'Deutsch-Jozsa Circuit Structure',
        visual: 'circuit',
        explanation: 'The pattern is: (1) Initialize N input qubits in |0⟩ and one ancilla in |1⟩. (2) Apply H to all qubits. (3) Apply the oracle Uf. (4) Apply H to input qubits. (5) Measure input qubits. If all zeros, the function is constant. Any non-zero result means balanced.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# 3-qubit Deutsch-Jozsa with a CONSTANT oracle (f(x) = 0)
n = 3
qc = QuantumCircuit(n + 1, n)

# Step 1: Prepare ancilla in |1⟩
qc.x(n)

# Step 2: Apply H to all qubits
for i in range(n + 1):
    qc.h(i)

# Step 3: Oracle for f(x) = 0 (identity — do nothing)

# Step 4: Apply H to input qubits
for i in range(n):
    qc.h(i)

# Step 5: Measure input qubits
qc.measure(range(n), range(n))`,
        framework: 'qiskit',
        description: 'Constant oracle f(x)=0: the oracle does nothing. All measurements yield 000, confirming "constant".',
        explorationPrompt: 'Notice the oracle section is empty — f(x)=0 means no phase flip ever happens. The H gates undo each other perfectly, returning every input qubit to |0⟩.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# 3-qubit Deutsch-Jozsa with a BALANCED oracle
# This oracle computes f(x) = x0 XOR x1 (balanced function)
n = 3
qc = QuantumCircuit(n + 1, n)

# Prepare ancilla in |1⟩
qc.x(n)

# Apply H to all qubits
for i in range(n + 1):
    qc.h(i)

# Balanced oracle: CNOT from qubit 0 and qubit 1 to ancilla
qc.cx(0, n)
qc.cx(1, n)

# Apply H to input qubits
for i in range(n):
    qc.h(i)

# Measure input qubits
qc.measure(range(n), range(n))`,
        framework: 'qiskit',
        description: 'Balanced oracle: CNOT gates flip the ancilla conditioned on input qubits. The measurement will NOT be all zeros.',
        explorationPrompt: 'Try adding or removing CNOT gates to change which balanced function the oracle computes. Any non-trivial combination of CNOTs from input qubits to the ancilla creates a balanced function.',
      },
      {
        type: 'exercise',
        id: '3.1-ex1',
        title: 'Build a 4-qubit Deutsch-Jozsa',
        description: 'Implement the Deutsch-Jozsa algorithm for 4 input qubits with a balanced oracle where f(x) = x0 XOR x2. You should measure a non-zero result.',
        starterCode: `from qiskit import QuantumCircuit

n = 4
qc = QuantumCircuit(n + 1, n)

# TODO: Prepare the ancilla qubit in |1⟩

# TODO: Apply H to ALL qubits (input + ancilla)

# TODO: Build the balanced oracle for f(x) = x0 XOR x2
# Hint: Use CNOT from qubit 0 and qubit 2 to the ancilla

# TODO: Apply H to input qubits only

# TODO: Measure the input qubits
`,
        framework: 'qiskit',
        expectedProbabilities: { '0101': 1.0 },
        tolerancePercent: 2,
        hints: [
          'The ancilla is qubit index n (qubit 4). Use qc.x(n) then qc.h() on all.',
          'The oracle for f(x) = x0 XOR x2 needs qc.cx(0, n) and qc.cx(2, n).',
          'After the oracle, apply H only to qubits 0 through n-1, then measure them.',
        ],
        successMessage: 'The result 0101 (reading right to left: qubits 0 and 2 are 1) reveals exactly which qubits the oracle depends on. This is the power of quantum parallelism — one query exposes the full structure of the function.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '3.1-q1',
            question: 'How many oracle queries does the N-qubit Deutsch-Jozsa algorithm use?',
            options: ['N', '2^N', '1', '2^(N-1) + 1'],
            correctIndex: 2,
            explanation: 'Deutsch-Jozsa uses exactly one oracle query regardless of N. This is an exponential speedup over the classical worst case of 2^(N-1) + 1 queries.',
          },
          {
            id: '3.1-q2',
            question: 'If all input qubits measure |0⟩, what does this tell us?',
            options: ['The function is balanced', 'The function is constant', 'The oracle is broken', 'We need to run it again'],
            correctIndex: 1,
            explanation: 'All-zero measurement means the function is constant. Any other result means balanced. There is zero probability of error — this is a deterministic algorithm.',
          },
        ],
      },
    ],
  },

  // ── Lesson 3.2 ──
  {
    id: '3.2',
    title: 'Bernstein-Vazirani',
    description: 'Find a hidden bitstring with a single quantum query.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['3.1'],
    tags: ['bernstein-vazirani', 'hidden-string', 'oracle', 'inner-product'],
    diracContext: 'This algorithm is elegant and intuitive. The oracle computes f(x) = s·x mod 2 (bitwise inner product). Classically you need N queries (one per bit of s). Quantum: one query. The circuit is nearly identical to Deutsch-Jozsa — the key insight is that H transforms the oracle phase kickback into the hidden string directly. If the student asks "why does this work?", walk through the math for a 2-bit example.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Finding a Hidden Bitstring

Imagine someone has a secret string **s** of N bits. They give you a black-box function:

**f(x) = s · x mod 2**

where · is the bitwise inner product (AND each pair of bits, XOR the results).

**Example:** If s = "101" and x = "110", then f(x) = (1·1) XOR (0·1) XOR (1·0) = 1.

**Classical approach:** Query f with each standard basis vector (100, 010, 001) to learn one bit of s at a time — **N queries**.

**Quantum approach:** Apply the Deutsch-Jozsa circuit pattern and the measurement directly reveals s — **1 query**.`,
      },
      {
        type: 'concept-card',
        title: 'Why Bernstein-Vazirani Works',
        visual: 'circuit',
        explanation: 'The oracle for f(x) = s·x mod 2 applies a CNOT from each input qubit i to the ancilla whenever the i-th bit of s is 1. After the Hadamard transform, measuring the input register gives s directly. The Hadamard basis change converts oracle phase information into computational basis outcomes.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# Bernstein-Vazirani: find hidden string s = "101"
s = "101"
n = len(s)
qc = QuantumCircuit(n + 1, n)

# Prepare ancilla in |1⟩
qc.x(n)

# Apply H to all qubits
for i in range(n + 1):
    qc.h(i)

# Oracle: CNOT from qubit i to ancilla where s[i] = '1'
# Note: Qiskit bit ordering is reversed, so s[0] is the highest qubit
for i, bit in enumerate(s):
    if bit == '1':
        qc.cx(i, n)

# Apply H to input qubits
for i in range(n):
    qc.h(i)

# Measure
qc.measure(range(n), range(n))`,
        framework: 'qiskit',
        description: 'Finding s = "101". The measurement result directly reveals the hidden string.',
        explorationPrompt: 'Change s to different strings like "110" or "111" and verify that the measurement always gives you back s. The circuit structure stays the same — only the oracle changes.',
      },
      {
        type: 'exercise',
        id: '3.2-ex1',
        title: 'Find the hidden string s = "1010"',
        description: 'Implement the Bernstein-Vazirani algorithm to find the 4-bit hidden string s = "1010". The measurement should reveal the string in one shot.',
        starterCode: `from qiskit import QuantumCircuit

s = "1010"
n = len(s)
qc = QuantumCircuit(n + 1, n)

# TODO: Prepare ancilla in |1⟩

# TODO: Apply H to all qubits

# TODO: Build the oracle
# For each bit in s that is '1', add a CNOT from that qubit to the ancilla

# TODO: Apply H to input qubits

# TODO: Measure input qubits
`,
        framework: 'qiskit',
        expectedProbabilities: { '0101': 1.0 },
        tolerancePercent: 2,
        hints: [
          'Ancilla is qubit n. Start with qc.x(n) and H on all.',
          'Loop through s: if s[i] == "1", do qc.cx(i, n). Bits 0 and 2 of "1010" are "1".',
          'Qiskit reverses bit ordering in measurement: "1010" appears as "0101" in the output string.',
        ],
        successMessage: 'One query, four bits recovered. Classically this would take four separate queries. The Hadamard transform converts phase information into the answer.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '3.2-q1',
            question: 'What does the oracle in Bernstein-Vazirani compute?',
            options: ['f(x) = x mod 2', 'f(x) = s · x mod 2 (bitwise inner product)', 'f(x) = s XOR x', 'f(x) = s + x'],
            correctIndex: 1,
            explanation: 'The oracle computes f(x) = s · x mod 2, the bitwise inner product of the hidden string s with the input x.',
          },
        ],
      },
    ],
  },

  // ── Lesson 3.3 ──
  {
    id: '3.3',
    title: "Simon's Algorithm",
    description: 'Find the hidden period of a two-to-one function.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['3.2'],
    tags: ['simons-algorithm', 'period-finding', 'linear-algebra', 'oracle'],
    diracContext: "Simon's algorithm is the bridge between the simple oracle algorithms and Shor's. The quantum part finds vectors orthogonal to the hidden period s, then classical linear algebra solves for s. Emphasize: (1) the quantum circuit runs MULTIPLE times, unlike Deutsch-Jozsa/BV, (2) each run gives one equation, (3) we need enough equations to solve the system. If the student is confused about the classical post-processing, use a concrete 2-bit example.",
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Simon's Problem

Given a function f that is either **one-to-one** or **two-to-one** with a hidden period s:

**f(x) = f(y) if and only if x = y or x = y ⊕ s**

where ⊕ is bitwise XOR. Find **s**.

**Classical complexity:** O(2^(N/2)) queries (birthday problem).
**Quantum complexity:** O(N) queries — exponential speedup!

### The key difference from previous algorithms

Deutsch-Jozsa and Bernstein-Vazirani need **one run**. Simon's needs **O(N) runs** because each run gives one linear equation orthogonal to s. You collect enough equations, then solve classically.`,
      },
      {
        type: 'concept-card',
        title: "Simon's Algorithm Structure",
        visual: 'circuit',
        explanation: 'Each run: (1) H on input register, (2) apply oracle Uf mapping |x⟩|0⟩ to |x⟩|f(x)⟩, (3) H on input register, (4) measure input register to get a string y where y · s = 0 mod 2. Repeat O(N) times and solve the linear system of equations y · s = 0 to find s.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# Simon's algorithm for s = "11" (2 input qubits)
# Oracle: f(00)=f(11)=00, f(01)=f(10)=01
n = 2
qc = QuantumCircuit(2 * n, n)

# Apply H to input register
for i in range(n):
    qc.h(i)

# Oracle for s = "11":
# Copy input to output register
qc.cx(0, 2)
qc.cx(1, 3)
# XOR with s when first qubit is 1
qc.cx(0, 2)
qc.cx(0, 3)

# Apply H to input register
for i in range(n):
    qc.h(i)

# Measure input register
qc.measure(range(n), range(n))`,
        framework: 'qiskit',
        description: "Simon's with s = \"11\". Each measurement gives a string y where y · s = 0 mod 2. You'll see either 00 or 11 — both satisfy y · (11) = 0.",
        explorationPrompt: 'Run this multiple times. You should only see "00" and "11" as results. Both satisfy y·s = 0 mod 2: (0·1 + 0·1) = 0, and (1·1 + 1·1) = 0 mod 2. The non-trivial solution s = "11" is the only string consistent with all results.',
      },
      {
        type: 'exercise',
        id: '3.3-ex1',
        title: "Implement Simon's for s = \"01\"",
        description: "Build Simon's algorithm circuit for the hidden string s = \"01\". The oracle should satisfy f(x) = f(x XOR 01), meaning f(00)=f(01) and f(10)=f(11).",
        starterCode: `from qiskit import QuantumCircuit

# Simon's algorithm for s = "01"
n = 2
qc = QuantumCircuit(2 * n, n)

# TODO: Apply H to input register (qubits 0 and 1)

# TODO: Build oracle for s = "01"
# Copy input to output: cx from qubit 0 to 2, cx from qubit 1 to 3
# Then XOR output with s when qubit 1 is |1⟩:
# cx from qubit 1 to qubit 3

# TODO: Apply H to input register

# TODO: Measure input register
`,
        framework: 'qiskit',
        expectedProbabilities: { '00': 0.5, '10': 0.5 },
        tolerancePercent: 5,
        hints: [
          'Start with qc.h(0) and qc.h(1) for the input Hadamards.',
          'The oracle copies input to output (cx 0->2, cx 1->3), then for s="01", add cx from qubit 1 to qubit 3.',
          'After the oracle, apply H to qubits 0 and 1 again, then measure them.',
        ],
        successMessage: "You see 00 and 10 — both satisfy y · (01) = 0 mod 2. The non-trivial constraint tells us s has a 1 in position 1. Simon's gives us the equations; classical algebra finds the answer.",
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '3.3-q1',
            question: "How many times must Simon's quantum circuit run for N-bit inputs?",
            options: ['1', 'N', '2^N', '2^(N/2)'],
            correctIndex: 1,
            explanation: "Simon's needs O(N) runs to collect enough independent equations to solve the linear system for s. This is still exponentially better than the classical O(2^(N/2)).",
          },
          {
            id: '3.3-q2',
            question: 'What does each measurement in Simon\'s algorithm give you?',
            options: ['The hidden string s directly', 'A random string', 'A string y where y · s = 0 mod 2', 'Half of the hidden string'],
            correctIndex: 2,
            explanation: 'Each measurement produces a string y orthogonal to s (y · s = 0 mod 2). After collecting enough such strings, classical linear algebra recovers s.',
          },
        ],
      },
    ],
  },

  // ── Lesson 3.4 ──
  {
    id: '3.4',
    title: "Grover's Search",
    description: 'Find a needle in a haystack with quadratic quantum speedup.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['3.1'],
    tags: ['grovers-algorithm', 'amplitude-amplification', 'oracle', 'diffuser', 'search'],
    diracContext: "Grover's is THE algorithm students remember. Break it into two pieces: the oracle (marks the answer) and the diffuser (amplifies the marked amplitude). Use the geometric picture — amplitude of the target state gets rotated toward 1. For 2 qubits with 1 marked item, 1 iteration is optimal. For 3 qubits, about 2 iterations. If the student asks about optimality, explain that too many iterations overshoot.",
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Search Problem

You have an unsorted database of N items. One item is marked. Classical search: check items one by one — **O(N)** queries on average.

**Grover's algorithm** finds the marked item in **O(√N)** queries — a quadratic speedup.

### The Two Ingredients

1. **Oracle** — Flips the phase of the marked state: |w⟩ → -|w⟩
2. **Diffuser** (Grover operator) — Reflects all amplitudes about the mean, amplifying the marked state

One round of oracle + diffuser is called a **Grover iteration**. For N items, you need approximately **π√N / 4** iterations.`,
      },
      {
        type: 'concept-card',
        title: 'Amplitude Amplification',
        visual: 'histogram',
        explanation: 'Start: all amplitudes equal (1/√N each). After the oracle, the marked item has negative amplitude. The diffuser "reflects about the mean" — since the mean is slightly less than 1/√N (dragged down by the negative amplitude), the reflection boosts the marked item and suppresses the rest. Repeat until the marked amplitude is close to 1.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# 2-qubit Grover's: find |11⟩
qc = QuantumCircuit(2, 2)

# Initialize superposition
qc.h(0)
qc.h(1)

# Oracle: mark |11⟩ with a phase flip (CZ gate)
qc.cz(0, 1)

# Diffuser: reflect about |++⟩
qc.h(0)
qc.h(1)
qc.z(0)
qc.z(1)
qc.cz(0, 1)
qc.h(0)
qc.h(1)

# Measure
qc.measure([0, 1], [0, 1])`,
        framework: 'qiskit',
        description: 'Grover\'s search in a 4-item "database" — finds |11⟩ with 100% probability in just 1 iteration.',
        explorationPrompt: 'With 2 qubits (4 items), one Grover iteration is exactly right. Try removing the diffuser — you get uniform probabilities again. The oracle alone is useless without amplification.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# 3-qubit Grover's: find |101⟩
n = 3
qc = QuantumCircuit(n, n)

# Initialize superposition
for i in range(n):
    qc.h(i)

# --- Grover iteration (repeat ~2 times for 3 qubits) ---
for _ in range(2):
    # Oracle: mark |101⟩
    # Flip qubit 1 so we can use a multi-controlled Z on |111⟩
    qc.x(1)
    qc.h(2)
    qc.ccx(0, 1, 2)
    qc.h(2)
    qc.x(1)

    # Diffuser
    for i in range(n):
        qc.h(i)
    for i in range(n):
        qc.x(i)
    qc.h(n - 1)
    qc.ccx(0, 1, 2)
    qc.h(n - 1)
    for i in range(n):
        qc.x(i)
    for i in range(n):
        qc.h(i)

# Measure
qc.measure(range(n), range(n))`,
        framework: 'qiskit',
        description: '3-qubit Grover searching for |101⟩ among 8 items. Two iterations give high probability (~94.5%) of finding the target.',
        explorationPrompt: 'Try changing to 1 iteration or 3 iterations. With 1 you get ~78%, with 2 you get ~94.5%, and with 3 you overshoot down to ~33%. The sweet spot is about π√8/4 ≈ 2.2, so 2 iterations is optimal.',
      },
      {
        type: 'exercise',
        id: '3.4-ex1',
        title: "Grover's: find |110⟩",
        description: 'Implement a 3-qubit Grover search to find the state |110⟩. Use 2 Grover iterations. Hint: the oracle must mark |110⟩ — think about which qubit to flip before the multi-controlled gate.',
        starterCode: `from qiskit import QuantumCircuit

n = 3
qc = QuantumCircuit(n, n)

# Initialize superposition
for i in range(n):
    qc.h(i)

# TODO: Implement 2 Grover iterations
# Each iteration needs:
#   1. Oracle — mark |110⟩ (flip qubit 0 since it should be |0⟩)
#   2. Diffuser — reflect about mean

for _ in range(2):
    # Oracle for |110⟩
    # Hint: qubit 0 should be 0, so flip it, apply multi-controlled Z, flip back

    # Diffuser
    pass

qc.measure(range(n), range(n))`,
        framework: 'qiskit',
        expectedProbabilities: { '110': 0.945 },
        tolerancePercent: 8,
        hints: [
          'For the oracle marking |110⟩: flip qubit 0 with X, apply multi-controlled Z (h(2), ccx(0,1,2), h(2)), then unflip qubit 0 with X.',
          'The diffuser is: H on all, X on all, multi-controlled Z, X on all, H on all.',
          'Multi-controlled Z = H on the target qubit, then Toffoli, then H on the target qubit.',
        ],
        successMessage: "Grover's found |110⟩ with ~94.5% probability in just 2 queries. A classical search of 8 items would need on average 4 queries. For larger databases, the speedup becomes dramatic: 1 million items → ~785 queries instead of 500,000.",
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '3.4-q1',
            question: "What is the speedup provided by Grover's algorithm?",
            options: ['Exponential (N → log N)', 'Quadratic (N → √N)', 'Polynomial (N → N^0.5)', 'Constant (always 1 query)'],
            correctIndex: 1,
            explanation: "Grover's provides a quadratic speedup: O(N) classical queries become O(√N) quantum queries. Note that options B and C describe the same thing — both are correct descriptions of the quadratic speedup.",
          },
        ],
      },
    ],
  },

  // ── Lesson 3.5 ──
  {
    id: '3.5',
    title: "Grover's — Multi-Solution & Counting",
    description: 'What happens when there are multiple needles in the haystack?',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['3.4'],
    tags: ['grovers-algorithm', 'multi-solution', 'quantum-counting', 'amplitude-amplification'],
    diracContext: "When there are M marked items out of N, the optimal number of Grover iterations changes to π√(N/M)/4. More solutions means FEWER iterations needed. If the student doesn't know M in advance, that's where quantum counting comes in — combining Grover with phase estimation. Keep the counting explanation conceptual; the implementation is in the QPE lesson.",
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Multiple Marked Items

When **M** items are marked out of **N** total:
- Optimal iterations: **π√(N/M) / 4** (rounded to nearest integer)
- Each iteration rotates the state by a larger angle (since the "marked subspace" is bigger)
- More solutions → fewer iterations needed

| N | M | Optimal Iterations |
|---|---|-------------------|
| 4 | 1 | 1 |
| 4 | 2 | 1 |
| 8 | 1 | 2 |
| 8 | 2 | 1 |

### The Counting Problem

What if you don't know M? **Quantum counting** combines Grover iterations with phase estimation to estimate M without knowing it in advance.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# 2-qubit Grover's with 2 marked items: |01⟩ and |10⟩
qc = QuantumCircuit(2, 2)

# Initialize superposition
qc.h(0)
qc.h(1)

# Oracle: mark |01⟩ and |10⟩
# |01⟩: qubit 0 = 1, qubit 1 = 0 → flip qubit 1, CZ, flip back
qc.x(1)
qc.cz(0, 1)
qc.x(1)

# |10⟩: qubit 0 = 0, qubit 1 = 1 → flip qubit 0, CZ, flip back
qc.x(0)
qc.cz(0, 1)
qc.x(0)

# Diffuser
qc.h(0)
qc.h(1)
qc.z(0)
qc.z(1)
qc.cz(0, 1)
qc.h(0)
qc.h(1)

# Measure
qc.measure([0, 1], [0, 1])`,
        framework: 'qiskit',
        description: 'Searching for 2 items (|01⟩ and |10⟩) in a 4-item database. With M=2 out of N=4, 1 iteration gives near-perfect results.',
        explorationPrompt: 'Notice we get both solutions with equal probability. The oracle marks both states, and the diffuser amplifies both. Try adding a second Grover iteration — the probability actually drops because we overshoot!',
      },
      {
        type: 'text',
        markdown: `## Quantum Counting — The Idea

If you don't know how many solutions exist, you can estimate M using **quantum counting**:

1. Treat the Grover operator (oracle + diffuser) as a unitary G
2. G has eigenvalues related to the angle θ where sin²(θ) = M/N
3. Use **Quantum Phase Estimation** (you'll learn this next lesson) on G to estimate θ
4. Compute M = N · sin²(θ)

This tells you the number of solutions without finding them first — a quantum census.`,
      },
      {
        type: 'exercise',
        id: '3.5-ex1',
        title: "Grover's with two solutions in 3 qubits",
        description: 'Search a 3-qubit space for |011⟩ and |110⟩ (2 solutions out of 8). With M=2 and N=8, the optimal number of iterations is 1. Build the oracle and diffuser.',
        starterCode: `from qiskit import QuantumCircuit

n = 3
qc = QuantumCircuit(n, n)

# Initialize superposition
for i in range(n):
    qc.h(i)

# TODO: 1 Grover iteration with oracle marking |011⟩ and |110⟩

# Oracle for |011⟩: qubits should be 1,1,0 (qubit 0=1, 1=1, 2=0)
# Flip qubit 2 (it should be 0), apply multi-controlled Z, unflip

# Oracle for |110⟩: qubits should be 0,1,1 (qubit 0=0, 1=1, 2=1)
# Flip qubit 0 (it should be 0), apply multi-controlled Z, unflip

# TODO: Diffuser
# H on all, X on all, multi-controlled Z, X on all, H on all

qc.measure(range(n), range(n))`,
        framework: 'qiskit',
        expectedProbabilities: { '011': 0.5, '110': 0.5 },
        tolerancePercent: 8,
        hints: [
          'Oracle for |011⟩: qc.x(2), then multi-controlled Z (qc.h(2), qc.ccx(0,1,2), qc.h(2)), then qc.x(2).',
          'Oracle for |110⟩: qc.x(0), multi-controlled Z, qc.x(0).',
          'Diffuser: H all, X all, H on qubit 2, ccx(0,1,2), H on qubit 2, X all, H all.',
        ],
        successMessage: 'With 2 solutions out of 8, a single Grover iteration amplifies both marked states to ~50% each. The quadratic speedup applies to finding ANY solution — with more solutions, you find one faster.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '3.5-q1',
            question: "If there are M solutions out of N items, how does Grover's iteration count change?",
            options: ['Still √N', 'Increases to M·√N', 'Decreases to approximately √(N/M)', 'Stays constant at 1'],
            correctIndex: 2,
            explanation: 'The optimal iteration count is approximately π√(N/M)/4, which decreases as M increases. More solutions means fewer iterations needed.',
          },
        ],
      },
    ],
  },

  // ── Lesson 3.6 ──
  {
    id: '3.6',
    title: 'Quantum Phase Estimation',
    description: 'Estimate eigenvalues of unitary operators — the engine behind Shor and HHL.',
    difficulty: 'advanced',
    estimatedMinutes: 30,
    prerequisites: ['3.4'],
    tags: ['phase-estimation', 'qpe', 'eigenvalues', 'inverse-qft', 'controlled-unitary'],
    diracContext: 'QPE is the workhorse subroutine behind Shor, HHL, and quantum counting. The student needs to understand: (1) eigenvalue ↔ phase relationship: U|ψ⟩ = e^(2πiφ)|ψ⟩, (2) controlled-U^(2^k) puts the phase into counting qubits via phase kickback, (3) inverse QFT reads out the binary expansion of φ. Do NOT expect the student to implement inverse QFT from scratch — Qiskit provides it. Focus on the conceptual pipeline and how to set up the controlled unitaries.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Phase Estimation — The Quantum Workhorse

Many quantum algorithms need to find the **eigenvalue** of a unitary operator U. If U|ψ⟩ = e^(2πiφ)|ψ⟩, QPE finds the phase **φ**.

### The Structure

1. **Counting register** — t qubits initialized to |0⟩ (more qubits = more precision)
2. **Eigenstate register** — holds |ψ⟩ (the eigenvector of U)
3. Apply **H** to counting qubits → superposition
4. Apply **controlled-U^(2^k)** from counting qubit k to the eigenstate
5. Apply **inverse QFT** to counting register
6. Measure counting register → binary representation of φ

### Example: T Gate

The T gate has eigenvalue e^(iπ/4) = e^(2πi · 1/8). So φ = 1/8 = 0.001 in binary. With 3 counting qubits, QPE should output |001⟩.`,
      },
      {
        type: 'concept-card',
        title: 'Phase Kickback in QPE',
        visual: 'circuit',
        explanation: 'When a counting qubit controls U^(2^k) acting on |ψ⟩, the eigenvalue phase "kicks back" onto the counting qubit: |1⟩|ψ⟩ → e^(2πi · 2^k · φ)|1⟩|ψ⟩. After all controlled operations, the counting register holds the state |2^t · φ⟩ in the Fourier basis. The inverse QFT converts this to the computational basis.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.circuit.library import QFT
import numpy as np

# QPE for the T gate: eigenvalue = e^(i*pi/4), phase = 1/8
t_qubits = 3  # counting qubits (precision)
qc = QuantumCircuit(t_qubits + 1, t_qubits)

# Prepare eigenstate |1⟩ of the T gate
qc.x(t_qubits)

# Hadamard on counting qubits
for i in range(t_qubits):
    qc.h(i)

# Controlled-T^(2^k)
# T gate = Rz(pi/4), so T^(2^k) = Rz(pi/4 * 2^k)
for k in range(t_qubits):
    angle = np.pi / 4 * (2 ** k)
    qc.cp(angle, k, t_qubits)

# Inverse QFT on counting register
iqft = QFT(t_qubits, inverse=True)
qc.append(iqft, range(t_qubits))

# Measure counting register
qc.measure(range(t_qubits), range(t_qubits))`,
        framework: 'qiskit',
        description: 'QPE for the T gate. The phase is 1/8 = 0.001 in binary, so we expect measurement |001⟩ with high probability.',
        explorationPrompt: 'Try changing to 4 counting qubits for more precision. For the T gate the phase is exactly representable in 3 bits, so more qubits just confirm the same answer. But for phases that aren\'t neat fractions, more counting qubits give better approximations.',
      },
      {
        type: 'exercise',
        id: '3.6-ex1',
        title: 'QPE for the S Gate',
        description: 'The S gate (phase gate) has eigenvalue e^(iπ/2) when acting on |1⟩, so the phase is φ = 1/4 = 0.01 in binary. Implement QPE with 3 counting qubits. You should measure |010⟩.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit.circuit.library import QFT
import numpy as np

t_qubits = 3
qc = QuantumCircuit(t_qubits + 1, t_qubits)

# TODO: Prepare eigenstate |1⟩ on the target qubit

# TODO: Hadamard on counting qubits

# TODO: Controlled-S^(2^k)
# S gate = Rz(pi/2), so S^(2^k) = Rz(pi/2 * 2^k)
# Use qc.cp(angle, control, target) for each counting qubit k

# TODO: Inverse QFT on counting register

# TODO: Measure counting register
`,
        framework: 'qiskit',
        expectedProbabilities: { '010': 1.0 },
        tolerancePercent: 3,
        hints: [
          'Prepare |1⟩: qc.x(t_qubits). Then qc.h(i) for i in range(t_qubits).',
          'The S gate angle is pi/2. So the controlled phase is: angle = (pi/2) * 2**k for counting qubit k.',
          'Use qc.append(QFT(t_qubits, inverse=True), range(t_qubits)) for the inverse QFT.',
        ],
        successMessage: 'Phase = 1/4 = 0.01 in binary → measurement |010⟩ (reading qubit 0 on the right). QPE precisely extracted the eigenvalue. This same technique powers Shor\'s algorithm for factoring integers.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '3.6-q1',
            question: 'What does QPE output encode?',
            options: ['The eigenvector', 'The binary representation of the phase φ', 'The unitary matrix entries', 'The number of qubits needed'],
            correctIndex: 1,
            explanation: 'QPE outputs the binary representation of the phase φ in the eigenvalue e^(2πiφ). More counting qubits give more bits of precision.',
          },
          {
            id: '3.6-q2',
            question: 'Why does QPE apply controlled-U^(2^k) instead of just controlled-U?',
            options: ['To save circuit depth', 'To amplify the signal', 'Each controlled-U^(2^k) extracts one bit of the phase', 'It is faster to execute'],
            correctIndex: 2,
            explanation: 'The k-th counting qubit controlled by U^(2^k) picks up a phase of 2^k · φ, which effectively reads the k-th bit of the binary expansion of φ.',
          },
        ],
      },
    ],
  },

  // ── Lesson 3.7 ──
  {
    id: '3.7',
    title: "Shor's Algorithm — Integer Factoring",
    description: 'The algorithm that threatened RSA — understand the theory behind quantum factoring.',
    difficulty: 'advanced',
    estimatedMinutes: 35,
    prerequisites: ['3.6'],
    tags: ['shors-algorithm', 'factoring', 'period-finding', 'rsa', 'number-theory'],
    diracContext: "This is the lesson students are most excited about. Focus on the big picture: (1) factoring reduces to period finding, (2) period finding reduces to QPE, (3) the quantum part is just phase estimation on the modular exponentiation operator. The classical reduction (Euler's theorem, GCD) is where most confusion happens — walk through it step by step with N=15. Don't expect the student to implement modular exponentiation circuits — that's the next lesson.",
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Algorithm That Shook Cryptography

RSA encryption relies on one assumption: **factoring large numbers is computationally hard**. In 1994, Peter Shor showed that a quantum computer could factor integers in **polynomial time**, making RSA vulnerable.

### The Classical Reduction

Shor's algorithm converts factoring into period finding:

1. Pick a random **a** coprime to N (i.e., gcd(a, N) = 1)
2. Find the **period r** of f(x) = a^x mod N (the smallest r where a^r mod N = 1)
3. If r is even, compute gcd(a^(r/2) ± 1, N) — these are likely the factors

**Example:** Factor N = 15, choose a = 7
- 7^1 mod 15 = 7
- 7^2 mod 15 = 4
- 7^3 mod 15 = 13
- 7^4 mod 15 = 1 → **period r = 4**
- gcd(7^2 + 1, 15) = gcd(50, 15) = **5**
- gcd(7^2 - 1, 15) = gcd(48, 15) = **3**
- 15 = 3 × 5`,
      },
      {
        type: 'concept-card',
        title: "Shor's Algorithm Pipeline",
        visual: 'circuit',
        explanation: 'Step 1: Classical random choice of a. Step 2: Quantum period finding — use QPE on the unitary U|y⟩ = |a·y mod N⟩ to find r. Step 3: Classical post-processing — compute gcd(a^(r/2) ± 1, N). The quantum computer only handles step 2; the rest is classical.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
import numpy as np

# Period finding for f(x) = 7^x mod 15
# We expect period r = 4

# Simplified circuit: 3 counting qubits, 4 work qubits
n_count = 3
n_work = 4
qc = QuantumCircuit(n_count + n_work, n_count)

# Initialize work register to |1⟩ (since a^0 mod N = 1)
qc.x(n_count)

# Hadamard on counting register
for i in range(n_count):
    qc.h(i)

# Controlled modular exponentiation: a^(2^k) mod 15
# For a=7, N=15, we hard-code the permutations:
# 7^1 mod 15: swap pattern
qc.cswap(0, n_count + 0, n_count + 1)
qc.cswap(0, n_count + 1, n_count + 2)
qc.cswap(0, n_count + 2, n_count + 3)

# 7^2 mod 15 = 4: swap 0<->2, 1<->3
qc.cswap(1, n_count + 0, n_count + 2)
qc.cswap(1, n_count + 1, n_count + 3)

# 7^4 mod 15 = 1 (identity — no gates needed for qubit 2)

# Inverse QFT on counting register (manual for 3 qubits)
qc.swap(0, 2)
qc.h(0)
qc.cp(-np.pi / 2, 1, 0)
qc.h(1)
qc.cp(-np.pi / 4, 2, 0)
qc.cp(-np.pi / 2, 2, 1)
qc.h(2)

# Measure counting register
qc.measure(range(n_count), range(n_count))`,
        framework: 'qiskit',
        description: 'Simplified period finding for 7^x mod 15. The measurement outcomes encode the period r=4 through the phase.',
        explorationPrompt: 'The measurement gives outcomes like 000, 010, 100, 110 — these correspond to phases 0/8, 2/8, 4/8, 6/8. Using continued fractions on each: 0 → trivial, 2/8 = 1/4 → r=4, 4/8 = 1/2 → r=2 (wrong), 6/8 = 3/4 → r=4. Most outcomes give the correct period r=4.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '3.7-q1',
            question: "What mathematical problem does Shor's algorithm solve?",
            options: ['Finding prime numbers', 'Integer factoring in polynomial time', 'Computing discrete logarithms', 'Both B and C'],
            correctIndex: 3,
            explanation: "Shor's algorithm solves both integer factoring and discrete logarithm problems in polynomial time. Both are crucial for breaking RSA and Diffie-Hellman cryptography.",
          },
          {
            id: '3.7-q2',
            question: "What is the quantum part of Shor's algorithm?",
            options: ['Choosing the random base a', 'Computing GCD', 'Period finding via QPE', 'All of the above'],
            correctIndex: 2,
            explanation: 'Only the period-finding step is quantum. Choosing a and computing GCD are classical. The quantum speedup comes from finding the period of a^x mod N exponentially faster than any known classical algorithm.',
          },
          {
            id: '3.7-q3',
            question: 'If the period r is odd, what happens?',
            options: ['The algorithm succeeds anyway', 'Choose a different random a and try again', 'Double r to make it even', 'The computation is invalid'],
            correctIndex: 1,
            explanation: 'If r is odd (or if a^(r/2) ≡ -1 mod N), the reduction to factoring fails. You simply pick a new random a and repeat. The probability of failure is low enough that a few attempts suffice.',
          },
        ],
      },
    ],
  },

  // ── Lesson 3.8 ──
  {
    id: '3.8',
    title: "Shor's — Implementation",
    description: 'Build the quantum circuit that factors 15 = 3 x 5.',
    difficulty: 'advanced',
    estimatedMinutes: 30,
    prerequisites: ['3.7'],
    tags: ['shors-algorithm', 'implementation', 'modular-exponentiation', 'factoring-15'],
    diracContext: "Now the student implements Shor's for N=15. The modular exponentiation circuit for small N can be hard-coded as permutation gates. Reassure the student that real implementations use more sophisticated techniques. Focus on: (1) the overall circuit structure, (2) how controlled modular exponentiation works as controlled swaps for N=15, (3) reading the period from the measurement using continued fractions. If the student is frustrated by the complexity, emphasize that they're implementing one of the most famous algorithms in computer science.",
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Factoring 15 — Step by Step

Let's factor N = 15 using a = 2:
- 2^1 mod 15 = 2
- 2^2 mod 15 = 4
- 2^3 mod 15 = 8
- 2^4 mod 15 = 1 → **r = 4**
- gcd(2^2 + 1, 15) = gcd(5, 15) = **5**
- gcd(2^2 - 1, 15) = gcd(3, 15) = **3**

### Modular Exponentiation as Permutations

For N = 15 and a = 2, multiplying by 2 mod 15 permutes the basis states:
- |1⟩ → |2⟩ → |4⟩ → |8⟩ → |1⟩ (cycle of length 4 = the period)

We encode this as controlled swap operations on a 4-qubit work register.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.circuit.library import QFT
import numpy as np

# Shor's algorithm: factor 15 using a = 2
n_count = 4  # counting qubits
n_work = 4   # work qubits to hold mod-15 arithmetic
qc = QuantumCircuit(n_count + n_work, n_count)

# Initialize work register to |0001⟩ = |1⟩
qc.x(n_count)

# Hadamard on counting register
for i in range(n_count):
    qc.h(i)

# Controlled-[multiply by 2^(2^k) mod 15]
# 2^1 mod 15: permute |1⟩→|2⟩→|4⟩→|8⟩→|1⟩
# This is a cyclic left shift of the 4 work qubits
qc.cswap(0, n_count + 3, n_count + 2)
qc.cswap(0, n_count + 2, n_count + 1)
qc.cswap(0, n_count + 1, n_count + 0)

# 2^2 mod 15 = 4: swap pairs (0↔2, 1↔3)
qc.cswap(1, n_count + 0, n_count + 2)
qc.cswap(1, n_count + 1, n_count + 3)

# 2^4 mod 15 = 1: identity (no gates for qubit 2)

# 2^8 mod 15 = 1: identity (no gates for qubit 3)

# Inverse QFT
iqft = QFT(n_count, inverse=True)
qc.append(iqft, range(n_count))

# Measure counting register
qc.measure(range(n_count), range(n_count))`,
        framework: 'qiskit',
        description: "Shor's algorithm factoring 15 with a=2. Measurements give phases 0, 4, 8, 12 (out of 16), corresponding to 0/16, 4/16=1/4, 8/16=1/2, 12/16=3/4.",
        explorationPrompt: 'The most useful outcomes are 4 (→ 4/16 = 1/4 → r=4) and 12 (→ 12/16 = 3/4 → r=4). Outcome 8 gives 1/2 → r=2 (a divisor of the true period), and 0 is uninformative. Multiple runs give enough data to determine r=4 reliably.',
      },
      {
        type: 'exercise',
        id: '3.8-ex1',
        title: 'Period finding for N=15, a=7',
        description: 'Set up the period-finding circuit for N=15, a=7. The period is r=4. For a=7, the multiplication permutation is |1⟩→|7⟩→|4⟩→|13⟩→|1⟩. Implement the controlled-[multiply by 7 mod 15] for counting qubit 0.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit.circuit.library import QFT
import numpy as np

n_count = 3
n_work = 4
qc = QuantumCircuit(n_count + n_work, n_count)

# Initialize work register to |0001⟩ = |1⟩
qc.x(n_count)

# Hadamard on counting register
for i in range(n_count):
    qc.h(i)

# TODO: Controlled-[multiply by 7 mod 15] from counting qubit 0
# Multiplication by 7 mod 15 maps:
# |0001⟩ → |0111⟩ (1 → 7)
# This involves swaps and X gates
# Hint: Use cswap and cx operations controlled on qubit 0
# Swap work qubits 0↔2 and 1↔3, then flip qubits 0,1,2
qc.cswap(0, n_count + 0, n_count + 2)
qc.cswap(0, n_count + 1, n_count + 3)
qc.cx(0, n_count + 0)
qc.cx(0, n_count + 1)
qc.cx(0, n_count + 2)

# TODO: Controlled-[multiply by 7^2 mod 15] = [multiply by 4 mod 15]
# from counting qubit 1
# 4 mod 15: swap pairs (0↔2, 1↔3)

# 7^4 mod 15 = 1: identity (no gates for qubit 2)

# TODO: Inverse QFT on counting register

# TODO: Measure counting register
`,
        framework: 'qiskit',
        expectedProbabilities: { '000': 0.25, '010': 0.25, '100': 0.25, '110': 0.25 },
        tolerancePercent: 8,
        hints: [
          'For 7^2 mod 15 = 4 (multiply by 4): swap work[0]↔work[2] and work[1]↔work[3] controlled on qubit 1.',
          'Use qc.append(QFT(n_count, inverse=True), range(n_count)) for the inverse QFT.',
          'Measure with qc.measure(range(n_count), range(n_count)).',
        ],
        successMessage: "You've built a quantum circuit that finds the period of 7^x mod 15. From the period r=4, classical computation gives gcd(7^2+1, 15) = gcd(50,15) = 5 and gcd(7^2-1, 15) = gcd(48,15) = 3. Therefore 15 = 3 x 5. You've factored an integer!",
      },
    ],
  },

  // ── Lesson 3.9 ──
  {
    id: '3.9',
    title: 'HHL Algorithm',
    description: 'Solving linear systems Ax = b with exponential quantum speedup.',
    difficulty: 'advanced',
    estimatedMinutes: 25,
    prerequisites: ['3.6'],
    tags: ['hhl-algorithm', 'linear-systems', 'quantum-linear-algebra', 'qpe'],
    diracContext: 'HHL is conceptually deep but the student should understand the pipeline, not implement it from scratch. Focus on: (1) the problem — solving Ax=b, (2) the three stages (QPE to get eigenvalues, controlled rotation to encode 1/λ, inverse QPE to clean up), (3) the caveats (sparse A, need to prepare |b⟩, can only extract limited info from |x⟩). Use the 2x2 example to make it concrete. Do NOT push the student toward implementing HHL — it is too complex for an exercise.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Solving Ax = b on a Quantum Computer

The **HHL algorithm** (Harrow-Hassidim-Lloyd, 2009) solves systems of linear equations with an **exponential speedup** for sparse matrices.

**Classical:** O(N · s · κ) where N is matrix size, s is sparsity, κ is condition number
**Quantum:** O(log(N) · s² · κ²) — exponential in N!

### The Three Stages

1. **QPE** — Decompose |b⟩ in the eigenbasis of A, extract eigenvalues λ_j
2. **Controlled Rotation** — Rotate an ancilla by angle arcsin(C/λ_j), encoding 1/λ_j
3. **Inverse QPE** — Uncompute the eigenvalue register, leaving |x⟩ ∝ A^(-1)|b⟩

### Caveats
- A must be Hermitian (or you can embed it in a larger Hermitian matrix)
- Preparing |b⟩ efficiently can be hard
- You can't read out all of |x⟩ — only extract expectation values`,
      },
      {
        type: 'concept-card',
        title: 'HHL Pipeline',
        visual: 'circuit',
        explanation: 'Three registers: (1) ancilla qubit for the rotation, (2) counting qubits for eigenvalue estimation, (3) state qubits holding |b⟩. QPE extracts eigenvalues into the counting register, controlled rotations encode 1/λ into the ancilla, inverse QPE cleans up the counting register, and post-selecting the ancilla in |1⟩ gives the solution state.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
import numpy as np

# HHL for a simple 2x2 system:
# A = [[1, -1/3], [-1/3, 1]], b = [1, 0]
# Eigenvalues: lambda_1 = 2/3, lambda_2 = 4/3

# Simplified HHL circuit
# 1 ancilla + 1 counting qubit + 1 state qubit
qc = QuantumCircuit(3, 1)

# Prepare |b⟩ = |0⟩ (already the default)

# QPE: Hadamard on counting qubit
qc.h(1)

# Controlled unitary e^(iAt) on state qubit
# For this specific A, we use a controlled rotation
qc.cp(2 * np.pi / 3, 1, 2)

# Inverse QFT (just H for 1 counting qubit)
qc.h(1)

# Controlled rotation: Ry(2*arcsin(C/lambda))
# When counting = |1⟩ (lambda = 2/3), rotate ancilla
qc.cry(2 * np.arcsin(1 / 3), 1, 0)

# Inverse QPE to uncompute
qc.h(1)
qc.cp(-2 * np.pi / 3, 1, 2)
qc.h(1)

# Measure ancilla — post-select on |1⟩
qc.measure(0, 0)`,
        framework: 'qiskit',
        description: 'Simplified HHL for a 2x2 system. The ancilla measurement probability encodes information about the solution vector.',
        explorationPrompt: 'This is a highly simplified version — real HHL needs many more qubits for precision. The key insight is that eigenvalue inversion (the hard classical step) becomes a simple rotation in the quantum circuit.',
      },
      {
        type: 'text',
        markdown: `## Where HHL Matters

| Application | Why HHL Helps |
|------------|---------------|
| Machine learning | Kernel methods, regression, classification on exponentially large feature spaces |
| Finite element analysis | Solving PDEs discretized into large sparse systems |
| Portfolio optimization | Solving systems in financial risk modeling |
| Electromagnetic simulation | Maxwell's equations → large sparse linear systems |

### The Fine Print

HHL gives an **exponential speedup in matrix size N**, but:
- The input |b⟩ must be efficiently preparable
- The output is a quantum state — you can only measure properties of x, not read all entries
- The matrix A must be sparse and well-conditioned (small κ)

Despite these caveats, HHL showed that quantum computers can tackle a fundamental problem in linear algebra, inspiring a wave of "quantum machine learning" research.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '3.9-q1',
            question: 'What are the three main stages of the HHL algorithm?',
            options: [
              'Grover search, factoring, measurement',
              'QPE, controlled rotation, inverse QPE',
              'Hadamard, oracle, diffuser',
              'State preparation, entanglement, teleportation',
            ],
            correctIndex: 1,
            explanation: 'HHL uses QPE to extract eigenvalues, controlled rotation to encode 1/λ into an ancilla qubit, and inverse QPE to clean up. Post-selecting the ancilla gives the solution state.',
          },
          {
            id: '3.9-q2',
            question: "What is the main limitation of HHL's output?",
            options: [
              'It only works for 2x2 matrices',
              'You get a quantum state |x⟩ — you cannot efficiently read all entries',
              'It requires exponential time',
              'It only finds approximate solutions',
            ],
            correctIndex: 1,
            explanation: 'HHL produces the quantum state |x⟩ ∝ A^(-1)|b⟩. Reading all N entries would require O(N) measurements, destroying the exponential speedup. You can only efficiently extract specific properties like ⟨x|M|x⟩.',
          },
        ],
      },
    ],
  },

  // ── Lesson 3.10 ──
  {
    id: '3.10',
    title: 'Quantum Walks',
    description: 'The quantum analogue of random walks — faster spreading and algorithmic applications.',
    difficulty: 'advanced',
    estimatedMinutes: 20,
    prerequisites: ['3.4'],
    tags: ['quantum-walks', 'coin-operator', 'shift-operator', 'graph-algorithms'],
    diracContext: 'Quantum walks are less familiar than Grover/Shor but equally important for graph algorithms and spatial search. The key insight: a classical random walk spreads as √t (standard deviation after t steps), while a quantum walk spreads as t (linearly). This is because quantum amplitudes interfere constructively at the leading edge. Use the 1D walk on a line as the main example. The "coin" qubit decides left/right, the "position" register tracks location.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Walking Quantumly

A **classical random walk** on a line: flip a coin, go left or right. After t steps, your average distance from the origin is **√t**.

A **quantum walk** replaces the coin flip with a quantum operation. After t steps, the walker spreads to distance **t** — quadratically faster!

### Two Components

1. **Coin operator** — A unitary on the "coin" qubit (like Hadamard)
2. **Shift operator** — Moves the walker left or right based on the coin state

Each step: apply coin → apply shift → repeat.

### Why It Matters

Quantum walks power:
- **Spatial search** — finding a marked node on a graph in O(√N) steps
- **Element distinctness** — finding duplicates in O(N^(2/3)) queries
- **Graph isomorphism** heuristics`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# 1D Quantum Walk on a line: 4 steps
# 1 coin qubit + 4 position qubits (16 positions, centered)
n_pos = 4
qc = QuantumCircuit(1 + n_pos, n_pos)

# Start at position 1000 (center of the line)
qc.x(1 + 3)

# Quantum walk: 4 steps of (coin, shift)
for step in range(4):
    # Coin: Hadamard on coin qubit
    qc.h(0)

    # Conditional shift right: if coin = |1⟩, increment position
    # Increment is a series of controlled operations
    for i in range(n_pos - 1, 0, -1):
        controls = [0] + list(range(1, i + 1))
        target = i + 1
        if len(controls) == 2:
            qc.ccx(controls[0], controls[1], target)
        elif len(controls) == 1:
            qc.cx(controls[0], target)

    # Flip coin meaning
    qc.x(0)

    # Conditional shift left: if coin = |0⟩ (now flipped to |1⟩), decrement
    for i in range(n_pos - 1, 0, -1):
        controls = [0] + list(range(1, i + 1))
        target = i + 1
        if len(controls) == 2:
            qc.ccx(controls[0], controls[1], target)
        elif len(controls) == 1:
            qc.cx(controls[0], target)

    # Unflip coin
    qc.x(0)

# Measure position
qc.measure(range(1, n_pos + 1), range(n_pos))`,
        framework: 'qiskit',
        description: 'A 4-step quantum walk starting from the center of a 16-position line. The probability distribution shows the characteristic "two-peaked" quantum walk pattern.',
        explorationPrompt: 'Unlike a classical random walk which gives a bell curve centered at the origin, a quantum walk produces two peaks at the edges of the distribution — the walker spreads much faster due to constructive interference at the leading wavefront.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# Compare: Classical-like walk (measure coin each step)
# vs quantum walk (coherent coin)

# "Classical" version: add a barrier and measure coin between steps
n_pos = 3
qc_classical = QuantumCircuit(1 + n_pos, n_pos)

# Start at position 100 (center)
qc_classical.x(1 + 2)

# 2 steps with decoherence (H then measure-like effect via reset)
for step in range(2):
    qc_classical.h(0)
    # Shift right if coin = 1
    qc_classical.ccx(0, 1, 2)
    qc_classical.cx(0, 1)
    qc_classical.x(0)
    # Shift left if coin = 0
    qc_classical.ccx(0, 1, 2)
    qc_classical.cx(0, 1)
    qc_classical.x(0)
    # "Decohere" the coin by resetting
    qc_classical.reset(0)

qc_classical.measure(range(1, n_pos + 1), range(n_pos))`,
        framework: 'qiskit',
        description: 'A walk where the coin is reset each step (mimicking classical randomness). Compare the resulting distribution with the coherent quantum walk above.',
        explorationPrompt: 'When we reset the coin between steps, we destroy quantum coherence and get a classical binomial distribution. The quantum walk keeps the coin coherent, allowing interference effects that speed up spreading.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '3.10-q1',
            question: 'After t steps, how far does a quantum walker spread compared to a classical random walker?',
            options: ['Same distance (√t)', 'Linearly (t) vs classically (√t)', 'Exponentially (2^t) vs classically (t)', 'Logarithmically (log t) vs classically (√t)'],
            correctIndex: 1,
            explanation: 'A quantum walk spreads linearly with t, while a classical random walk spreads as √t. This quadratic speedup is the basis for quantum walk algorithms.',
          },
          {
            id: '3.10-q2',
            question: 'What are the two operators in a discrete quantum walk?',
            options: ['Oracle and diffuser', 'Coin and shift', 'Phase and amplitude', 'Create and annihilate'],
            correctIndex: 1,
            explanation: 'A discrete quantum walk uses a coin operator (like Hadamard) to create superposition of directions and a shift operator to move the walker based on the coin state.',
          },
        ],
      },
    ],
  },

  // ── Lesson 3.11 ──
  {
    id: '3.11',
    title: 'VQE — Variational Quantum Eigensolver',
    description: 'Hybrid quantum-classical optimization for finding ground state energies.',
    difficulty: 'advanced',
    estimatedMinutes: 30,
    prerequisites: ['3.4'],
    tags: ['vqe', 'variational', 'hybrid', 'ansatz', 'optimization', 'hamiltonian'],
    diracContext: 'VQE is the most practically relevant near-term algorithm. The student should understand: (1) the variational principle — the ground state energy is the minimum of ⟨ψ|H|ψ⟩, (2) the ansatz is a parameterized circuit whose parameters are optimized classically, (3) the quantum computer measures ⟨H⟩ for a given set of parameters, the classical optimizer updates parameters, repeat. Emphasize that VQE works on NOISY hardware — no error correction needed. If the student asks about chemistry, explain that H represents a molecular Hamiltonian.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Near-Term Quantum Algorithm

Most quantum algorithms require fault-tolerant hardware that doesn't exist yet. **VQE** is designed for **today's noisy quantum computers** (NISQ era).

### The Variational Principle

For any quantum state |ψ⟩: **⟨ψ|H|ψ⟩ ≥ E₀** (the ground state energy)

So if we can minimize ⟨ψ|H|ψ⟩ over a family of states, we find (an approximation to) E₀.

### The VQE Loop

1. Choose an **ansatz** — a parameterized quantum circuit U(θ)
2. Prepare |ψ(θ)⟩ = U(θ)|0⟩ on the quantum computer
3. Measure ⟨H⟩ = ⟨ψ(θ)|H|ψ(θ)⟩
4. Send the energy to a **classical optimizer**
5. Optimizer updates θ
6. Repeat until convergence

The quantum computer handles step 2-3 (state prep + measurement). The classical computer handles step 4-5 (optimization).`,
      },
      {
        type: 'concept-card',
        title: 'Ansatz Design',
        visual: 'circuit',
        explanation: 'The ansatz is a parameterized circuit with rotation gates (Ry, Rz) and entangling gates (CNOT). The parameters are angles that the classical optimizer tunes. A good ansatz should: (1) be expressive enough to represent the ground state, (2) be shallow enough for noisy hardware, (3) have a smooth energy landscape for the optimizer.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import SparsePauliOp
import numpy as np

# VQE for H = Z (single-qubit Hamiltonian)
# Ground state: |1⟩ with energy -1

# Ansatz: single Ry rotation
def build_ansatz(theta):
    qc = QuantumCircuit(1)
    qc.ry(theta, 0)
    return qc

# The ground state of Z is |1⟩, reached when theta = pi
# Let's show the ansatz at the optimal angle
optimal_theta = np.pi
qc = build_ansatz(optimal_theta)
qc.measure_all()`,
        framework: 'qiskit',
        description: 'Simple VQE ansatz for H = Z. At theta = pi, the circuit produces |1⟩ which is the ground state with energy E₀ = -1.',
        explorationPrompt: 'Try different theta values: theta=0 gives |0⟩ (energy +1), theta=pi/2 gives |+⟩ (energy 0), theta=pi gives |1⟩ (energy -1). The optimizer would discover theta=pi minimizes the energy.',
      },
      {
        type: 'exercise',
        id: '3.11-ex1',
        title: 'VQE Ansatz for ZZ + 0.5(XI + IX)',
        description: 'Build a 2-qubit VQE ansatz for H = Z\u2297Z + 0.5*(X\u2297I + I\u2297X). The ground state energy is approximately -1.118. Create an ansatz with Ry rotations on both qubits followed by a CNOT and another layer of Ry. Use the provided optimal parameters.',
        starterCode: `from qiskit import QuantumCircuit
import numpy as np

# H = ZZ + 0.5*(XI + IX)
# Ground state energy ≈ -1.118

# Optimal parameters (found by classical optimizer)
theta = [np.pi * 0.785, np.pi * 0.785, np.pi * 0.25, np.pi * 0.25]

qc = QuantumCircuit(2, 2)

# TODO: Layer 1 — Ry rotations
# qc.ry(theta[0], 0)
# qc.ry(theta[1], 1)

# TODO: Entangling layer — CNOT
# qc.cx(0, 1)

# TODO: Layer 2 — Ry rotations
# qc.ry(theta[2], 0)
# qc.ry(theta[3], 1)

# Measure
qc.measure([0, 1], [0, 1])`,
        framework: 'qiskit',
        expectedProbabilities: { '00': 0.25, '01': 0.25, '10': 0.25, '11': 0.25 },
        tolerancePercent: 15,
        hints: [
          'Uncomment the Ry gates and CNOT to build the two-layer ansatz.',
          'The ansatz structure is: Ry-Ry-CNOT-Ry-Ry. This is a standard "hardware-efficient" ansatz.',
          'With the given parameters, the circuit produces a state that approximates the ground state of the Hamiltonian.',
        ],
        successMessage: 'You built a variational ansatz! In a full VQE run, the classical optimizer would try thousands of different theta values, measuring ⟨H⟩ each time, to find the parameters that minimize the energy. This hybrid approach is the most promising path for near-term quantum advantage.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '3.11-q1',
            question: 'Why is VQE suitable for noisy quantum hardware?',
            options: [
              'It uses error correction',
              'It only needs short circuits and uses classical optimization for the hard part',
              'It does not use entanglement',
              'It runs entirely on classical hardware',
            ],
            correctIndex: 1,
            explanation: 'VQE uses shallow parameterized circuits (less noise accumulation) and offloads optimization to a classical computer. The quantum computer only needs to prepare states and measure expectation values — tasks that are feasible on NISQ hardware.',
          },
          {
            id: '3.11-q2',
            question: 'What does the classical optimizer update in each VQE iteration?',
            options: ['The Hamiltonian', 'The number of qubits', 'The parameters θ of the ansatz circuit', 'The measurement basis'],
            correctIndex: 2,
            explanation: 'The optimizer adjusts the rotation angles θ in the ansatz to minimize the measured energy ⟨ψ(θ)|H|ψ(θ)⟩.',
          },
        ],
      },
    ],
  },

  // ── Lesson 3.12 ──
  {
    id: '3.12',
    title: 'QAOA — Quantum Approximate Optimization',
    description: 'From MaxCut to general combinatorial optimization with quantum circuits.',
    difficulty: 'advanced',
    estimatedMinutes: 30,
    prerequisites: ['3.11'],
    tags: ['qaoa', 'optimization', 'maxcut', 'combinatorial', 'hybrid', 'variational'],
    diracContext: 'QAOA is VQE applied to combinatorial optimization. The student should understand: (1) the problem Hamiltonian encodes the cost function (e.g., MaxCut), (2) the mixer Hamiltonian drives transitions between solutions, (3) alternating layers of cost and mixer unitaries create a parameterized circuit, (4) the depth p controls the approximation quality. Use the MaxCut triangle example — it is small enough to visualize all solutions. If the student asks about performance guarantees, mention that p=1 QAOA achieves a known approximation ratio for MaxCut.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Quantum Optimization

**QAOA** (Quantum Approximate Optimization Algorithm) tackles combinatorial optimization problems like MaxCut, traveling salesman, and graph coloring.

### MaxCut Problem

Given a graph, divide vertices into two groups to maximize edges between groups.

### QAOA Structure

1. **Cost layer** — Apply e^(-iγC) where C encodes the problem (ZZ interactions for edges)
2. **Mixer layer** — Apply e^(-iβB) where B = sum of X operators (drives exploration)
3. Repeat p times with different (γ, β) parameters
4. Measure and evaluate the cost
5. Classical optimizer updates (γ, β)

More layers (higher p) → better approximation, but deeper circuit.`,
      },
      {
        type: 'concept-card',
        title: 'QAOA Circuit Structure',
        visual: 'circuit',
        explanation: 'Start with |+⟩^n (Hadamard on all qubits). Then alternate p rounds of: (1) Cost unitary — for each edge (i,j) in the graph, apply RZZ(γ) = e^(-iγZ_iZ_j), (2) Mixer unitary — apply Rx(2β) on every qubit. The parameters {γ_1,...,γ_p, β_1,...,β_p} are optimized classically.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
import numpy as np

# QAOA for MaxCut on a triangle (3 nodes, 3 edges)
# Edges: (0,1), (1,2), (0,2)
# Optimal cut: any partition with 1 vs 2 nodes → cuts 2 edges

# Parameters (pre-optimized for p=1)
gamma = 0.59
beta = 0.39

qc = QuantumCircuit(3, 3)

# Initial state: |+++⟩
for i in range(3):
    qc.h(i)

# Cost layer: RZZ(gamma) for each edge
# RZZ(gamma) = CNOT - Rz(2*gamma) - CNOT
edges = [(0, 1), (1, 2), (0, 2)]
for i, j in edges:
    qc.cx(i, j)
    qc.rz(2 * gamma, j)
    qc.cx(i, j)

# Mixer layer: Rx(2*beta) on each qubit
for i in range(3):
    qc.rx(2 * beta, i)

# Measure
qc.measure(range(3), range(3))`,
        framework: 'qiskit',
        description: 'QAOA (p=1) for MaxCut on a triangle. The optimal cuts are 001, 010, 011, 100, 101, 110 — any partition cutting 2 edges.',
        explorationPrompt: 'Try different gamma and beta values. At gamma=0, beta=0 you get uniform random (all outcomes equally likely). The optimized parameters push probability toward the optimal cuts. Try gamma=pi/4, beta=pi/8 as another starting point.',
      },
      {
        type: 'exercise',
        id: '3.12-ex1',
        title: 'QAOA for a 4-node path graph',
        description: 'Implement QAOA (p=1) for MaxCut on a 4-node path graph with edges (0,1), (1,2), (2,3). The maximum cut has 2 edges cut (alternating partition: 0101 or 1010). Use gamma=0.59 and beta=0.39.',
        starterCode: `from qiskit import QuantumCircuit
import numpy as np

# MaxCut on path graph: 0-1-2-3
# Edges: (0,1), (1,2), (2,3)
# Optimal: alternating partition cuts all 3 edges

gamma = 0.59
beta = 0.39

qc = QuantumCircuit(4, 4)

# TODO: Initial state |++++⟩

# TODO: Cost layer — RZZ(gamma) for each edge
# For each edge (i,j):
#   qc.cx(i, j)
#   qc.rz(2 * gamma, j)
#   qc.cx(i, j)

# TODO: Mixer layer — Rx(2*beta) on each qubit

# Measure
qc.measure(range(4), range(4))`,
        framework: 'qiskit',
        expectedProbabilities: { '0101': 0.15, '1010': 0.15 },
        tolerancePercent: 12,
        hints: [
          'Start with qc.h(i) for i in range(4) to create |++++⟩.',
          'The edges are (0,1), (1,2), (2,3). Apply the RZZ pattern for each edge.',
          'Mixer: qc.rx(2*beta, i) for i in range(4).',
        ],
        successMessage: 'Your QAOA circuit biases the output toward good cuts. With p=1 the bias is modest, but increasing p (more alternating layers with separate parameters) improves the approximation. QAOA is one of the leading candidates for near-term quantum advantage in optimization.',
      },
      {
        type: 'text',
        markdown: `## QAOA vs VQE — When to Use Which

| Aspect | VQE | QAOA |
|--------|-----|------|
| **Problem type** | Finding ground state of Hamiltonian | Combinatorial optimization |
| **Ansatz** | Hardware-efficient (Ry + CNOT layers) | Problem-inspired (cost + mixer layers) |
| **Parameters** | Rotation angles | γ (cost) and β (mixer) per layer |
| **Structure** | Flexible | Fixed alternating structure |
| **Typical use** | Quantum chemistry, materials | MaxCut, scheduling, routing |

Both are **variational hybrid algorithms** — the quantum computer prepares and measures states, the classical computer optimizes parameters.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '3.12-q1',
            question: 'What does the "cost layer" in QAOA encode?',
            options: [
              'The number of qubits',
              'The optimization problem (e.g., which edges to cut)',
              'The classical optimization algorithm',
              'The error correction scheme',
            ],
            correctIndex: 1,
            explanation: 'The cost layer applies e^(-iγC) where C is the cost Hamiltonian that encodes the optimization problem. For MaxCut, C uses ZZ interactions for each edge in the graph.',
          },
          {
            id: '3.12-q2',
            question: 'What happens as you increase the QAOA depth p?',
            options: [
              'The circuit gets shallower',
              'The approximation quality improves but the circuit gets deeper',
              'The number of qubits increases',
              'Nothing changes',
            ],
            correctIndex: 1,
            explanation: 'Higher p means more alternating cost-mixer layers with more parameters to optimize. This improves solution quality but requires deeper circuits (more prone to noise on real hardware).',
          },
        ],
      },
    ],
  },
];
