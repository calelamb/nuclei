import type { Lesson } from './types';

export const TRACK2_LESSONS: Lesson[] = [
  // ── Lesson 2.1 ──
  {
    id: '2.1',
    title: 'The Universal Gate Set',
    description:
      'Any quantum computation can be built from a small set of gates — learn which ones and why.',
    difficulty: 'beginner',
    estimatedMinutes: 15,
    prerequisites: ['1.2'],
    tags: ['universal-gates', 'gate-sets', 'decomposition', 'H', 'T', 'CNOT'],
    diracContext:
      'The student knows basic gates (H, X, CNOT) from Track 1. This lesson introduces the idea of universality — that a handful of gates can build ANY quantum computation. Use the analogy of NAND gates in classical computing. Keep it accessible; the student does not need to prove universality, just understand the concept and see it in action.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Building Blocks of Everything

In classical computing, a single gate — **NAND** — can build every possible computation. AND, OR, NOT, adders, entire CPUs — all from one gate.

Quantum computing has the same idea: a **universal gate set** is a small collection of gates that, combined, can approximate *any* quantum operation to arbitrary precision.

### Common Universal Sets

| Set | Gates | Notes |
|-----|-------|-------|
| Standard | {H, T, CNOT} | Most common in textbooks |
| Rotation | {Rx, Ry, CNOT} | Popular in variational circuits |
| Alternative | {H, Toffoli} | Uses a 3-qubit gate instead of T |

> **Key insight:** You don't need an infinite menu of gates. A finite set is enough to do *anything*.`,
      },
      {
        type: 'video',
        youtubeId: 'F2okky5vD8k',
        title: 'Universal Quantum Computation',
        creator: 'Michael Nielsen',
      },
      {
        type: 'concept-card',
        title: 'Why Universality Matters',
        visual: 'circuit',
        explanation:
          'Hardware only implements a few physical gate operations. Universality guarantees that this limited hardware can still run any quantum algorithm — the compiler decomposes complex gates into the native set.',
      },
      {
        type: 'text',
        markdown: `## Building Gates from Other Gates

The **Z gate** flips the phase of |1⟩. But you don't need Z as a primitive — you can build it from H and S gates:

\`\`\`
Z = H · S · S · H
\`\`\`

Or equivalently, since S\u00B2 = Z, a single Z can be replaced by applying S twice. Let's see a more instructive decomposition: building Z from H and X.

> **Z = H · X · H**
>
> This works because H transforms the Z-basis into the X-basis. Sandwiching X between two H gates converts a bit-flip into a phase-flip.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Operator
import numpy as np

# Direct Z gate
qc_z = QuantumCircuit(1)
qc_z.z(0)

# Z built from H and X
qc_decomposed = QuantumCircuit(1)
qc_decomposed.h(0)
qc_decomposed.x(0)
qc_decomposed.h(0)

# Verify they're the same unitary
op_z = Operator(qc_z)
op_decomposed = Operator(qc_decomposed)
print("Z gate matrix:")
print(np.round(op_z.data, 3))
print("\\nH·X·H matrix:")
print(np.round(op_decomposed.data, 3))
print("\\nAre they equal?", op_z.equiv(op_decomposed))`,
        framework: 'qiskit',
        description:
          'Build the Z gate from H and X gates, then verify the matrices match.',
        explorationPrompt:
          'Try replacing X with Z in the middle — what gate does H·Z·H produce? (Hint: it should be X!)',
      },
      {
        type: 'exercise',
        id: '2.1-ex1',
        title: 'Decompose S into universal gates',
        description:
          'The S gate applies a \u03C0/2 phase to |1\u27E9. Build a circuit that produces the same result as an S gate using only H and T gates. Remember: T applies a \u03C0/4 phase, so S = T\u00B7T.',
        starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)

# Build the equivalent of an S gate using H and T
# Hint: S = T applied twice
# TODO: Add your gates here

qc.h(0)
qc.measure(0, 0)`,
        framework: 'qiskit',
        expectedProbabilities: { '0': 0.5, '1': 0.5 },
        tolerancePercent: 5,
        hints: [
          'The S gate is equivalent to applying T twice: S = T\u00B7T.',
          'Start with H to create superposition, then apply your S-equivalent, then H again before measuring.',
          'Full solution: H, T, T, H, measure. The T\u00B7T in the middle acts as S, and H\u00B7S\u00B7H should flip the state.',
        ],
        successMessage:
          'You decomposed the S gate into T gates — the first step toward understanding how compilers break down complex operations.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '2.1-q1',
            question: 'What does "universal gate set" mean?',
            options: [
              'A set of gates that works on all quantum hardware',
              'A set of gates that can approximate any quantum computation',
              'A set of all possible quantum gates',
              'A gate that operates on all qubits simultaneously',
            ],
            correctIndex: 1,
            explanation:
              'A universal gate set can approximate any unitary operation to arbitrary precision through composition.',
          },
          {
            id: '2.1-q2',
            question: 'Which of these is a universal gate set?',
            options: [
              '{H, X, Z}',
              '{H, T, CNOT}',
              '{X, Y, Z}',
              '{CNOT, SWAP}',
            ],
            correctIndex: 1,
            explanation:
              '{H, T, CNOT} is universal. The single-qubit gates H and T can approximate any single-qubit rotation, and CNOT provides the entangling power needed for multi-qubit operations.',
          },
        ],
      },
    ],
  },

  // ── Lesson 2.2 ──
  {
    id: '2.2',
    title: 'Controlled Gates',
    description:
      'CX, CZ, Toffoli, Fredkin — gates that act only when a control qubit says so.',
    difficulty: 'beginner',
    estimatedMinutes: 20,
    prerequisites: ['1.5', '2.1'],
    tags: ['controlled-gates', 'CNOT', 'CZ', 'Toffoli', 'Fredkin', 'entanglement'],
    diracContext:
      'The student knows CNOT from Track 1 entanglement lessons. Now we generalize: any gate can be controlled, and multi-control gates like Toffoli are reversible classical logic. Use the "if-then" analogy for controlled gates. Emphasize that Toffoli = reversible AND, which is a bridge between classical and quantum.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Conditional Quantum Logic

A **controlled gate** acts on a target qubit *only* when the control qubit is |1\u27E9. If the control is |0\u27E9, nothing happens.

You already know **CNOT (CX)** — it flips the target when the control is |1\u27E9. But the idea generalizes to *any* gate:

| Gate | Control(s) | Target action | Use case |
|------|-----------|---------------|----------|
| CX (CNOT) | 1 qubit | X (bit flip) | Entanglement, error correction |
| CZ | 1 qubit | Z (phase flip) | Phase-based entanglement |
| CCX (Toffoli) | 2 qubits | X (bit flip) | Reversible AND gate |
| CSWAP (Fredkin) | 1 qubit | SWAP two targets | Controlled routing |

> **Toffoli is special:** it's a reversible AND gate. With ancilla qubits, you can build any classical Boolean circuit from Toffoli gates alone.`,
      },
      {
        type: 'video',
        youtubeId: 'rLF-oHaXLtE',
        title: 'The Controlled-NOT Gate',
        creator: 'Michael Nielsen',
      },
      {
        type: 'concept-card',
        title: 'The Toffoli Gate',
        visual: 'circuit',
        explanation:
          'The Toffoli gate (CCX) has two control qubits and one target. The target flips ONLY when BOTH controls are |1\u27E9. This makes it a reversible AND gate — classical logic embedded in a quantum circuit.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# Toffoli as a reversible AND gate
# Input: |110⟩ → both controls are 1, so target flips → |111⟩
qc = QuantumCircuit(3, 1)
qc.x(0)  # Set control 1 to |1⟩
qc.x(1)  # Set control 2 to |1⟩
# Target qubit 2 starts as |0⟩
qc.ccx(0, 1, 2)  # Toffoli: flip target if both controls are |1⟩
qc.measure(2, 0)  # Measure the target`,
        framework: 'qiskit',
        description:
          'Toffoli as AND: both controls are |1\u27E9, so the target flips to |1\u27E9. Change one control to |0\u27E9 and re-run.',
        explorationPrompt:
          'Remove one of the X gates (so only one control is |1\u27E9). The target should stay |0\u27E9 — just like AND(1, 0) = 0.',
      },
      {
        type: 'text',
        markdown: `## CZ — The Phase Entangler

CZ applies a Z gate to the target when the control is |1\u27E9. Unlike CNOT, CZ is **symmetric** — it doesn't matter which qubit you call "control" and which you call "target."

\`\`\`
CZ|11⟩ = -|11⟩    (phase flip only when both qubits are |1⟩)
CZ|10⟩ =  |10⟩    (no change)
CZ|01⟩ =  |01⟩    (no change)
CZ|00⟩ =  |00⟩    (no change)
\`\`\`

This symmetry makes CZ very useful in algorithms like Grover's search.`,
      },
      {
        type: 'exercise',
        id: '2.2-ex1',
        title: 'Build a Toffoli truth table',
        description:
          'Create a circuit that demonstrates the Toffoli gate acting as an AND gate. Set the inputs to |1\u27E9 and |1\u27E9, apply the Toffoli, and measure the output qubit.',
        starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(3, 1)

# Set both control qubits to |1⟩
# TODO: Activate control qubit 0
# TODO: Activate control qubit 1

# TODO: Apply the Toffoli gate (ccx) with controls 0,1 and target 2

# Measure the target qubit
qc.measure(2, 0)`,
        framework: 'qiskit',
        expectedProbabilities: { '1': 1.0 },
        tolerancePercent: 3,
        hints: [
          'Use qc.x(0) and qc.x(1) to set the control qubits to |1\u27E9.',
          'The Toffoli gate is qc.ccx(control1, control2, target).',
          'Since both controls are |1\u27E9, the target should flip from |0\u27E9 to |1\u27E9.',
        ],
        successMessage:
          'AND(1, 1) = 1 — the Toffoli gate is a reversible classical AND. You can build entire classical computers from Toffoli gates!',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '2.2-q1',
            question: 'What does the Toffoli (CCX) gate do?',
            options: [
              'Flips the target when either control is |1\u27E9',
              'Flips the target when both controls are |1\u27E9',
              'Flips both controls when the target is |1\u27E9',
              'Swaps the two control qubits',
            ],
            correctIndex: 1,
            explanation:
              'The Toffoli gate flips the target qubit only when BOTH control qubits are |1\u27E9 — it\'s a controlled-controlled-NOT.',
          },
          {
            id: '2.2-q2',
            question: 'What is special about the CZ gate compared to CX?',
            options: [
              'CZ is faster',
              'CZ is symmetric — control and target are interchangeable',
              'CZ doesn\'t require a control qubit',
              'CZ works on 3 qubits',
            ],
            correctIndex: 1,
            explanation:
              'CZ is symmetric: it doesn\'t matter which qubit is "control" and which is "target." The phase flip on |11\u27E9 affects both qubits equally.',
          },
        ],
      },
    ],
  },

  // ── Lesson 2.3 ──
  {
    id: '2.3',
    title: 'Gate Decomposition',
    description:
      'Break complex multi-qubit gates into simpler primitives — the art of quantum compilation.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['2.1', '2.2'],
    tags: ['decomposition', 'SWAP', 'CZ', 'compilation', 'circuit-identity'],
    diracContext:
      'The student now understands controlled gates and universality. This lesson teaches them to think like a quantum compiler — breaking complex operations into simpler ones. Emphasize that real hardware has a limited gate set, so decomposition is essential. Use circuit diagrams and matrix equivalence to build intuition.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Thinking Like a Quantum Compiler

Real quantum hardware can only perform a few gates natively (e.g., Rx, Ry, Rz, and CX on IBM hardware). Every other operation must be **decomposed** into these primitives.

### Key Decompositions

| Complex Gate | Decomposition | Gate Count |
|-------------|---------------|------------|
| SWAP | 3 CNOTs | CX \u2192 CX \u2192 CX |
| CZ | H on target + CNOT + H on target | 1 CX + 2 H |
| Toffoli | 6 CNOTs + single-qubit gates | ~15 gates total |

> **Why this matters:** A SWAP looks like one operation, but on hardware it costs 3 entangling gates. Circuit optimization is about reducing these costly operations.`,
      },
      {
        type: 'video',
        youtubeId: 'placeholder',
        title: 'Quantum Circuit Decomposition',
        creator: 'Qiskit',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Operator
import numpy as np

# SWAP gate (built-in)
qc_swap = QuantumCircuit(2)
qc_swap.swap(0, 1)

# SWAP from 3 CNOTs
qc_decomposed = QuantumCircuit(2)
qc_decomposed.cx(0, 1)
qc_decomposed.cx(1, 0)
qc_decomposed.cx(0, 1)

print("SWAP matrix:")
print(np.round(Operator(qc_swap).data, 3))
print("\\n3-CNOT decomposition:")
print(np.round(Operator(qc_decomposed).data, 3))
print("\\nEquivalent?", Operator(qc_swap).equiv(qc_decomposed))`,
        framework: 'qiskit',
        description:
          'SWAP = 3 CNOTs. Verify by comparing the unitary matrices.',
        explorationPrompt:
          'Try removing one of the CNOT gates — the matrices will no longer match. Each CNOT is essential.',
      },
      {
        type: 'text',
        markdown: `## CZ from CNOT

The CZ gate can be built from a single CNOT sandwiched by Hadamards on the target:

\`\`\`
CZ = (I \u2297 H) \u00B7 CNOT \u00B7 (I \u2297 H)
\`\`\`

This is one of the most important circuit identities in quantum computing. It lets you convert between phase-based and bit-flip-based entanglement.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Operator
import numpy as np

# CZ gate (built-in)
qc_cz = QuantumCircuit(2)
qc_cz.cz(0, 1)

# CZ from CNOT + Hadamards
qc_decomposed = QuantumCircuit(2)
qc_decomposed.h(1)       # H on target before
qc_decomposed.cx(0, 1)   # CNOT
qc_decomposed.h(1)       # H on target after

print("CZ matrix:")
print(np.round(Operator(qc_cz).data, 3))
print("\\nH-CNOT-H decomposition:")
print(np.round(Operator(qc_decomposed).data, 3))
print("\\nEquivalent?", Operator(qc_cz).equiv(qc_decomposed))`,
        framework: 'qiskit',
        description:
          'CZ = H on target, then CNOT, then H on target. A single entangling gate plus two cheap single-qubit gates.',
      },
      {
        type: 'exercise',
        id: '2.3-ex1',
        title: 'Decompose SWAP into CNOTs',
        description:
          'Build a circuit that swaps two qubits using only CNOT gates. Initialize qubit 0 to |1\u27E9, leave qubit 1 as |0\u27E9, apply your SWAP decomposition, then measure both. If your SWAP works, qubit 0 should measure |0\u27E9 and qubit 1 should measure |1\u27E9.',
        starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)

# Put qubit 0 in |1⟩ (so we can verify the swap)
qc.x(0)

# TODO: Decompose SWAP using 3 CNOT gates
# Hint: CX(0,1), CX(1,0), CX(0,1)

qc.measure([0, 1], [0, 1])`,
        framework: 'qiskit',
        expectedProbabilities: { '10': 1.0 },
        tolerancePercent: 3,
        hints: [
          'SWAP requires exactly 3 CNOT gates.',
          'The pattern is: CX(a,b), CX(b,a), CX(a,b).',
          'After the swap, qubit 0 (which started as |1\u27E9) should now be |0\u27E9, and qubit 1 should be |1\u27E9. In Qiskit bit ordering, this reads as "10".',
        ],
        successMessage:
          'SWAP decomposed! On real hardware, every SWAP costs 3 entangling gates — now you see why quantum compilers work so hard to minimize them.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '2.3-q1',
            question: 'How many CNOT gates are needed to implement a SWAP?',
            options: ['1', '2', '3', '4'],
            correctIndex: 2,
            explanation:
              'SWAP requires exactly 3 CNOTs: CX(0,1), CX(1,0), CX(0,1). This is optimal — it cannot be done with fewer.',
          },
          {
            id: '2.3-q2',
            question: 'Why is gate decomposition important for real quantum hardware?',
            options: [
              'It makes circuits look simpler',
              'Hardware can only execute a limited set of native gates',
              'It reduces the number of qubits needed',
              'It eliminates quantum errors entirely',
            ],
            correctIndex: 1,
            explanation:
              'Real quantum processors have a small native gate set (e.g., {Rz, SX, CX} on IBM). All other gates must be decomposed into these primitives before execution.',
          },
        ],
      },
    ],
  },

  // ── Lesson 2.4 ──
  {
    id: '2.4',
    title: 'Quantum Fourier Transform (QFT)',
    description:
      'The quantum analog of the Fast Fourier Transform — exponentially faster, and the engine behind Shor\'s algorithm.',
    difficulty: 'intermediate',
    estimatedMinutes: 30,
    prerequisites: ['2.3'],
    tags: ['QFT', 'Fourier', 'phase', 'controlled-rotation', 'Shor'],
    diracContext:
      'This is a challenging lesson. The student does NOT need to understand classical FFT to appreciate QFT. Focus on what QFT does (converts computational basis states to phase-encoded states) rather than the full mathematical derivation. Use the "clock" analogy: QFT distributes amplitudes evenly but encodes information in the angles of the clock hands (phases). Build up from 1-qubit to 3-qubit step by step.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Quantum Fourier Transform

The **QFT** is the quantum version of the discrete Fourier transform. While the classical FFT takes O(n log n) operations, the QFT operates on n qubits in O(n\u00B2) gates — an exponential speedup since n qubits represent 2\u207F values.

### What does QFT actually do?

It converts **computational basis states** into **phase-encoded states**:

\`\`\`
|j⟩ → (1/√N) Σₖ e^(2πijk/N) |k⟩
\`\`\`

> **Intuition:** Think of N clocks arranged in a circle. QFT takes a single "position" and spreads it evenly across all clocks, but each clock's hand points in a slightly different direction. The information is encoded in the *angles* (phases), not the positions.

### QFT Circuit Structure

For n qubits, the QFT circuit follows a regular pattern:
1. Apply H to the first qubit
2. Apply controlled-R2, R3, ... Rn rotations from the remaining qubits
3. Repeat for the next qubit (with fewer rotations each time)
4. SWAP the qubit order at the end`,
      },
      {
        type: 'video',
        youtubeId: 'spUNpyF58BY',
        title: 'But What is the Fourier Transform?',
        creator: '3Blue1Brown',
      },
      {
        type: 'concept-card',
        title: 'QFT Circuit Pattern',
        visual: 'circuit',
        explanation:
          'The QFT on n qubits uses Hadamard gates and controlled phase rotations (CP). Each qubit gets an H gate followed by increasingly fine controlled rotations from later qubits. The circuit has a triangular structure — the first qubit interacts with all others, the second with all but the first, and so on.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.circuit.library import QFT
import numpy as np

# Qiskit's built-in 3-qubit QFT
qft_builtin = QFT(3)
print("Built-in QFT circuit:")
print(qft_builtin.decompose().draw())

# Now build it manually
qc = QuantumCircuit(3)

# Qubit 0: H + controlled rotations from qubits 1 and 2
qc.h(0)
qc.cp(np.pi / 2, 1, 0)   # Controlled-R2 (π/2 phase)
qc.cp(np.pi / 4, 2, 0)   # Controlled-R3 (π/4 phase)

# Qubit 1: H + controlled rotation from qubit 2
qc.h(1)
qc.cp(np.pi / 2, 2, 1)   # Controlled-R2

# Qubit 2: just H
qc.h(2)

# Swap to get correct output order
qc.swap(0, 2)

print("\\nManual QFT circuit:")
print(qc.draw())`,
        framework: 'qiskit',
        description:
          'Compare Qiskit\'s built-in QFT with a hand-built version. Notice the triangular pattern of H gates and controlled phase rotations.',
        explorationPrompt:
          'Count the gates: for 3 qubits, there are 3 H gates and 3 controlled phase gates. For n qubits, the pattern grows as n(n-1)/2 controlled rotations — still polynomial!',
      },
      {
        type: 'text',
        markdown: `## 2-Qubit QFT Step by Step

Let's trace the simplest non-trivial QFT (2 qubits) on input |10\u27E9:

1. **Start:** |10\u27E9
2. **H on qubit 0:** Creates superposition on qubit 0, conditioned on its input value
3. **Controlled-R2(qubit 1 \u2192 qubit 0):** Adds a \u03C0/2 phase rotation
4. **H on qubit 1:** Creates superposition on qubit 1
5. **SWAP:** Reverses the qubit order

The output encodes the frequency "2" (binary "10") as phase angles across all four basis states.`,
      },
      {
        type: 'exercise',
        id: '2.4-ex1',
        title: 'Build a 2-qubit QFT from scratch',
        description:
          'Implement the 2-qubit Quantum Fourier Transform manually. Apply it to the |0\u27E9 state and measure. Since QFT(|00\u27E9) produces an equal superposition with no relative phases, you should see roughly uniform measurement outcomes across all 4 basis states.',
        starterCode: `from qiskit import QuantumCircuit
import numpy as np

qc = QuantumCircuit(2, 2)

# Step 1: H on qubit 0
# TODO

# Step 2: Controlled-R2 (π/2 phase) from qubit 1 to qubit 0
# Hint: use qc.cp(np.pi / 2, control, target)
# TODO

# Step 3: H on qubit 1
# TODO

# Step 4: SWAP qubits (to get the correct output order)
# TODO

qc.measure([0, 1], [0, 1])`,
        framework: 'qiskit',
        expectedProbabilities: { '00': 0.25, '01': 0.25, '10': 0.25, '11': 0.25 },
        tolerancePercent: 6,
        hints: [
          'Follow the pattern: H(0), CP(\u03C0/2, 1, 0), H(1), SWAP(0, 1).',
          'The controlled phase gate is qc.cp(angle, control_qubit, target_qubit).',
          'QFT of |00\u27E9 produces equal superposition — all 4 outcomes should be ~25%.',
        ],
        successMessage:
          'You built the QFT by hand! This transform is the core of Shor\'s factoring algorithm and quantum phase estimation.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '2.4-q1',
            question: 'What is the gate complexity of QFT on n qubits?',
            options: ['O(n)', 'O(n\u00B2)', 'O(2\u207F)', 'O(n log n)'],
            correctIndex: 1,
            explanation:
              'QFT uses O(n\u00B2) gates: for each qubit, there is one H and up to n-1 controlled rotations, giving n + n(n-1)/2 gates total.',
          },
          {
            id: '2.4-q2',
            question:
              'What does the QFT encode information into?',
            options: [
              'The amplitudes of basis states',
              'The phases (angles) of basis states',
              'The number of qubits',
              'The measurement outcomes',
            ],
            correctIndex: 1,
            explanation:
              'QFT converts computational basis information into phase information. All amplitudes become equal in magnitude — the information is carried by the relative phases between basis states.',
          },
          {
            id: '2.4-q3',
            question:
              'Which famous quantum algorithm relies on the QFT?',
            options: [
              'Grover\'s search',
              'Deutsch-Jozsa',
              'Shor\'s factoring algorithm',
              'Quantum teleportation',
            ],
            correctIndex: 2,
            explanation:
              'Shor\'s algorithm uses QFT (technically, the inverse QFT) to extract the period of a modular exponentiation function, which leads to efficient factoring.',
          },
        ],
      },
    ],
  },

  // ── Lesson 2.5 ──
  {
    id: '2.5',
    title: 'Phase Kickback',
    description:
      'The most important trick in quantum computing — when the control qubit absorbs a phase from the target.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['2.2', '1.6'],
    tags: ['phase-kickback', 'eigenvalue', 'phase', 'controlled-gates'],
    diracContext:
      'Phase kickback is subtle but crucial — it underpins Deutsch-Jozsa, Grover\'s, QPE, and Shor\'s. The student should understand the mechanism: when the target is an eigenstate, the eigenvalue "kicks back" onto the control. Use the Bloch sphere to show the phase change on the control qubit. Don\'t rush the math — walk through one concrete example thoroughly.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Most Important Trick You'll Learn

**Phase kickback** is when a controlled gate deposits a phase on the *control* qubit instead of (or in addition to) changing the *target*.

### How it works

When the target qubit is an **eigenstate** of the gate being controlled, the gate can't change the target (by definition — eigenstates are fixed points). Instead, the eigenvalue appears as a phase on the control qubit.

> **Setup:** Control in |+\u27E9, target in eigenstate |u\u27E9 of gate U
>
> **Before:** (|0\u27E9 + |1\u27E9)|u\u27E9 / \u221A2
>
> **After CU:** (|0\u27E9 + e^{i\u03B8}|1\u27E9)|u\u27E9 / \u221A2
>
> The target is unchanged! The phase e^{i\u03B8} appeared on the control.

This is the engine behind **quantum phase estimation**, **Deutsch-Jozsa**, and **Grover's algorithm**.`,
      },
      {
        type: 'video',
        youtubeId: 'placeholder',
        title: 'Phase Kickback — The Key to Quantum Algorithms',
        creator: 'Qiskit',
      },
      {
        type: 'concept-card',
        title: 'Phase Kickback Mechanism',
        visual: 'bloch',
        explanation:
          'The control qubit starts at |+\u27E9 (equator of the Bloch sphere, pointing along +X). After phase kickback, it rotates around the Z-axis by the eigenvalue angle. For a CZ gate with target |1\u27E9, the control rotates by \u03C0 — going from |+\u27E9 to |-\u27E9.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# Phase kickback with CZ
# Target qubit 1 is |1⟩ (eigenstate of Z with eigenvalue -1)
# Control qubit 0 is |+⟩
qc = QuantumCircuit(2, 1)

qc.h(0)     # Control → |+⟩
qc.x(1)     # Target → |1⟩ (eigenstate of Z)
qc.cz(0, 1) # Phase kickback: -1 kicks onto control
qc.h(0)     # Convert phase to measurable bit
qc.measure(0, 0)

# Control should measure |1⟩ — the phase flip
# turned |+⟩ into |−⟩, and H converts |−⟩ to |1⟩`,
        framework: 'qiskit',
        description:
          'CZ kicks a \u03C0 phase onto the control qubit. H converts this phase difference into a measurable bit flip.',
        explorationPrompt:
          'Try removing qc.x(1) so the target stays |0\u27E9. Now |0\u27E9 is an eigenstate of Z with eigenvalue +1, so no phase is kicked back — the control should measure |0\u27E9.',
      },
      {
        type: 'interactive-bloch',
        initialTheta: Math.PI / 2,
        initialPhi: 0,
        availableGates: ['H', 'Z', 'S', 'T'],
        challenge: {
          targetTheta: Math.PI / 2,
          targetPhi: Math.PI,
          description:
            'Start at |+\u27E9 (equator, \u03C6=0). Apply a Z gate to rotate to |-\u27E9 (\u03C6=\u03C0). This is exactly what phase kickback does to the control qubit when the eigenvalue is -1.',
        },
      },
      {
        type: 'exercise',
        id: '2.5-ex1',
        title: 'Detect an eigenvalue via phase kickback',
        description:
          'Use phase kickback to determine whether the target qubit is in the +1 or -1 eigenstate of Z. Prepare the target in |1\u27E9 (eigenvalue -1), use a controlled-Z with the control in |+\u27E9, then measure the control. The control qubit reveals the eigenvalue.',
        starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 1)

# Prepare control in |+⟩
# TODO: Apply H to qubit 0

# Prepare target in |1⟩ (eigenstate of Z with eigenvalue -1)
# TODO: Apply X to qubit 1

# Apply controlled-Z for phase kickback
# TODO: Apply CZ between qubit 0 (control) and qubit 1 (target)

# Convert phase to amplitude on control
# TODO: Apply H to qubit 0

# Measure the control qubit
qc.measure(0, 0)`,
        framework: 'qiskit',
        expectedProbabilities: { '1': 1.0 },
        tolerancePercent: 3,
        hints: [
          'The control goes into |+\u27E9 with H, the target goes to |1\u27E9 with X.',
          'CZ applies a \u03C0 phase when both qubits are |1\u27E9 — this kicks the -1 eigenvalue onto the control.',
          'The final H on the control converts |+\u27E9\u2192|0\u27E9 or |-\u27E9\u2192|1\u27E9. Since the phase kickback turned |+\u27E9 into |-\u27E9, you should measure |1\u27E9.',
        ],
        successMessage:
          'You just performed quantum phase estimation at its simplest! The control qubit detected the eigenvalue (-1) of the Z gate on the target. This exact technique scales up to estimate arbitrary eigenvalues.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '2.5-q1',
            question:
              'In phase kickback, what happens to the target qubit?',
            options: [
              'It gets flipped',
              'It gains a phase',
              'Nothing — it stays in its eigenstate',
              'It becomes entangled with the control',
            ],
            correctIndex: 2,
            explanation:
              'The target is an eigenstate of the controlled gate, so it is unchanged by the operation. The eigenvalue phase instead appears on the control qubit.',
          },
          {
            id: '2.5-q2',
            question:
              'Which of these algorithms does NOT use phase kickback?',
            options: [
              'Deutsch-Jozsa',
              'Grover\'s search',
              'Quantum teleportation',
              'Quantum phase estimation',
            ],
            correctIndex: 2,
            explanation:
              'Quantum teleportation uses entanglement and classical communication but does not rely on phase kickback. The other three all depend on it.',
          },
        ],
      },
    ],
  },

  // ── Lesson 2.6 ──
  {
    id: '2.6',
    title: 'Parameterized Circuits & Variational Forms',
    description:
      'Rotation gates with tunable angles — the foundation of variational quantum algorithms and quantum machine learning.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['2.1', '1.4'],
    tags: ['parameterized', 'rotation', 'Rx', 'Ry', 'Rz', 'variational', 'VQE'],
    diracContext:
      'The student knows individual gates but hasn\'t seen parameterized circuits yet. This lesson bridges the gap to variational algorithms (VQE, QAOA). Emphasize the "knobs" analogy: parameterized gates are like knobs on an amplifier — classical optimization turns the knobs to find the best quantum state. Use the interactive Bloch sphere heavily to build rotation intuition.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Gates with Knobs

So far, most gates you've used are fixed: H always does the same thing, X always flips. But **rotation gates** take an angle parameter \u03B8:

| Gate | Rotation axis | Matrix |
|------|--------------|--------|
| Rx(\u03B8) | X-axis | Rotates around X by \u03B8 |
| Ry(\u03B8) | Y-axis | Rotates around Y by \u03B8 |
| Rz(\u03B8) | Z-axis | Rotates around Z by \u03B8 |

### Special cases you already know

- **Rx(\u03C0) = X** (bit flip)
- **Ry(\u03C0) = Y** (bit + phase flip)
- **Rz(\u03C0) = Z** (phase flip)
- **Rz(\u03C0/2) = S** (quarter turn)
- **Rz(\u03C0/4) = T** (eighth turn)

> **Key insight:** With Ry(\u03B8) and Rz(\u03C6), you can reach *any point* on the Bloch sphere from |0\u27E9. Add an entangling gate (CNOT) and you have a universal parameterized circuit.`,
      },
      {
        type: 'video',
        youtubeId: 'placeholder',
        title: 'Parameterized Quantum Circuits',
        creator: 'Qiskit',
      },
      {
        type: 'interactive-bloch',
        initialTheta: 0,
        initialPhi: 0,
        availableGates: ['Rx', 'Ry', 'Rz'],
        challenge: {
          targetTheta: Math.PI / 2,
          targetPhi: Math.PI / 2,
          description:
            'Navigate from |0\u27E9 (north pole) to the +Y point on the equator using rotation gates. Hint: Rx(\u03C0/2) gets you to the equator, then Rz(\u03C0/2) rotates to +Y.',
        },
      },
      {
        type: 'text',
        markdown: `## Variational Circuits

A **variational circuit** (or **ansatz**) is a parameterized circuit whose angles are optimized by a classical computer. This is the foundation of:

- **VQE** (Variational Quantum Eigensolver) — finding ground state energies
- **QAOA** (Quantum Approximate Optimization) — solving combinatorial problems
- **QML** (Quantum Machine Learning) — classification and regression

The workflow:

1. Prepare a parameterized circuit with angles \u03B8\u2081, \u03B8\u2082, ...
2. Run the circuit and measure
3. Feed the results to a classical optimizer
4. Optimizer suggests new angles
5. Repeat until convergence`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
import numpy as np

# A simple variational circuit (ansatz) for 2 qubits
# This creates entangled states parameterized by 4 angles

theta = [np.pi / 4, np.pi / 3, np.pi / 6, np.pi / 2]

qc = QuantumCircuit(2, 2)

# Layer 1: single-qubit rotations
qc.ry(theta[0], 0)
qc.ry(theta[1], 1)

# Entangling layer
qc.cx(0, 1)

# Layer 2: single-qubit rotations
qc.ry(theta[2], 0)
qc.ry(theta[3], 1)

qc.measure([0, 1], [0, 1])

print(qc.draw())
print("\\nTry changing the theta values to see different output distributions!")`,
        framework: 'qiskit',
        description:
          'A 2-qubit variational ansatz with 4 tunable parameters. Changing the angles produces different quantum states and measurement distributions.',
        explorationPrompt:
          'Set all theta values to 0 — you should get 100% |00\u27E9. Now try [\u03C0, \u03C0, 0, 0] — what happens?',
      },
      {
        type: 'exercise',
        id: '2.6-ex1',
        title: 'Create |+i\u27E9 with rotation gates',
        description:
          'Use rotation gates to prepare the state |+i\u27E9 = (|0\u27E9 + i|1\u27E9)/\u221A2, which sits on the +Y axis of the Bloch sphere. This state has equal measurement probabilities (50/50) but with a specific phase relationship. Use Ry(\u03C0/2) to rotate from |0\u27E9 to the +Y equator point.',
        starterCode: `from qiskit import QuantumCircuit
import numpy as np

qc = QuantumCircuit(1, 1)

# Prepare |+i⟩ using rotation gates
# |+i⟩ lives on the +Y axis of the Bloch sphere
# TODO: Apply the right rotation to reach |+i⟩

qc.measure(0, 0)`,
        framework: 'qiskit',
        expectedProbabilities: { '0': 0.5, '1': 0.5 },
        tolerancePercent: 5,
        hints: [
          'The |+i\u27E9 state is at \u03B8=\u03C0/2, \u03C6=\u03C0/2 on the Bloch sphere.',
          'Ry(\u03C0/2) rotates from |0\u27E9 (north pole) down to the equator along the +Y direction.',
          'A single qc.ry(np.pi / 2, 0) does the job.',
        ],
        successMessage:
          'You used a parameterized rotation to prepare an exact quantum state. In variational algorithms, a classical optimizer finds these angles automatically to minimize an energy or cost function.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '2.6-q1',
            question: 'What is Rx(\u03C0) equivalent to?',
            options: ['H gate', 'X gate (bit flip)', 'Z gate (phase flip)', 'S gate'],
            correctIndex: 1,
            explanation:
              'Rx(\u03C0) is a full rotation around the X-axis, which is equivalent to the X (NOT) gate — it flips |0\u27E9 to |1\u27E9 and vice versa.',
          },
          {
            id: '2.6-q2',
            question: 'In a variational algorithm, what does the classical optimizer do?',
            options: [
              'Simulates the quantum circuit',
              'Measures the qubits',
              'Adjusts the rotation angles to minimize a cost function',
              'Compiles the circuit into native gates',
            ],
            correctIndex: 2,
            explanation:
              'The classical optimizer receives measurement results and suggests new angle parameters that should produce a lower cost. This outer loop is what makes variational algorithms "hybrid" quantum-classical.',
          },
          {
            id: '2.6-q3',
            question: 'Which pair of gates can reach any single-qubit state from |0\u27E9?',
            options: [
              'H and X',
              'X and Z',
              'Ry and Rz',
              'S and T',
            ],
            correctIndex: 2,
            explanation:
              'Ry(\u03B8) controls the polar angle (latitude) and Rz(\u03C6) controls the azimuthal angle (longitude) on the Bloch sphere. Together they can reach any point from |0\u27E9.',
          },
        ],
      },
    ],
  },

  // ── Lesson 2.7 ──
  {
    id: '2.7',
    title: 'Circuit Optimization',
    description:
      'Reduce gate count and circuit depth — essential techniques for real quantum hardware where every gate introduces noise.',
    difficulty: 'advanced',
    estimatedMinutes: 25,
    prerequisites: ['2.3', '2.6'],
    tags: ['optimization', 'gate-cancellation', 'commutation', 'depth', 'transpiler'],
    diracContext:
      'The student can build circuits and decompose gates. Now they learn to optimize — a critical skill for real hardware where every gate adds noise. Emphasize the practical motivation: on current NISQ hardware, circuits deeper than ~100 layers produce garbage. Keep the rules concrete and visual: show the before/after circuit diagrams. Don\'t get into transpiler internals — focus on hand-optimizable patterns.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Why Optimization Matters

On real quantum hardware, every gate introduces a small error. Two-qubit gates (like CNOT) are ~10x noisier than single-qubit gates. If your circuit has too many gates or too much depth, the accumulated errors overwhelm the computation.

### The Optimization Toolkit

**1. Gate cancellation** — adjacent inverse gates cancel out:
- X \u00B7 X = I (identity)
- H \u00B7 H = I
- CNOT \u00B7 CNOT = I (same qubits)
- Rz(\u03B8) \u00B7 Rz(\u03C6) = Rz(\u03B8 + \u03C6) (rotations merge)

**2. Gate commutation** — some gates can be reordered:
- Two gates on different qubits always commute
- Rz and CX sometimes commute (Rz on control commutes through CX)
- Diagonal gates always commute with each other

**3. Depth reduction** — parallelize independent gates:
- Gates on different qubits can run simultaneously
- Restructure to maximize parallelism`,
      },
      {
        type: 'video',
        youtubeId: 'placeholder',
        title: 'Quantum Circuit Optimization Techniques',
        creator: 'Qiskit',
      },
      {
        type: 'concept-card',
        title: 'Gate Cancellation',
        visual: 'circuit',
        explanation:
          'When a gate and its inverse appear next to each other, they cancel out. H\u00B7H = I, X\u00B7X = I, CNOT\u00B7CNOT = I. Spotting these patterns is the simplest and most effective optimization.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Operator
import numpy as np

# An unoptimized circuit with redundant gates
qc_bloated = QuantumCircuit(2, 2)
qc_bloated.h(0)
qc_bloated.h(0)     # H·H = I → cancels
qc_bloated.cx(0, 1)
qc_bloated.x(1)
qc_bloated.x(1)     # X·X = I → cancels
qc_bloated.cx(0, 1)
qc_bloated.cx(0, 1) # CNOT·CNOT = I → cancels
qc_bloated.h(0)

print("Bloated circuit (8 gates):")
print(qc_bloated.draw())

# Optimized equivalent
qc_optimized = QuantumCircuit(2, 2)
qc_optimized.cx(0, 1)
qc_optimized.h(0)

print("\\nOptimized circuit (2 gates):")
print(qc_optimized.draw())

# Verify they're equivalent
print("\\nEquivalent?", Operator(qc_bloated).equiv(qc_optimized))`,
        framework: 'qiskit',
        description:
          'An 8-gate circuit reduced to 2 gates by cancelling redundant pairs. The unitary matrices are identical.',
        explorationPrompt:
          'Try adding more redundant pairs to the bloated circuit and verify it still reduces to the same 2-gate circuit.',
      },
      {
        type: 'text',
        markdown: `## Rotation Merging

Adjacent rotations around the same axis combine into a single rotation:

\`\`\`
Rz(π/4) · Rz(π/4) = Rz(π/2) = S gate
Rz(π/4) · Rz(-π/4) = Rz(0) = I (cancels!)
\`\`\`

This is especially important in variational circuits where multiple rotation layers stack up. A good optimizer merges them automatically, but knowing the pattern helps you write cleaner circuits from the start.`,
      },
      {
        type: 'exercise',
        id: '2.7-ex1',
        title: 'Optimize a redundant circuit',
        description:
          'The circuit below has unnecessary gates. Optimize it by removing cancelling pairs and merging where possible. The original circuit applies H, X, X, H, then CNOT — the X\u00B7X and H\u00B7H pairs cancel, leaving just CNOT. Measure both qubits to verify.',
        starterCode: `from qiskit import QuantumCircuit

# Original bloated circuit: H, X, X, H on qubit 0, then CNOT
# Your job: write the optimized equivalent

qc = QuantumCircuit(2, 2)

# TODO: Write the optimized circuit
# Hint: after cancelling H·H and X·X, what's left?

qc.measure([0, 1], [0, 1])`,
        framework: 'qiskit',
        expectedProbabilities: { '00': 1.0 },
        tolerancePercent: 3,
        hints: [
          'H\u00B7H = I and X\u00B7X = I, so the four single-qubit gates all cancel out.',
          'After cancellation, only the CNOT remains. But the control qubit is |0\u27E9, so CNOT does nothing.',
          'The optimized circuit is just measurement — no gates needed! Both qubits remain |0\u27E9.',
        ],
        successMessage:
          'You reduced 5 gates to zero. On real hardware, those 5 gates would each add noise for no benefit. Circuit optimization is how you survive the NISQ era.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '2.7-q1',
            question: 'Which pair of adjacent gates cancels to identity?',
            options: [
              'H followed by X',
              'H followed by H',
              'CNOT followed by H',
              'X followed by Z',
            ],
            correctIndex: 1,
            explanation:
              'H\u00B7H = I. The Hadamard is its own inverse — applying it twice returns the qubit to its original state.',
          },
          {
            id: '2.7-q2',
            question: 'What does Rz(\u03C0/4) \u00B7 Rz(\u03C0/4) simplify to?',
            options: [
              'Rz(\u03C0/8)',
              'Rz(\u03C0/2) = S gate',
              'Rz(\u03C0/16)',
              'Identity (I)',
            ],
            correctIndex: 1,
            explanation:
              'Rotations around the same axis add their angles: Rz(\u03C0/4) \u00B7 Rz(\u03C0/4) = Rz(\u03C0/2), which is the S gate.',
          },
          {
            id: '2.7-q3',
            question: 'Why is circuit depth more important than gate count on real hardware?',
            options: [
              'Deeper circuits use more qubits',
              'Each layer adds decoherence time, and qubits lose their state over time',
              'Deeper circuits require more classical memory',
              'Gate count and depth are the same thing',
            ],
            correctIndex: 1,
            explanation:
              'Circuit depth determines how long the computation takes. Qubits decohere (lose quantum information) over time, so deeper circuits are more likely to produce errors even with the same number of total gates.',
          },
        ],
      },
    ],
  },

  // ── Lesson 2.8 ──
  {
    id: '2.8',
    title: 'Clifford vs Non-Clifford Gates',
    description:
      'Why some gates are "easy" and one gate (T) makes quantum computing powerful — the Gottesman-Knill theorem.',
    difficulty: 'advanced',
    estimatedMinutes: 20,
    prerequisites: ['2.1', '2.7'],
    tags: ['Clifford', 'non-Clifford', 'T-gate', 'Gottesman-Knill', 'simulation'],
    diracContext:
      'This is a more theoretical lesson about computational complexity. The student should understand the key takeaway: Clifford circuits (H, S, CNOT) can be efficiently simulated classically, so they alone don\'t give quantum advantage. The T gate breaks this simulability and makes universal quantum computation possible. Don\'t get bogged down in stabilizer formalism — focus on the practical implication: "Clifford = classically easy, add T = quantumly powerful."',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Clifford Group

The **Clifford group** is the set of gates that maps Pauli operators to Pauli operators under conjugation. In practice, the Clifford gates are:

| Gate | Type | Clifford? |
|------|------|-----------|
| H | Single-qubit | Yes |
| S | Single-qubit | Yes |
| CNOT | Two-qubit | Yes |
| X, Y, Z | Single-qubit | Yes |
| **T** | **Single-qubit** | **No** |
| **Rx(\u03B8)** (arbitrary \u03B8) | **Single-qubit** | **No** (except special angles) |

### The Gottesman-Knill Theorem

> Any circuit composed **only** of Clifford gates, starting from computational basis states and ending with computational basis measurements, can be efficiently simulated on a classical computer.

This is a remarkable result: circuits with H, S, CNOT, and Pauli gates — which include entanglement, superposition, and interference — can all be simulated classically in polynomial time using the **stabilizer formalism**.

### So where does quantum advantage come from?

The **T gate**. Adding T to the Clifford set breaks classical simulability and enables **universal quantum computation**. Without T (or an equivalent non-Clifford gate), your quantum computer is no more powerful than a classical one.`,
      },
      {
        type: 'video',
        youtubeId: 'placeholder',
        title: 'Clifford Gates and the Gottesman-Knill Theorem',
        creator: 'Qiskit',
      },
      {
        type: 'concept-card',
        title: 'Clifford vs Non-Clifford',
        visual: 'circuit',
        explanation:
          'Think of Clifford gates as the "free" gates — powerful-looking but classically simulable. The T gate is the "expensive" gate that unlocks true quantum computational advantage. This is why T-count (the number of T gates in a circuit) is a key metric in quantum error correction.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# A Clifford-only circuit: can be simulated classically!
qc_clifford = QuantumCircuit(3, 3)
qc_clifford.h(0)
qc_clifford.cx(0, 1)
qc_clifford.s(1)
qc_clifford.cx(1, 2)
qc_clifford.h(2)
qc_clifford.measure([0, 1, 2], [0, 1, 2])

print("Clifford circuit (classically simulable):")
print(qc_clifford.draw())

# Add a single T gate → no longer efficiently simulable
qc_universal = QuantumCircuit(3, 3)
qc_universal.h(0)
qc_universal.t(0)     # This one gate breaks classical simulability
qc_universal.cx(0, 1)
qc_universal.s(1)
qc_universal.cx(1, 2)
qc_universal.h(2)
qc_universal.measure([0, 1, 2], [0, 1, 2])

print("\\nUniversal circuit (NOT classically simulable):")
print(qc_universal.draw())

print("\\nThe only difference: one T gate.")
print("That single gate is what makes quantum computing powerful.")`,
        framework: 'qiskit',
        description:
          'Two nearly identical circuits — one Clifford-only (classically simulable) and one with a single T gate (not efficiently simulable classically).',
        explorationPrompt:
          'Try replacing the T gate with an S gate — the circuit becomes Clifford again and classically simulable. The difference between S (\u03C0/2 rotation) and T (\u03C0/4 rotation) is the boundary between classical and quantum computational power.',
      },
      {
        type: 'text',
        markdown: `## Why This Matters in Practice

### T-count and Quantum Error Correction

In fault-tolerant quantum computing, Clifford gates are "cheap" — they can be implemented transversally (directly on encoded qubits). T gates are "expensive" — they require a complex protocol called **magic state distillation**.

> **The cost breakdown on a fault-tolerant quantum computer:**
> - Clifford gate: ~1 time step
> - T gate: ~100-1000x more resources (magic state distillation)

This is why circuit optimization focuses heavily on **minimizing T-count** — the number of T gates in a circuit.

### The Simulation Boundary

| Circuit Type | Classical Simulation | Quantum Advantage |
|-------------|---------------------|-------------------|
| Clifford only | Efficient (polynomial) | None |
| Clifford + T | Exponentially hard | Yes |
| Clifford + measurement + feedback | Can be hard | Depends on structure |`,
      },
      {
        type: 'exercise',
        id: '2.8-ex1',
        title: 'Identify the quantum advantage',
        description:
          'Build two circuits: one using only Clifford gates (H, S, CNOT) and one that adds a T gate. Run both and observe the outputs. The Clifford circuit creates a Bell state (classically simulable). The T-enhanced circuit creates a state that is NOT efficiently simulable classically.',
        starterCode: `from qiskit import QuantumCircuit

# Circuit 1: Clifford only (Bell state)
qc1 = QuantumCircuit(2, 2)
qc1.h(0)
qc1.cx(0, 1)
qc1.measure([0, 1], [0, 1])

# Circuit 2: Add a T gate before the CNOT
qc2 = QuantumCircuit(2, 2)
qc2.h(0)
# TODO: Add a T gate on qubit 0 here
qc2.cx(0, 1)
qc2.measure([0, 1], [0, 1])`,
        framework: 'qiskit',
        expectedProbabilities: { '00': 0.5, '11': 0.5 },
        tolerancePercent: 8,
        hints: [
          'Add qc2.t(0) between the H and CNOT gates.',
          'The T gate adds a \u03C0/4 phase that breaks classical simulability.',
          'Both circuits produce correlated outcomes (00 and 11), but the T-gate version has a relative phase that a classical simulator cannot efficiently track for large circuits.',
        ],
        successMessage:
          'Both circuits look similar in measurement, but the T gate fundamentally changes the computational complexity. For 2 qubits the difference is invisible — but scale to 100+ qubits and only the quantum computer can handle the T-gate version efficiently.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '2.8-q1',
            question: 'Which of these gates is NOT a Clifford gate?',
            options: ['H (Hadamard)', 'S (phase)', 'T (\u03C0/8)', 'CNOT'],
            correctIndex: 2,
            explanation:
              'T is not a Clifford gate. H, S, and CNOT generate the entire Clifford group. T is the key non-Clifford gate needed for universality.',
          },
          {
            id: '2.8-q2',
            question:
              'What does the Gottesman-Knill theorem tell us?',
            options: [
              'Quantum computers are always faster than classical ones',
              'Clifford-only circuits can be efficiently simulated classically',
              'The T gate is the fastest quantum gate',
              'Entangled states cannot be simulated',
            ],
            correctIndex: 1,
            explanation:
              'The Gottesman-Knill theorem proves that circuits using only Clifford gates (with computational basis prep and measurement) can be simulated in polynomial time on a classical computer. Quantum advantage requires non-Clifford gates.',
          },
          {
            id: '2.8-q3',
            question:
              'Why is "T-count" an important metric in quantum error correction?',
            options: [
              'T gates are the fastest to execute',
              'T gates require expensive magic state distillation',
              'T gates don\'t introduce errors',
              'T gates can only be used once per circuit',
            ],
            correctIndex: 1,
            explanation:
              'On fault-tolerant hardware, T gates require magic state distillation — a process that consumes many physical qubits and time steps. Minimizing T-count directly reduces the resource cost of a quantum computation.',
          },
        ],
      },
    ],
  },
];
