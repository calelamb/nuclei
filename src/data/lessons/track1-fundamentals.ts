import type { Lesson } from './types';

export const TRACK1_LESSONS: Lesson[] = [
  // ── Lesson 1.1 ──
  {
    id: '1.1',
    title: 'What is Quantum Computing?',
    description: 'Classical bits vs qubits — your first quantum circuit.',
    difficulty: 'beginner',
    estimatedMinutes: 15,
    prerequisites: [],
    tags: ['qubits', 'classical-bits', 'introduction'],
    diracContext: 'The student is just starting. They may have zero quantum background. Be encouraging. Use analogies to coins (heads/tails). Do NOT mention linear algebra, matrices, or complex numbers yet.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Welcome to Quantum Computing

Classical computers use **bits** — 0 or 1. Quantum computers use **qubits**, which can be 0, 1, or a combination of both at the same time. This isn't magic — it's physics. And you're about to see it in action.`,
      },
      {
        type: 'video',
        youtubeId: 'T2DXrs0OpHU',
        title: 'How Does a Quantum Computer Work?',
        creator: 'Veritasium',
        startTime: 0,
        endTime: 300,
      },
      {
        type: 'concept-card',
        title: 'Classical Bit vs Qubit',
        visual: 'bloch',
        explanation: 'A classical bit is like a light switch — on or off. A qubit is like a globe — it can point in any direction. The north pole is |0⟩, the south pole is |1⟩, and everything in between is a superposition.',
      },
      {
        type: 'text',
        markdown: `## Your First Circuit

Let's run the simplest possible quantum circuit: create a qubit and measure it. No gates, no tricks — just measure what's there.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.measure(0, 0)`,
        framework: 'qiskit',
        description: 'A qubit starts in |0⟩. Measuring it gives 100% |0⟩.',
        explorationPrompt: 'This circuit does nothing interesting — it just confirms the qubit starts at |0⟩. In the next lesson, we\'ll change that.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '1.1-q1',
            question: 'What is the fundamental unit of quantum computing?',
            options: ['Bit', 'Qubit', 'Byte', 'Transistor'],
            correctIndex: 1,
            explanation: 'A qubit (quantum bit) is the fundamental unit. Unlike classical bits, qubits can exist in superposition.',
          },
          {
            id: '1.1-q2',
            question: 'How many states can a classical bit be in?',
            options: ['1', '2', '3', 'Infinite'],
            correctIndex: 1,
            explanation: 'A classical bit is either 0 or 1 — exactly 2 states.',
          },
          {
            id: '1.1-q3',
            question: 'What makes a qubit different from a classical bit?',
            options: [
              'It is faster',
              'It can be in a superposition of 0 and 1',
              'It uses less energy',
              'It is smaller',
            ],
            correctIndex: 1,
            explanation: 'A qubit can be in a superposition — a combination of |0⟩ and |1⟩ at the same time. This is the key quantum property.',
          },
        ],
      },
    ],
  },

  // ── Lesson 1.2 ──
  {
    id: '1.2',
    title: 'Your First Quantum Gate — The Hadamard',
    description: 'The H gate puts a qubit into superposition — equal chances of 0 and 1.',
    difficulty: 'beginner',
    estimatedMinutes: 20,
    prerequisites: ['1.1'],
    tags: ['hadamard', 'superposition', 'gates'],
    diracContext: 'This lesson introduces the H gate and superposition. The student will see 50/50 results for the first time. Emphasize that this is REAL randomness, not pseudorandom. If they ask about the math, you can mention that H creates the state (|0⟩ + |1⟩)/√2, but keep it light. The Bloch sphere visual is more important than the math right now.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Hadamard Gate

A **gate** is an operation that changes a qubit's state. The most important gate in quantum computing is the **Hadamard gate (H)**. It takes a qubit from a definite state (|0⟩) into a **superposition** — equal chances of measuring 0 or 1.`,
      },
      {
        type: 'video',
        youtubeId: 'kMm4white1o',
        title: 'What is Superposition?',
        creator: 'IBM Qiskit',
      },
      {
        type: 'concept-card',
        title: 'The H Gate',
        visual: 'bloch',
        explanation: 'The Hadamard gate rotates |0⟩ (north pole) to |+⟩ (equator). At the equator, the qubit has an equal probability of being measured as 0 or 1. This is superposition.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.h(0)
qc.measure(0, 0)`,
        framework: 'qiskit',
        description: 'Add an H gate before measurement — the histogram shows ~50% |0⟩, ~50% |1⟩.',
        explorationPrompt: 'Try running this 10 times. Notice how the exact percentages change slightly each time? That\'s quantum randomness — the outcomes are truly random, not pseudo-random like a computer\'s random number generator.',
      },
      {
        type: 'exercise',
        id: '1.2-ex1',
        title: 'Create a quantum coin flip',
        description: 'Build a circuit with 1 qubit that produces a 50/50 outcome.',
        starterCode: `from qiskit import QuantumCircuit

# Create a 1-qubit, 1-classical-bit circuit
qc = QuantumCircuit(1, 1)

# TODO: Add a gate that puts the qubit in superposition

# TODO: Add a measurement

`,
        framework: 'qiskit',
        expectedProbabilities: { '0': 0.5, '1': 0.5 },
        tolerancePercent: 5,
        hints: [
          'You need to put the qubit in superposition.',
          'The Hadamard gate (qc.h) creates equal superposition.',
          'Don\'t forget to add a measurement after the gate: qc.measure(0, 0)',
        ],
        successMessage: 'Congratulations! You just built a quantum random number generator. No classical computer can produce truly random numbers like this.',
      },
    ],
  },

  // ── Lesson 1.3 ──
  {
    id: '1.3',
    title: 'Measurement — Observing Changes Everything',
    description: 'When you measure a qubit in superposition, it collapses to 0 or 1.',
    difficulty: 'beginner',
    estimatedMinutes: 15,
    prerequisites: ['1.2'],
    tags: ['measurement', 'collapse', 'superposition'],
    diracContext: 'This lesson is about measurement collapse. It\'s one of the most counterintuitive aspects of quantum mechanics. Students often struggle with WHY measurement changes the state — it\'s okay to say "this is how nature works" rather than trying to explain the philosophy. Focus on the observable behavior: run the circuit, see the results, notice that measurement breaks the pattern.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Measurement Collapse

In the classical world, measuring something doesn't change it. You can check the time without affecting the clock. In quantum mechanics, **measurement fundamentally changes the system**. A qubit in superposition "collapses" to either 0 or 1 when you measure it — and the superposition is gone.`,
      },
      {
        type: 'video',
        youtubeId: 'SMbh0GgCN7I',
        title: 'Measuring a Qubit',
        creator: 'Michael Nielsen',
      },
      {
        type: 'concept-card',
        title: 'Measurement Collapse',
        visual: 'bloch',
        explanation: 'A qubit in superposition sits on the equator of the Bloch sphere. When you measure it, it snaps to the north pole (|0⟩) or south pole (|1⟩). The superposition is destroyed.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 2)
qc.h(0)
qc.measure(0, 0)
qc.h(0)
qc.measure(0, 1)`,
        framework: 'qiskit',
        description: 'Two measurements on the same qubit — does the second H undo the first?',
        explorationPrompt: 'Look at classical bit 1 (the second measurement). If measurement didn\'t collapse the state, the second H would undo the first (H applied twice = identity), and you\'d always get |0⟩. But that\'s NOT what happens. The first measurement collapsed the state, so the second H creates a new superposition.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '1.3-q1',
            question: 'What happens when you measure a qubit in superposition?',
            options: [
              'Nothing changes',
              'It collapses to either |0⟩ or |1⟩',
              'It stays in superposition',
              'It becomes entangled',
            ],
            correctIndex: 1,
            explanation: 'Measurement collapses the superposition — the qubit randomly becomes |0⟩ or |1⟩.',
          },
          {
            id: '1.3-q2',
            question: 'Can you undo a measurement?',
            options: ['Yes, with another gate', 'Yes, with H gate', 'No, measurement is irreversible', 'Only with Z gate'],
            correctIndex: 2,
            explanation: 'Measurement is irreversible. Once you measure, the superposition is destroyed and cannot be recovered.',
          },
          {
            id: '1.3-q3',
            question: 'If you apply H twice without measuring in between, what do you get?',
            options: ['Random results', 'Always |1⟩', 'The original state (back to |0⟩)', 'An error'],
            correctIndex: 2,
            explanation: 'H applied twice is the identity: H·H = I. The qubit returns to its original state.',
          },
        ],
      },
    ],
  },

  // ── Lesson 1.4 ──
  {
    id: '1.4',
    title: 'Rotation Gates — Controlling the Bloch Sphere',
    description: 'RX, RY, RZ gates let you rotate to any point on the Bloch sphere.',
    difficulty: 'beginner',
    estimatedMinutes: 25,
    prerequisites: ['1.3'],
    tags: ['rotation-gates', 'bloch-sphere', 'ry', 'rx', 'rz'],
    diracContext: 'This lesson introduces rotation gates and the Bloch sphere as a control surface. The big insight is that the angle parameter gives continuous control over probabilities. If the student asks about the math, you can introduce sin\u00B2(\u03B8/2) for the RY probability, but lead with the visual — "the further you rotate from the north pole, the more likely you measure |1\u27E9." Encourage them to experiment with different angles.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Rotation Gates

The H gate is useful, but it only gives you 50/50. What if you want 70/30? Or 90/10? **Rotation gates (RX, RY, RZ)** let you rotate the qubit to any position on the Bloch sphere. The angle you choose determines the probability.`,
      },
      {
        type: 'video',
        youtubeId: 'wta0o3fLOnk',
        title: 'X, Y, Z, H Gates Explained',
        creator: 'Quantum Computing (DSC TIET)',
      },
      {
        type: 'concept-card',
        title: 'The Bloch Sphere',
        visual: 'bloch',
        explanation: '|0⟩ is at the north pole, |1⟩ at the south pole, |+⟩ and |−⟩ on the equator. RX rotates around the X axis, RY around Y, RZ around Z. The rotation angle determines how far the qubit moves.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
import math

qc = QuantumCircuit(1, 1)
qc.ry(math.pi / 4, 0)   # Try changing this angle!
qc.measure(0, 0)`,
        framework: 'qiskit',
        description: 'RY gate at different angles — the angle controls probability.',
        explorationPrompt: 'Change `math.pi / 4` to `math.pi / 2` — what happens? Now try `math.pi` (full rotation). What do you get? The angle controls how far the qubit rotates from |0⟩ toward |1⟩.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
import math

# Try each one — which ones change the histogram?
qc = QuantumCircuit(1, 1)
qc.ry(math.pi / 2, 0)   # Swap ry for rx or rz
qc.measure(0, 0)`,
        framework: 'qiskit',
        description: 'Compare RX, RY, RZ with the same angle.',
        explorationPrompt: 'RZ rotates around the Z axis. Since |0⟩ is at the north pole (on the Z axis), RZ doesn\'t change the probability — it only changes the phase. You won\'t see a difference in the histogram, but the Bloch sphere position changes. Phase matters later.',
      },
      {
        type: 'exercise',
        id: '1.4-ex1',
        title: 'Bias the coin',
        description: 'Create a circuit where qubit 0 has approximately 75% chance of being measured as |0⟩ and 25% chance of |1⟩.',
        starterCode: `from qiskit import QuantumCircuit
import math

qc = QuantumCircuit(1, 1)

# TODO: Add a rotation gate with the right angle
# Hint: the probability of measuring |1⟩ is sin²(θ/2) for RY(θ)

qc.measure(0, 0)`,
        framework: 'qiskit',
        expectedProbabilities: { '0': 0.75, '1': 0.25 },
        tolerancePercent: 8,
        hints: [
          'You need a rotation gate — RY is the most intuitive for changing probabilities.',
          'The probability of measuring |1⟩ is sin\u00B2(\u03B8/2) where \u03B8 is the RY angle.',
          'For 25% on |1⟩: sin\u00B2(\u03B8/2) = 0.25, so \u03B8/2 = \u03C0/6, so \u03B8 = \u03C0/3',
        ],
        successMessage: 'You can now prepare any single-qubit state you want. This is the foundation of quantum state preparation.',
      },
    ],
  },

  // ── Lesson 1.5 ──
  {
    id: '1.5',
    title: 'The X, Y, Z Gates — Pauli Gates',
    description: 'The simplest quantum gates: each does a 180\u00B0 rotation around one axis.',
    difficulty: 'beginner',
    estimatedMinutes: 20,
    prerequisites: ['1.4'],
    tags: ['pauli-gates', 'x-gate', 'y-gate', 'z-gate'],
    diracContext: 'This lesson covers Pauli gates. The X gate is straightforward (bit flip). The crucial insight is that Z gate "does nothing visible" to |0⟩ but matters when the qubit is in superposition. The H-Z-H = X equivalence is the first time the student sees that different circuits can be equivalent. If the student is confused about phase, use the Bloch sphere: "Z rotates around the vertical axis — if you\'re at the north pole, spinning around the pole doesn\'t move you. But if you\'re on the equator (superposition), it swings you to the opposite side."',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Pauli Gates

Before we add more qubits, let's meet the three **Pauli gates**. They're the simplest quantum gates — each one does a 180\u00B0 rotation around one axis of the Bloch sphere.

- **X** flips |0⟩ to |1⟩ (like a classical NOT gate)
- **Y** and **Z** are more subtle`,
      },
      {
        type: 'concept-card',
        title: 'Pauli X — The Bit Flip',
        visual: 'bloch',
        explanation: 'The X gate rotates 180\u00B0 around the X axis: |0⟩ (north pole) flips to |1⟩ (south pole) and vice versa. It\'s the quantum NOT gate.',
      },
      {
        type: 'concept-card',
        title: 'Pauli Z — The Phase Flip',
        visual: 'bloch',
        explanation: 'The Z gate rotates 180\u00B0 around the Z axis. It doesn\'t change |0⟩ or |1⟩, but when a qubit is in superposition (|+⟩), Z flips it to |−⟩. The histogram doesn\'t change, but the phase does.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.x(0)       # Try .y(0) and .z(0) too
qc.measure(0, 0)`,
        framework: 'qiskit',
        description: 'Try all three Pauli gates on |0⟩.',
        explorationPrompt: 'X gives 100% |1⟩ — it\'s a bit flip. Now try Z. The histogram shows 100% |0⟩ still! Z doesn\'t change |0⟩. But put an H before the Z, then another H after. Now what happens?',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.h(0)
qc.z(0)
qc.h(0)
qc.measure(0, 0)`,
        framework: 'qiskit',
        description: 'Z gate\'s hidden effect revealed through H-Z-H.',
        explorationPrompt: 'H-Z-H gives 100% |1⟩! The Z gate changed the phase while the qubit was in superposition, and the second H converted that phase difference into a measurable bit flip. This is the core idea behind many quantum algorithms.',
      },
      {
        type: 'exercise',
        id: '1.5-ex1',
        title: 'Flip a qubit without using X',
        description: 'Start with |0⟩ and get 100% |1⟩ outcome using only H and Z gates (no X gate allowed).',
        starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)

# TODO: Get 100% |1⟩ using only H and Z gates
# (Do NOT use the X gate)

qc.measure(0, 0)`,
        framework: 'qiskit',
        expectedProbabilities: { '1': 1.0 },
        tolerancePercent: 1,
        hints: [
          'Think about what H-Z-H did in the demo.',
          'H puts you in superposition, Z flips the phase, H converts that back.',
          'The sequence H \u2192 Z \u2192 H is equivalent to X.',
        ],
        successMessage: 'You just discovered gate equivalence — different gate sequences can produce the same result. H-Z-H = X. This kind of decomposition is fundamental to quantum circuit design.',
      },
    ],
  },

  // ── Lesson 1.6 ──
  {
    id: '1.6',
    title: 'Two Qubits — More Qubits, More States',
    description: 'N qubits = 2^N possible outcomes. Exponential state space is where quantum gets its power.',
    difficulty: 'beginner',
    estimatedMinutes: 20,
    prerequisites: ['1.5'],
    tags: ['multi-qubit', 'state-space', 'two-qubits'],
    diracContext: 'This lesson introduces multi-qubit systems. The big idea is exponential state space — 2^N outcomes for N qubits. The Qiskit little-endian bit ordering confuses many beginners (|01⟩ means qubit 0 is 1, qubit 1 is 0). Watch for this and clarify if they get mixed up. The independence of the two qubits in the H-H demo is important setup for entanglement in the next lesson.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Two Qubits — Exponential State Space

One qubit has 2 possible outcomes: |0⟩ and |1⟩. Two qubits have 4: |00⟩, |01⟩, |10⟩, |11⟩. Three qubits have 8. **N qubits have 2\u207F**. This exponential growth is where quantum computing gets its power.`,
      },
      {
        type: 'video',
        youtubeId: 'placeholder',
        title: 'Multi-qubit States',
        creator: 'IBM Qiskit',
      },
      {
        type: 'concept-card',
        title: 'Exponential State Space',
        visual: 'histogram',
        explanation: '1 qubit \u2192 2 bars. 2 qubits \u2192 4 bars. 3 qubits \u2192 8 bars. 10 qubits \u2192 1024 bars. Each additional qubit doubles the number of possible outcomes.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.x(1)                  # Flip qubit 1 to |1⟩
qc.measure([0, 1], [0, 1])`,
        framework: 'qiskit',
        description: 'A 2-qubit circuit — flip one qubit and measure both.',
        explorationPrompt: 'The result is |10⟩ (qubit 1 is |1⟩, qubit 0 is |0⟩). Note: Qiskit uses little-endian ordering — the rightmost bit is qubit 0. Try putting H on qubit 0 instead of X on qubit 1. What are the possible outcomes?',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.h(1)
qc.measure([0, 1], [0, 1])`,
        framework: 'qiskit',
        description: 'Both qubits in superposition independently.',
        explorationPrompt: 'Four equal bars! Each qubit is independently in superposition, so all 4 combinations are equally likely. But these qubits aren\'t connected to each other — they\'re independent. In the next lesson, we\'ll link them.',
      },
      {
        type: 'exercise',
        id: '1.6-ex1',
        title: 'Create the |01⟩ state',
        description: 'Build a 2-qubit circuit that always measures |01⟩ (qubit 0 = 1, qubit 1 = 0).',
        starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)

# TODO: Prepare the |01⟩ state
# Remember: Qiskit uses little-endian ordering
# |01⟩ means qubit 0 = 1, qubit 1 = 0

qc.measure([0, 1], [0, 1])`,
        framework: 'qiskit',
        expectedProbabilities: { '01': 1.0 },
        tolerancePercent: 1,
        hints: [
          'Qubits start in |0⟩ — you only need to flip the one you want to be |1⟩.',
          'Which qubit needs to be |1⟩? Remember Qiskit\'s ordering: the rightmost bit is qubit 0.',
          'Apply X to qubit 0 to flip it to |1⟩.',
        ],
        successMessage: 'You can now prepare specific multi-qubit states. You\'re controlling individual qubits independently.',
      },
    ],
  },

  // ── Lesson 1.7 ──
  {
    id: '1.7',
    title: 'The CNOT Gate — Qubits That Talk to Each Other',
    description: 'The first two-qubit gate: if the control is |1⟩, flip the target.',
    difficulty: 'beginner',
    estimatedMinutes: 25,
    prerequisites: ['1.6'],
    tags: ['cnot', 'two-qubit-gates', 'entanglement-intro'],
    diracContext: 'This lesson introduces CNOT and entanglement. The CNOT truth table is helpful but the real aha moment is Demo 2: H + CNOT producing only |00⟩ and |11⟩. Make sure the student understands that these qubits are now CORRELATED, not independent. If they ask "why does this happen?" — explain it as: the CNOT says "copy the control to the target," but the control is in superposition, so the copy also gets entangled. Don\'t go into EPR paradox or Bell inequalities unless they ask.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The CNOT Gate

So far, each qubit has been independent — gates on qubit 0 don't affect qubit 1. The **CNOT** (Controlled-NOT) gate changes that. It has a **control** qubit and a **target** qubit:

- If the control is |1⟩, it **flips** the target
- If the control is |0⟩, it **does nothing**

This is the first two-qubit gate, and it's how qubits become connected.`,
      },
      {
        type: 'video',
        youtubeId: 'rLF-oHaXLtE',
        title: 'The Controlled-NOT Gate',
        creator: 'Michael Nielsen',
      },
      {
        type: 'concept-card',
        title: 'CNOT Gate',
        visual: 'circuit',
        explanation: 'CNOT has a control (dot) and target (\u2295). Truth table: |00⟩\u219200⟩, |01⟩\u219201⟩, |10⟩\u219211⟩, |11⟩\u219210⟩. The target flips only when the control is |1⟩.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.x(0)         # Put control qubit in |1⟩
qc.cx(0, 1)     # CNOT: control=0, target=1
qc.measure([0, 1], [0, 1])`,
        framework: 'qiskit',
        description: 'CNOT with control in |1⟩.',
        explorationPrompt: 'Result: |11⟩. The control (qubit 0) was |1⟩, so CNOT flipped the target (qubit 1) from |0⟩ to |1⟩. Now remove the X gate so control stays |0⟩. What happens?',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.h(0)         # Control in superposition
qc.cx(0, 1)     # CNOT
qc.measure([0, 1], [0, 1])`,
        framework: 'qiskit',
        description: 'CNOT with control in superposition — creates entanglement!',
        explorationPrompt: 'Only |00⟩ and |11⟩ appear! Never |01⟩ or |10⟩. The qubits are now correlated — if one is 0, the other is always 0. If one is 1, the other is always 1. This is entanglement. You just created a Bell state.',
      },
      {
        type: 'exercise',
        id: '1.7-ex1',
        title: 'Create the anti-correlated Bell state',
        description: 'Build a circuit where the two qubits are always opposite: if one is |0⟩ the other is |1⟩, and vice versa. You should only see |01⟩ and |10⟩ in the histogram.',
        starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)

# TODO: Create a Bell state where the qubits are
# always OPPOSITE (|01⟩ and |10⟩ only)

qc.measure([0, 1], [0, 1])`,
        framework: 'qiskit',
        expectedProbabilities: { '01': 0.5, '10': 0.5 },
        tolerancePercent: 5,
        hints: [
          'Start with the Bell state from the demo (H + CNOT).',
          'You need to flip one of the qubits after entangling them.',
          'Add an X gate to qubit 0 or qubit 1 after the CNOT.',
        ],
        successMessage: 'You\'ve created the |\u03A8+⟩ Bell state — one of four maximally entangled states. Einstein called this "spooky action at a distance."',
      },
    ],
  },

  // ── Lesson 1.8 ──
  {
    id: '1.8',
    title: 'Entanglement — Spooky Action at a Distance',
    description: 'All four Bell states and why entanglement is the most powerful quantum resource.',
    difficulty: 'beginner',
    estimatedMinutes: 20,
    prerequisites: ['1.7'],
    tags: ['entanglement', 'bell-states', 'epr'],
    diracContext: 'This lesson deepens entanglement understanding. The student already created a Bell state in the previous lesson — now they learn all four. The key conceptual point is that entanglement is a RESOURCE that quantum algorithms use, not just a curiosity. If the student asks about FTL communication, explain that you can\'t send information faster than light with entanglement — the outcomes are random, and you need classical communication to know what the other person measured.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Entanglement

Entanglement is the most powerful resource in quantum computing. When two qubits are entangled, measuring one **instantly determines the other** — no matter how far apart they are.

Einstein was so disturbed by this that he called it "spooky action at a distance." But it's real, it's been experimentally verified thousands of times, and it's the engine behind quantum algorithms and quantum teleportation.`,
      },
      {
        type: 'video',
        youtubeId: 'ZuvK-od7jHA',
        title: 'Quantum Entanglement Explained',
        creator: 'Veritasium',
      },
      {
        type: 'concept-card',
        title: 'The Four Bell States',
        visual: 'circuit',
        explanation: '|\u03A6+⟩ = H+CNOT (|00⟩+|11⟩), |\u03A6\u2212⟩ = H+CNOT+Z (|00⟩\u2212|11⟩), |\u03A8+⟩ = H+CNOT+X (|01⟩+|10⟩), |\u03A8\u2212⟩ = H+CNOT+X+Z (|01⟩\u2212|10⟩). Four maximally entangled 2-qubit states.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# Bell State: |Φ+⟩  (try the others below)
qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
# For |Φ-⟩: add qc.z(0)
# For |Ψ+⟩: add qc.x(1)
# For |Ψ-⟩: add qc.x(1) then qc.z(0)
qc.measure([0, 1], [0, 1])`,
        framework: 'qiskit',
        description: 'All four Bell states — uncomment lines to switch between them.',
        explorationPrompt: 'Uncomment the different lines to create each Bell state. Notice that |\u03A6⟩ states always have matching qubits (00 or 11), while |\u03A8⟩ states always have opposite qubits (01 or 10). The Z gate only affects which version (+ or \u2212) you get — it changes the phase between the two terms.',
      },
      {
        type: 'exercise',
        id: '1.8-ex1',
        title: 'Create all four Bell states',
        description: 'Build a circuit that creates the |\u03A6\u2212⟩ Bell state: you should see |00⟩ and |11⟩ with equal probability. The key difference from |\u03A6+⟩ is the relative phase (which affects interference in later circuits).',
        starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)

# TODO: Create the |Φ-⟩ Bell state
# It should produce |00⟩ and |11⟩ (like |Φ+⟩)
# but with a phase difference

qc.measure([0, 1], [0, 1])`,
        framework: 'qiskit',
        expectedProbabilities: { '00': 0.5, '11': 0.5 },
        tolerancePercent: 5,
        hints: [
          'All Bell states start with H on qubit 0 and CNOT(0,1).',
          'The difference is what you add AFTER the CNOT.',
          '|\u03A6\u2212⟩ adds a Z gate to qubit 0 after the CNOT.',
        ],
        successMessage: 'You now know the four Bell states — the building blocks of quantum information. These appear everywhere: teleportation, superdense coding, error correction, and more.',
      },
    ],
  },

  // ── Lesson 1.9 ──
  {
    id: '1.9',
    title: 'Phase and Interference — Why Quantum Algorithms Work',
    description: 'Phase is invisible in histograms but crucial for quantum speedups.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['1.8'],
    tags: ['phase', 'interference', 'constructive', 'destructive'],
    diracContext: 'This is the most conceptually difficult lesson so far. Phase is invisible in histograms but crucial for algorithms. The key demos are: (1) H-H = identity (constructive interference), (2) H-Z-H = X (destructive interference), and (3) phase kickback. If the student is struggling, focus on the wave analogy: waves can add up (constructive) or cancel out (destructive). Quantum algorithms arrange gates so that wrong answers cancel and right answers amplify. Don\'t rush — this lesson is worth spending extra time on.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Phase and Interference

We've been focused on probabilities, but there's a hidden variable that doesn't show up in the histogram: **phase**. Phase is the secret ingredient that makes quantum algorithms faster than classical ones.

When qubit states have the right phases, they can **interfere** — constructive interference amplifies correct answers, destructive interference cancels wrong ones.`,
      },
      {
        type: 'video',
        youtubeId: 'placeholder',
        title: 'Quantum Interference',
        creator: 'IBM Qiskit',
      },
      {
        type: 'concept-card',
        title: 'Interference',
        visual: 'custom-svg',
        explanation: 'Like waves in water: two waves can add up (constructive interference, bigger wave) or cancel out (destructive interference, flat line). Quantum algorithms use gates to set up phases so the right answer gets amplified and wrong answers get cancelled.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.h(0)    # |0⟩ → |+⟩
qc.h(0)    # |+⟩ → |0⟩  (constructive interference)
qc.measure(0, 0)`,
        framework: 'qiskit',
        description: 'H-H cancellation — constructive interference back to |0⟩.',
        explorationPrompt: '100% |0⟩! The two H gates cancel out perfectly. The |0⟩ component interfered constructively and the |1⟩ component interfered destructively.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.h(0)    # |0⟩ → |+⟩
qc.z(0)    # |+⟩ → |−⟩  (flip the phase)
qc.h(0)    # |−⟩ → |1⟩  (destructive interference)
qc.measure(0, 0)`,
        framework: 'qiskit',
        description: 'H-Z-H — destructive interference gives |1⟩.',
        explorationPrompt: 'The Z gate flipped the phase, so the second H produced destructive interference on |0⟩ and constructive interference on |1⟩. Result: 100% |1⟩. This H-Z-H = X pattern is the simplest example of a quantum algorithm using interference.',
      },
      {
        type: 'exercise',
        id: '1.9-ex1',
        title: 'Phase kickback',
        description: 'Create a 2-qubit circuit where a controlled-Z (CZ) gate causes the CONTROL qubit to flip, not the target. This is called phase kickback and it\'s the engine behind Deutsch-Jozsa, Grover\'s, and Shor\'s algorithms.',
        starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 1)

# TODO: Demonstrate phase kickback
# 1. Put the control qubit (0) in |+⟩ state
# 2. Put the target qubit (1) in |1⟩ state
# 3. Apply CZ gate
# 4. Apply H to the control qubit
# 5. Measure the control qubit

qc.measure(0, 0)`,
        framework: 'qiskit',
        expectedProbabilities: { '1': 1.0 },
        tolerancePercent: 1,
        hints: [
          'Put the control qubit in |+⟩ state with H.',
          'Put the target qubit in |1⟩ state with X.',
          'Apply CZ (qc.cz(0, 1)), then H on the control again, then measure the control.',
          'The CZ gate kicks a phase back to the control qubit, and the final H converts it to a bit flip.',
        ],
        successMessage: 'Phase kickback is arguably the most important concept in quantum algorithms. Every quantum speedup — Deutsch-Jozsa, Grover\'s search, Shor\'s factoring — relies on this trick.',
      },
    ],
  },

  // ── Lesson 1.10 ──
  {
    id: '1.10',
    title: 'Your First Algorithm — Deutsch-Jozsa',
    description: 'The simplest quantum algorithm that demonstrates quantum advantage.',
    difficulty: 'intermediate',
    estimatedMinutes: 30,
    prerequisites: ['1.9'],
    tags: ['deutsch-jozsa', 'algorithm', 'quantum-advantage', 'oracle'],
    diracContext: 'This is the capstone of Track 1. The student is implementing a real quantum algorithm. Key concepts to reinforce: (1) the oracle is a black box that encodes the function, (2) H gates before and after create the interference pattern, (3) phase kickback (from lesson 1.9) is what makes it work — the oracle kicks phase onto the input qubits, and the final H gates convert that into measurable bits. If the student gets the exercise right, make it feel like a big achievement — they just wrote a quantum algorithm from scratch.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Your First Quantum Algorithm

Time to put everything together. The **Deutsch-Jozsa algorithm** is the simplest quantum algorithm that demonstrates quantum advantage.

It answers a question in **ONE query** that would take a classical computer up to 2\u207D\u207F\u207B\u00B9\u207E + 1 queries:

> Given a function f(x) that takes N bits and returns 0 or 1, is f **constant** (same output for all inputs) or **balanced** (0 for half, 1 for the other half)?`,
      },
      {
        type: 'video',
        youtubeId: 'placeholder',
        title: 'Deutsch-Jozsa Algorithm',
        creator: 'IBM Qiskit',
      },
      {
        type: 'concept-card',
        title: 'Constant vs Balanced',
        visual: 'custom-svg',
        explanation: 'A constant function returns the same value for every input (always 0 or always 1). A balanced function returns 0 for exactly half the inputs and 1 for the other half. Deutsch-Jozsa tells you which type it is with a single query.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 1)

# Prepare
qc.x(1)         # Set output qubit to |1⟩
qc.h(0)          # Input qubit in superposition
qc.h(1)          # Output qubit in |−⟩

# Oracle: constant (do nothing — f(x) = 0 for all x)

# Interfere
qc.h(0)
qc.measure(0, 0)`,
        framework: 'qiskit',
        description: 'Deutsch-Jozsa with a constant oracle — f always returns 0.',
        explorationPrompt: 'Result: |0⟩. The algorithm says "constant." Now let\'s try a balanced oracle.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 1)

# Prepare
qc.x(1)
qc.h(0)
qc.h(1)

# Oracle: balanced (CNOT — f flips output when input is 1)
qc.cx(0, 1)

# Interfere
qc.h(0)
qc.measure(0, 0)`,
        framework: 'qiskit',
        description: 'Deutsch-Jozsa with a balanced oracle — CNOT as the oracle.',
        explorationPrompt: 'Result: |1⟩. The algorithm says "balanced." One query. A classical computer would need to check at least half the inputs plus one. For N=100 qubits, that\'s 2\u2079\u2079 + 1 classical queries vs 1 quantum query.',
      },
      {
        type: 'exercise',
        id: '1.10-ex1',
        title: 'Extend Deutsch-Jozsa to 3 qubits',
        description: 'Build a 3-input-qubit Deutsch-Jozsa circuit with a balanced oracle. The oracle should apply CNOT from each input qubit to the output qubit. Measure all 3 input qubits — if all measure 0, the function is constant; any non-zero result means balanced.',
        starterCode: `from qiskit import QuantumCircuit

# 4 qubits total: 3 input + 1 output
# 3 classical bits: one per input qubit
qc = QuantumCircuit(4, 3)

# TODO: Step 1 — Prepare output qubit (qubit 3): X then H
# TODO: Step 2 — Put all input qubits (0, 1, 2) in superposition with H
# TODO: Step 3 — Balanced oracle: CNOT from each input to output
# TODO: Step 4 — Apply H to all input qubits
# TODO: Step 5 — Measure input qubits

`,
        framework: 'qiskit',
        expectedProbabilities: { '111': 1.0 },
        tolerancePercent: 1,
        hints: [
          'You need 4 qubits total: 3 input + 1 output.',
          'Apply H to all input qubits, X+H to the output qubit.',
          'The balanced oracle: CNOT from qubit 0 to 3, CNOT from qubit 1 to 3, CNOT from qubit 2 to 3.',
          'Apply H to all input qubits again, then measure them: qc.measure([0,1,2], [0,1,2]).',
        ],
        successMessage: 'You\'ve implemented your first quantum algorithm! Deutsch-Jozsa proves quantum computers can solve certain problems exponentially faster than classical computers. Next up: Grover\'s search algorithm, which speeds up database search.',
      },
    ],
  },
];
