import type { Framework } from '../types/quantum';

export interface GlossaryTerm {
  id: string;
  term: string;
  aliases: string[];
  plainEnglish: string;
  mathDefinition?: string;
  codeExample?: { framework: Framework; code: string };
  relatedConcepts: string[];
  category: 'basics' | 'gates' | 'entanglement' | 'algorithms' | 'error-correction' | 'hardware';
}

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  // ===== BASICS =====
  {
    id: 'qubit',
    term: 'Qubit',
    aliases: ['quantum bit', 'qbit'],
    plainEnglish: 'A qubit is the basic unit of quantum information. Unlike a classical bit that is either 0 or 1, a qubit can be in a blend of both at the same time (called superposition). Think of a classical bit as a coin lying flat — heads or tails. A qubit is like a coin spinning in the air — it has some chance of landing on either side until you look at it.',
    mathDefinition: '|ψ⟩ = α|0⟩ + β|1⟩, where |α|² + |β|² = 1',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

# Create a circuit with 1 qubit
qc = QuantumCircuit(1, 1)
# The qubit starts in |0⟩ by default
qc.measure(0, 0)`,
    },
    relatedConcepts: ['superposition', 'measurement', 'bloch-sphere', 'state-vector'],
    category: 'basics',
  },
  {
    id: 'superposition',
    term: 'Superposition',
    aliases: ['quantum superposition'],
    plainEnglish: 'Superposition means a qubit is in a combination of |0⟩ and |1⟩ at the same time. It is NOT "both 0 and 1 simultaneously" — it is a new kind of state that has some probability of being measured as 0 and some probability of being measured as 1. When you measure, the superposition collapses to a single definite value.',
    mathDefinition: '|ψ⟩ = α|0⟩ + β|1⟩, P(0) = |α|², P(1) = |β|²',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.h(0)  # Hadamard gate creates equal superposition
qc.measure(0, 0)
# Result: ~50% |0⟩, ~50% |1⟩`,
    },
    relatedConcepts: ['qubit', 'hadamard-gate', 'measurement', 'probability-amplitude'],
    category: 'basics',
  },
  {
    id: 'measurement',
    term: 'Measurement',
    aliases: ['quantum measurement', 'observation', 'collapse'],
    plainEnglish: 'Measurement is how you read the value of a qubit. Before measurement, a qubit can be in superposition. The act of measuring forces it to "choose" — it collapses into either |0⟩ or |1⟩. The outcome is probabilistic: the probabilities are determined by the qubit\'s state. Measurement is irreversible — once you measure, the superposition is gone.',
    mathDefinition: 'P(outcome = 0) = |⟨0|ψ⟩|² = |α|², P(outcome = 1) = |⟨1|ψ⟩|² = |β|²',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.h(0)          # Put qubit in superposition
qc.measure(0, 0) # Measure: collapses to 0 or 1`,
    },
    relatedConcepts: ['superposition', 'born-rule', 'state-vector', 'classical-register'],
    category: 'basics',
  },
  {
    id: 'entanglement',
    term: 'Entanglement',
    aliases: ['quantum entanglement', 'entangled state'],
    plainEnglish: 'Entanglement is a special connection between two or more qubits where their fates are linked. When qubits are entangled, measuring one instantly tells you something about the other, no matter how far apart they are. For example, in the Bell state, if you measure one qubit and get 0, the other will always be 0 too. This is not because they communicated — it is because they share a correlated quantum state.',
    mathDefinition: '|Φ+⟩ = (|00⟩ + |11⟩) / √2 — cannot be written as a product of individual qubit states',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.h(0)       # Superposition on qubit 0
qc.cx(0, 1)   # CNOT entangles qubits 0 and 1
qc.measure([0, 1], [0, 1])
# Result: always 00 or 11, never 01 or 10`,
    },
    relatedConcepts: ['bell-state', 'cnot-gate', 'quantum-teleportation', 'superdense-coding'],
    category: 'entanglement',
  },
  {
    id: 'bell-state',
    term: 'Bell State',
    aliases: ['Bell pair', 'EPR pair', 'maximally entangled state'],
    plainEnglish: 'A Bell state is one of four specific two-qubit entangled states. They are the simplest and most important entangled states. The most common one, |Φ+⟩, means both qubits will always measure the same value (both 0 or both 1). Bell states are the building blocks for quantum teleportation, superdense coding, and many quantum protocols.',
    mathDefinition: '|Φ+⟩ = (|00⟩ + |11⟩)/√2, |Φ-⟩ = (|00⟩ - |11⟩)/√2, |Ψ+⟩ = (|01⟩ + |10⟩)/√2, |Ψ-⟩ = (|01⟩ - |10⟩)/√2',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

# Create all four Bell states:
# |Φ+⟩: H then CNOT
qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])`,
    },
    relatedConcepts: ['entanglement', 'hadamard-gate', 'cnot-gate', 'quantum-teleportation'],
    category: 'entanglement',
  },

  // ===== GATES =====
  {
    id: 'hadamard-gate',
    term: 'Hadamard Gate',
    aliases: ['H gate', 'Hadamard'],
    plainEnglish: 'The Hadamard gate is the most important single-qubit gate. It puts a qubit into an equal superposition: |0⟩ becomes (|0⟩+|1⟩)/√2 and |1⟩ becomes (|0⟩-|1⟩)/√2. Think of it as a "half-flip" that creates a perfect coin flip. Applying it twice returns the qubit to its original state (H is its own inverse).',
    mathDefinition: 'H = (1/√2) [[1, 1], [1, -1]]; H|0⟩ = |+⟩, H|1⟩ = |-⟩',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.h(0)  # Apply Hadamard gate to qubit 0
qc.measure(0, 0)`,
    },
    relatedConcepts: ['superposition', 'qubit', 'pauli-x-gate', 'unitary-matrix'],
    category: 'gates',
  },
  {
    id: 'pauli-x-gate',
    term: 'Pauli-X Gate',
    aliases: ['X gate', 'NOT gate', 'bit flip', 'sigma-x'],
    plainEnglish: 'The Pauli-X gate is the quantum version of a NOT gate. It flips |0⟩ to |1⟩ and |1⟩ to |0⟩. On the Bloch sphere, it is a 180-degree rotation around the X axis. It is one of the three Pauli gates (X, Y, Z).',
    mathDefinition: 'X = [[0, 1], [1, 0]]; X|0⟩ = |1⟩, X|1⟩ = |0⟩',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.x(0)  # Flip qubit from |0⟩ to |1⟩
qc.measure(0, 0)
# Result: always 1`,
    },
    relatedConcepts: ['pauli-y-gate', 'pauli-z-gate', 'qubit', 'bloch-sphere'],
    category: 'gates',
  },
  {
    id: 'pauli-y-gate',
    term: 'Pauli-Y Gate',
    aliases: ['Y gate', 'sigma-y'],
    plainEnglish: 'The Pauli-Y gate combines a bit flip and a phase flip. It maps |0⟩ to i|1⟩ and |1⟩ to -i|0⟩. On the Bloch sphere, it is a 180-degree rotation around the Y axis. It is less commonly used than X or Z but is important in many quantum algorithms.',
    mathDefinition: 'Y = [[0, -i], [i, 0]]; Y|0⟩ = i|1⟩, Y|1⟩ = -i|0⟩',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.y(0)  # Apply Pauli-Y gate
qc.measure(0, 0)
# Result: always 1 (like X, but with a phase)`,
    },
    relatedConcepts: ['pauli-x-gate', 'pauli-z-gate', 'bloch-sphere', 'unitary-matrix'],
    category: 'gates',
  },
  {
    id: 'pauli-z-gate',
    term: 'Pauli-Z Gate',
    aliases: ['Z gate', 'phase flip', 'sigma-z'],
    plainEnglish: 'The Pauli-Z gate is a phase flip gate. It leaves |0⟩ unchanged but flips the sign of |1⟩ to -|1⟩. On the Bloch sphere, it is a 180-degree rotation around the Z axis. You cannot see its effect by measuring in the standard basis (it only affects the phase), but it matters when the qubit is in superposition.',
    mathDefinition: 'Z = [[1, 0], [0, -1]]; Z|0⟩ = |0⟩, Z|1⟩ = -|1⟩',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.h(0)  # Put in superposition: |+⟩
qc.z(0)  # Phase flip: turns |+⟩ into |−⟩
qc.h(0)  # Convert phase difference to bit difference
qc.measure(0, 0)
# Result: always 1 (Z flipped the phase)`,
    },
    relatedConcepts: ['pauli-x-gate', 'pauli-y-gate', 'phase-gate', 'bloch-sphere'],
    category: 'gates',
  },
  {
    id: 'cnot-gate',
    term: 'CNOT Gate',
    aliases: ['CX gate', 'controlled-NOT', 'controlled-X'],
    plainEnglish: 'The CNOT (Controlled-NOT) gate is the most important two-qubit gate. It has a control qubit and a target qubit. If the control qubit is |1⟩, it flips the target qubit. If the control is |0⟩, it does nothing. CNOT is essential for creating entanglement — applying H then CNOT creates a Bell state.',
    mathDefinition: 'CNOT = [[1,0,0,0],[0,1,0,0],[0,0,0,1],[0,0,1,0]]; CNOT|10⟩ = |11⟩, CNOT|00⟩ = |00⟩',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.x(0)       # Set control qubit to |1⟩
qc.cx(0, 1)   # CNOT: flips qubit 1 because qubit 0 is |1⟩
qc.measure([0, 1], [0, 1])
# Result: always 11`,
    },
    relatedConcepts: ['entanglement', 'bell-state', 'toffoli-gate', 'pauli-x-gate'],
    category: 'gates',
  },
  {
    id: 'toffoli-gate',
    term: 'Toffoli Gate',
    aliases: ['CCX gate', 'CCNOT', 'controlled-controlled-NOT', 'doubly-controlled NOT'],
    plainEnglish: 'The Toffoli gate is a three-qubit gate with two controls and one target. It flips the target qubit only when BOTH control qubits are |1⟩. It is the quantum version of the classical AND gate (combined with NOT). The Toffoli gate is universal for classical computation, and together with the Hadamard gate, it is universal for quantum computation.',
    mathDefinition: 'CCX|110⟩ = |111⟩, CCX|100⟩ = |100⟩ (flips target only if both controls are 1)',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(3, 3)
qc.x(0)          # Control 1 = |1⟩
qc.x(1)          # Control 2 = |1⟩
qc.ccx(0, 1, 2)  # Toffoli: flips qubit 2
qc.measure([0, 1, 2], [0, 1, 2])
# Result: always 111`,
    },
    relatedConcepts: ['cnot-gate', 'pauli-x-gate', 'universal-gates'],
    category: 'gates',
  },
  {
    id: 'swap-gate',
    term: 'SWAP Gate',
    aliases: ['swap'],
    plainEnglish: 'The SWAP gate exchanges the states of two qubits. If qubit A is |0⟩ and qubit B is |1⟩, after SWAP they switch: A becomes |1⟩ and B becomes |0⟩. SWAP is useful when you need to move qubit states around, especially on hardware where not all qubits are directly connected.',
    mathDefinition: 'SWAP|ab⟩ = |ba⟩; SWAP = [[1,0,0,0],[0,0,1,0],[0,1,0,0],[0,0,0,1]]',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.x(0)              # Qubit 0 = |1⟩, Qubit 1 = |0⟩
qc.swap(0, 1)        # Swap them
qc.measure([0, 1], [0, 1])
# Result: always 01 (states swapped)`,
    },
    relatedConcepts: ['cnot-gate', 'qubit'],
    category: 'gates',
  },
  {
    id: 'phase-gate',
    term: 'Phase Gate (S Gate)',
    aliases: ['S gate', 'sqrt(Z)', '√Z', 'P gate'],
    plainEnglish: 'The S gate (also called the phase gate) adds a 90-degree phase to |1⟩ while leaving |0⟩ unchanged. It is the "square root" of the Z gate — applying S twice gives you Z. Phases are invisible when measuring in the standard basis, but they matter for interference effects in algorithms.',
    mathDefinition: 'S = [[1, 0], [0, i]]; S|1⟩ = i|1⟩; S² = Z',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.h(0)  # Superposition
qc.s(0)  # Add 90° phase to |1⟩ component
qc.h(0)  # Interfere
qc.measure(0, 0)`,
    },
    relatedConcepts: ['pauli-z-gate', 't-gate', 'rotation-gates', 'bloch-sphere'],
    category: 'gates',
  },
  {
    id: 't-gate',
    term: 'T Gate',
    aliases: ['π/8 gate', 'sqrt(S)', '√S'],
    plainEnglish: 'The T gate adds a 45-degree phase to |1⟩. It is the "square root" of the S gate — applying T twice gives S. The T gate is extremely important in fault-tolerant quantum computing because it is the hardest gate to implement fault-tolerantly. The set {H, T, CNOT} is universal for quantum computation.',
    mathDefinition: 'T = [[1, 0], [0, e^(iπ/4)]]; T² = S; T⁴ = Z',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.h(0)  # Superposition
qc.t(0)  # Add 45° phase to |1⟩ component
qc.measure(0, 0)`,
    },
    relatedConcepts: ['phase-gate', 'universal-gates', 'pauli-z-gate'],
    category: 'gates',
  },
  {
    id: 'rotation-gates',
    term: 'Rotation Gates (Rx, Ry, Rz)',
    aliases: ['Rx gate', 'Ry gate', 'Rz gate', 'rotation-x', 'rotation-y', 'rotation-z'],
    plainEnglish: 'Rotation gates rotate a qubit state around the X, Y, or Z axis of the Bloch sphere by a specified angle. They let you fine-tune the qubit state continuously rather than in fixed steps like H or X. Rx(θ) rotates around X by angle θ, Ry(θ) around Y, and Rz(θ) around Z. These are essential for variational quantum algorithms like VQE and QAOA.',
    mathDefinition: 'Rx(θ) = e^(-iθX/2), Ry(θ) = e^(-iθY/2), Rz(θ) = e^(-iθZ/2)',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit
import math

qc = QuantumCircuit(1, 1)
qc.rx(math.pi / 4, 0)  # Rotate around X by 45°
qc.ry(math.pi / 2, 0)  # Rotate around Y by 90°
qc.rz(math.pi, 0)      # Rotate around Z by 180° (same as Z gate)
qc.measure(0, 0)`,
    },
    relatedConcepts: ['bloch-sphere', 'pauli-x-gate', 'pauli-y-gate', 'pauli-z-gate', 'vqe'],
    category: 'gates',
  },
  {
    id: 'quantum-circuit',
    term: 'Quantum Circuit',
    aliases: ['circuit', 'quantum program'],
    plainEnglish: 'A quantum circuit is a sequence of quantum gates applied to qubits, followed by measurements. It is the standard way to describe a quantum computation. You read it left to right: each column is a layer of gates that happen at the same time, and each horizontal line represents a qubit. Quantum circuits are analogous to classical logic circuits but use quantum gates instead of AND/OR/NOT.',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

# Create a circuit with 2 qubits and 2 classical bits
qc = QuantumCircuit(2, 2)
qc.h(0)            # Gate layer 1
qc.cx(0, 1)        # Gate layer 2
qc.measure([0, 1], [0, 1])  # Measurement`,
    },
    relatedConcepts: ['qubit', 'quantum-register', 'classical-register'],
    category: 'basics',
  },
  {
    id: 'quantum-register',
    term: 'Quantum Register',
    aliases: ['qreg', 'qubit register'],
    plainEnglish: 'A quantum register is a collection of qubits that you work with together in a quantum circuit. If you create a circuit with 3 qubits, those 3 qubits form a quantum register. The term comes from classical computing where a register holds a group of bits.',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit, QuantumRegister

qr = QuantumRegister(3, 'q')  # 3-qubit register named 'q'
qc = QuantumCircuit(qr)
qc.h(qr[0])  # Apply H to first qubit in register`,
    },
    relatedConcepts: ['qubit', 'classical-register', 'quantum-circuit'],
    category: 'basics',
  },
  {
    id: 'classical-register',
    term: 'Classical Register',
    aliases: ['creg', 'classical bits', 'cbits'],
    plainEnglish: 'A classical register holds the results of quantum measurements. When you measure a qubit, the result (0 or 1) is stored in a classical bit within a classical register. You need classical bits to read output from a quantum circuit.',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit, ClassicalRegister

cr = ClassicalRegister(2, 'c')  # 2 classical bits named 'c'
qc = QuantumCircuit(2, cr)
qc.measure(0, cr[0])  # Store measurement of qubit 0 in classical bit 0`,
    },
    relatedConcepts: ['quantum-register', 'measurement', 'quantum-circuit'],
    category: 'basics',
  },
  {
    id: 'bloch-sphere',
    term: 'Bloch Sphere',
    aliases: ['Bloch ball'],
    plainEnglish: 'The Bloch sphere is a 3D visualization of a single qubit state. The north pole represents |0⟩, the south pole represents |1⟩, and every other point on the sphere is a valid qubit state. Points on the equator are superpositions with equal probability of 0 and 1 but different phases. Quantum gates correspond to rotations on the sphere.',
    mathDefinition: '|ψ⟩ = cos(θ/2)|0⟩ + e^(iφ)sin(θ/2)|1⟩, where θ is polar angle and φ is azimuthal angle',
    relatedConcepts: ['qubit', 'superposition', 'rotation-gates', 'pauli-x-gate'],
    category: 'basics',
  },
  {
    id: 'state-vector',
    term: 'State Vector',
    aliases: ['quantum state', 'ket', 'wave function'],
    plainEnglish: 'A state vector is the mathematical description of a quantum system. For one qubit, it is a list of two complex numbers (the amplitudes for |0⟩ and |1⟩). For n qubits, it is a list of 2^n complex numbers. The state vector contains all the information about the quantum system. Squaring each amplitude gives the probability of measuring that state.',
    mathDefinition: '|ψ⟩ = Σ αᵢ|i⟩, where Σ|αᵢ|² = 1',
    relatedConcepts: ['qubit', 'probability-amplitude', 'born-rule', 'superposition'],
    category: 'basics',
  },
  {
    id: 'probability-amplitude',
    term: 'Probability Amplitude',
    aliases: ['amplitude', 'complex amplitude'],
    plainEnglish: 'A probability amplitude is a complex number associated with each possible measurement outcome of a qubit. The probability of getting a particular result is the square of the absolute value of its amplitude. Amplitudes can be positive, negative, or complex — this is why quantum interference works. Negative amplitudes can cancel out positive ones (destructive interference).',
    mathDefinition: 'For |ψ⟩ = α|0⟩ + β|1⟩: amplitudes are α and β; P(0) = |α|², P(1) = |β|²',
    relatedConcepts: ['state-vector', 'born-rule', 'superposition', 'measurement'],
    category: 'basics',
  },
  {
    id: 'born-rule',
    term: 'Born Rule',
    aliases: ['probability rule', 'Born\'s rule'],
    plainEnglish: 'The Born rule is the fundamental rule that connects quantum states to measurement outcomes. It says: the probability of a measurement result equals the square of the absolute value of the amplitude for that result. If a qubit has amplitude α for |0⟩, the probability of measuring 0 is |α|². This is the bridge between quantum math and experimental results.',
    mathDefinition: 'P(outcome = i) = |⟨i|ψ⟩|² = |αᵢ|²',
    relatedConcepts: ['probability-amplitude', 'measurement', 'state-vector'],
    category: 'basics',
  },
  {
    id: 'tensor-product',
    term: 'Tensor Product',
    aliases: ['Kronecker product', 'tensor', '⊗'],
    plainEnglish: 'The tensor product is how you mathematically combine multiple qubits into a multi-qubit system. If qubit A is in state |a⟩ and qubit B is in state |b⟩ (independently), the combined state is |a⟩ ⊗ |b⟩. For 1-qubit states (2 elements each), the tensor product gives a 4-element state vector. The size doubles with each added qubit, which is why quantum computers are hard to simulate classically.',
    mathDefinition: '|a⟩ ⊗ |b⟩ = |ab⟩; for n qubits, state vector has 2ⁿ components',
    relatedConcepts: ['state-vector', 'qubit', 'entanglement'],
    category: 'basics',
  },
  {
    id: 'unitary-matrix',
    term: 'Unitary Matrix',
    aliases: ['unitary operator', 'unitary transformation'],
    plainEnglish: 'Every quantum gate is described by a unitary matrix — a special kind of matrix whose inverse equals its conjugate transpose. "Unitary" means the gate is reversible and preserves probabilities (they still add up to 1 after the gate). This is a fundamental rule of quantum mechanics: all quantum operations (except measurement) must be unitary.',
    mathDefinition: 'U†U = UU† = I, where U† is the conjugate transpose',
    relatedConcepts: ['hadamard-gate', 'pauli-x-gate', 'quantum-circuit', 'eigenvalue'],
    category: 'basics',
  },
  {
    id: 'eigenvalue',
    term: 'Eigenvalue',
    aliases: ['eigenphase'],
    plainEnglish: 'An eigenvalue is a special number associated with a quantum operator (gate). If applying a gate to a state only multiplies it by a number (instead of changing it), that state is an "eigenvector" and the multiplier is the "eigenvalue." For example, |0⟩ is an eigenvector of Z with eigenvalue +1, and |1⟩ is an eigenvector of Z with eigenvalue -1. Eigenvalues are crucial for understanding quantum algorithms like phase estimation.',
    mathDefinition: 'U|v⟩ = λ|v⟩, where λ is the eigenvalue and |v⟩ is the eigenvector',
    relatedConcepts: ['eigenvector', 'unitary-matrix', 'quantum-fourier-transform'],
    category: 'basics',
  },
  {
    id: 'eigenvector',
    term: 'Eigenvector',
    aliases: ['eigenstate'],
    plainEnglish: 'An eigenvector (or eigenstate) of a quantum gate is a state that does not change direction when the gate is applied — it only gets scaled by a number (the eigenvalue). For example, |0⟩ is an eigenstate of the Z gate because Z|0⟩ = +1|0⟩. The |+⟩ state is an eigenstate of the X gate. Understanding eigenstates helps you predict what a gate does to different quantum states.',
    mathDefinition: 'U|v⟩ = λ|v⟩; |v⟩ is the eigenvector, λ is the eigenvalue',
    relatedConcepts: ['eigenvalue', 'unitary-matrix', 'state-vector'],
    category: 'basics',
  },

  // ===== ENTANGLEMENT =====
  {
    id: 'quantum-teleportation',
    term: 'Quantum Teleportation',
    aliases: ['teleportation'],
    plainEnglish: 'Quantum teleportation is a protocol that transfers a qubit state from one location to another using entanglement and classical communication. It does NOT transmit matter or information faster than light — Alice must send two classical bits to Bob for it to work. The original qubit is destroyed in the process (consistent with the no-cloning theorem). It requires a pre-shared Bell pair.',
    mathDefinition: '|ψ⟩_A ⊗ |Φ+⟩_BC → classical bits + corrections → |ψ⟩_C',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

qc = QuantumCircuit(3, 3)
# Prepare message qubit
qc.x(0)         # Message = |1⟩
# Create Bell pair (qubits 1,2)
qc.h(1)
qc.cx(1, 2)
# Alice's operations
qc.cx(0, 1)
qc.h(0)
# Measure Alice's qubits
qc.measure(0, 0)
qc.measure(1, 1)
# Bob's corrections
qc.cx(1, 2)
qc.cz(0, 2)
qc.measure(2, 2)`,
    },
    relatedConcepts: ['bell-state', 'entanglement', 'no-cloning-theorem', 'superdense-coding'],
    category: 'entanglement',
  },
  {
    id: 'superdense-coding',
    term: 'Superdense Coding',
    aliases: ['dense coding'],
    plainEnglish: 'Superdense coding is the opposite of teleportation: it sends two classical bits of information by transmitting just one qubit (plus a pre-shared Bell pair). Alice applies one of four gates (I, X, Z, or XZ) to her half of the Bell pair to encode two bits, then sends her qubit to Bob. Bob measures both qubits to decode the two-bit message.',
    mathDefinition: 'Alice encodes 2 bits into Bell pair modifications: 00→I, 01→X, 10→Z, 11→ZX',
    relatedConcepts: ['bell-state', 'entanglement', 'quantum-teleportation'],
    category: 'entanglement',
  },
  {
    id: 'no-cloning-theorem',
    term: 'No-Cloning Theorem',
    aliases: ['no cloning', 'quantum no-cloning'],
    plainEnglish: 'The no-cloning theorem says it is impossible to create an exact copy of an unknown quantum state. You cannot build a machine that takes |ψ⟩ in and produces two copies |ψ⟩|ψ⟩ out, unless you already know what |ψ⟩ is. This is a fundamental result of quantum mechanics and is the reason quantum teleportation destroys the original state. It also makes quantum cryptography possible (eavesdroppers cannot copy qubits without disturbing them).',
    mathDefinition: 'There is no unitary U such that U|ψ⟩|0⟩ = |ψ⟩|ψ⟩ for all |ψ⟩',
    relatedConcepts: ['quantum-teleportation', 'unitary-matrix', 'measurement'],
    category: 'entanglement',
  },

  // ===== ALGORITHMS =====
  {
    id: 'grovers-algorithm',
    term: 'Grover\'s Algorithm',
    aliases: ['Grover search', 'quantum search'],
    plainEnglish: 'Grover\'s algorithm searches an unsorted list of N items in about √N steps instead of the classical N steps. It works by repeatedly applying two operations: (1) an oracle that marks the correct item with a phase flip, and (2) a diffusion operator that amplifies the marked item\'s probability. After about √N repetitions, measuring gives the correct item with high probability. This is a quadratic speedup.',
    mathDefinition: 'G = (2|ψ⟩⟨ψ| - I) · O_f, applied √N times; O_f flips the phase of the target state',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

# Grover for 2 qubits, searching for |11⟩
qc = QuantumCircuit(2, 2)
# Superposition
qc.h([0, 1])
# Oracle: mark |11⟩
qc.cz(0, 1)
# Diffusion operator
qc.h([0, 1])
qc.x([0, 1])
qc.cz(0, 1)
qc.x([0, 1])
qc.h([0, 1])
# Measure
qc.measure([0, 1], [0, 1])`,
    },
    relatedConcepts: ['hadamard-gate', 'superposition', 'quantum-supremacy'],
    category: 'algorithms',
  },
  {
    id: 'shors-algorithm',
    term: 'Shor\'s Algorithm',
    aliases: ['Shor factoring', 'quantum factoring'],
    plainEnglish: 'Shor\'s algorithm factors large numbers exponentially faster than any known classical algorithm. It is the reason people worry about quantum computers breaking encryption (RSA is based on the difficulty of factoring). It works by using quantum phase estimation to find the period of a modular function, which reveals the factors. A sufficiently large quantum computer running Shor\'s algorithm could break most current public-key encryption.',
    mathDefinition: 'Classical: O(e^(n^(1/3))) for n-bit number; Quantum: O(n³) using QFT + period finding',
    relatedConcepts: ['quantum-fourier-transform', 'quantum-supremacy'],
    category: 'algorithms',
  },
  {
    id: 'quantum-fourier-transform',
    term: 'Quantum Fourier Transform',
    aliases: ['QFT'],
    plainEnglish: 'The Quantum Fourier Transform converts quantum states from the "time domain" to the "frequency domain," just like the classical Fourier Transform but exponentially faster. It is a key building block of Shor\'s algorithm and quantum phase estimation. For n qubits, QFT uses only O(n²) gates compared to O(n·2ⁿ) for the classical FFT.',
    mathDefinition: 'QFT|j⟩ = (1/√N) Σₖ e^(2πijk/N)|k⟩, where N = 2ⁿ',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit
import math

# 3-qubit QFT
qc = QuantumCircuit(3)
# QFT on qubit 0
qc.h(0)
qc.cp(math.pi/2, 1, 0)   # Controlled phase from qubit 1
qc.cp(math.pi/4, 2, 0)   # Controlled phase from qubit 2
# QFT on qubit 1
qc.h(1)
qc.cp(math.pi/2, 2, 1)
# QFT on qubit 2
qc.h(2)
# Swap to reverse bit order
qc.swap(0, 2)`,
    },
    relatedConcepts: ['shors-algorithm', 'hadamard-gate', 'phase-gate', 'rotation-gates'],
    category: 'algorithms',
  },
  {
    id: 'vqe',
    term: 'Variational Quantum Eigensolver (VQE)',
    aliases: ['VQE'],
    plainEnglish: 'VQE is a hybrid quantum-classical algorithm for finding the lowest energy of a molecule or system. It uses a quantum computer to prepare trial states and measure their energy, and a classical computer to optimize the parameters. VQE is designed for near-term noisy quantum computers because the circuits are short. It is one of the most promising applications of current quantum hardware.',
    mathDefinition: 'min_θ ⟨ψ(θ)|H|ψ(θ)⟩, where |ψ(θ)⟩ is a parameterized quantum state (ansatz)',
    relatedConcepts: ['rotation-gates', 'qaoa', 'measurement'],
    category: 'algorithms',
  },
  {
    id: 'qaoa',
    term: 'Quantum Approximate Optimization Algorithm (QAOA)',
    aliases: ['QAOA'],
    plainEnglish: 'QAOA is a hybrid quantum-classical algorithm for solving combinatorial optimization problems (like the traveling salesman problem). It alternates between two types of operations — a "problem" layer that encodes the objective function and a "mixer" layer that explores solutions. A classical optimizer tunes the parameters. Like VQE, it is designed for near-term quantum computers.',
    mathDefinition: '|γ,β⟩ = e^(-iβₚB) e^(-iγₚC) ··· e^(-iβ₁B) e^(-iγ₁C)|+⟩ⁿ, optimize over γ,β',
    relatedConcepts: ['vqe', 'rotation-gates', 'grovers-algorithm'],
    category: 'algorithms',
  },
  {
    id: 'quantum-supremacy',
    term: 'Quantum Supremacy',
    aliases: ['quantum advantage', 'quantum computational advantage'],
    plainEnglish: 'Quantum supremacy (or quantum advantage) is the milestone where a quantum computer solves a problem significantly faster than any classical computer could. Google claimed it in 2019 with their Sycamore processor, completing a specific sampling task in 200 seconds that they estimated would take a classical supercomputer 10,000 years. The term is somewhat controversial — some prefer "quantum advantage" as a less loaded term.',
    relatedConcepts: ['shors-algorithm', 'grovers-algorithm'],
    category: 'algorithms',
  },

  // ===== ERROR CORRECTION =====
  {
    id: 'decoherence',
    term: 'Decoherence',
    aliases: ['quantum decoherence', 'dephasing'],
    plainEnglish: 'Decoherence is the process by which a qubit loses its quantum properties (superposition and entanglement) due to unwanted interaction with its environment. Think of it like a spinning coin that gradually slows down and falls flat. Decoherence is the biggest enemy of quantum computing — it limits how long computations can run. Quantum error correction exists to fight decoherence.',
    relatedConcepts: ['quantum-noise', 'quantum-error-correction', 'gate-fidelity'],
    category: 'error-correction',
  },
  {
    id: 'gate-fidelity',
    term: 'Gate Fidelity',
    aliases: ['fidelity', 'gate error rate'],
    plainEnglish: 'Gate fidelity measures how accurately a quantum gate performs its intended operation. A fidelity of 1.0 (100%) means the gate is perfect. In practice, gates always have some error — current hardware achieves roughly 99-99.9% fidelity for single-qubit gates and 99-99.5% for two-qubit gates. Higher fidelity means fewer errors, which is crucial for running longer algorithms.',
    mathDefinition: 'F(U, E) = |Tr(U†E)|² / d², where U is the ideal gate and E is the actual operation',
    relatedConcepts: ['decoherence', 'quantum-noise', 'quantum-error-correction'],
    category: 'hardware',
  },
  {
    id: 'quantum-noise',
    term: 'Quantum Noise',
    aliases: ['noise', 'quantum errors', 'noise model'],
    plainEnglish: 'Quantum noise refers to the random errors that affect qubits during computation. Common types include bit flips (X errors), phase flips (Z errors), and depolarizing noise (random errors in any direction). Noise is caused by imperfect control signals, environmental interference, and crosstalk between qubits. Understanding noise is essential for running reliable quantum computations.',
    relatedConcepts: ['decoherence', 'gate-fidelity', 'quantum-error-correction'],
    category: 'error-correction',
  },
  {
    id: 'quantum-error-correction',
    term: 'Quantum Error Correction',
    aliases: ['QEC', 'error correction'],
    plainEnglish: 'Quantum error correction (QEC) uses multiple physical qubits to protect one "logical" qubit from errors. The simplest example is the 3-qubit bit flip code: encode |0⟩ as |000⟩ and |1⟩ as |111⟩, so if one qubit flips, majority voting can fix it. Real QEC codes protect against both bit flips and phase flips. QEC is necessary for large-scale quantum computing but requires many extra qubits.',
    codeExample: {
      framework: 'qiskit',
      code: `from qiskit import QuantumCircuit

# 3-qubit bit flip code
qc = QuantumCircuit(3, 3)
# Encode |0⟩ → |000⟩
qc.cx(0, 1)  # Copy to qubit 1
qc.cx(0, 2)  # Copy to qubit 2
# Simulate error: flip qubit 1
qc.x(1)
# Decode and correct (majority vote)
qc.cx(0, 1)
qc.cx(0, 2)
qc.ccx(1, 2, 0)  # Correct qubit 0 if needed
qc.measure([0, 1, 2], [0, 1, 2])`,
    },
    relatedConcepts: ['stabilizer-code', 'surface-code', 'decoherence', 'quantum-noise'],
    category: 'error-correction',
  },
  {
    id: 'stabilizer-code',
    term: 'Stabilizer Code',
    aliases: ['stabilizer', 'stabilizer formalism'],
    plainEnglish: 'A stabilizer code is a type of quantum error correcting code defined by a set of operators (called stabilizers) that leave the encoded state unchanged. If an error occurs, the stabilizers detect it by returning -1 instead of +1 when measured. The most famous stabilizer codes are the Steane code (7 qubits protecting 1 logical qubit) and the surface code. The stabilizer formalism is the mathematical framework for most quantum error correction.',
    mathDefinition: 'S = {S₁, S₂, ...} where Sᵢ|ψ_L⟩ = |ψ_L⟩ for all logical codewords |ψ_L⟩',
    relatedConcepts: ['quantum-error-correction', 'surface-code'],
    category: 'error-correction',
  },
  {
    id: 'surface-code',
    term: 'Surface Code',
    aliases: ['toric code', 'planar code'],
    plainEnglish: 'The surface code is the most promising quantum error correction code for real hardware. It arranges physical qubits on a 2D grid and uses nearest-neighbor interactions only, making it compatible with most chip architectures. It has a high error threshold (about 1% per gate), meaning if your gates are better than 99% fidelity, the surface code can suppress errors to arbitrarily low levels by using more qubits.',
    relatedConcepts: ['stabilizer-code', 'quantum-error-correction', 'gate-fidelity', 'decoherence'],
    category: 'error-correction',
  },
];
