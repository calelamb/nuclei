import type { Framework } from '../types/quantum';

export interface GateData {
  name: string;
  symbol: string;
  category: 'single-qubit' | 'multi-qubit' | 'rotation' | 'measurement';
  qubitCount: number;
  matrix: string;
  blochRotation?: { axis: string; angle: string };
  description: string;
  relatedGates: string[];
  frameworkSyntax: Record<Framework, string>;
}

export const GATE_DATABASE: Record<string, GateData> = {
  H: {
    name: 'Hadamard',
    symbol: 'H',
    category: 'single-qubit',
    qubitCount: 1,
    matrix: '1/√2 · [[1, 1], [1, -1]]',
    blochRotation: { axis: 'X+Z (diagonal)', angle: 'π' },
    description: 'Creates an equal superposition. Maps |0⟩ → |+⟩ = (|0⟩+|1⟩)/√2 and |1⟩ → |−⟩ = (|0⟩−|1⟩)/√2. The most common gate for creating superposition.',
    relatedGates: ['X', 'Z'],
    frameworkSyntax: { qiskit: 'qc.h(qubit)', cirq: 'cirq.H(qubit)', 'cuda-q': 'h(qubit)' },
  },
  X: {
    name: 'Pauli-X (NOT)',
    symbol: 'X',
    category: 'single-qubit',
    qubitCount: 1,
    matrix: '[[0, 1], [1, 0]]',
    blochRotation: { axis: 'X', angle: 'π' },
    description: 'Bit flip gate — the quantum NOT. Swaps |0⟩ and |1⟩. Equivalent to a 180° rotation around the X-axis of the Bloch sphere.',
    relatedGates: ['Y', 'Z', 'H'],
    frameworkSyntax: { qiskit: 'qc.x(qubit)', cirq: 'cirq.X(qubit)', 'cuda-q': 'x(qubit)' },
  },
  Y: {
    name: 'Pauli-Y',
    symbol: 'Y',
    category: 'single-qubit',
    qubitCount: 1,
    matrix: '[[0, -i], [i, 0]]',
    blochRotation: { axis: 'Y', angle: 'π' },
    description: 'Combines a bit flip and a phase flip. Maps |0⟩ → i|1⟩ and |1⟩ → -i|0⟩. A 180° rotation around the Y-axis.',
    relatedGates: ['X', 'Z'],
    frameworkSyntax: { qiskit: 'qc.y(qubit)', cirq: 'cirq.Y(qubit)', 'cuda-q': 'y(qubit)' },
  },
  Z: {
    name: 'Pauli-Z',
    symbol: 'Z',
    category: 'single-qubit',
    qubitCount: 1,
    matrix: '[[1, 0], [0, -1]]',
    blochRotation: { axis: 'Z', angle: 'π' },
    description: 'Phase flip gate. Leaves |0⟩ unchanged and maps |1⟩ → −|1⟩. A 180° rotation around the Z-axis. No visible effect on measurement probabilities alone.',
    relatedGates: ['X', 'Y', 'S', 'T'],
    frameworkSyntax: { qiskit: 'qc.z(qubit)', cirq: 'cirq.Z(qubit)', 'cuda-q': 'z(qubit)' },
  },
  S: {
    name: 'S Gate (√Z)',
    symbol: 'S',
    category: 'single-qubit',
    qubitCount: 1,
    matrix: '[[1, 0], [0, i]]',
    blochRotation: { axis: 'Z', angle: 'π/2' },
    description: 'Quarter-turn phase gate. Applies a π/2 phase to |1⟩. Two S gates = one Z gate. Used in many quantum algorithms.',
    relatedGates: ['Z', 'T', 'Sdg'],
    frameworkSyntax: { qiskit: 'qc.s(qubit)', cirq: 'cirq.S(qubit)', 'cuda-q': 's(qubit)' },
  },
  T: {
    name: 'T Gate (√S)',
    symbol: 'T',
    category: 'single-qubit',
    qubitCount: 1,
    matrix: '[[1, 0], [0, e^(iπ/4)]]',
    blochRotation: { axis: 'Z', angle: 'π/4' },
    description: 'Eighth-turn phase gate (π/8 gate). Applies a π/4 phase to |1⟩. Critical for universal quantum computation. Two T gates = one S gate.',
    relatedGates: ['S', 'Z', 'Tdg'],
    frameworkSyntax: { qiskit: 'qc.t(qubit)', cirq: 'cirq.T(qubit)', 'cuda-q': 't(qubit)' },
  },
  RX: {
    name: 'Rotation-X',
    symbol: 'RX',
    category: 'rotation',
    qubitCount: 1,
    matrix: '[[cos(θ/2), -i·sin(θ/2)], [-i·sin(θ/2), cos(θ/2)]]',
    blochRotation: { axis: 'X', angle: 'θ (parameter)' },
    description: 'Rotates the qubit state around the X-axis by angle θ. RX(π) = X gate. Parameterized — the angle is specified when applied.',
    relatedGates: ['RY', 'RZ', 'X'],
    frameworkSyntax: { qiskit: 'qc.rx(θ, qubit)', cirq: 'cirq.rx(θ)(qubit)', 'cuda-q': 'rx(θ, qubit)' },
  },
  RY: {
    name: 'Rotation-Y',
    symbol: 'RY',
    category: 'rotation',
    qubitCount: 1,
    matrix: '[[cos(θ/2), -sin(θ/2)], [sin(θ/2), cos(θ/2)]]',
    blochRotation: { axis: 'Y', angle: 'θ (parameter)' },
    description: 'Rotates the qubit state around the Y-axis by angle θ. RY(π) = Y gate (up to global phase). Used for state preparation.',
    relatedGates: ['RX', 'RZ', 'Y'],
    frameworkSyntax: { qiskit: 'qc.ry(θ, qubit)', cirq: 'cirq.ry(θ)(qubit)', 'cuda-q': 'ry(θ, qubit)' },
  },
  RZ: {
    name: 'Rotation-Z',
    symbol: 'RZ',
    category: 'rotation',
    qubitCount: 1,
    matrix: '[[e^(-iθ/2), 0], [0, e^(iθ/2)]]',
    blochRotation: { axis: 'Z', angle: 'θ (parameter)' },
    description: 'Rotates the qubit state around the Z-axis by angle θ. RZ(π) = Z gate. Changes the relative phase between |0⟩ and |1⟩.',
    relatedGates: ['RX', 'RY', 'Z', 'S', 'T'],
    frameworkSyntax: { qiskit: 'qc.rz(θ, qubit)', cirq: 'cirq.rz(θ)(qubit)', 'cuda-q': 'rz(θ, qubit)' },
  },
  CNOT: {
    name: 'Controlled-NOT (CX)',
    symbol: 'CNOT',
    category: 'multi-qubit',
    qubitCount: 2,
    matrix: '[[1,0,0,0], [0,1,0,0], [0,0,0,1], [0,0,1,0]]',
    description: 'Flips the target qubit if and only if the control qubit is |1⟩. The primary gate for creating entanglement. CNOT + H can create a Bell state.',
    relatedGates: ['CZ', 'Toffoli', 'SWAP'],
    frameworkSyntax: { qiskit: 'qc.cx(control, target)', cirq: 'cirq.CNOT(control, target)', 'cuda-q': 'cx(control, target)' },
  },
  CZ: {
    name: 'Controlled-Z',
    symbol: 'CZ',
    category: 'multi-qubit',
    qubitCount: 2,
    matrix: '[[1,0,0,0], [0,1,0,0], [0,0,1,0], [0,0,0,-1]]',
    description: 'Applies a Z gate to the target qubit if the control is |1⟩. Symmetric — control and target are interchangeable. Applies a phase of -1 to |11⟩.',
    relatedGates: ['CNOT', 'Z'],
    frameworkSyntax: { qiskit: 'qc.cz(q1, q2)', cirq: 'cirq.CZ(q1, q2)', 'cuda-q': 'cz(q1, q2)' },
  },
  SWAP: {
    name: 'SWAP',
    symbol: 'SWAP',
    category: 'multi-qubit',
    qubitCount: 2,
    matrix: '[[1,0,0,0], [0,0,1,0], [0,1,0,0], [0,0,0,1]]',
    description: 'Swaps the quantum states of two qubits. |01⟩ → |10⟩ and vice versa. Can be decomposed into three CNOT gates.',
    relatedGates: ['CNOT'],
    frameworkSyntax: { qiskit: 'qc.swap(q1, q2)', cirq: 'cirq.SWAP(q1, q2)', 'cuda-q': 'swap(q1, q2)' },
  },
  Toffoli: {
    name: 'Toffoli (CCX)',
    symbol: 'CCX',
    category: 'multi-qubit',
    qubitCount: 3,
    matrix: '8×8 (flips target only when both controls are |1⟩)',
    description: 'Three-qubit gate: flips the target qubit only when both control qubits are |1⟩. The quantum AND gate. Universal for classical computation.',
    relatedGates: ['CNOT', 'CZ'],
    frameworkSyntax: { qiskit: 'qc.ccx(c1, c2, target)', cirq: 'cirq.TOFFOLI(c1, c2, target)', 'cuda-q': 'x.ctrl(c1, c2, target)' },
  },
  Measure: {
    name: 'Measurement',
    symbol: 'M',
    category: 'measurement',
    qubitCount: 1,
    matrix: 'N/A (non-unitary)',
    description: 'Measures a qubit in the computational basis (Z basis), collapsing the superposition to |0⟩ or |1⟩. The probability of each outcome is |α|² and |β|² respectively.',
    relatedGates: [],
    frameworkSyntax: { qiskit: 'qc.measure(qubit, cbit)', cirq: 'cirq.measure(qubit, key="m")', 'cuda-q': 'mz(qubit)' },
  },
};

export function getGateData(gateName: string): GateData | undefined {
  return GATE_DATABASE[gateName] ?? GATE_DATABASE[gateName.toUpperCase()];
}
