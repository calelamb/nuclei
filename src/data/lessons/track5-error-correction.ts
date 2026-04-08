import type { Lesson } from './types';

export const TRACK5_LESSONS: Lesson[] = [
  // ── Lesson 5.1 ──
  {
    id: '5.1',
    title: 'Why Quantum Computers Make Errors',
    description: 'Decoherence, gate infidelity, and measurement noise — the enemies of quantum computation.',
    difficulty: 'beginner',
    estimatedMinutes: 15,
    prerequisites: ['1.5'],
    tags: ['decoherence', 'T1', 'T2', 'gate-fidelity', 'noise', 'error-rates'],
    diracContext:
      'Set the stage for the entire track. The student needs to understand WHY error correction matters before learning HOW. Keep it conceptual — no circuits yet. Use analogies: T1 is like a ball rolling downhill, T2 is like a spinning top wobbling. Emphasize that classical computers also have errors but fix them trivially by redundancy.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Fragility of Quantum Information

Classical bits are robust. A voltage representing "1" can drift by 20% and still read as "1." Quantum states have no such luxury — a qubit in superposition **α|0⟩ + β|1⟩** is a precise point on the Bloch sphere, and any disturbance moves it.

Three sources of error plague every quantum computer:

| Error Source | What Happens | Timescale |
|-------------|-------------|-----------|
| **T₁ (relaxation)** | Qubit decays from |1⟩ to |0⟩ — energy leaks to the environment | 50–300 μs (superconducting) |
| **T₂ (dephasing)** | Relative phase between |0⟩ and |1⟩ randomizes | 20–200 μs |
| **Gate infidelity** | Each gate operation introduces small rotation errors | 99.5–99.9% fidelity |
| **Measurement error** | Detector misreads |0⟩ as |1⟩ or vice versa | 0.5–3% error rate |

> **Key insight:** A single-qubit gate at 99.9% fidelity sounds great — until you run 1000 gates in a circuit. The probability of *zero* errors drops to (0.999)^1000 ≈ 37%. Most runs will have at least one error.`,
      },
      {
        type: 'concept-card',
        title: 'T₁ and T₂ Decay',
        visual: 'bloch',
        explanation:
          'T₁ decay pulls the Bloch vector toward the north pole (|0⟩) — the qubit loses energy. T₂ dephasing shrinks the equatorial component — the qubit loses phase coherence. Together, they collapse any superposition back to a classical state over time.',
      },
      {
        type: 'text',
        markdown: `## Why Not Just Copy?

In classical computing, the fix is trivial: copy the bit three times (0 → 000), and if one flips, majority vote recovers the original. But quantum mechanics forbids this.

The **no-cloning theorem** (Track 4) says you cannot copy an unknown quantum state. You cannot take α|0⟩ + β|1⟩ and produce α|0⟩ + β|1⟩ ⊗ α|0⟩ + β|1⟩.

So how do you protect quantum information? The answer is **quantum error correction** — encoding one logical qubit into multiple physical qubits using *entanglement*, not copying. The redundancy lives in correlations, not in duplicated data.

> **The road ahead:** This track teaches you the codes that make fault-tolerant quantum computing possible — from the simplest 3-qubit code to the surface codes used by Google and IBM today.`,
      },
      {
        type: 'video',
        youtubeId: 'placeholder',
        title: 'Why Quantum Error Correction Is So Hard',
        creator: 'Nuclei Learning',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '5.1-q1',
            question: 'What does T₂ dephasing do to a qubit on the Bloch sphere?',
            options: [
              'Pulls the state toward |0⟩',
              'Flips the state to the opposite pole',
              'Shrinks the equatorial (phase) component',
              'Rotates the state around the Z axis',
            ],
            correctIndex: 2,
            explanation:
              'T₂ dephasing randomizes the relative phase, shrinking the x and y components of the Bloch vector while leaving the z component intact.',
          },
          {
            id: '5.1-q2',
            question: 'Why can\'t we protect quantum information by simply copying the qubit?',
            options: [
              'Copying would require too many qubits',
              'The no-cloning theorem forbids copying unknown quantum states',
              'Classical error correction is always more efficient',
              'Quantum states cannot interact with other qubits',
            ],
            correctIndex: 1,
            explanation:
              'The no-cloning theorem proves that no physical process can duplicate an arbitrary unknown quantum state. Quantum error correction encodes information using entanglement instead.',
          },
          {
            id: '5.1-q3',
            question: 'A gate with 99.9% fidelity is applied 1000 times. Roughly what is the probability of zero errors?',
            options: ['99.9%', '90%', '37%', '0.1%'],
            correctIndex: 2,
            explanation:
              '(0.999)^1000 ≈ e^(-1) ≈ 0.368, so about 37%. Even high-fidelity gates accumulate errors over long circuits.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Classical vs Quantum Error Correction',
        visual: 'circuit',
        explanation:
          'Classical: copy bits, then majority vote. Quantum: entangle qubits into a code space, measure syndromes (not the data), and apply corrections. The key difference — you never look at the encoded data directly, because measurement would destroy it.',
      },
    ],
  },

  // ── Lesson 5.2 ──
  {
    id: '5.2',
    title: 'The Bit Flip Code',
    description: 'Three qubits, two parity checks — the simplest quantum error correcting code.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['5.1'],
    tags: ['bit-flip', 'repetition-code', 'syndrome', 'parity', 'CNOT'],
    diracContext:
      'This is the first real error correction circuit. Walk through encoding step by step: CNOT from data qubit to two ancillas spreads the logical state into entanglement (not copying). Emphasize syndrome measurement — you learn WHICH qubit flipped without learning WHAT the state is.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Encoding: Entangle, Don't Copy

The 3-qubit bit flip code encodes one logical qubit into three physical qubits:

- |0⟩_L = |000⟩
- |1⟩_L = |111⟩
- **α|0⟩ + β|1⟩ → α|000⟩ + β|111⟩**

This is NOT cloning — it's entanglement. The state α|000⟩ + β|111⟩ is a GHZ-like state where no individual qubit carries the full information.

The encoding circuit is two CNOTs from qubit 0 (data) to qubits 1 and 2 (ancilla).`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

# Encode |+⟩ into the 3-qubit bit flip code
qc = QuantumCircuit(3)
qc.h(0)          # Prepare |+⟩ on data qubit
qc.cx(0, 1)      # Encode: spread to qubit 1
qc.cx(0, 2)      # Encode: spread to qubit 2

sv = Statevector.from_instruction(qc)
print("Encoded state:")
print(sv)
# Should be (|000⟩ + |111⟩)/√2 — a GHZ state`,
        framework: 'qiskit',
        description: 'Encode a superposition state into the 3-qubit bit flip code and verify the GHZ-like entangled state.',
        explorationPrompt:
          'Change the initial state from |+⟩ to something else (try qc.ry(0.7, 0)). Verify that the encoded state is always α|000⟩ + β|111⟩.',
      },
      {
        type: 'text',
        markdown: `## Syndrome Measurement: Detecting Without Disturbing

After encoding, suppose a bit flip (X error) hits qubit 1. The state becomes α|010⟩ + β|101⟩.

To find the error, measure **parity checks** using ancilla qubits:
- **Syndrome bit s₁:** Parity of qubits 0 and 1 (CNOT 0→a₁, CNOT 1→a₁, measure a₁)
- **Syndrome bit s₂:** Parity of qubits 0 and 2 (CNOT 0→a₂, CNOT 2→a₂, measure a₂)

| s₁ s₂ | Meaning |
|--------|---------|
| 00 | No error |
| 10 | Qubit 1 flipped |
| 01 | Qubit 2 flipped |
| 11 | Qubit 0 flipped |

The syndrome tells you WHERE the error is without revealing WHAT the encoded state is.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# Full bit flip code: encode, inject error, detect
qc = QuantumCircuit(5, 2)  # 3 data + 2 syndrome ancillas

# --- Encoding ---
qc.h(0)           # Start in |+⟩
qc.cx(0, 1)
qc.cx(0, 2)
qc.barrier()

# --- Inject bit flip error on qubit 1 ---
qc.x(1)
qc.barrier()

# --- Syndrome measurement ---
# s1: parity of qubits 0 and 1
qc.cx(0, 3)
qc.cx(1, 3)
# s2: parity of qubits 0 and 2
qc.cx(0, 4)
qc.cx(2, 4)
qc.measure(3, 0)  # s1
qc.measure(4, 1)  # s2`,
        framework: 'qiskit',
        description: 'Encode, inject a bit flip on qubit 1, and measure the syndrome. Expect syndrome "10" — qubit 1 is the culprit.',
        explorationPrompt:
          'Move the qc.x() error to qubit 0 or qubit 2. Does the syndrome correctly identify the new error location?',
      },
      {
        type: 'exercise',
        id: '5.2-ex1',
        title: 'Build the Bit Flip Code',
        description:
          'Encode |0⟩ into the 3-qubit bit flip code, inject an X error on qubit 2, measure the syndrome, then correct the error and verify the state. The final measurement of the 3 data qubits should yield 000.',
        starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(5, 5)  # 3 data + 2 syndrome, 5 classical bits

# TODO: Encode qubit 0 into the bit flip code
# Hint: CNOT from qubit 0 to qubits 1 and 2

# TODO: Inject an X error on qubit 2
# Hint: qc.x(2)

# TODO: Syndrome measurement
# s1: CNOT qubit 0 -> 3, CNOT qubit 1 -> 3
# s2: CNOT qubit 0 -> 4, CNOT qubit 2 -> 4
# Measure qubits 3 and 4 into classical bits 0 and 1

# TODO: Correct the error using the syndrome
# Syndrome "01" means qubit 2 flipped — apply X to qubit 2
# Hint: Use qc.x(2).c_if(classical_register, value) or
# just apply qc.x(2) since we know the error location

# TODO: Measure the 3 data qubits into classical bits 2, 3, 4
`,
        framework: 'qiskit',
        expectedProbabilities: { '00001': 1.0 },
        tolerancePercent: 5,
        hints: [
          'Encoding: qc.cx(0, 1) and qc.cx(0, 2) spread |0⟩ to |000⟩.',
          'After qc.x(2), the state is |001⟩. The syndrome qubits detect this.',
          'Syndrome "01" (s1=0, s2=1) means qubit 2 flipped. Apply qc.x(2) to correct.',
          'Measure data qubits: qc.measure([0,1,2], [2,3,4]).',
        ],
        successMessage:
          'You built a complete error correction cycle: encode, detect, correct. The syndrome told you exactly which qubit was wrong without disturbing the encoded quantum information.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '5.2-q1',
            question: 'The bit flip code encodes α|0⟩ + β|1⟩ as:',
            options: [
              'α|0⟩|0⟩|0⟩ + β|1⟩|1⟩|1⟩ (three separate copies)',
              'α|000⟩ + β|111⟩ (an entangled state)',
              '(α|0⟩ + β|1⟩) ⊗ (α|0⟩ + β|1⟩) ⊗ (α|0⟩ + β|1⟩)',
              'α²|000⟩ + β²|111⟩',
            ],
            correctIndex: 1,
            explanation:
              'The encoding produces an entangled state α|000⟩ + β|111⟩. This is NOT three copies — measuring any single qubit would collapse the whole state.',
          },
        ],
      },
    ],
  },

  // ── Lesson 5.3 ──
  {
    id: '5.3',
    title: 'The Phase Flip Code',
    description: 'The Hadamard sandwich — protecting against phase errors by working in the X basis.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['5.2'],
    tags: ['phase-flip', 'Z-error', 'hadamard', 'basis-change', 'dual-code'],
    diracContext:
      'The student knows the bit flip code. Now show that Z errors are just X errors in the Hadamard basis. The "Hadamard sandwich" — apply H before encoding and after decoding — converts the bit flip code into a phase flip code. Stress the duality: HZH = X.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## A Different Kind of Error

The bit flip code catches X errors (|0⟩ ↔ |1⟩). But quantum computers also suffer **phase flip errors** — the Z gate flips the sign:

Z|0⟩ = |0⟩,  Z|1⟩ = −|1⟩

So α|0⟩ + β|1⟩ becomes α|0⟩ − β|1⟩. The probabilities of measuring 0 or 1 don't change, but the *phase* is corrupted. This is devastating for interference-based algorithms.

**Key insight:** HZH = X. A phase flip in the Z basis is a bit flip in the X basis.

So to correct phase errors: (1) rotate into the X basis with H, (2) use the bit flip code, (3) rotate back with H.`,
      },
      {
        type: 'concept-card',
        title: 'The Hadamard Sandwich',
        visual: 'circuit',
        explanation:
          'Wrap the bit flip code encoding in Hadamard gates. The logical codewords become: |0⟩_L = |+++⟩ and |1⟩_L = |−−−⟩. Now a Z error on any qubit looks like an X error in the +/− basis, which the bit flip code detects.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

# Phase flip code: encode in X basis
qc = QuantumCircuit(3)

# Encode |0⟩ into the phase flip code
qc.cx(0, 1)       # Bit flip encoding first
qc.cx(0, 2)
qc.h(0)           # Rotate all to X basis
qc.h(1)
qc.h(2)

sv_encoded = Statevector.from_instruction(qc)
print("Encoded |0⟩_L = |+++⟩:")
print(sv_encoded)

# Now inject a phase error on qubit 1
qc.z(1)

sv_error = Statevector.from_instruction(qc)
print("\\nAfter Z error on qubit 1:")
print(sv_error)`,
        framework: 'qiskit',
        description: 'Encode into the phase flip code and see how a Z error changes the state. The encoded state is |+++⟩, and Z on one qubit flips its sign in the X basis.',
        explorationPrompt:
          'Compare the state before and after the Z error. The Z basis probabilities look identical — the error only shows up in the phase.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# Full phase flip code with syndrome detection
qc = QuantumCircuit(5, 2)  # 3 data + 2 syndrome

# --- Encode into phase flip code ---
qc.cx(0, 1)
qc.cx(0, 2)
qc.h(0)
qc.h(1)
qc.h(2)
qc.barrier()

# --- Inject phase error on qubit 1 ---
qc.z(1)
qc.barrier()

# --- Decode back to Z basis for syndrome ---
qc.h(0)
qc.h(1)
qc.h(2)

# Syndrome measurement (same as bit flip code now)
qc.cx(0, 3)
qc.cx(1, 3)
qc.cx(0, 4)
qc.cx(2, 4)
qc.measure(3, 0)
qc.measure(4, 1)`,
        framework: 'qiskit',
        description: 'Decode with Hadamards, then run the same syndrome circuit as the bit flip code. Syndrome "10" identifies qubit 1.',
      },
      {
        type: 'exercise',
        id: '5.3-ex1',
        title: 'Detect a Phase Flip',
        description:
          'Build the phase flip code to protect |0⟩. Encode, inject a Z error on qubit 0, decode to the Z basis, and measure the syndrome. The syndrome should read "11" — both parity checks flag qubit 0.',
        starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(5, 2)

# TODO: Encode into the phase flip code
# Step 1: CNOT from qubit 0 to qubits 1 and 2
# Step 2: Apply H to qubits 0, 1, 2

# TODO: Inject Z error on qubit 0
# Hint: qc.z(0)

# TODO: Decode back to Z basis
# Apply H to qubits 0, 1, 2

# TODO: Syndrome measurement
# s1: CNOT 0->3, CNOT 1->3, measure qubit 3
# s2: CNOT 0->4, CNOT 2->4, measure qubit 4
`,
        framework: 'qiskit',
        expectedMeasurements: { '11': 1024 },
        tolerancePercent: 5,
        hints: [
          'Encoding: qc.cx(0,1), qc.cx(0,2), then qc.h(0), qc.h(1), qc.h(2).',
          'The Z error on qubit 0 becomes an X-like error in the +/− basis.',
          'Decoding: apply H again to all three data qubits before syndrome measurement.',
          'Syndrome "11" means qubit 0 is the error — both parity checks involve qubit 0.',
        ],
        successMessage:
          'The Hadamard sandwich transforms phase errors into detectable bit flip errors. This duality is the foundation of more powerful codes that handle both error types.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '5.3-q1',
            question: 'The phase flip code protects against Z errors by:',
            options: [
              'Measuring in the Z basis to detect phase changes',
              'Using Hadamards to convert Z errors into X errors, then using the bit flip code',
              'Encoding into three copies of the phase',
              'Applying Z gates to cancel the error',
            ],
            correctIndex: 1,
            explanation:
              'Since HZH = X, wrapping the bit flip code in Hadamards converts detectable bit flips into detectable phase flips. The syndrome circuit works identically after the basis change.',
          },
        ],
      },
    ],
  },

  // ── Lesson 5.4 ──
  {
    id: '5.4',
    title: "Shor's 9-Qubit Code",
    description: 'Nine physical qubits to protect one logical qubit from any single-qubit error.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['5.2', '5.3'],
    tags: ['shor-code', '9-qubit', 'concatenation', 'universal-protection'],
    diracContext:
      "Show how Shor's code concatenates the phase flip code (outer) with the bit flip code (inner). Each of 3 logical qubits in the phase flip code is itself encoded in 3 physical qubits for bit flip protection — 3×3=9. Stress that this was the first code to correct arbitrary single-qubit errors.",
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The First Quantum Error Correcting Code

The bit flip code corrects X errors. The phase flip code corrects Z errors. But real noise is a *continuous* mixture of both. Peter Shor showed in 1995 that you can protect against **any** single-qubit error by combining the two codes.

**Shor's 9-qubit code** uses **concatenation**:

1. **Outer code (phase flip):** Encode 1 logical qubit into 3 "blocks"
2. **Inner code (bit flip):** Each block is further encoded into 3 physical qubits

Total: 1 logical qubit → 3 blocks × 3 qubits = **9 physical qubits**

**Logical codewords:**

|0⟩_L = (|000⟩ + |111⟩)(|000⟩ + |111⟩)(|000⟩ + |111⟩) / 2√2

|1⟩_L = (|000⟩ − |111⟩)(|000⟩ − |111⟩)(|000⟩ − |111⟩) / 2√2

Each group of 3 qubits can fix one bit flip. The three groups together can fix one phase flip.`,
      },
      {
        type: 'concept-card',
        title: 'Concatenation Diagram',
        visual: 'circuit',
        explanation:
          "Shor's code is a code within a code. The outer layer protects against phase flips (Z). Each inner layer protects against bit flips (X). Since any error can be decomposed into X, Z, and XZ (Y) components, fixing both types covers everything.",
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

# Shor's 9-qubit encoding circuit
qc = QuantumCircuit(9)

# Phase flip encoding (outer code): qubit 0 -> blocks at 0,3,6
qc.cx(0, 3)
qc.cx(0, 6)
qc.h(0)
qc.h(3)
qc.h(6)

# Bit flip encoding (inner code) for each block
# Block 1: qubit 0 -> qubits 1, 2
qc.cx(0, 1)
qc.cx(0, 2)
# Block 2: qubit 3 -> qubits 4, 5
qc.cx(3, 4)
qc.cx(3, 5)
# Block 3: qubit 6 -> qubits 7, 8
qc.cx(6, 7)
qc.cx(6, 8)

sv = Statevector.from_instruction(qc)
print("Shor code |0⟩_L (non-zero amplitudes):")
for i, amp in enumerate(sv):
    if abs(amp) > 1e-10:
        print(f"  |{i:09b}⟩: {amp:.4f}")`,
        framework: 'qiskit',
        description: "Build the full 9-qubit encoding circuit and inspect the logical |0⟩ state. You'll see 8 basis states with equal amplitude — the hallmark of the Shor code.",
        explorationPrompt:
          'Add qc.x(0) before encoding to prepare |1⟩_L. Compare the signs of the amplitudes with |0⟩_L. The difference is only in the signs — that encodes the logical information.',
      },
      {
        type: 'text',
        markdown: `## Why 9 Qubits Correct ANY Single-Qubit Error

Any single-qubit error E can be written as: E = aI + bX + cZ + dY (where Y = iXZ).

- **X error** on any qubit: detected by the bit flip syndrome within its block
- **Z error** on any qubit: detected by the phase flip syndrome across blocks
- **Y error** = XZ: both syndromes fire, both corrections applied

This works because the error types are **discretized** by measurement. Even a continuous rotation error, once you measure the syndrome, collapses into "no error," "X error," "Z error," or "Y error." Quantum measurement does the discretization for free.

> **Historical note:** Shor's code was not just a technical achievement — it proved that quantum error correction is *possible at all*. Many physicists believed noise would make quantum computing fundamentally impossible.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '5.4-q1',
            question: "How many physical qubits does Shor's code use to protect one logical qubit?",
            options: ['3', '5', '7', '9'],
            correctIndex: 3,
            explanation:
              "Shor's code concatenates a 3-qubit phase flip code with a 3-qubit bit flip code: 3 × 3 = 9 physical qubits per logical qubit.",
          },
          {
            id: '5.4-q2',
            question: 'Why can the Shor code correct a continuous rotation error, not just discrete X/Z flips?',
            options: [
              'It uses 9 qubits, which is enough to handle any angle',
              'Syndrome measurement collapses continuous errors into discrete X, Z, or Y errors',
              'Continuous errors do not occur on real hardware',
              'The code includes rotation gates that cancel arbitrary angles',
            ],
            correctIndex: 1,
            explanation:
              'Measuring the syndrome projects any error into the discrete set {I, X, Z, Y}. This "error discretization" is a fundamental feature of quantum error correction — the code only needs to handle a finite set of errors.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Error Discretization',
        visual: 'histogram',
        explanation:
          'Before syndrome measurement, an error could be any mixture of I, X, Z, Y. After measurement, it collapses to exactly one of them. The syndrome measurement itself discretizes the error — this is why quantum error correction works despite continuous noise.',
      },
    ],
  },

  // ── Lesson 5.5 ──
  {
    id: '5.5',
    title: 'Stabilizer Formalism',
    description: 'Pauli groups, stabilizer generators, and a compact language for quantum error correction.',
    difficulty: 'advanced',
    estimatedMinutes: 25,
    prerequisites: ['5.4'],
    tags: ['stabilizer', 'pauli-group', 'generators', 'code-space', 'gottesman-knill'],
    diracContext:
      'This is the most theoretical lesson in the track. The student needs to understand that stabilizers are a COMPACT DESCRIPTION of the code space. Use concrete examples: the bit flip code has stabilizers Z₁Z₂ and Z₂Z₃. Measuring these stabilizers IS the syndrome measurement. Connect the formalism back to the circuits they already know.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## A Language for Error Correction

Describing quantum codes as circuits gets unwieldy. The **stabilizer formalism** provides a compact mathematical language.

**The Pauli group** on n qubits consists of all n-fold tensor products of {I, X, Y, Z} with phases ±1, ±i. For example, on 3 qubits: X₁Z₂I₃, Y₁Y₂X₃, etc.

A **stabilizer** S of a state |ψ⟩ is a Pauli operator such that S|ψ⟩ = +|ψ⟩. The state is an eigenstate with eigenvalue +1.

> **Example:** |00⟩ is stabilized by Z₁, Z₂, and Z₁Z₂. But |00⟩ + |11⟩ (Bell state) is stabilized by X₁X₂ and Z₁Z₂, but NOT by Z₁ alone.`,
      },
      {
        type: 'text',
        markdown: `## Stabilizer Generators for the Bit Flip Code

The codespace of the bit flip code {α|000⟩ + β|111⟩} is stabilized by:

- **g₁ = Z₁Z₂** (parity of qubits 1 and 2 in Z basis)
- **g₂ = Z₂Z₃** (parity of qubits 2 and 3 in Z basis)

These two generators define the code completely. Any state in the codespace satisfies g₁|ψ⟩ = |ψ⟩ and g₂|ψ⟩ = |ψ⟩.

**When an error happens:**

| Error | g₁ eigenvalue | g₂ eigenvalue | Syndrome |
|-------|:---:|:---:|:---:|
| None (I) | +1 | +1 | 00 |
| X₁ | −1 | +1 | 10 |
| X₂ | −1 | −1 | 11 |
| X₃ | +1 | −1 | 01 |

The syndrome IS the pattern of ±1 eigenvalues. Measuring the stabilizer generators IS syndrome measurement.`,
      },
      {
        type: 'concept-card',
        title: 'Stabilizer ↔ Syndrome Connection',
        visual: 'circuit',
        explanation:
          'Each stabilizer generator corresponds to one syndrome bit. Measuring gₖ gives +1 (syndrome 0) or −1 (syndrome 1). The syndrome measurement circuit you built in Lesson 5.2 was exactly measuring Z₁Z₂ and Z₁Z₃ — the stabilizer generators of the bit flip code.',
      },
      {
        type: 'text',
        markdown: `## The Power of Stabilizers

An n-qubit stabilizer code is specified by its generators — typically n−k independent operators for an [[n,k]] code (n physical qubits encoding k logical qubits).

| Code | n | k | Generators |
|------|---|---|-----------|
| Bit flip | 3 | 1 | Z₁Z₂, Z₂Z₃ |
| Phase flip | 3 | 1 | X₁X₂, X₂X₃ |
| Shor | 9 | 1 | 8 generators |
| Steane [[7,1,3]] | 7 | 1 | 6 generators |

> **Gottesman-Knill theorem:** Any quantum circuit consisting only of Clifford gates (H, S, CNOT) and Pauli measurements can be efficiently simulated classically using the stabilizer formalism. This means stabilizer codes are not just useful notation — they are computationally tractable.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '5.5-q1',
            question: 'What does it mean for an operator S to "stabilize" a state |ψ⟩?',
            options: [
              'S annihilates the state: S|ψ⟩ = 0',
              'S|ψ⟩ = +|ψ⟩ — the state is a +1 eigenvector of S',
              'S commutes with the Hamiltonian',
              'S|ψ⟩ = −|ψ⟩ — the state picks up a minus sign',
            ],
            correctIndex: 1,
            explanation:
              'A stabilizer S of |ψ⟩ satisfies S|ψ⟩ = +|ψ⟩. The state is in the +1 eigenspace. An error that anticommutes with S flips the eigenvalue to −1, which the syndrome measurement detects.',
          },
          {
            id: '5.5-q2',
            question: 'The bit flip code has stabilizer generators Z₁Z₂ and Z₂Z₃. What is the syndrome for an X error on qubit 2?',
            options: ['00', '10', '01', '11'],
            correctIndex: 3,
            explanation:
              'X₂ anticommutes with both Z₁Z₂ (shares qubit 2) and Z₂Z₃ (shares qubit 2), so both syndromes flip to −1, giving syndrome 11.',
          },
          {
            id: '5.5-q3',
            question: 'What does the Gottesman-Knill theorem tell us?',
            options: [
              'All quantum circuits can be simulated classically',
              'Stabilizer codes cannot correct all errors',
              'Circuits using only Clifford gates can be efficiently simulated classically',
              'Quantum error correction requires non-Clifford gates',
            ],
            correctIndex: 2,
            explanation:
              'The Gottesman-Knill theorem says Clifford circuits + Pauli measurements are classically simulable. This makes stabilizer code analysis tractable but also means you need non-Clifford gates (like T) for quantum advantage.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Why Stabilizers Matter',
        visual: 'custom-svg',
        explanation:
          'Stabilizers compress the description of a code. Instead of writing out 2ⁿ amplitudes, you list a handful of Pauli operators. Every major quantum error correcting code — surface codes, color codes, toric codes — is described in the stabilizer formalism.',
      },
    ],
  },

  // ── Lesson 5.6 ──
  {
    id: '5.6',
    title: 'Surface Codes',
    description: 'The leading architecture for fault-tolerant quantum computing — qubits on a 2D grid.',
    difficulty: 'advanced',
    estimatedMinutes: 20,
    prerequisites: ['5.5'],
    tags: ['surface-code', 'topological', 'fault-tolerant', '2D-lattice', 'threshold'],
    diracContext:
      'Surface codes are the endgame for real hardware. Keep this conceptual — the student should understand WHY surface codes are favored (local interactions, high threshold) without needing to build one. Use the grid analogy: data qubits on edges, syndrome qubits at vertices and faces.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Real-World Error Correction Code

The codes we have studied so far are elegant but impractical. Shor's code needs 9 qubits but only has distance 3 — it corrects exactly 1 error. For a real quantum computer running millions of gates, we need something much more powerful.

**Surface codes** are the leading candidate. They were proposed by Kitaev (1997) and developed by Dennis, Kitaev, Landahl, and Preskill (2002).

**Why surface codes dominate:**

| Property | Why It Matters |
|----------|---------------|
| **2D nearest-neighbor** | Only adjacent qubits interact — matches chip layout |
| **High threshold** | ~1% error rate threshold — achievable on current hardware |
| **Local syndrome** | Each check involves only 4 neighboring qubits |
| **Scalable distance** | Grow the lattice to increase error suppression exponentially |`,
      },
      {
        type: 'concept-card',
        title: 'The Surface Code Lattice',
        visual: 'custom-svg',
        explanation:
          'Picture a checkerboard grid. Data qubits sit on every edge. X-type stabilizers (faces) detect phase errors. Z-type stabilizers (vertices) detect bit flip errors. Each stabilizer involves only 4 neighboring data qubits — no long-range connections needed.',
      },
      {
        type: 'text',
        markdown: `## How It Works

A distance-d surface code uses a d×d lattice with:
- **d² data qubits** on the edges
- **(d²−1) syndrome qubits** at vertices and faces (approximately)

**Stabilizer types:**
- **Vertex stabilizers (Z-type):** Product of Z on all edges touching a vertex → detects X errors
- **Face stabilizers (X-type):** Product of X on all edges around a face → detects Z errors

**Error correction cycle:**
1. Measure all stabilizers simultaneously (one "round")
2. Repeat multiple rounds (because measurements are also noisy!)
3. Feed syndrome history to a **decoder** algorithm
4. Decoder identifies most likely error pattern
5. Apply corrections (or just track them in software)

> **Distance and protection:** A distance-d code can correct up to ⌊(d−1)/2⌋ errors. A distance-3 surface code corrects 1 error (17 qubits). Distance-5 corrects 2 errors (49 qubits). Each step roughly squares the logical error rate.`,
      },
      {
        type: 'text',
        markdown: `## The Threshold Theorem

The threshold theorem states: **if the physical error rate is below a critical threshold p_th, then increasing the code distance suppresses the logical error rate exponentially.**

For surface codes, p_th ≈ 1%.

| Physical error rate | Distance 3 | Distance 5 | Distance 7 |
|--------------------|-----------|-----------|-----------|
| 0.1% (10× below threshold) | ~10⁻⁴ | ~10⁻⁶ | ~10⁻⁸ |
| 0.5% (2× below threshold) | ~10⁻² | ~10⁻³ | ~10⁻⁴ |
| 1.5% (above threshold) | Gets worse as you increase distance | — | — |

> **Google's Willow chip (2024)** demonstrated this experimentally: increasing the surface code distance from 3 to 5 to 7 reduced logical errors each time, proving they are below threshold.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '5.6-q1',
            question: 'What makes surface codes particularly well-suited for real quantum hardware?',
            options: [
              'They use the fewest qubits of any code',
              'They only require nearest-neighbor interactions on a 2D grid',
              'They do not require syndrome measurements',
              'They can correct errors without any classical processing',
            ],
            correctIndex: 1,
            explanation:
              'Surface codes only need local (nearest-neighbor) interactions on a 2D lattice, which matches the physical layout of superconducting and ion-trap chips. Other codes often require long-range connections that are hard to build.',
          },
          {
            id: '5.6-q2',
            question: 'The error threshold for surface codes is approximately:',
            options: ['0.01%', '0.1%', '1%', '10%'],
            correctIndex: 2,
            explanation:
              'Surface codes have a threshold around 1%. Current superconducting qubits achieve error rates of 0.1–0.5%, which is below this threshold — making exponential error suppression possible.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Distance and Logical Error Rate',
        visual: 'histogram',
        explanation:
          'Below threshold, every increase in code distance d roughly squares the logical error suppression. Distance 3 → 5 → 7 gives exponential improvement. Above threshold, adding more qubits makes things worse — the extra qubits introduce more errors than they correct.',
      },
    ],
  },

  // ── Lesson 5.7 ──
  {
    id: '5.7',
    title: 'Syndrome Decoding',
    description: 'Measuring syndromes without collapsing the encoded state — the heart of error correction.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['5.2', '5.3'],
    tags: ['syndrome', 'ancilla', 'indirect-measurement', 'decoding', 'correction'],
    diracContext:
      'Focus on the mechanics of syndrome extraction: CNOT from data qubits to ancilla, measure ancilla. The magic is that this reveals parity information (which qubit is different) without revealing the encoded state. Build intuition with the bit flip code, then discuss lookup table decoding.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Measurement Paradox

Here's the puzzle at the heart of quantum error correction: you need to **detect** errors, but **measurement destroys quantum states**. How do you check for errors without reading the data?

The answer: **indirect measurement via ancilla qubits.**

Instead of measuring the data qubits directly, you entangle ancilla qubits with the data in a way that transfers *parity information* — not the actual encoded data — to the ancillas. Then you measure the ancillas.

**What the syndrome reveals:** "Do these two data qubits agree or disagree?"
**What the syndrome does NOT reveal:** "What state are the data qubits in?"`,
      },
      {
        type: 'concept-card',
        title: 'Indirect Measurement',
        visual: 'circuit',
        explanation:
          'To measure the parity Z₁Z₂ (do qubits 1 and 2 agree?), use an ancilla: CNOT from qubit 1 to ancilla, CNOT from qubit 2 to ancilla, then measure ancilla. Result 0 = they agree. Result 1 = they disagree. The data qubits are never measured.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# Demonstrate that syndrome measurement preserves the encoded state
qc = QuantumCircuit(5, 2)  # 3 data + 2 ancilla

# Encode |+⟩ into bit flip code
qc.h(0)
qc.cx(0, 1)
qc.cx(0, 2)
qc.barrier()

# Inject X error on qubit 2
qc.x(2)
qc.barrier()

# Syndrome extraction (indirect measurement)
# Parity of qubits 0,1 -> ancilla 3
qc.cx(0, 3)
qc.cx(1, 3)
# Parity of qubits 0,2 -> ancilla 4
qc.cx(0, 4)
qc.cx(2, 4)

# Measure ONLY the ancillas
qc.measure(3, 0)
qc.measure(4, 1)

# The data qubits remain in a quantum state!
# After correction (qc.x(2)), the logical state is intact`,
        framework: 'qiskit',
        description: 'The syndrome ancillas absorb the parity information. Measuring them yields "01" (qubit 2 error) while the data qubits remain coherent.',
        explorationPrompt:
          'Add qc.measure([0,1,2], [2,3,4]) after the syndrome measurement (expand to 5 classical bits). Even after syndrome extraction, the data qubits carry the encoded state.',
      },
      {
        type: 'text',
        markdown: `## Syndrome Lookup Table

Once you have the syndrome bits, a **lookup table** maps each syndrome to a correction:

| Syndrome | Error | Correction |
|----------|-------|-----------|
| 00 | None | Do nothing |
| 10 | X on qubit 1 | Apply X to qubit 1 |
| 01 | X on qubit 2 | Apply X to qubit 2 |
| 11 | X on qubit 0 | Apply X to qubit 0 |

For simple codes, this is a direct table. For surface codes, the "table" becomes a **decoder algorithm** (like Minimum Weight Perfect Matching) that processes syndrome histories across multiple rounds.

> **Important subtlety:** In real hardware, syndrome measurements themselves can be wrong. That's why surface codes repeat syndrome measurements many times and use temporal decoding across rounds.`,
      },
      {
        type: 'exercise',
        id: '5.7-ex1',
        title: 'Decode and Correct',
        description:
          'Build a complete error correction cycle: encode |0⟩ in the bit flip code, inject an X error on qubit 0, extract the syndrome, apply the correction based on the syndrome, and verify the final state is |000⟩.',
        starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(5, 5)  # 3 data + 2 syndrome, 5 classical

# Encode |0⟩ into the bit flip code
qc.cx(0, 1)
qc.cx(0, 2)
qc.barrier()

# Inject X error on qubit 0
qc.x(0)
qc.barrier()

# TODO: Syndrome extraction
# Parity of qubits 0,1 -> ancilla 3
# Parity of qubits 0,2 -> ancilla 4
# Measure ancillas into classical bits 0, 1

# TODO: Apply correction
# Syndrome 11 means qubit 0 flipped -> apply X to qubit 0
# Since we know the error, just apply qc.x(0) to correct

# TODO: Measure data qubits into classical bits 2, 3, 4
# qc.measure([0, 1, 2], [2, 3, 4])
`,
        framework: 'qiskit',
        expectedProbabilities: { '00011': 1.0 },
        tolerancePercent: 5,
        hints: [
          'Syndrome: qc.cx(0,3), qc.cx(1,3), qc.cx(0,4), qc.cx(2,4), then qc.measure(3,0) and qc.measure(4,1).',
          'Syndrome "11" means qubit 0 is wrong. Apply qc.x(0) to fix it.',
          'After correction, measure data qubits: qc.measure([0,1,2], [2,3,4]).',
          'Expected output: syndrome bits are 11, data bits are 000 → combined "00011".',
        ],
        successMessage:
          'You completed the full error correction loop: encode, error, detect, correct, verify. The syndrome told you qubit 0 was flipped, and X(0) fixed it without ever measuring the encoded quantum state directly.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '5.7-q1',
            question: 'Why do we use ancilla qubits for syndrome measurement instead of measuring data qubits directly?',
            options: [
              'Ancilla qubits are cheaper to manufacture',
              'Direct measurement would collapse the encoded quantum state',
              'Ancilla qubits have lower error rates',
              'Data qubits cannot be measured in current hardware',
            ],
            correctIndex: 1,
            explanation:
              'Measuring data qubits would collapse the superposition and destroy the encoded quantum information. Ancilla-based indirect measurement extracts only parity (error) information while preserving the data.',
          },
          {
            id: '5.7-q2',
            question: 'In real surface codes, why are syndrome measurements repeated multiple times?',
            options: [
              'To improve the accuracy of the data qubits',
              'Because syndrome measurements themselves can be noisy and unreliable',
              'To increase the code distance',
              'To prepare the ancilla qubits in the correct state',
            ],
            correctIndex: 1,
            explanation:
              'Syndrome measurements use physical gates and measurements, which are themselves noisy. Repeating the syndrome extraction over multiple rounds creates a time history that decoders use to distinguish real data errors from measurement errors.',
          },
        ],
      },
    ],
  },

  // ── Lesson 5.8 ──
  {
    id: '5.8',
    title: 'Logical vs Physical Qubits',
    description: 'The overhead of fault tolerance — from millions of physical qubits to useful logical qubits.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['5.6', '5.7'],
    tags: ['logical-qubit', 'physical-qubit', 'overhead', 'threshold-theorem', 'fault-tolerance', 'roadmap'],
    diracContext:
      'This lesson connects error correction theory to the practical reality of building a quantum computer. Help the student understand the massive overhead: thousands of physical qubits per logical qubit. But also convey optimism — the threshold theorem guarantees that if hardware keeps improving, fault tolerance is achievable.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Cost of Perfection

Every quantum algorithm you've seen in this course — Grover's, Shor's, VQE — uses **logical qubits**: perfect, error-free quantum bits that behave exactly as the math says. But real hardware gives you **physical qubits**: noisy, decohering, error-prone.

The gap between the two is the central challenge of quantum computing.

**How many physical qubits per logical qubit?**

For a distance-d surface code:
- Data qubits: d²
- Syndrome qubits: ~d²
- Total: **~2d² physical qubits per logical qubit**

| Target logical error rate | Distance needed | Physical qubits per logical qubit |
|--------------------------|----------------|-----------------------------------|
| 10⁻⁴ | d = 5 | ~50 |
| 10⁻⁸ | d = 9 | ~162 |
| 10⁻¹² | d = 13 | ~338 |
| 10⁻¹⁵ (Shor's algorithm) | d ≈ 17 | ~578 |`,
      },
      {
        type: 'concept-card',
        title: 'The Qubit Overhead Pyramid',
        visual: 'custom-svg',
        explanation:
          'At the top: 1 logical qubit doing useful computation. Below: hundreds or thousands of physical qubits maintaining it. Factoring a 2048-bit RSA key with Shor\'s algorithm requires roughly 4,000 logical qubits — which translates to millions of physical qubits with current error rates.',
      },
      {
        type: 'text',
        markdown: `## Real-World Numbers

| Task | Logical Qubits | Physical Qubits (estimated) |
|------|---------------|---------------------------|
| Chemistry simulation (small molecule) | 50–100 | 50,000–200,000 |
| Drug discovery (useful scale) | 200–500 | 500,000–2,000,000 |
| Breaking RSA-2048 | ~4,000 | 10,000,000–20,000,000 |
| Quantum advantage in optimization | 100–1,000 | 100,000–2,000,000 |

**Where are we today?**

| Company | Physical qubits (2024–2025) | Logical qubits demonstrated |
|---------|---------------------------|---------------------------|
| IBM | 1,121 (Condor) | 12 (Heron) |
| Google | 105 (Willow) | 1 (below threshold) |
| Quantinuum | 56 (H2) | 12 (color codes) |
| Microsoft + Atom | 24 (topological prototype) | 8 (announced) |

The gap is enormous. But the trajectory is clear.`,
      },
      {
        type: 'text',
        markdown: `## The Threshold Theorem: Why Optimism Is Justified

The **threshold theorem** (Aharonov & Ben-Or, 1997; Knill, Laflamme & Zurek, 1998) is the most important result in quantum computing after Shor's algorithm:

> **If the physical error rate per gate is below a constant threshold p_th, then arbitrarily long quantum computations can be performed with arbitrarily small logical error rate, with only polylogarithmic overhead.**

In plain English: there is a well-defined finish line. If hardware engineers can push error rates below ~0.1%, the software (error correction) can handle the rest. We don't need perfect qubits — just *good enough* qubits.

**Google's Willow result (December 2024)** was the first experimental demonstration: they showed that increasing the surface code distance from 3 to 5 to 7 reduced logical errors each time. They are below threshold.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '5.8-q1',
            question: 'Roughly how many physical qubits are estimated to factor RSA-2048 using Shor\'s algorithm?',
            options: ['4,000', '100,000', '1,000,000', '10,000,000+'],
            correctIndex: 3,
            explanation:
              'Shor\'s algorithm needs ~4,000 logical qubits. With surface code overhead at practical error rates, each logical qubit requires thousands of physical qubits, totaling 10–20 million physical qubits.',
          },
          {
            id: '5.8-q2',
            question: 'What does the threshold theorem guarantee?',
            options: [
              'Quantum computers will always be faster than classical ones',
              'Error correction always reduces logical errors',
              'Below a critical error rate, arbitrarily long computations are possible with manageable overhead',
              'Physical qubits will eventually have zero errors',
            ],
            correctIndex: 2,
            explanation:
              'The threshold theorem says: below p_th, you can compute as long as you want with polynomially bounded overhead. Above p_th, error correction cannot keep up with the noise. It is the theoretical foundation for fault-tolerant quantum computing.',
          },
          {
            id: '5.8-q3',
            question: 'For a distance-d surface code, approximately how many physical qubits are needed per logical qubit?',
            options: ['d', 'd²', '2d²', '2ⁿ'],
            correctIndex: 2,
            explanation:
              'A distance-d surface code uses d² data qubits plus approximately d² syndrome qubits, totaling about 2d² physical qubits per logical qubit.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The Quantum Computing Roadmap',
        visual: 'custom-svg',
        explanation:
          'We are in the "noisy intermediate-scale quantum" (NISQ) era — enough qubits for experiments, not enough for full error correction. The path forward: improve gate fidelity → cross error threshold → scale up qubit count → demonstrate practical logical qubits → fault-tolerant quantum advantage.',
      },
    ],
  },
];
