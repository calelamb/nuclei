import type { Exercise } from '../../stores/exerciseStore';

export const BUILT_IN_EXERCISES: Exercise[] = [
  // ===== BASICS =====
  {
    id: 'basics-1', title: 'Your First Qubit', topic: 'Basics', difficulty: 'beginner', framework: 'qiskit',
    description: 'Create a single qubit circuit and apply an X gate to flip it from |0⟩ to |1⟩. Measure the result.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
# TODO: Apply an X gate to qubit 0
# TODO: Measure qubit 0 into classical bit 0
`,
    expectedOutput: { '1': 1.0 },
    hints: ['The X gate flips |0⟩ to |1⟩.', 'Use qc.x(0) to apply X to qubit 0.', 'Use qc.measure(0, 0) to measure.'],
    isBuiltIn: true,
  },
  {
    id: 'basics-2', title: 'Two Qubit Circuit', topic: 'Basics', difficulty: 'beginner', framework: 'qiskit',
    description: 'Create a 2-qubit circuit. Flip the second qubit to |1⟩ and leave the first as |0⟩. You should measure |01⟩ every time.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
# TODO: Apply X gate to qubit 1 only
# TODO: Measure both qubits
`,
    expectedOutput: { '01': 1.0 },
    hints: ['Remember qubit indexing starts at 0.', 'qc.x(1) flips the second qubit.', 'qc.measure([0,1], [0,1]) measures both.'],
    isBuiltIn: true,
  },
  {
    id: 'basics-3', title: 'Multiple Gates', topic: 'Basics', difficulty: 'beginner', framework: 'qiskit',
    description: 'Apply X, then X again to qubit 0. What happens? Two X gates cancel out — you should measure |0⟩.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
# TODO: Apply X gate twice to qubit 0
# TODO: Measure
`,
    expectedOutput: { '0': 1.0 },
    hints: ['X applied twice returns to the original state.', 'qc.x(0) then qc.x(0) again.'],
    isBuiltIn: true,
  },
  {
    id: 'basics-4', title: 'Identity Check', topic: 'Basics', difficulty: 'intermediate', framework: 'qiskit',
    description: 'Apply H, then H again to qubit 0. The Hadamard is its own inverse — you should measure |0⟩ with 100% probability.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
# TODO: Apply H gate twice
# TODO: Measure
`,
    expectedOutput: { '0': 1.0 },
    hints: ['H·H = I (identity).', 'Apply qc.h(0) twice.'],
    isBuiltIn: true,
  },

  // ===== SUPERPOSITION =====
  {
    id: 'super-1', title: 'Equal Superposition', topic: 'Superposition', difficulty: 'beginner', framework: 'qiskit',
    description: 'Put a single qubit into an equal superposition using the Hadamard gate. You should see ~50% |0⟩ and ~50% |1⟩.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
# TODO: Create superposition
# TODO: Measure
`,
    expectedOutput: { '0': 0.5, '1': 0.5 },
    hints: ['The Hadamard gate creates superposition.', 'Use qc.h(0).', 'Then qc.measure(0, 0).'],
    isBuiltIn: true,
  },
  {
    id: 'super-2', title: 'Two Qubit Superposition', topic: 'Superposition', difficulty: 'beginner', framework: 'qiskit',
    description: 'Put both qubits into superposition. You should see all four states (|00⟩, |01⟩, |10⟩, |11⟩) each with ~25% probability.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
# TODO: Apply H to both qubits
# TODO: Measure both
`,
    expectedOutput: { '00': 0.25, '01': 0.25, '10': 0.25, '11': 0.25 },
    hints: ['Apply H to qubit 0 and qubit 1 separately.', 'qc.h(0) and qc.h(1).'],
    isBuiltIn: true,
  },
  {
    id: 'super-3', title: 'Minus State', topic: 'Superposition', difficulty: 'intermediate', framework: 'qiskit',
    description: 'Create the |−⟩ state: (|0⟩ − |1⟩)/√2. Apply X first, then H. The measurement probabilities are the same as |+⟩, but the phase is different.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
# TODO: Create the |−⟩ state
# TODO: Measure
`,
    expectedOutput: { '0': 0.5, '1': 0.5 },
    hints: ['Start with |1⟩ by applying X.', 'Then apply H to get |−⟩.', 'qc.x(0) then qc.h(0).'],
    isBuiltIn: true,
  },
  {
    id: 'super-4', title: 'Selective Superposition', topic: 'Superposition', difficulty: 'intermediate', framework: 'qiskit',
    description: 'Create a 2-qubit circuit where only qubit 0 is in superposition and qubit 1 is |1⟩. Expected: ~50% |01⟩ and ~50% |11⟩.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
# TODO: Superposition on q0, flip q1
# TODO: Measure
`,
    expectedOutput: { '01': 0.5, '11': 0.5 },
    hints: ['Apply H to qubit 0 for superposition.', 'Apply X to qubit 1 to flip it.', 'Order doesn\'t matter for independent qubits.'],
    isBuiltIn: true,
  },

  // ===== ENTANGLEMENT =====
  {
    id: 'ent-1', title: 'Bell State (Φ+)', topic: 'Entanglement', difficulty: 'beginner', framework: 'qiskit',
    description: 'Create the Bell state |Φ+⟩ = (|00⟩ + |11⟩)/√2. This is the most famous entangled state.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
# TODO: Create the Bell state
# TODO: Measure both qubits
`,
    expectedOutput: { '00': 0.5, '11': 0.5 },
    hints: ['Start with H on qubit 0.', 'Then CNOT with control=0, target=1.', 'qc.h(0) then qc.cx(0, 1).'],
    isBuiltIn: true,
  },
  {
    id: 'ent-2', title: 'Bell State (Ψ+)', topic: 'Entanglement', difficulty: 'intermediate', framework: 'qiskit',
    description: 'Create the Bell state |Ψ+⟩ = (|01⟩ + |10⟩)/√2. Hint: start with Φ+ and flip one qubit.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
# TODO: Create the |Ψ+⟩ Bell state
# TODO: Measure
`,
    expectedOutput: { '01': 0.5, '10': 0.5 },
    hints: ['Start with the Φ+ state: H then CNOT.', 'Then apply X to one qubit to flip it.', 'qc.h(0), qc.cx(0,1), qc.x(1).'],
    isBuiltIn: true,
  },
  {
    id: 'ent-3', title: 'GHZ State', topic: 'Entanglement', difficulty: 'intermediate', framework: 'qiskit',
    description: 'Create a 3-qubit GHZ state: (|000⟩ + |111⟩)/√2. This is like a Bell state but with 3 qubits.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(3, 3)
# TODO: Create GHZ state
# TODO: Measure all qubits
`,
    expectedOutput: { '000': 0.5, '111': 0.5 },
    hints: ['Start with H on qubit 0.', 'Chain CNOTs: 0→1, then 1→2.', 'qc.h(0), qc.cx(0,1), qc.cx(1,2).'],
    isBuiltIn: true,
  },
  {
    id: 'ent-4', title: 'All Bell States', topic: 'Entanglement', difficulty: 'advanced', framework: 'qiskit',
    description: 'Create the |Φ−⟩ Bell state: (|00⟩ − |11⟩)/√2. Apply a Z gate to add the phase difference.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
# TODO: Create |Φ−⟩ state
# TODO: Measure
`,
    expectedOutput: { '00': 0.5, '11': 0.5 },
    hints: ['Create Φ+ first: H then CNOT.', 'Apply Z to qubit 0 for the minus sign.', 'qc.h(0), qc.cx(0,1), qc.z(0).'],
    isBuiltIn: true,
  },

  // ===== ALGORITHMS =====
  {
    id: 'algo-1', title: 'Deutsch Oracle (Constant)', topic: 'Algorithms', difficulty: 'intermediate', framework: 'qiskit',
    description: 'Implement the Deutsch algorithm for a constant oracle (f(x)=0). The result qubit should measure |0⟩.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 1)
# Input qubit in |+⟩, output qubit in |−⟩
qc.x(1)
qc.h(0)
qc.h(1)
# TODO: Apply the constant oracle (f(x)=0 means do nothing)
# Apply H to input qubit
qc.h(0)
# Measure input qubit
qc.measure(0, 0)
`,
    expectedOutput: { '0': 1.0 },
    hints: ['For a constant oracle f(x)=0, the oracle does nothing.', 'Just leave the oracle section empty.', 'The measurement of qubit 0 reveals if f is constant (0) or balanced (1).'],
    isBuiltIn: true,
  },
  {
    id: 'algo-2', title: 'Deutsch Oracle (Balanced)', topic: 'Algorithms', difficulty: 'intermediate', framework: 'qiskit',
    description: 'Implement the Deutsch algorithm for a balanced oracle (f(x)=x). The result qubit should measure |1⟩.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 1)
qc.x(1)
qc.h(0)
qc.h(1)
# TODO: Apply the balanced oracle (f(x)=x means CNOT)
# Apply H to input qubit
qc.h(0)
qc.measure(0, 0)
`,
    expectedOutput: { '1': 1.0 },
    hints: ['The balanced oracle f(x)=x is implemented as a CNOT.', 'qc.cx(0, 1) between the H gates.', 'Measuring |1⟩ means the function is balanced.'],
    isBuiltIn: true,
  },
  {
    id: 'algo-3', title: 'Phase Kickback', topic: 'Algorithms', difficulty: 'advanced', framework: 'qiskit',
    description: 'Demonstrate phase kickback: apply H to qubit 0, X then H to qubit 1, then CNOT. Measure qubit 0 — it should be |1⟩ due to phase kickback.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 1)
# TODO: Set up phase kickback
# - Put qubit 0 in |+⟩
# - Put qubit 1 in |−⟩
# - Apply CNOT(0, 1)
# - Apply H to qubit 0
# - Measure qubit 0
`,
    expectedOutput: { '1': 1.0 },
    hints: ['qc.h(0) puts q0 in |+⟩.', 'qc.x(1) then qc.h(1) puts q1 in |−⟩.', 'After CNOT and H on q0, phase kickback flips q0 to |1⟩.'],
    isBuiltIn: true,
  },
  {
    id: 'algo-4', title: 'Swap Test', topic: 'Algorithms', difficulty: 'advanced', framework: 'qiskit',
    description: 'Build a swap test circuit to compare two qubits. If both are |0⟩, the ancilla should measure |0⟩ with 100% probability.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(3, 1)
# Ancilla = qubit 0, Test qubits = qubit 1, 2
# Both test qubits are |0⟩ (identical states)
# TODO: Implement swap test
# 1. H on ancilla
# 2. Controlled-SWAP (Fredkin) on qubits 1,2 controlled by 0
# 3. H on ancilla
# 4. Measure ancilla
`,
    expectedOutput: { '0': 1.0 },
    hints: ['Apply H to qubit 0.', 'Use qc.cswap(0, 1, 2) for the controlled swap.', 'Apply H to qubit 0 again, then measure.'],
    isBuiltIn: true,
  },

  // ===== ERROR CORRECTION =====
  {
    id: 'ec-1', title: 'Bit Flip Code (Encode)', topic: 'Error Correction', difficulty: 'intermediate', framework: 'qiskit',
    description: 'Encode a single qubit using the 3-qubit bit flip code: |0⟩ → |000⟩, |1⟩ → |111⟩. Use CNOTs to copy the state.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(3, 3)
# Qubit 0 is our logical qubit (currently |0⟩)
# TODO: Encode into 3 physical qubits using CNOT
# TODO: Measure all 3 qubits
`,
    expectedOutput: { '000': 1.0 },
    hints: ['CNOT copies the control qubit state to the target.', 'Use qc.cx(0, 1) and qc.cx(0, 2).', 'All three should measure the same.'],
    isBuiltIn: true,
  },
  {
    id: 'ec-2', title: 'Bit Flip Code (Encode |1⟩)', topic: 'Error Correction', difficulty: 'intermediate', framework: 'qiskit',
    description: 'Encode |1⟩ using the 3-qubit bit flip code. Apply X first, then the encoding CNOTs. All three qubits should be |1⟩.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(3, 3)
# TODO: Set logical qubit to |1⟩
# TODO: Encode with CNOTs
# TODO: Measure
`,
    expectedOutput: { '111': 1.0 },
    hints: ['Apply X to qubit 0 first.', 'Then CNOT 0→1 and 0→2 to spread the state.', 'All three should be |1⟩.'],
    isBuiltIn: true,
  },
  {
    id: 'ec-3', title: 'Detect a Bit Flip', topic: 'Error Correction', difficulty: 'advanced', framework: 'qiskit',
    description: 'Encode |0⟩ in the bit flip code, introduce an error (X on qubit 1), then detect it using syndrome measurement with ancillas.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(5, 2)  # 3 data + 2 ancilla
# Encode
qc.cx(0, 1)
qc.cx(0, 2)
# Error on qubit 1
qc.x(1)
# TODO: Syndrome measurement
# - CNOT q0→q3, CNOT q1→q3 (syndrome bit 1)
# - CNOT q1→q4, CNOT q2→q4 (syndrome bit 2)
# - Measure q3 and q4
`,
    expectedOutput: { '11': 1.0 },
    hints: ['Syndrome bits detect which qubit flipped.', 'CNOT from data qubits to ancilla qubits.', 'Syndrome 11 means qubit 1 was flipped.'],
    isBuiltIn: true,
  },
  {
    id: 'ec-4', title: 'Phase Flip Code', topic: 'Error Correction', difficulty: 'advanced', framework: 'qiskit',
    description: 'Encode a qubit using the 3-qubit phase flip code: use H gates around the bit flip encoding to protect against Z errors.',
    starterCode: `from qiskit import QuantumCircuit

qc = QuantumCircuit(3, 3)
# TODO: Encode in phase flip code
# 1. CNOT encoding (like bit flip code)
# 2. Apply H to all three qubits
# 3. Measure all
`,
    expectedOutput: { '000': 0.25, '011': 0.25, '101': 0.25, '110': 0.25 },
    hints: ['Start with CNOT encoding: cx(0,1) and cx(0,2).', 'Then apply H to all three qubits.', 'The superposition creates the phase flip code words.'],
    isBuiltIn: true,
  },
];

export function getExercisesByTopic(): Record<string, Exercise[]> {
  const result: Record<string, Exercise[]> = {};
  for (const ex of BUILT_IN_EXERCISES) {
    if (!result[ex.topic]) result[ex.topic] = [];
    result[ex.topic].push(ex);
  }
  return result;
}
