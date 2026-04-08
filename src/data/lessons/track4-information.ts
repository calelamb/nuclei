import type { Lesson } from './types';

export const TRACK4_LESSONS: Lesson[] = [
  // ── Lesson 4.1 ──
  {
    id: '4.1',
    title: 'Density Matrices & Mixed States',
    description: 'Pure states vs mixed states — the Bloch ball has an interior.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['1.5', '1.6'],
    tags: ['density-matrix', 'mixed-states', 'purity', 'bloch-ball'],
    diracContext: 'Introduce density matrices. Emphasize geometry: pure states on Bloch sphere surface, mixed inside the ball. Use maximally mixed state (center) as anchor.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Beyond State Vectors

So far every quantum state has been a **state vector** |ψ⟩ — a **pure state**. But what if there's a 50% chance your qubit is |0⟩ and 50% chance it's |+⟩? You need a **density matrix**.

For a pure state: **ρ = |ψ⟩⟨ψ|**
For a mixture: **ρ = Σ pᵢ |ψᵢ⟩⟨ψᵢ|**

The **purity** Tr(ρ²) tells you how mixed: 1 for pure states, 1/d for maximally mixed (d = dimension).`,
      },
      {
        type: 'concept-card',
        title: 'The Bloch Ball',
        visual: 'bloch',
        explanation:
          'Pure states live on the surface of the Bloch sphere (radius = 1). Mixed states live inside the ball (radius < 1). The maximally mixed state ρ = I/2 sits at the center — no preferred direction, like a completely random coin.',
      },
      {
        type: 'demo',
        code: `from qiskit.quantum_info import Statevector, DensityMatrix
import numpy as np

# Pure state |+⟩
rho_pure = DensityMatrix(Statevector.from_label('+'))
print("Pure |+⟩ density matrix:")
print(np.round(rho_pure.data, 3))
print(f"Purity: {rho_pure.purity():.4f}")

# Mixed state: 50% |0⟩ + 50% |1⟩
rho_mixed = 0.5 * DensityMatrix.from_label('0') + 0.5 * DensityMatrix.from_label('1')
print("\\nMixed (50/50) density matrix:")
print(np.round(rho_mixed.data, 3))
print(f"Purity: {rho_mixed.purity():.4f}")`,
        framework: 'qiskit',
        description: 'Compare density matrices and purity values for pure vs mixed states.',
        explorationPrompt: 'Try mixing |+⟩ and |−⟩ instead. Is the result the same as mixing |0⟩ and |1⟩?',
      },
      {
        type: 'interactive-bloch',
        initialTheta: 0,
        initialPhi: 0,
        availableGates: ['H', 'X', 'Y', 'Z', 'S', 'T'],
        challenge: {
          targetTheta: Math.PI / 2,
          targetPhi: 0,
          description: 'Move the state to the equator. Notice it stays on the surface — pure states always do.',
        },
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '4.1-q1',
            question: 'What is the purity of a maximally mixed single-qubit state?',
            options: ['0', '1/4', '1/2', '1'],
            correctIndex: 2,
            explanation: 'For d=2, the maximally mixed state ρ = I/2 has purity Tr(ρ²) = 1/2.',
          },
          {
            id: '4.1-q2',
            question: 'A 50/50 mixture of |0⟩ and |+⟩ vs the superposition (|0⟩+|+⟩)/√2 — are they the same?',
            options: [
              'Yes, they are identical',
              'No — the mixture is mixed, the superposition is pure',
              'No — the mixture has higher purity',
              'It depends on the measurement basis',
            ],
            correctIndex: 1,
            explanation: 'A statistical mixture (classical probabilities) is fundamentally different from a coherent superposition. The mixture has purity < 1; the superposition is pure.',
          },
        ],
      },
    ],
  },

  // ── Lesson 4.2 ──
  {
    id: '4.2',
    title: 'Quantum Channels & Noise',
    description: 'Kraus operators, depolarizing noise, and why real qubits are imperfect.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['4.1'],
    tags: ['quantum-channels', 'noise', 'kraus-operators', 'decoherence'],
    diracContext: 'Introduce quantum channels as the math for noise. Intuition: noise pushes pure states toward the Bloch ball center. Focus on depolarizing channel.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Real Qubits Are Noisy

**Decoherence** = qubits losing info to environment. **Quantum channels** describe this: ρ → Σᵢ Kᵢ ρ Kᵢ† (Kraus operators, Σ Kᵢ†Kᵢ = I).

| Channel | Meaning | Bloch Effect |
|---------|---------|-------------|
| **Depolarizing** | Random errors | Shrinks to center |
| **Amplitude damping** | T₁ decay | Pulls to \\|0⟩ |
| **Phase damping** | T₂ decay | Shrinks to z-axis |`,
      },
      {
        type: 'concept-card',
        title: 'Depolarizing Channel',
        visual: 'bloch',
        explanation: 'Replaces the state with I/2 with probability p, shrinking the Bloch vector by (1-p). At p=0 nothing happens; at p=1 everything becomes maximally mixed.',
      },
      {
        type: 'demo',
        code: `from qiskit.quantum_info import Statevector, DensityMatrix
from qiskit_aer.noise import depolarizing_error
import numpy as np

rho = DensityMatrix(Statevector.from_label('+'))
print(f"Initial purity: {rho.purity():.4f}")
for p in [0.1, 0.3, 0.5, 1.0]:
    ops = [np.array(k) for k in depolarizing_error(p, 1).to_instruction().params]
    noisy = DensityMatrix(sum(K @ rho.data @ K.conj().T for K in ops))
    print(f"p={p}: purity={noisy.purity():.4f}")`,
        framework: 'qiskit',
        description: 'Watch purity decrease as depolarizing noise strength increases.',
        explorationPrompt: 'Try starting with |0⟩ instead. Does purity decrease at the same rate?',
      },
      {
        type: 'exercise',
        id: '4.2-ex1',
        title: 'Noisy Bell State',
        description: 'Create a Bell state, add depolarizing noise to the H gate, and observe decoherence breaking correlations.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error

qc = QuantumCircuit(2, 2)
qc.h(0); qc.cx(0, 1)
# TODO: Add measurements, create noise model with depolarizing_error(0.3, 1) for 'h'
`,
        framework: 'qiskit',
        expectedProbabilities: { '00': 0.42, '11': 0.42, '01': 0.08, '10': 0.08 },
        tolerancePercent: 10,
        hints: [
          'Add measurements: qc.measure([0, 1], [0, 1])',
          'Create error: error = depolarizing_error(0.3, 1)',
          "Add to model: noise_model.add_all_qubit_quantum_error(error, ['h'])",
        ],
        successMessage: 'The |01⟩ and |10⟩ outcomes should never appear in a perfect Bell state. That is noise breaking entanglement.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '4.2-q1',
            question: 'What does the depolarizing channel with p=1 do?',
            options: ['Leaves state unchanged', 'Flips to opposite', 'Replaces with I/2', 'Projects onto |0⟩'],
            correctIndex: 2,
            explanation: 'At p=1, the channel completely randomizes the state, producing I/2 regardless of input.',
          },
          {
            id: '4.2-q2',
            question: 'Amplitude damping physically corresponds to:',
            options: ['Random Pauli errors', 'Energy loss (T₁ decay)', 'Phase randomization', 'Measurement back-action'],
            correctIndex: 1,
            explanation: 'Amplitude damping models spontaneous emission — the qubit losing energy from |1⟩ to |0⟩.',
          },
        ],
      },
    ],
  },

  // ── Lesson 4.3 ──
  {
    id: '4.3',
    title: 'Von Neumann Entropy',
    description: 'Quantifying quantum uncertainty with S(ρ) = −Tr(ρ log ρ).',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['4.1'],
    tags: ['entropy', 'von-neumann', 'information-theory', 'shannon'],
    diracContext: 'Entropy is a more refined measure of mixedness than purity. Draw connection to Shannon entropy. Key insight: pure=0, maximally mixed=maximum.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Measuring Quantum Uncertainty

**Von Neumann entropy:** S(ρ) = −Σᵢ λᵢ log₂ λᵢ (eigenvalues of ρ, 0 log 0 = 0)

Pure state → 0 bits. Maximally mixed (d=2) → 1 bit. For entangled pure states: S(ρ_AB)=0 but S(ρ_A)>0 — the whole has *less* uncertainty than its parts.`,
      },
      {
        type: 'concept-card',
        title: 'Shannon vs Von Neumann',
        visual: 'histogram',
        explanation:
          'Shannon entropy H(X) = −Σ pᵢ log₂ pᵢ measures classical uncertainty. Von Neumann entropy generalizes it to quantum states via eigenvalues of the density matrix. For diagonal ρ (no coherence), they are identical.',
      },
      {
        type: 'demo',
        code: `from qiskit.quantum_info import DensityMatrix, entropy, Statevector
import numpy as np

print(f"|+⟩ entropy: {entropy(DensityMatrix(Statevector.from_label('+')), base=2):.4f} bits")
print(f"I/2 entropy: {entropy(DensityMatrix(np.eye(2) / 2), base=2):.4f} bits")

# Sweep from pure to maximally mixed
for p in [0.0, 0.1, 0.2, 0.3, 0.5]:
    rho = (1 - p) * DensityMatrix.from_label('0') + p * DensityMatrix.from_label('1')
    print(f"p={p:.1f}: S = {entropy(rho, base=2):.4f} bits")`,
        framework: 'qiskit',
        description: 'Compute Von Neumann entropy for pure, mixed, and partially mixed states.',
        explorationPrompt: 'Notice entropy increases fastest near p=0.5. Why does the curve flatten at maximum uncertainty?',
      },
      {
        type: 'text',
        markdown: `## Key Properties

Non-negative (S≥0, =0 iff pure). Bounded (S≤log₂d). Subadditive (S(ρ_AB)≤S(ρ_A)+S(ρ_B)). But for entangled pure states, S(ρ_AB)=0 while S(ρ_A)>0 — the whole has less uncertainty than its parts.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '4.3-q1',
            question: 'What is the Von Neumann entropy of any pure state?',
            options: ['−1', '0', '0.5', '1'],
            correctIndex: 1,
            explanation: 'A pure state has eigenvalue 1 (rest 0). Since −1·log₂(1) = 0, entropy is exactly 0.',
          },
          {
            id: '4.3-q2',
            question: 'For a Bell state |Φ+⟩, S(ρ_AB) and S(ρ_A) are:',
            options: ['Both 0', 'Both 1', 'S(ρ_AB)=0, S(ρ_A)=1', 'S(ρ_AB)=2, S(ρ_A)=1'],
            correctIndex: 2,
            explanation: '|Φ+⟩ is pure so S(ρ_AB)=0. Each qubit alone is maximally mixed, so S(ρ_A)=1. The whole has less uncertainty than its parts.',
          },
        ],
      },
    ],
  },

  // ── Lesson 4.4 ──
  {
    id: '4.4',
    title: 'Entanglement Measures',
    description: 'Concurrence, Schmidt decomposition, and quantifying how entangled a state is.',
    difficulty: 'advanced',
    estimatedMinutes: 25,
    prerequisites: ['4.1', '4.3', '1.6'],
    tags: ['entanglement', 'concurrence', 'schmidt-decomposition', 'separability'],
    diracContext: 'Formalize entanglement: separability, concurrence for 2-qubit states, Schmidt decomposition. Focus on what the numbers mean.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## How Entangled Is It?

**Separable:** ρ = Σ pᵢ (ρᵢ^A ⊗ ρᵢ^B). Otherwise **entangled**.

**Schmidt decomposition:** |ψ⟩_AB = Σ λᵢ|aᵢ⟩|bᵢ⟩. Rank 1 = product state, rank > 1 = entangled.

**Concurrence:** C(ρ) ∈ [0,1] for 2-qubit states. Bell states have C=1.`,
      },
      {
        type: 'concept-card',
        title: 'Entanglement Spectrum',
        visual: 'histogram',
        explanation:
          'Schmidt coefficients form an entanglement spectrum. A product state has λ₁=1. A maximally entangled 2-qubit state has λ₁=λ₂=1/√2. The more uniform the spectrum, the stronger the entanglement.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector, concurrence, DensityMatrix
import numpy as np

def conc(qc):
    return concurrence(DensityMatrix(Statevector.from_instruction(qc)))

bell = QuantumCircuit(2); bell.h(0); bell.cx(0, 1)
prod = QuantumCircuit(2); prod.h(0); prod.x(1)
part = QuantumCircuit(2); part.ry(np.pi / 6, 0); part.cx(0, 1)

print(f"Bell state: {conc(bell):.4f}")
print(f"Product:    {conc(prod):.4f}")
print(f"Partial:    {conc(part):.4f}")`,
        framework: 'qiskit',
        description: 'Compute concurrence and Schmidt coefficients for different entanglement levels.',
        explorationPrompt: 'Vary the ry angle from 0 to π/2 in the partial case. How does concurrence change?',
      },
      {
        type: 'interactive-bloch',
        initialTheta: 0,
        initialPhi: 0,
        availableGates: ['H', 'X', 'CNOT'],
        challenge: {
          targetTheta: Math.PI / 2,
          targetPhi: 0,
          description: 'Create a maximally entangled state using H and CNOT. Watch how individual qubit states become maximally mixed.',
        },
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '4.4-q1',
            question: 'Schmidt coefficients λ₁=1, λ₂=0 means the state is:',
            options: ['Maximally entangled', 'Partially entangled', 'A product state', 'Invalid'],
            correctIndex: 2,
            explanation: 'Schmidt rank 1 means the state factors into |a⟩⊗|b⟩. No entanglement.',
          },
          {
            id: '4.4-q2',
            question: 'Which measure works for mixed 2-qubit states (not just pure)?',
            options: ['Schmidt rank', 'Concurrence', 'Schmidt coefficients', 'None'],
            correctIndex: 1,
            explanation: 'Concurrence is defined for arbitrary 2-qubit density matrices via the Wootters formula. Schmidt decomposition requires a pure state.',
          },
        ],
      },
    ],
  },

  // ── Lesson 4.5 ──
  {
    id: '4.5',
    title: 'No-Cloning Theorem',
    description: 'You cannot copy an arbitrary quantum state — and that changes everything.',
    difficulty: 'intermediate',
    estimatedMinutes: 15,
    prerequisites: ['1.2', '1.6'],
    tags: ['no-cloning', 'quantum-information', 'linearity', 'quantum-communication'],
    diracContext: 'One of the most important results in quantum info. Proof is simple (linearity) but implications are profound. Keep conversational.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The No-Cloning Theorem

**There is no quantum operation that copies an arbitrary unknown state.**

**Proof:** Suppose U|ψ⟩|0⟩ = |ψ⟩|ψ⟩. For |a⟩+|b⟩, linearity gives |a⟩|a⟩+|b⟩|b⟩, but cloning demands |a⟩|a⟩+|a⟩|b⟩+|b⟩|a⟩+|b⟩|b⟩. Cross terms missing. Contradiction.`,
      },
      {
        type: 'concept-card',
        title: 'Why No-Cloning Matters',
        visual: 'circuit',
        explanation:
          'Three major consequences: (1) Quantum cryptography works — eavesdroppers cannot copy qubits without disturbing them. (2) Teleportation must destroy the original — move, not copy. (3) Quantum error correction uses entanglement instead of simple duplication.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

# CNOT "copies" |0⟩ and |1⟩ perfectly
for label in ['0', '1']:
    qc = QuantumCircuit(2)
    if label == '1': qc.x(0)
    qc.cx(0, 1)
    print(f"|{label}⟩|0⟩ -> {Statevector.from_instruction(qc)}")

# But |+⟩ produces entanglement, NOT a copy
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
print(f"\\n|+⟩|0⟩ -> {Statevector.from_instruction(qc)}")
print("Bell state, NOT |+⟩|+⟩!")`,
        framework: 'qiskit',
        description: 'CNOT copies basis states but creates entanglement (not copies) for superpositions.',
        explorationPrompt: 'Try "cloning" |−⟩ or |i⟩. Compare the output with a real clone.',
      },
      {
        type: 'text',
        markdown: `## What You CAN Do

No-cloning does not trap quantum information: **teleportation** moves states, **error correction** protects them via entanglement, and classical descriptions of known states copy freely.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '4.5-q1',
            question: 'Why can known states be cloned?',
            options: [
              'They cannot — no quantum states can be cloned',
              'You can prepare fresh copies from the known recipe',
              'Cloning known states requires entanglement',
              'Known states are classical',
            ],
            correctIndex: 1,
            explanation: 'No-cloning applies to arbitrary unknown states. If you know the recipe, prepare as many copies as you want.',
          },
          {
            id: '4.5-q2',
            question: 'CNOT on |+⟩|0⟩ produces:',
            options: ['|+⟩|+⟩', '(|00⟩+|11⟩)/√2', '|+⟩|0⟩', '|0⟩|+⟩'],
            correctIndex: 1,
            explanation: 'CNOT creates a Bell state, not a copy. This is exactly why cloning fails for superpositions.',
          },
          {
            id: '4.5-q3',
            question: 'No-cloning is essential for quantum cryptography because:',
            options: [
              'It makes quantum computers faster',
              'Eavesdroppers cannot copy qubits without disturbing them',
              'It prevents decoherence',
              'It allows faster-than-light communication',
            ],
            correctIndex: 1,
            explanation: 'QKD security relies on the fact that intercepting qubits introduces detectable disturbance.',
          },
        ],
      },
    ],
  },

  // ── Lesson 4.6 ──
  {
    id: '4.6',
    title: 'Quantum Teleportation Deep Dive',
    description: 'Full protocol with classical communication, Bell measurement, and no-signaling.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['4.5', '1.6'],
    tags: ['teleportation', 'bell-measurement', 'classical-communication', 'no-signaling'],
    diracContext: 'Teleportation uses pre-shared entanglement + classical bits to move a state. Nothing FTL. Walk through step by step with 3 qubits.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Quantum Teleportation

Move |ψ⟩ from Alice to Bob using a shared Bell pair + 2 classical bits:

1. Share (|00⟩+|11⟩)/√2 between Alice and Bob
2. Alice: CNOT(ψ→Bell), then H on ψ, then measure → 2 bits
3. Bob corrects: 00→I, 01→X, 10→Z, 11→ZX

State destroyed at Alice's end, reconstructed at Bob's. No FTL — classical bits required.`,
      },
      {
        type: 'video',
        youtubeId: 'dQw4w9WgXcQ',
        title: 'Quantum Teleportation Explained',
        creator: 'Quantum Computing Lecture Series',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister
import numpy as np

qr, cr = QuantumRegister(3, 'q'), ClassicalRegister(2, 'c')
qc = QuantumCircuit(qr, cr)
qc.ry(np.pi / 4, 0)          # State to teleport
qc.h(1); qc.cx(1, 2)         # Bell pair (qubits 1-2)
qc.barrier()
qc.cx(0, 1); qc.h(0)         # Bell measurement
qc.measure(0, 0); qc.measure(1, 1)
qc.barrier()
qc.x(2).c_if(cr[1], 1)       # Bob's corrections
qc.z(2).c_if(cr[0], 1)
print(qc)`,
        framework: 'qiskit',
        description: 'Full 3-qubit teleportation circuit with state prep, Bell measurement, and corrections.',
        explorationPrompt: 'Try teleporting |+⟩ (replace ry with h) or |1⟩ (replace ry with x).',
      },
      {
        type: 'interactive-bloch',
        initialTheta: Math.PI / 4,
        initialPhi: 0,
        availableGates: ['H', 'X', 'Z', 'RY'],
        challenge: {
          targetTheta: Math.PI / 4,
          targetPhi: 0,
          description: 'This is the state being teleported. Verify Bob receives the same state after the protocol.',
        },
      },
      {
        type: 'exercise',
        id: '4.6-ex1',
        title: 'Teleport |+i⟩',
        description: 'Teleport |ψ⟩ = (|0⟩+i|1⟩)/√2 from Alice (qubit 0) to Bob (qubit 2). Qubits 1-2 are the Bell pair.',
        starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(3, 2)
# TODO: Prepare (|0⟩+i|1⟩)/√2 on q0, Bell pair on q1-q2, Bell measure, corrections
`,
        framework: 'qiskit',
        tolerancePercent: 5,
        hints: [
          'State prep: qc.h(0) then qc.s(0)',
          'Bell pair: qc.h(1) then qc.cx(1, 2)',
          'Measurement: qc.cx(0, 1), qc.h(0), qc.measure(0, 0), qc.measure(1, 1)',
        ],
        successMessage: 'The state (|0⟩+i|1⟩)/√2 was teleported. The original is destroyed — no cloning violated.',
      },
      {
        type: 'text',
        markdown: `## No FTL Communication

Before receiving Alice's bits, Bob's qubit is I/2 regardless of what was sent. Classical bits travel at light speed. Teleportation moves states, not information faster than light.`,
      },
    ],
  },

  // ── Lesson 4.7 ──
  {
    id: '4.7',
    title: 'Superdense Coding',
    description: 'Send 2 classical bits using 1 qubit — teleportation in reverse.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['4.6'],
    tags: ['superdense-coding', 'entanglement', 'communication', 'bell-states'],
    diracContext: 'Superdense coding is the dual of teleportation. Show the encoding table and the symmetry.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Superdense Coding

With pre-shared entanglement, Alice sends **2 classical bits** via **1 qubit**.

| Message | Gate | Result |
|---------|------|--------|
| 00 | I | |Φ+⟩ |
| 01 | X | |Ψ+⟩ |
| 10 | Z | |Φ−⟩ |
| 11 | ZX | |Ψ−⟩ |

Bob decodes with CNOT then H, then measures. Resource dual of teleportation: 1 ebit + 1 qubit → 2 cbits.`,
      },
      {
        type: 'concept-card',
        title: 'Teleportation vs Superdense Coding',
        visual: 'circuit',
        explanation: 'Resource duals: teleportation uses 1 ebit + 2 cbits → 1 qubit. Superdense uses 1 ebit + 1 qubit → 2 cbits. Both need pre-shared entanglement.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

def superdense(msg):
    qc = QuantumCircuit(2, 2)
    qc.h(0); qc.cx(0, 1); qc.barrier()   # Bell pair
    if msg in ('01', '11'): qc.x(0)       # Alice encodes
    if msg in ('10', '11'): qc.z(0)
    qc.barrier()
    qc.cx(0, 1); qc.h(0)                  # Bob decodes
    qc.measure([0, 1], [0, 1])
    return qc

sim = AerSimulator()
for msg in ['00', '01', '10', '11']:
    counts = sim.run(superdense(msg), shots=1024).result().get_counts()
    print(f"Sent: {msg} -> {counts}")`,
        framework: 'qiskit',
        description: 'Full superdense coding protocol — all four 2-bit messages transmitted correctly.',
        explorationPrompt: 'What happens if you swap the CNOT and H in Bob\'s decoding step?',
      },
      {
        type: 'exercise',
        id: '4.7-ex1',
        title: 'Decode a Superdense Message',
        description: 'The state is |Ψ−⟩. Write Bob\'s decoding circuit to extract the 2-bit message.',
        starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
# |Psi-> already prepared
qc.x(1); qc.h(0); qc.cx(0, 1); qc.z(0); qc.x(0)
qc.barrier()
# TODO: Bob decodes — CNOT, H, measure
`,
        framework: 'qiskit',
        expectedProbabilities: { '11': 1.0 },
        tolerancePercent: 2,
        hints: [
          'Reverse the Bell creation: qc.cx(0, 1) then qc.h(0)',
          'Then measure: qc.measure([0, 1], [0, 1])',
          '|Ψ−⟩ encodes message "11" (ZX encoding)',
        ],
        successMessage: 'Decoded message "11". Alice used ZX encoding, Bob recovered both bits from a single qubit.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '4.7-q1',
            question: 'How many classical bits can superdense coding send per qubit?',
            options: ['1', '2', '4', 'Unlimited'],
            correctIndex: 1,
            explanation: '2 bits per transmitted qubit, saturating the Holevo bound. Requires pre-shared entanglement.',
          },
        ],
      },
    ],
  },

  // ── Lesson 4.8 ──
  {
    id: '4.8',
    title: 'Quantum State Tomography',
    description: 'Reconstruct an unknown state from measurements in X, Y, Z bases.',
    difficulty: 'advanced',
    estimatedMinutes: 25,
    prerequisites: ['4.1', '1.4'],
    tags: ['tomography', 'measurement-bases', 'state-reconstruction', 'pauli-operators'],
    diracContext: 'Experimental counterpart to theory. Measure many copies in X, Y, Z bases to reconstruct Bloch vector. Requires many copies (no-cloning).',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Reconstructing Quantum States

Prepare many identical copies and measure in X, Y, Z bases. Any single-qubit ρ = (I + r·σ)/2 where **r** is the Bloch vector.

- **r_x = ⟨X⟩**: H before measurement
- **r_y = ⟨Y⟩**: S†H before measurement
- **r_z = ⟨Z⟩**: standard measurement

Each: (count_0 − count_1) / total_shots.`,
      },
      {
        type: 'concept-card',
        title: 'Three Measurements, One State',
        visual: 'bloch',
        explanation:
          'The three Pauli expectation values give the Bloch vector coordinates. For pure states r² = 1 (on the surface). For mixed states r² < 1 (inside). With enough shots, you can pinpoint any single-qubit state.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np

shots, sim = 8192, AerSimulator()

def expect(state_qc, basis):
    qc = state_qc.copy()
    qc.add_register(qc._create_creg(1, 'c'))
    if basis == 'X': qc.h(0)
    elif basis == 'Y': qc.sdg(0); qc.h(0)
    qc.measure(0, 0)
    c = sim.run(qc, shots=shots).result().get_counts()
    return c.get('0', 0) / shots - c.get('1', 0) / shots

mystery = QuantumCircuit(1)
mystery.ry(np.pi / 3, 0)
mystery.rz(np.pi / 4, 0)

r = [expect(mystery, b) for b in ['X', 'Y', 'Z']]
print(f"Bloch vector: ({r[0]:.3f}, {r[1]:.3f}, {r[2]:.3f})")
print(f"|r| = {np.linalg.norm(r):.3f}")`,
        framework: 'qiskit',
        description: 'Single-qubit tomography: measure in X, Y, Z bases to reconstruct the Bloch vector.',
        explorationPrompt: 'Change the mystery state. Can you identify it from the Bloch vector? Try fewer shots — how noisy does reconstruction get?',
      },
      {
        type: 'exercise',
        id: '4.8-ex1',
        title: 'Identify the Mystery State',
        description: 'The mystery state is |+i⟩ = (|0⟩+i|1⟩)/√2. Perform tomography to recover r = (0, 1, 0).',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np

shots, sim = 8192, AerSimulator()

def get_mystery():
    qc = QuantumCircuit(1)
    qc.h(0); qc.s(0)
    return qc

# TODO: Measure <Z>, <X>, <Y> and print the Bloch vector (r_x, r_y, r_z)
`,
        framework: 'qiskit',
        tolerancePercent: 8,
        hints: [
          'Copy the circuit, add qc.measure(0, 0), run, compute (count_0 - count_1)/shots',
          'For X basis: add qc.h(0) before measurement',
          'For Y basis: add qc.sdg(0) then qc.h(0) before measurement',
          'Expected result: r ≈ (0, 1, 0) — the state points along +Y',
        ],
        successMessage: 'Reconstructed r = (0, 1, 0), identifying the state as |+i⟩. This is the essence of quantum state tomography.',
      },
      {
        type: 'text',
        markdown: `## Scaling

1 qubit: 3 settings. 2 qubits: 9. n qubits: 3ⁿ. For 10 qubits that's 59,000+ — full tomography only works for small systems. **Shadow tomography** reduces this overhead.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '4.8-q1',
            question: 'To measure ⟨X⟩, apply which gate before Z-basis measurement?',
            options: ['X', 'Z', 'H', 'S'],
            correctIndex: 2,
            explanation: 'H rotates X eigenstates |+⟩,|−⟩ into Z eigenstates |0⟩,|1⟩. Measuring after H effectively measures in the X basis.',
          },
          {
            id: '4.8-q2',
            question: 'Tomography gives r = (0, 0, 0). The state is:',
            options: ['|0⟩', '|+⟩', 'Maximally mixed I/2', 'Invalid'],
            correctIndex: 2,
            explanation: 'Bloch vector (0,0,0) is the center of the ball: the maximally mixed state ρ = I/2.',
          },
        ],
      },
    ],
  },
];
