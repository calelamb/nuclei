export interface ConceptNode {
  id: string;
  label: string;
  category: 'basics' | 'gates' | 'entanglement' | 'algorithms' | 'error-correction' | 'hardware';
  description: string;
  moduleIds: string[];
  exerciseIds: string[];
}

export interface ConceptEdge {
  from: string;
  to: string;
}

export interface ConceptGraph {
  nodes: ConceptNode[];
  edges: ConceptEdge[];
}

export const CONCEPT_GRAPH: ConceptGraph = {
  nodes: [
    // ===== BASICS =====
    {
      id: 'classical-bit',
      label: 'Classical Bit',
      category: 'basics',
      description: 'The fundamental unit of classical information: either 0 or 1. Understanding classical bits is the starting point for understanding qubits.',
      moduleIds: ['fund-1'],
      exerciseIds: [],
    },
    {
      id: 'qubit',
      label: 'Qubit',
      category: 'basics',
      description: 'The basic unit of quantum information. Unlike a classical bit, a qubit can be in a superposition of |0⟩ and |1⟩.',
      moduleIds: ['fund-1'],
      exerciseIds: ['basics-1', 'basics-2'],
    },
    {
      id: 'complex-numbers',
      label: 'Complex Numbers',
      category: 'basics',
      description: 'Numbers with a real and imaginary part (a + bi). Quantum amplitudes are complex numbers, and understanding them is essential for understanding phase.',
      moduleIds: [],
      exerciseIds: [],
    },
    {
      id: 'probability',
      label: 'Probability',
      category: 'basics',
      description: 'The likelihood of a measurement outcome. Quantum probabilities come from squaring the absolute value of complex amplitudes (Born rule).',
      moduleIds: ['fund-6'],
      exerciseIds: [],
    },
    {
      id: 'superposition',
      label: 'Superposition',
      category: 'basics',
      description: 'A qubit state that is a combination of |0⟩ and |1⟩ with definite amplitudes. Measurement collapses superposition to a single outcome.',
      moduleIds: ['fund-3'],
      exerciseIds: ['super-1', 'super-2', 'super-3', 'super-4'],
    },
    {
      id: 'measurement',
      label: 'Measurement',
      category: 'basics',
      description: 'The process of reading a qubit, which collapses its state to |0⟩ or |1⟩ with probabilities determined by the Born rule.',
      moduleIds: ['fund-6'],
      exerciseIds: ['super-3'],
    },

    // ===== GATES =====
    {
      id: 'hadamard',
      label: 'Hadamard Gate',
      category: 'gates',
      description: 'The most important single-qubit gate. Creates equal superposition from |0⟩ or |1⟩. Its own inverse.',
      moduleIds: ['fund-2', 'fund-3'],
      exerciseIds: ['super-1', 'basics-4'],
    },
    {
      id: 'pauli-x',
      label: 'Pauli-X Gate',
      category: 'gates',
      description: 'The quantum NOT gate. Flips |0⟩ to |1⟩ and vice versa. A 180-degree rotation around the X axis of the Bloch sphere.',
      moduleIds: ['fund-2'],
      exerciseIds: ['basics-1', 'basics-3'],
    },
    {
      id: 'pauli-y',
      label: 'Pauli-Y Gate',
      category: 'gates',
      description: 'Combines bit flip and phase flip. A 180-degree rotation around the Y axis of the Bloch sphere.',
      moduleIds: ['fund-2'],
      exerciseIds: [],
    },
    {
      id: 'pauli-z',
      label: 'Pauli-Z Gate',
      category: 'gates',
      description: 'The phase flip gate. Leaves |0⟩ unchanged and maps |1⟩ to -|1⟩. A 180-degree rotation around the Z axis.',
      moduleIds: ['fund-2'],
      exerciseIds: [],
    },
    {
      id: 'cnot',
      label: 'CNOT Gate',
      category: 'gates',
      description: 'Two-qubit gate that flips the target if the control is |1⟩. Essential for creating entanglement.',
      moduleIds: ['fund-5'],
      exerciseIds: ['ent-1', 'ent-2', 'ent-3'],
    },
    {
      id: 'toffoli',
      label: 'Toffoli Gate',
      category: 'gates',
      description: 'Three-qubit gate with two controls and one target. Flips target only when both controls are |1⟩. Universal for classical computation.',
      moduleIds: [],
      exerciseIds: [],
    },
    {
      id: 'swap',
      label: 'SWAP Gate',
      category: 'gates',
      description: 'Exchanges the states of two qubits. Important for hardware with limited qubit connectivity.',
      moduleIds: [],
      exerciseIds: [],
    },
    {
      id: 'phase',
      label: 'Phase & T Gates',
      category: 'gates',
      description: 'S gate adds 90-degree phase, T gate adds 45-degree phase. {H, T, CNOT} form a universal gate set.',
      moduleIds: ['fund-2'],
      exerciseIds: [],
    },
    {
      id: 'rotation',
      label: 'Rotation Gates',
      category: 'gates',
      description: 'Rx, Ry, Rz gates rotate a qubit around the X, Y, or Z axis by an arbitrary angle. Key for variational algorithms.',
      moduleIds: [],
      exerciseIds: [],
    },
    {
      id: 'controlled-gates',
      label: 'Controlled Gates',
      category: 'gates',
      description: 'Gates that apply an operation on a target qubit only when a control qubit is |1⟩. CNOT and Toffoli are examples.',
      moduleIds: ['fund-5'],
      exerciseIds: ['ent-1'],
    },
    {
      id: 'universal-gates',
      label: 'Universal Gate Sets',
      category: 'gates',
      description: 'A set of gates that can approximate any quantum operation. {H, T, CNOT} and {Rx, Ry, CNOT} are common universal sets.',
      moduleIds: [],
      exerciseIds: [],
    },

    // ===== ENTANGLEMENT =====
    {
      id: 'entanglement',
      label: 'Entanglement',
      category: 'entanglement',
      description: 'A quantum correlation between qubits where measuring one instantly determines the other. Cannot be explained by classical physics.',
      moduleIds: ['fund-5'],
      exerciseIds: ['ent-1', 'ent-2', 'ent-3', 'ent-4'],
    },
    {
      id: 'bell-states',
      label: 'Bell States',
      category: 'entanglement',
      description: 'The four maximally entangled two-qubit states: |Φ+⟩, |Φ-⟩, |Ψ+⟩, |Ψ-⟩. The building blocks of quantum information protocols.',
      moduleIds: ['fund-5'],
      exerciseIds: ['ent-1', 'ent-2', 'ent-4'],
    },
    {
      id: 'teleportation',
      label: 'Quantum Teleportation',
      category: 'entanglement',
      description: 'Protocol to transfer a quantum state using entanglement and classical communication. Requires a shared Bell pair.',
      moduleIds: ['fund-7'],
      exerciseIds: ['algo-3'],
    },
    {
      id: 'superdense-coding',
      label: 'Superdense Coding',
      category: 'entanglement',
      description: 'Protocol to send 2 classical bits by transmitting 1 qubit, using a pre-shared Bell pair. The reverse of teleportation.',
      moduleIds: [],
      exerciseIds: [],
    },
    {
      id: 'no-cloning',
      label: 'No-Cloning Theorem',
      category: 'entanglement',
      description: 'It is impossible to create an exact copy of an unknown quantum state. A fundamental theorem that enables quantum cryptography.',
      moduleIds: [],
      exerciseIds: [],
    },

    // ===== ALGORITHMS =====
    {
      id: 'deutsch-jozsa',
      label: 'Deutsch-Jozsa Algorithm',
      category: 'algorithms',
      description: 'Determines if a function is constant or balanced in one query. The first algorithm proving quantum speedup.',
      moduleIds: ['algo-mod-2'],
      exerciseIds: ['algo-1', 'algo-2'],
    },
    {
      id: 'bernstein-vazirani',
      label: 'Bernstein-Vazirani Algorithm',
      category: 'algorithms',
      description: 'Finds a hidden bitstring in one query instead of n. A generalization of Deutsch-Jozsa.',
      moduleIds: ['algo-mod-3'],
      exerciseIds: [],
    },
    {
      id: 'qft',
      label: 'Quantum Fourier Transform',
      category: 'algorithms',
      description: 'Exponentially faster version of the classical Fourier Transform. A key subroutine in Shor\'s algorithm and phase estimation.',
      moduleIds: ['algo-mod-4'],
      exerciseIds: [],
    },
    {
      id: 'grover',
      label: 'Grover\'s Algorithm',
      category: 'algorithms',
      description: 'Searches unsorted data in √N time instead of N. Uses amplitude amplification via oracle and diffusion.',
      moduleIds: ['algo-mod-5'],
      exerciseIds: ['algo-4'],
    },
    {
      id: 'shor',
      label: 'Shor\'s Algorithm',
      category: 'algorithms',
      description: 'Factors large numbers exponentially faster than classical algorithms. Threatens RSA encryption.',
      moduleIds: [],
      exerciseIds: [],
    },
    {
      id: 'vqe',
      label: 'VQE',
      category: 'algorithms',
      description: 'Hybrid quantum-classical algorithm for finding ground state energies of molecules. Designed for near-term hardware.',
      moduleIds: [],
      exerciseIds: [],
    },
    {
      id: 'qaoa',
      label: 'QAOA',
      category: 'algorithms',
      description: 'Hybrid algorithm for combinatorial optimization problems. Uses alternating problem and mixer layers.',
      moduleIds: [],
      exerciseIds: [],
    },

    // ===== ERROR CORRECTION =====
    {
      id: 'noise',
      label: 'Quantum Noise',
      category: 'error-correction',
      description: 'Random errors affecting qubits during computation: bit flips, phase flips, and depolarization.',
      moduleIds: [],
      exerciseIds: [],
    },
    {
      id: 'decoherence',
      label: 'Decoherence',
      category: 'error-correction',
      description: 'The process of qubits losing their quantum properties due to environmental interaction. The main challenge in quantum computing.',
      moduleIds: [],
      exerciseIds: [],
    },
    {
      id: 'bit-flip-code',
      label: 'Bit Flip Code',
      category: 'error-correction',
      description: 'The simplest QEC code: encodes 1 qubit in 3 to protect against X errors using majority vote.',
      moduleIds: [],
      exerciseIds: ['ec-1', 'ec-2', 'ec-3'],
    },
    {
      id: 'phase-flip-code',
      label: 'Phase Flip Code',
      category: 'error-correction',
      description: 'Protects against Z errors by encoding in the Hadamard basis. Combines with bit flip code for full protection.',
      moduleIds: [],
      exerciseIds: ['ec-4'],
    },
    {
      id: 'surface-code',
      label: 'Surface Code',
      category: 'error-correction',
      description: 'The leading QEC code for real hardware. Uses 2D grid of qubits with nearest-neighbor interactions and ~1% error threshold.',
      moduleIds: [],
      exerciseIds: [],
    },

    // ===== HARDWARE =====
    {
      id: 'gate-fidelity',
      label: 'Gate Fidelity',
      category: 'hardware',
      description: 'How accurately a quantum gate performs its intended operation. Current hardware: ~99.9% for 1-qubit, ~99.5% for 2-qubit gates.',
      moduleIds: [],
      exerciseIds: [],
    },
    {
      id: 'qubit-connectivity',
      label: 'Qubit Connectivity',
      category: 'hardware',
      description: 'Which qubits can directly interact on a given chip. Limited connectivity requires SWAP gates to move states around.',
      moduleIds: [],
      exerciseIds: [],
    },
    {
      id: 'transpilation',
      label: 'Transpilation',
      category: 'hardware',
      description: 'Converting a quantum circuit into the native gate set and connectivity of a specific hardware backend.',
      moduleIds: [],
      exerciseIds: [],
    },
    {
      id: 'error-mitigation',
      label: 'Error Mitigation',
      category: 'hardware',
      description: 'Techniques to reduce the impact of errors without full error correction: zero-noise extrapolation, readout error correction, etc.',
      moduleIds: [],
      exerciseIds: [],
    },
  ],

  edges: [
    // Basics flow
    { from: 'classical-bit', to: 'qubit' },
    { from: 'qubit', to: 'superposition' },
    { from: 'complex-numbers', to: 'superposition' },
    { from: 'probability', to: 'measurement' },
    { from: 'superposition', to: 'measurement' },

    // Qubit → Gates
    { from: 'qubit', to: 'hadamard' },
    { from: 'qubit', to: 'pauli-x' },
    { from: 'qubit', to: 'pauli-y' },
    { from: 'qubit', to: 'pauli-z' },

    // Gates internal flow
    { from: 'superposition', to: 'hadamard' },
    { from: 'pauli-x', to: 'cnot' },
    { from: 'hadamard', to: 'cnot' },
    { from: 'cnot', to: 'toffoli' },
    { from: 'cnot', to: 'swap' },
    { from: 'pauli-z', to: 'phase' },
    { from: 'phase', to: 'rotation' },
    { from: 'cnot', to: 'controlled-gates' },
    { from: 'toffoli', to: 'controlled-gates' },
    { from: 'controlled-gates', to: 'universal-gates' },
    { from: 'phase', to: 'universal-gates' },
    { from: 'hadamard', to: 'universal-gates' },
    { from: 'rotation', to: 'universal-gates' },

    // Entanglement flow
    { from: 'cnot', to: 'entanglement' },
    { from: 'superposition', to: 'entanglement' },
    { from: 'entanglement', to: 'bell-states' },
    { from: 'hadamard', to: 'bell-states' },
    { from: 'bell-states', to: 'teleportation' },
    { from: 'measurement', to: 'teleportation' },
    { from: 'bell-states', to: 'superdense-coding' },
    { from: 'entanglement', to: 'no-cloning' },
    { from: 'measurement', to: 'no-cloning' },

    // Algorithms flow
    { from: 'superposition', to: 'deutsch-jozsa' },
    { from: 'hadamard', to: 'deutsch-jozsa' },
    { from: 'measurement', to: 'deutsch-jozsa' },
    { from: 'deutsch-jozsa', to: 'bernstein-vazirani' },
    { from: 'phase', to: 'qft' },
    { from: 'hadamard', to: 'qft' },
    { from: 'controlled-gates', to: 'qft' },
    { from: 'superposition', to: 'grover' },
    { from: 'hadamard', to: 'grover' },
    { from: 'qft', to: 'shor' },
    { from: 'rotation', to: 'vqe' },
    { from: 'measurement', to: 'vqe' },
    { from: 'rotation', to: 'qaoa' },
    { from: 'vqe', to: 'qaoa' },

    // Error correction flow
    { from: 'qubit', to: 'noise' },
    { from: 'noise', to: 'decoherence' },
    { from: 'pauli-x', to: 'bit-flip-code' },
    { from: 'cnot', to: 'bit-flip-code' },
    { from: 'noise', to: 'bit-flip-code' },
    { from: 'pauli-z', to: 'phase-flip-code' },
    { from: 'bit-flip-code', to: 'phase-flip-code' },
    { from: 'phase-flip-code', to: 'surface-code' },
    { from: 'bit-flip-code', to: 'surface-code' },

    // Hardware flow
    { from: 'noise', to: 'gate-fidelity' },
    { from: 'swap', to: 'qubit-connectivity' },
    { from: 'qubit-connectivity', to: 'transpilation' },
    { from: 'universal-gates', to: 'transpilation' },
    { from: 'gate-fidelity', to: 'error-mitigation' },
    { from: 'noise', to: 'error-mitigation' },
    { from: 'decoherence', to: 'gate-fidelity' },
  ],
};
