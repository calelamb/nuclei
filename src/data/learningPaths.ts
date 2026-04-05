import type { LearningPath } from '../stores/learningStore';

export const LEARNING_PATHS: LearningPath[] = [
  {
    id: 'fundamentals',
    title: 'Quantum Computing Fundamentals',
    description: 'Start from zero and build up to entanglement and teleportation.',
    modules: [
      {
        id: 'fund-1',
        title: '1. What is a Qubit?',
        description: 'Learn about the basic unit of quantum information and how it differs from a classical bit.',
        difficulty: 'beginner',
        diracPromptAddendum: 'The student is learning about qubits for the first time. Explain everything in terms of classical bits first, then contrast with quantum. Use the Bloch sphere to visualize — point out that a classical bit is either North or South pole, but a qubit can be anywhere on the sphere. Keep it very beginner-friendly.',
        demoCode: `import cirq

# A single qubit — starts in |0⟩ (top of Bloch sphere)
q = cirq.LineQubit(0)
circuit = cirq.Circuit([
    cirq.H(q),           # Put in superposition
    cirq.measure(q, key='result'),
])
# Run this (⌘+Enter) to see: ~50% |0⟩, ~50% |1⟩
`,
        exerciseIds: ['basics-1'],
        quizQuestions: [
          { id: 'q1-1', question: 'How many states can a classical bit be in?', options: ['1', '2', 'Infinite', 'It depends'], correctIndex: 1, explanation: 'A classical bit is either 0 or 1 — exactly 2 states.' },
          { id: 'q1-2', question: 'What does the Hadamard gate do?', options: ['Flips 0 to 1', 'Creates superposition', 'Measures the qubit', 'Entangles two qubits'], correctIndex: 1, explanation: 'The Hadamard gate puts a qubit in an equal superposition of |0⟩ and |1⟩.' },
        ],
      },
      {
        id: 'fund-2',
        title: '2. Quantum Gates',
        description: 'Learn the basic single-qubit gates: X, Y, Z, H, S, and T.',
        difficulty: 'beginner',
        diracPromptAddendum: 'The student is learning quantum gates. Focus on H, X, Y, Z gates. Explain each gate as a rotation on the Bloch sphere. Use analogies: X is like NOT, H creates superposition. When they ask about a gate, reference the gate explorer.',
        demoCode: `import cirq

q = cirq.LineQubit(0)
circuit = cirq.Circuit([
    cirq.X(q),    # Flip from |0⟩ to |1⟩ (like a NOT gate)
    cirq.H(q),    # Now put |1⟩ into superposition → |−⟩ state
    cirq.measure(q, key='result'),
])
`,
        exerciseIds: ['basics-3', 'basics-4'],
        quizQuestions: [
          { id: 'q2-1', question: 'What does the X gate do?', options: ['Creates superposition', 'Phase flip', 'Bit flip (NOT)', 'Measurement'], correctIndex: 2, explanation: 'The X gate flips |0⟩ to |1⟩ and vice versa — it\'s the quantum NOT gate.' },
          { id: 'q2-2', question: 'If you apply H twice, what happens?', options: ['Nothing — back to original', 'Permanent superposition', 'Qubit is destroyed', 'Error'], correctIndex: 0, explanation: 'H·H = Identity. Applying Hadamard twice returns the qubit to its original state.' },
        ],
      },
      {
        id: 'fund-3',
        title: '3. Superposition',
        description: 'Understand superposition deeply — what it means, how to create it, and what measurement does.',
        difficulty: 'beginner',
        diracPromptAddendum: 'Focus on superposition. Explain that a qubit in superposition is not "both 0 and 1 at once" — it\'s in a state that has probabilities of measuring each outcome. Use the histogram to show probability distributions. Emphasize that measurement collapses the state.',
        demoCode: `import cirq

# Two qubits, both in superposition → 4 equally likely outcomes
q0, q1 = cirq.LineQubit.range(2)
circuit = cirq.Circuit([
    cirq.H(q0),
    cirq.H(q1),
    cirq.measure(q0, q1, key='result'),
])
# Expected: |00⟩, |01⟩, |10⟩, |11⟩ each ~25%
`,
        exerciseIds: ['super-1', 'super-2'],
        quizQuestions: [
          { id: 'q3-1', question: 'When you measure a qubit in superposition, what happens?', options: ['You get both values', 'The state collapses to 0 or 1', 'Nothing', 'The qubit is reset'], correctIndex: 1, explanation: 'Measurement collapses the superposition — you get a definite 0 or 1, with probabilities determined by the state amplitudes.' },
        ],
      },
      {
        id: 'fund-4',
        title: '4. Multi-Qubit Systems',
        description: 'Work with multiple qubits and understand how they combine.',
        difficulty: 'beginner',
        diracPromptAddendum: 'Explain multi-qubit systems. Use 2-qubit examples. Explain that n qubits have 2^n possible states. Show how independent qubits produce product states. Prepare the student for entanglement in the next module.',
        demoCode: `import cirq

# 3-qubit system: 2^3 = 8 possible measurement outcomes
q0, q1, q2 = cirq.LineQubit.range(3)
circuit = cirq.Circuit([
    cirq.X(q2),      # Flip q2 to |1⟩
    cirq.H(q0),      # q0 in superposition
    cirq.measure(q0, q1, q2, key='result'),
])
# Expected: |001⟩ and |101⟩ each ~50%
`,
        exerciseIds: ['super-4', 'basics-2'],
        quizQuestions: [
          { id: 'q4-1', question: 'How many possible measurement outcomes does a 4-qubit system have?', options: ['4', '8', '16', '32'], correctIndex: 2, explanation: '2^4 = 16 possible bitstrings for 4 qubits.' },
        ],
      },
      {
        id: 'fund-5',
        title: '5. Entanglement',
        description: 'Create entangled states with CNOT and understand their remarkable properties.',
        difficulty: 'intermediate',
        diracPromptAddendum: 'This is the entanglement module — a crucial concept. Explain CNOT as "flip target if control is |1⟩". Show how H+CNOT creates a Bell state. Emphasize that entangled qubits have correlated measurements even though individual qubits appear random. Use the Bell state as the canonical example.',
        demoCode: `import cirq

# Bell state: (|00⟩ + |11⟩) / √2
q0, q1 = cirq.LineQubit.range(2)
circuit = cirq.Circuit([
    cirq.H(q0),
    cirq.CNOT(q0, q1),
    cirq.measure(q0, q1, key='result'),
])
# Result: always |00⟩ or |11⟩, never |01⟩ or |10⟩!
`,
        exerciseIds: ['ent-1', 'ent-2'],
        quizQuestions: [
          { id: 'q5-1', question: 'In the Bell state (|00⟩ + |11⟩)/√2, if you measure qubit 0 and get 1, what is qubit 1?', options: ['0', '1', '50/50 chance', 'Unknown'], correctIndex: 1, explanation: 'In this Bell state, the qubits are perfectly correlated — if one is 1, the other must also be 1.' },
          { id: 'q5-2', question: 'What two gates create a Bell state?', options: ['X then Z', 'H then CNOT', 'Two H gates', 'CNOT then H'], correctIndex: 1, explanation: 'A Hadamard on the control qubit followed by CNOT creates the Bell state.' },
        ],
      },
      {
        id: 'fund-6',
        title: '6. Measurement',
        description: 'Understand measurement bases, the Born rule, and why measurement is irreversible.',
        difficulty: 'intermediate',
        diracPromptAddendum: 'Focus on measurement theory. Explain the Born rule (probability = |amplitude|²). Discuss that measurement is in the computational (Z) basis by default. Mention that you can measure in other bases by applying gates first (e.g., H then measure = X-basis measurement). Keep it concrete with examples.',
        demoCode: `import cirq

# Measure in different bases
q = cirq.LineQubit(0)

# Z-basis measurement of |+⟩: random result
circuit_z = cirq.Circuit([cirq.H(q), cirq.measure(q, key='z_basis')])

# X-basis measurement of |+⟩: always 0
# (Apply H before measuring to rotate to X basis)
circuit_x = cirq.Circuit([cirq.H(q), cirq.H(q), cirq.measure(q, key='x_basis')])
# H·H = I, so this always gives |0⟩

circuit = circuit_z  # Try both!
`,
        exerciseIds: ['super-3'],
        quizQuestions: [
          { id: 'q6-1', question: 'If a qubit has amplitude 1/√2 for |0⟩, what is the probability of measuring 0?', options: ['1/√2 ≈ 0.71', '1/2 = 0.50', '1/4 = 0.25', '1.0'], correctIndex: 1, explanation: 'Probability = |amplitude|² = |1/√2|² = 1/2 = 50%.' },
        ],
      },
      {
        id: 'fund-7',
        title: '7. Quantum Teleportation (Capstone)',
        description: 'Build a quantum teleportation circuit — the crown jewel of introductory quantum computing.',
        difficulty: 'advanced',
        diracPromptAddendum: 'This is the capstone project — quantum teleportation. Guide the student step by step: (1) create a Bell pair between Alice and Bob, (2) Alice entangles her qubit with the message qubit, (3) Alice measures and sends classical bits, (4) Bob applies corrections. Be patient — this is challenging. Celebrate when they get it working.',
        demoCode: `import cirq

# Quantum Teleportation
msg, alice, bob = cirq.LineQubit.range(3)

circuit = cirq.Circuit([
    # Prepare message qubit in some state (try different gates!)
    cirq.X(msg),       # Message = |1⟩
    cirq.H(msg),       # Message = |−⟩

    # Create Bell pair between Alice and Bob
    cirq.H(alice),
    cirq.CNOT(alice, bob),

    # Alice's operations
    cirq.CNOT(msg, alice),
    cirq.H(msg),

    # Measure Alice's qubits
    cirq.measure(msg, key='m1'),
    cirq.measure(alice, key='m2'),

    # Bob's corrections (classically controlled)
    cirq.CNOT(alice, bob),
    cirq.CZ(msg, bob),

    cirq.measure(bob, key='bob_result'),
])
`,
        exerciseIds: ['algo-3'],
        quizQuestions: [
          { id: 'q7-1', question: 'Does quantum teleportation transmit information faster than light?', options: ['Yes', 'No — classical communication is still needed', 'Only for entangled states', 'It depends on distance'], correctIndex: 1, explanation: 'No. Alice must send 2 classical bits to Bob for the corrections. The quantum state transfer is instant, but the protocol requires classical communication.' },
        ],
      },
    ],
  },
  {
    id: 'algorithms',
    title: 'Quantum Algorithms',
    description: 'Learn the algorithms that make quantum computers powerful.',
    modules: [
      {
        id: 'algo-mod-1',
        title: '1. Classical vs Quantum Parallelism',
        description: 'Understand why quantum computers can solve some problems faster.',
        difficulty: 'intermediate',
        diracPromptAddendum: 'Explain quantum parallelism vs classical parallelism. Quantum parallelism is NOT "trying all solutions at once" — it\'s about interference. A quantum computer evaluates a function on a superposition, but you can\'t read all results. The trick is making wrong answers cancel out (destructive interference) and right answers add up (constructive interference).',
        demoCode: `import cirq

# Classical: evaluate f(0) and f(1) separately = 2 queries
# Quantum: evaluate f on superposition = 1 query!

q_in, q_out = cirq.LineQubit.range(2)
circuit = cirq.Circuit([
    cirq.H(q_in),           # Input in superposition: |+⟩
    cirq.X(q_out),
    cirq.H(q_out),          # Output in |−⟩
    # Oracle would go here
    cirq.H(q_in),           # Interference!
    cirq.measure(q_in, key='result'),
])
`,
        exerciseIds: [],
        quizQuestions: [
          { id: 'qa1-1', question: 'What is the key quantum advantage in algorithms?', options: ['Speed of individual operations', 'Interference amplifying correct answers', 'Having more memory', 'Random number generation'], correctIndex: 1, explanation: 'Quantum algorithms use interference to amplify the probability of correct answers and suppress wrong ones.' },
        ],
      },
      {
        id: 'algo-mod-2',
        title: '2. Deutsch-Jozsa Algorithm',
        description: 'The first algorithm that proves quantum can be exponentially faster.',
        difficulty: 'intermediate',
        diracPromptAddendum: 'Teach the Deutsch-Jozsa algorithm. Start with the simple 1-qubit Deutsch problem: determine if f(x) is constant or balanced with ONE query instead of two. Then extend to n qubits. Focus on the oracle concept and how phase kickback works. Use the step-through feature to show each stage.',
        demoCode: `import cirq

# Deutsch Algorithm: is f constant or balanced?
q_in, q_out = cirq.LineQubit.range(2)

# Setup
circuit = cirq.Circuit([
    cirq.X(q_out),    # |1⟩
    cirq.H(q_in),     # |+⟩
    cirq.H(q_out),    # |−⟩

    # Oracle for f(x) = x (balanced function)
    cirq.CNOT(q_in, q_out),

    # Measure in Hadamard basis
    cirq.H(q_in),
    cirq.measure(q_in, key='result'),
])
# Result 1 → balanced, Result 0 → constant
`,
        exerciseIds: ['algo-1', 'algo-2'],
        quizQuestions: [
          { id: 'qa2-1', question: 'The Deutsch-Jozsa algorithm determines if a function is:', options: ['Even or odd', 'Constant or balanced', 'Increasing or decreasing', 'Linear or quadratic'], correctIndex: 1, explanation: 'Deutsch-Jozsa distinguishes constant functions (same output for all inputs) from balanced functions (different output for half the inputs).' },
        ],
      },
      {
        id: 'algo-mod-3',
        title: '3. Bernstein-Vazirani Algorithm',
        description: 'Find a hidden bitstring in a single query.',
        difficulty: 'intermediate',
        diracPromptAddendum: 'Teach Bernstein-Vazirani. The problem: there\'s a hidden string s, and the oracle computes f(x) = s·x mod 2. Classically you need n queries (one per bit). Quantumly you need just ONE. Show how it\'s a generalization of Deutsch-Jozsa. Walk through the math simply.',
        demoCode: `import cirq

# Bernstein-Vazirani: find hidden string s = "101"
n = 3
qubits = cirq.LineQubit.range(n + 1)
q_in = qubits[:n]
q_out = qubits[n]

# Hidden string
s = "101"

circuit = cirq.Circuit()
circuit.append(cirq.X(q_out))
circuit.append(cirq.H.on_each(*q_in, q_out))

# Oracle: CNOT for each bit of s that is 1
for i, bit in enumerate(s):
    if bit == '1':
        circuit.append(cirq.CNOT(q_in[i], q_out))

circuit.append(cirq.H.on_each(*q_in))
circuit.append(cirq.measure(*q_in, key='result'))
# Should output "101" — the hidden string!
`,
        exerciseIds: [],
        quizQuestions: [
          { id: 'qa3-1', question: 'How many queries does Bernstein-Vazirani need to find an n-bit hidden string?', options: ['n queries', '1 query', 'n² queries', 'log(n) queries'], correctIndex: 1, explanation: 'Just one quantum query, compared to n classical queries. This is an exponential speedup!' },
        ],
      },
      {
        id: 'algo-mod-4',
        title: '4. Quantum Fourier Transform',
        description: 'The building block of Shor\'s algorithm and phase estimation.',
        difficulty: 'advanced',
        diracPromptAddendum: 'Teach the QFT. Start with what the classical DFT does, then show the quantum version. Explain that QFT maps computational basis states to frequency-domain states. It\'s exponentially faster than classical FFT. Show the circuit structure: H gates and controlled phase gates. Don\'t get lost in the math — focus on intuition.',
        demoCode: `import cirq
import numpy as np

# 3-qubit QFT
qubits = cirq.LineQubit.range(3)

def qft_circuit(qubits):
    n = len(qubits)
    circuit = cirq.Circuit()
    for i in range(n):
        circuit.append(cirq.H(qubits[i]))
        for j in range(i + 1, n):
            angle = np.pi / (2 ** (j - i))
            circuit.append(cirq.CZPowGate(exponent=angle/np.pi)(qubits[j], qubits[i]))
    # Swap to reverse qubit order
    for i in range(n // 2):
        circuit.append(cirq.SWAP(qubits[i], qubits[n - 1 - i]))
    return circuit

circuit = qft_circuit(qubits)
circuit.append(cirq.measure(*qubits, key='result'))
`,
        exerciseIds: [],
        quizQuestions: [
          { id: 'qa4-1', question: 'What is the QFT primarily used for?', options: ['Searching databases', 'Finding prime factors (via phase estimation)', 'Creating entanglement', 'Error correction'], correctIndex: 1, explanation: 'The QFT is the key component of Shor\'s algorithm and quantum phase estimation, used for factoring and other problems.' },
        ],
      },
      {
        id: 'algo-mod-5',
        title: '5. Grover\'s Search (Capstone)',
        description: 'Search an unsorted database quadratically faster than classical.',
        difficulty: 'advanced',
        diracPromptAddendum: 'Teach Grover\'s algorithm. This is the capstone — walk through each step: (1) uniform superposition, (2) oracle marks the target, (3) diffusion operator amplifies the marked state, (4) repeat ~√N times. Show the amplitude visualization at each step. Let them build it for 2 qubits first (searching 4 items).',
        demoCode: `import cirq

# Grover's Search for 2 qubits (searching 4 items)
# Target: |11⟩
q0, q1 = cirq.LineQubit.range(2)

circuit = cirq.Circuit()

# 1. Uniform superposition
circuit.append([cirq.H(q0), cirq.H(q1)])

# 2. Oracle: mark |11⟩ with a phase flip
circuit.append(cirq.CZ(q0, q1))

# 3. Diffusion operator
circuit.append([cirq.H(q0), cirq.H(q1)])
circuit.append([cirq.X(q0), cirq.X(q1)])
circuit.append(cirq.CZ(q0, q1))
circuit.append([cirq.X(q0), cirq.X(q1)])
circuit.append([cirq.H(q0), cirq.H(q1)])

# 4. Measure — should find |11⟩ with high probability!
circuit.append(cirq.measure(q0, q1, key='result'))
`,
        exerciseIds: ['algo-4'],
        quizQuestions: [
          { id: 'qa5-1', question: 'How many Grover iterations are needed to search N items?', options: ['N', 'N/2', '√N', 'log(N)'], correctIndex: 2, explanation: 'Grover\'s algorithm needs approximately √N iterations, giving a quadratic speedup over classical linear search.' },
        ],
      },
    ],
  },
];
