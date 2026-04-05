import type { Framework } from './quantum';

export interface GateInfo {
  canonical: string;
  displayName: string;
  description: string;
  qubitCount: number;
  paramCount: number;
  matrix?: string;
  frameworkNames: Record<Framework, string>;
}

export const GATE_REGISTRY: Record<string, GateInfo> = {
  H: {
    canonical: 'H',
    displayName: 'Hadamard',
    description: 'Creates superposition. Maps |0⟩ to |+⟩ and |1⟩ to |-⟩.',
    qubitCount: 1,
    paramCount: 0,
    matrix: '1/√2 [[1, 1], [1, -1]]',
    frameworkNames: { qiskit: 'qc.h(q)', cirq: 'cirq.H(q)', 'cuda-q': 'h(q)' },
  },
  X: {
    canonical: 'X',
    displayName: 'Pauli-X',
    description: 'Bit flip. Maps |0⟩ to |1⟩ and vice versa.',
    qubitCount: 1,
    paramCount: 0,
    matrix: '[[0, 1], [1, 0]]',
    frameworkNames: { qiskit: 'qc.x(q)', cirq: 'cirq.X(q)', 'cuda-q': 'x(q)' },
  },
  Y: {
    canonical: 'Y',
    displayName: 'Pauli-Y',
    description: 'Combines bit flip and phase flip.',
    qubitCount: 1,
    paramCount: 0,
    matrix: '[[0, -i], [i, 0]]',
    frameworkNames: { qiskit: 'qc.y(q)', cirq: 'cirq.Y(q)', 'cuda-q': 'y(q)' },
  },
  Z: {
    canonical: 'Z',
    displayName: 'Pauli-Z',
    description: 'Phase flip. Leaves |0⟩ unchanged, maps |1⟩ to -|1⟩.',
    qubitCount: 1,
    paramCount: 0,
    matrix: '[[1, 0], [0, -1]]',
    frameworkNames: { qiskit: 'qc.z(q)', cirq: 'cirq.Z(q)', 'cuda-q': 'z(q)' },
  },
  S: {
    canonical: 'S',
    displayName: 'S Gate',
    description: 'Phase gate. Applies π/2 phase to |1⟩.',
    qubitCount: 1,
    paramCount: 0,
    matrix: '[[1, 0], [0, i]]',
    frameworkNames: { qiskit: 'qc.s(q)', cirq: 'cirq.S(q)', 'cuda-q': 's(q)' },
  },
  T: {
    canonical: 'T',
    displayName: 'T Gate',
    description: 'π/8 gate. Applies π/4 phase to |1⟩.',
    qubitCount: 1,
    paramCount: 0,
    matrix: '[[1, 0], [0, e^(iπ/4)]]',
    frameworkNames: { qiskit: 'qc.t(q)', cirq: 'cirq.T(q)', 'cuda-q': 't(q)' },
  },
  RX: {
    canonical: 'RX',
    displayName: 'Rotation-X',
    description: 'Rotation around X-axis by angle θ.',
    qubitCount: 1,
    paramCount: 1,
    frameworkNames: { qiskit: 'qc.rx(θ, q)', cirq: 'cirq.rx(θ)(q)', 'cuda-q': 'rx(θ, q)' },
  },
  RY: {
    canonical: 'RY',
    displayName: 'Rotation-Y',
    description: 'Rotation around Y-axis by angle θ.',
    qubitCount: 1,
    paramCount: 1,
    frameworkNames: { qiskit: 'qc.ry(θ, q)', cirq: 'cirq.ry(θ)(q)', 'cuda-q': 'ry(θ, q)' },
  },
  RZ: {
    canonical: 'RZ',
    displayName: 'Rotation-Z',
    description: 'Rotation around Z-axis by angle θ.',
    qubitCount: 1,
    paramCount: 1,
    frameworkNames: { qiskit: 'qc.rz(θ, q)', cirq: 'cirq.rz(θ)(q)', 'cuda-q': 'rz(θ, q)' },
  },
  CNOT: {
    canonical: 'CNOT',
    displayName: 'Controlled-NOT',
    description: 'Flips target qubit if control is |1⟩. Creates entanglement.',
    qubitCount: 2,
    paramCount: 0,
    frameworkNames: { qiskit: 'qc.cx(c, t)', cirq: 'cirq.CNOT(c, t)', 'cuda-q': 'cx(c, t)' },
  },
  CZ: {
    canonical: 'CZ',
    displayName: 'Controlled-Z',
    description: 'Applies Z to target if control is |1⟩.',
    qubitCount: 2,
    paramCount: 0,
    frameworkNames: { qiskit: 'qc.cz(c, t)', cirq: 'cirq.CZ(c, t)', 'cuda-q': 'cz(c, t)' },
  },
  SWAP: {
    canonical: 'SWAP',
    displayName: 'SWAP',
    description: 'Swaps the states of two qubits.',
    qubitCount: 2,
    paramCount: 0,
    frameworkNames: { qiskit: 'qc.swap(q1, q2)', cirq: 'cirq.SWAP(q1, q2)', 'cuda-q': 'swap(q1, q2)' },
  },
  Toffoli: {
    canonical: 'Toffoli',
    displayName: 'Toffoli (CCX)',
    description: 'Three-qubit gate. Flips target if both controls are |1⟩.',
    qubitCount: 3,
    paramCount: 0,
    frameworkNames: { qiskit: 'qc.ccx(c1, c2, t)', cirq: 'cirq.TOFFOLI(c1,c2,t)', 'cuda-q': 'x.ctrl(c1, c2, t)' },
  },
  Measure: {
    canonical: 'Measure',
    displayName: 'Measurement',
    description: 'Measures a qubit in the computational basis, collapsing the state.',
    qubitCount: 1,
    paramCount: 0,
    frameworkNames: { qiskit: 'qc.measure(q, c)', cirq: 'cirq.measure(q)', 'cuda-q': 'mz(q)' },
  },
};
