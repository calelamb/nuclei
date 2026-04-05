import type { Framework } from '../../types/quantum';

export interface Challenge {
  id: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  framework: Framework;
  starterCode: string;
  hints: string[];
  deadline: string;
  submissions: number;
  weekNumber: number;
}

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  score: number;
  submittedAt: string;
}

export const MOCK_CHALLENGES: Challenge[] = [
  {
    id: 'challenge-001',
    title: 'Build the Perfect Bell State',
    description:
      'Create a circuit that produces the Bell state (|00> + |11>) / sqrt(2). Your circuit should measure |00> and |11> with roughly equal probability, and never produce |01> or |10>. Use the minimum number of gates possible.',
    difficulty: 'beginner',
    framework: 'qiskit',
    starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qc = QuantumCircuit(2, 2)

# TODO: Add gates to create a Bell state
# Hint: You need exactly 2 gates

qc.measure([0, 1], [0, 1])

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print(counts)`,
    hints: [
      'A Bell state requires putting one qubit into superposition first.',
      'The Hadamard gate (qc.h) creates an equal superposition of |0> and |1>.',
      'After the Hadamard, use a CNOT gate (qc.cx) to entangle the two qubits.',
    ],
    deadline: '2026-04-07T23:59:59Z',
    submissions: 156,
    weekNumber: 1,
  },
  {
    id: 'challenge-002',
    title: "Grover's Search: Find the Needle",
    description:
      "Implement Grover's algorithm to search for the marked state |10> in a 2-qubit system. Your oracle should mark only the state |10>, and the diffusion operator should amplify its probability. After one iteration, measuring should return |10> with high probability.",
    difficulty: 'intermediate',
    framework: 'qiskit',
    starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qc = QuantumCircuit(2, 2)

# Step 1: Initialize superposition
qc.h([0, 1])

# Step 2: Oracle - mark the state |10>
# TODO: Implement the oracle
# Hint: You need to flip the phase of |10> only

qc.barrier()

# Step 3: Diffusion operator
# TODO: Implement the diffusion operator

qc.barrier()

# Measure
qc.measure([0, 1], [0, 1])

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print(counts)`,
    hints: [
      'To mark |10>, you need to flip qubit 0 before applying a controlled-Z, then flip it back.',
      'The diffusion operator is: H on all qubits, X on all qubits, controlled-Z, X on all qubits, H on all qubits.',
      'For 2 qubits, a single Grover iteration gives the correct answer with 100% probability.',
    ],
    deadline: '2026-04-14T23:59:59Z',
    submissions: 98,
    weekNumber: 2,
  },
  {
    id: 'challenge-003',
    title: 'Quantum Teleportation Protocol',
    description:
      'Implement the full quantum teleportation protocol. Prepare an arbitrary state on qubit 0, then teleport it to qubit 2 using a shared Bell pair and classical communication. Verify the teleported state by measuring qubit 2.',
    difficulty: 'intermediate',
    framework: 'qiskit',
    starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qc = QuantumCircuit(3, 3)

# Step 1: Prepare the state to teleport on qubit 0
# Let's teleport |1>
qc.x(0)
qc.barrier()

# Step 2: Create a Bell pair between qubit 1 and qubit 2
# TODO: Create the Bell pair

qc.barrier()

# Step 3: Alice's operations (Bell measurement on qubits 0 and 1)
# TODO: Implement Alice's side of the protocol

qc.barrier()

# Step 4: Measure Alice's qubits
qc.measure(0, 0)
qc.measure(1, 1)
qc.barrier()

# Step 5: Bob's corrections based on classical bits
# TODO: Apply conditional corrections to qubit 2

# Measure Bob's qubit
qc.measure(2, 2)

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print(counts)`,
    hints: [
      'The Bell pair is created with a Hadamard on qubit 1 followed by CNOT(1, 2).',
      'Alice applies CNOT(0, 1) then H(0) before measuring her qubits.',
      'Bob applies X correction conditioned on qubit 1 measurement, and Z correction conditioned on qubit 0 measurement.',
    ],
    deadline: '2026-04-21T23:59:59Z',
    submissions: 72,
    weekNumber: 3,
  },
  {
    id: 'challenge-004',
    title: 'Optimize this Circuit',
    description:
      'The following circuit implements a simple computation but uses far too many gates. Your task is to produce the same output with fewer gates. The original circuit uses 12 gates — can you get it down to 4 or fewer while producing identical measurement results?',
    difficulty: 'advanced',
    framework: 'qiskit',
    starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

# Original circuit (12 gates) - produces a specific output
# Your job: produce the SAME output with fewer gates
qc = QuantumCircuit(2, 2)

# This sequence is intentionally redundant
qc.h(0)
qc.h(0)      # H*H = I (cancels out)
qc.x(0)
qc.x(1)
qc.cx(0, 1)
qc.cx(0, 1)  # Two CNOTs cancel out
qc.h(0)
qc.z(0)
qc.h(0)      # HZH = X
qc.x(0)      # X*X = I with the HZH result
qc.x(1)
qc.x(1)      # X*X = I (cancels out)

qc.measure([0, 1], [0, 1])

# TODO: Replace with your optimized circuit
# optimized = QuantumCircuit(2, 2)
# ... your gates here ...
# optimized.measure([0, 1], [0, 1])

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print("Original output:", counts)`,
    hints: [
      'Start by identifying pairs of gates that cancel each other out (like H*H = I or X*X = I).',
      'Remember that HZH = X, so three gates can be replaced by one.',
      'After all cancellations, figure out the net effect on each qubit and rebuild from scratch.',
    ],
    deadline: '2026-04-28T23:59:59Z',
    submissions: 45,
    weekNumber: 4,
  },
  {
    id: 'challenge-005',
    title: 'Build a 3-Qubit Error Correction Code',
    description:
      'Implement a 3-qubit bit-flip error correction code. Encode a logical qubit into 3 physical qubits, introduce a single bit-flip error on any one qubit, then use syndrome measurement and correction to recover the original state. Your code should work regardless of which qubit the error occurs on.',
    difficulty: 'advanced',
    framework: 'qiskit',
    starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

# 3 code qubits + 2 ancilla qubits for syndrome measurement
qc = QuantumCircuit(5, 3)

# Step 1: Prepare the logical state (try both |0> and |1>)
# For logical |1>:
qc.x(0)
qc.barrier()

# Step 2: Encode - spread the logical qubit across 3 physical qubits
# TODO: Encode using CNOT gates

qc.barrier()

# Step 3: Introduce an error (bit flip on qubit 1)
qc.x(1)
qc.barrier()

# Step 4: Syndrome measurement
# TODO: Use ancilla qubits 3 and 4 to detect which qubit flipped
# Ancilla 3 checks parity of qubits 0,1
# Ancilla 4 checks parity of qubits 1,2

qc.barrier()

# Step 5: Correction
# TODO: Based on syndrome, correct the flipped qubit

qc.barrier()

# Measure the code qubits
qc.measure([0, 1, 2], [0, 1, 2])

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print("After correction:", counts)`,
    hints: [
      'Encoding uses CNOT from the data qubit (0) to the other code qubits (1 and 2): qc.cx(0, 1) and qc.cx(0, 2).',
      'Syndrome measurement: use CNOT pairs — cx(0,3), cx(1,3) checks parity of qubits 0 and 1; cx(1,4), cx(2,4) checks parity of qubits 1 and 2.',
      'Correction: if both syndromes fire, the error is on qubit 1. If only the first syndrome fires, error is on qubit 0. If only the second, error is on qubit 2. Use Toffoli and CNOT gates for conditional correction.',
    ],
    deadline: '2026-05-05T23:59:59Z',
    submissions: 31,
    weekNumber: 5,
  },
];

export const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  { rank: 1, displayName: 'quantum_wizard', score: 980, submittedAt: '2026-03-28T08:15:00Z' },
  { rank: 2, displayName: 'alice_q', score: 955, submittedAt: '2026-03-28T10:30:00Z' },
  { rank: 3, displayName: 'entangle_me', score: 940, submittedAt: '2026-03-29T14:22:00Z' },
  { rank: 4, displayName: 'bob_quantum', score: 920, submittedAt: '2026-03-29T16:45:00Z' },
  { rank: 5, displayName: 'qubit_master', score: 895, submittedAt: '2026-03-30T09:00:00Z' },
  { rank: 6, displayName: 'diana_dirac', score: 870, submittedAt: '2026-03-30T11:30:00Z' },
  { rank: 7, displayName: 'superpose_this', score: 845, submittedAt: '2026-03-31T13:15:00Z' },
  { rank: 8, displayName: 'charlie_gates', score: 830, submittedAt: '2026-03-31T15:00:00Z' },
  { rank: 9, displayName: 'hadamard_fan', score: 810, submittedAt: '2026-04-01T08:45:00Z' },
  { rank: 10, displayName: 'eve_entangled', score: 790, submittedAt: '2026-04-01T17:20:00Z' },
];
