import type { Framework } from '../../types/quantum';

export interface GalleryCircuit {
  id: string;
  title: string;
  description: string;
  author: { id: string; displayName: string };
  framework: Framework;
  code: string;
  category: 'tutorial' | 'algorithm' | 'art' | 'challenge';
  tags: string[];
  likes: number;
  createdAt: string;
  featured: boolean;
}

export const MOCK_GALLERY: GalleryCircuit[] = [
  {
    id: 'gallery-001',
    title: 'Bell State',
    description: 'The simplest entangled state: apply a Hadamard gate followed by a CNOT to create (|00> + |11>) / sqrt(2). A fundamental building block in quantum computing.',
    author: { id: 'user-alice', displayName: 'alice_q' },
    framework: 'qiskit',
    code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print(counts)`,
    category: 'tutorial',
    tags: ['entanglement', 'bell-state', 'beginner'],
    likes: 142,
    createdAt: '2026-01-05T10:30:00Z',
    featured: true,
  },
  {
    id: 'gallery-002',
    title: 'GHZ State',
    description: 'A 3-qubit Greenberger-Horne-Zeilinger state: a maximally entangled state of three qubits that produces only |000> or |111> when measured.',
    author: { id: 'user-bob', displayName: 'bob_quantum' },
    framework: 'qiskit',
    code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qc = QuantumCircuit(3, 3)
qc.h(0)
qc.cx(0, 1)
qc.cx(0, 2)
qc.measure([0, 1, 2], [0, 1, 2])

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print(counts)`,
    category: 'tutorial',
    tags: ['entanglement', 'ghz', 'multi-qubit'],
    likes: 98,
    createdAt: '2026-01-12T14:15:00Z',
    featured: true,
  },
  {
    id: 'gallery-003',
    title: 'Quantum Teleportation',
    description: 'Teleport the state of one qubit to another using entanglement and classical communication. Demonstrates the full teleportation protocol.',
    author: { id: 'user-charlie', displayName: 'charlie_gates' },
    framework: 'qiskit',
    code: `from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister
from qiskit_aer import AerSimulator

# Create registers
qr = QuantumRegister(3, 'q')
cr = ClassicalRegister(3, 'c')
qc = QuantumCircuit(qr, cr)

# Prepare state to teleport (|1> for demonstration)
qc.x(qr[0])
qc.barrier()

# Create Bell pair between q1 and q2
qc.h(qr[1])
qc.cx(qr[1], qr[2])
qc.barrier()

# Alice's operations
qc.cx(qr[0], qr[1])
qc.h(qr[0])
qc.barrier()

# Measure Alice's qubits
qc.measure(qr[0], cr[0])
qc.measure(qr[1], cr[1])
qc.barrier()

# Bob's corrections
qc.x(qr[2]).c_if(cr[1], 1)
qc.z(qr[2]).c_if(cr[0], 1)
qc.measure(qr[2], cr[2])

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print(counts)`,
    category: 'algorithm',
    tags: ['teleportation', 'entanglement', 'protocol', 'intermediate'],
    likes: 203,
    createdAt: '2026-01-18T09:00:00Z',
    featured: true,
  },
  {
    id: 'gallery-004',
    title: "Grover's Search (2-qubit)",
    description: "Grover's algorithm on 2 qubits to search for the marked state |11>. Demonstrates quadratic speedup for unstructured search.",
    author: { id: 'user-diana', displayName: 'diana_dirac' },
    framework: 'qiskit',
    code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qc = QuantumCircuit(2, 2)

# Initialize superposition
qc.h([0, 1])

# Oracle: mark |11>
qc.cz(0, 1)

# Diffusion operator
qc.h([0, 1])
qc.z([0, 1])
qc.cz(0, 1)
qc.h([0, 1])

# Measure
qc.measure([0, 1], [0, 1])

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print(counts)`,
    category: 'algorithm',
    tags: ['grover', 'search', 'oracle', 'intermediate'],
    likes: 87,
    createdAt: '2026-01-25T16:45:00Z',
    featured: false,
  },
  {
    id: 'gallery-005',
    title: 'Deutsch-Jozsa Algorithm',
    description: 'Determine whether a function is constant or balanced in a single query. A classic example of quantum advantage over classical computation.',
    author: { id: 'user-eve', displayName: 'eve_entangled' },
    framework: 'qiskit',
    code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

# 2-qubit Deutsch-Jozsa with a balanced oracle
qc = QuantumCircuit(3, 2)

# Initialize
qc.x(2)
qc.h([0, 1, 2])
qc.barrier()

# Balanced oracle: CNOT from each input to output
qc.cx(0, 2)
qc.cx(1, 2)
qc.barrier()

# Apply Hadamard to input qubits
qc.h([0, 1])

# Measure input qubits
qc.measure([0, 1], [0, 1])

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print("Result:", counts)
print("Function is balanced" if '00' not in counts else "Function is constant")`,
    category: 'algorithm',
    tags: ['deutsch-jozsa', 'oracle', 'quantum-advantage'],
    likes: 64,
    createdAt: '2026-02-01T11:20:00Z',
    featured: false,
  },
  {
    id: 'gallery-006',
    title: 'Bernstein-Vazirani Algorithm',
    description: 'Find a hidden binary string s in a single query using quantum parallelism. The oracle encodes s as f(x) = s dot x mod 2.',
    author: { id: 'user-alice', displayName: 'alice_q' },
    framework: 'qiskit',
    code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

# Hidden string: s = "101"
n = 3
secret = "101"

qc = QuantumCircuit(n + 1, n)

# Initialize output qubit
qc.x(n)
qc.h(range(n + 1))
qc.barrier()

# Oracle: apply CNOT for each '1' in the secret string
for i, bit in enumerate(reversed(secret)):
    if bit == '1':
        qc.cx(i, n)

qc.barrier()
qc.h(range(n))
qc.measure(range(n), range(n))

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print("Secret string:", max(counts, key=counts.get))`,
    category: 'algorithm',
    tags: ['bernstein-vazirani', 'oracle', 'hidden-string'],
    likes: 52,
    createdAt: '2026-02-05T08:30:00Z',
    featured: false,
  },
  {
    id: 'gallery-007',
    title: 'Quantum Random Walk',
    description: 'A discrete-time quantum random walk on a line using a coin qubit and position register. Shows how quantum walks spread faster than classical random walks.',
    author: { id: 'user-bob', displayName: 'bob_quantum' },
    framework: 'qiskit',
    code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import math

# 1 coin qubit + 3 position qubits (8 positions)
n_pos = 3
qc = QuantumCircuit(1 + n_pos, n_pos)

# Start in the middle position (|100>)
qc.x(1)

# 3 steps of quantum walk
for step in range(3):
    # Coin flip: Hadamard on coin qubit
    qc.h(0)
    qc.barrier()

    # Conditional shift: increment position if coin is |1>
    # Simplified: CNOT from coin to position qubits
    for i in range(n_pos):
        qc.cx(0, 1 + i)

    qc.barrier()

# Measure position
qc.measure(range(1, 1 + n_pos), range(n_pos))

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print("Position distribution:", counts)`,
    category: 'art',
    tags: ['random-walk', 'quantum-walk', 'exploration'],
    likes: 41,
    createdAt: '2026-02-10T13:00:00Z',
    featured: false,
  },
  {
    id: 'gallery-008',
    title: 'Superdense Coding',
    description: 'Send 2 classical bits using only 1 qubit by leveraging a pre-shared Bell pair. Alice encodes, Bob decodes.',
    author: { id: 'user-charlie', displayName: 'charlie_gates' },
    framework: 'qiskit',
    code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qc = QuantumCircuit(2, 2)

# Create Bell pair
qc.h(0)
qc.cx(0, 1)
qc.barrier()

# Alice encodes message "10" (apply Z gate for bit 1, X gate for bit 0)
# Message "00": do nothing
# Message "01": apply X
# Message "10": apply Z
# Message "11": apply ZX
qc.z(0)  # Encoding "10"
qc.barrier()

# Bob decodes
qc.cx(0, 1)
qc.h(0)
qc.measure([0, 1], [0, 1])

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print("Decoded message:", counts)`,
    category: 'tutorial',
    tags: ['superdense-coding', 'communication', 'bell-pair'],
    likes: 73,
    createdAt: '2026-02-14T17:30:00Z',
    featured: false,
  },
  {
    id: 'gallery-009',
    title: 'Phase Estimation',
    description: 'Quantum Phase Estimation for a T-gate (phase = pi/4). Uses 3 counting qubits and inverse QFT to estimate the eigenvalue phase.',
    author: { id: 'user-diana', displayName: 'diana_dirac' },
    framework: 'qiskit',
    code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import math

n_count = 3  # counting qubits
qc = QuantumCircuit(n_count + 1, n_count)

# Initialize eigenstate |1>
qc.x(n_count)

# Apply Hadamard to counting qubits
for i in range(n_count):
    qc.h(i)

# Controlled unitary operations (T gate has phase pi/4)
for i in range(n_count):
    for _ in range(2 ** i):
        qc.cp(math.pi / 4, i, n_count)

qc.barrier()

# Inverse QFT on counting qubits
for i in range(n_count // 2):
    qc.swap(i, n_count - 1 - i)
for i in range(n_count):
    for j in range(i):
        qc.cp(-math.pi / (2 ** (i - j)), j, i)
    qc.h(i)

qc.barrier()
qc.measure(range(n_count), range(n_count))

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print("Phase estimation result:", counts)`,
    category: 'algorithm',
    tags: ['phase-estimation', 'qft', 'eigenvalue', 'advanced'],
    likes: 115,
    createdAt: '2026-02-20T10:00:00Z',
    featured: true,
  },
  {
    id: 'gallery-010',
    title: 'Simple VQE',
    description: 'A minimal Variational Quantum Eigensolver example. Uses a parameterized circuit to find the ground state energy of a simple Hamiltonian.',
    author: { id: 'user-eve', displayName: 'eve_entangled' },
    framework: 'qiskit',
    code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np

def create_ansatz(theta):
    """Create a parameterized ansatz circuit."""
    qc = QuantumCircuit(2)
    qc.ry(theta[0], 0)
    qc.ry(theta[1], 1)
    qc.cx(0, 1)
    qc.ry(theta[2], 0)
    qc.ry(theta[3], 1)
    return qc

def measure_zz(theta):
    """Measure <ZZ> expectation value."""
    qc = create_ansatz(theta)
    qc.measure_all()
    simulator = AerSimulator()
    result = simulator.run(qc, shots=1024).result()
    counts = result.get_counts()
    total = sum(counts.values())
    exp = 0.0
    for bitstring, count in counts.items():
        parity = (-1) ** bitstring.count('1')
        exp += parity * count / total
    return exp

# Simple parameter sweep
best_energy = 1.0
best_params = None
for _ in range(20):
    params = np.random.uniform(-np.pi, np.pi, 4)
    energy = measure_zz(params)
    if energy < best_energy:
        best_energy = energy
        best_params = params

print(f"Best energy: {best_energy:.4f}")
print(f"Best params: {best_params}")`,
    category: 'algorithm',
    tags: ['vqe', 'variational', 'optimization', 'advanced'],
    likes: 89,
    createdAt: '2026-02-25T15:45:00Z',
    featured: false,
  },
  {
    id: 'gallery-011',
    title: 'Quantum Fourier Transform',
    description: 'Implementation of the Quantum Fourier Transform on 3 qubits. The quantum analog of the discrete Fourier transform, used in many quantum algorithms.',
    author: { id: 'user-alice', displayName: 'alice_q' },
    framework: 'qiskit',
    code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import math

n = 3
qc = QuantumCircuit(n, n)

# Prepare an input state |5> = |101>
qc.x(0)
qc.x(2)
qc.barrier()

# QFT
for i in range(n):
    qc.h(i)
    for j in range(i + 1, n):
        qc.cp(math.pi / (2 ** (j - i)), j, i)

# Swap qubits for correct output ordering
for i in range(n // 2):
    qc.swap(i, n - 1 - i)

qc.barrier()
qc.measure(range(n), range(n))

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print("QFT result:", counts)`,
    category: 'algorithm',
    tags: ['qft', 'fourier', 'transform', 'intermediate'],
    likes: 76,
    createdAt: '2026-03-01T09:15:00Z',
    featured: false,
  },
  {
    id: 'gallery-012',
    title: 'Error Correction (3-bit Repetition)',
    description: 'A simple 3-bit repetition code that protects against a single bit-flip error. Encodes one logical qubit into three physical qubits.',
    author: { id: 'user-bob', displayName: 'bob_quantum' },
    framework: 'qiskit',
    code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qc = QuantumCircuit(5, 3)

# Prepare logical |1> state
qc.x(0)
qc.barrier()

# Encode: spread across 3 qubits
qc.cx(0, 1)
qc.cx(0, 2)
qc.barrier()

# Simulate a bit-flip error on qubit 1
qc.x(1)
qc.barrier()

# Syndrome measurement using ancilla qubits
qc.cx(0, 3)
qc.cx(1, 3)
qc.cx(1, 4)
qc.cx(2, 4)
qc.barrier()

# Correction based on syndrome
qc.ccx(3, 4, 1)  # If both syndromes triggered, fix qubit 1
qc.barrier()

# Measure the code qubits
qc.measure([0, 1, 2], [0, 1, 2])

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print("After correction:", counts)`,
    category: 'tutorial',
    tags: ['error-correction', 'repetition-code', 'syndrome'],
    likes: 58,
    createdAt: '2026-03-05T12:00:00Z',
    featured: false,
  },
  {
    id: 'gallery-013',
    title: 'Swap Test',
    description: 'The Swap Test determines how similar two quantum states are without measuring them directly. Uses a controlled-SWAP and ancilla qubit.',
    author: { id: 'user-charlie', displayName: 'charlie_gates' },
    framework: 'qiskit',
    code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qc = QuantumCircuit(3, 1)

# Prepare two states to compare
# State 1 on qubit 1: |0>
# State 2 on qubit 2: |0> (identical states should give |0> on ancilla)
# Try changing one state to see the difference!

# Hadamard on ancilla
qc.h(0)
qc.barrier()

# Controlled-SWAP
qc.cswap(0, 1, 2)
qc.barrier()

# Hadamard on ancilla and measure
qc.h(0)
qc.measure(0, 0)

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print("Swap test result:", counts)
prob_0 = counts.get('0', 0) / 1024
print(f"Probability of |0>: {prob_0:.3f}")
print(f"Overlap: {2 * prob_0 - 1:.3f}")`,
    category: 'challenge',
    tags: ['swap-test', 'state-comparison', 'fidelity'],
    likes: 45,
    createdAt: '2026-03-10T14:30:00Z',
    featured: false,
  },
  {
    id: 'gallery-014',
    title: 'W State',
    description: 'Create the 3-qubit W state: (|001> + |010> + |100>) / sqrt(3). Unlike the GHZ state, the W state retains entanglement when one qubit is traced out.',
    author: { id: 'user-diana', displayName: 'diana_dirac' },
    framework: 'qiskit',
    code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import math

qc = QuantumCircuit(3, 3)

# Prepare W state: (|001> + |010> + |100>) / sqrt(3)
# Step 1: Create unequal superposition on qubit 0
theta = 2 * math.acos(1 / math.sqrt(3))
qc.ry(theta, 0)

# Step 2: Controlled rotation on qubit 1
qc.ch(0, 1)

# Step 3: Toffoli-like spreading
qc.cx(1, 2)
qc.cx(0, 1)
qc.x(0)
qc.barrier()

qc.measure([0, 1, 2], [0, 1, 2])

simulator = AerSimulator()
result = simulator.run(qc, shots=3000).result()
counts = result.get_counts()
print("W state distribution:", counts)`,
    category: 'challenge',
    tags: ['w-state', 'entanglement', 'multi-qubit'],
    likes: 67,
    createdAt: '2026-03-15T11:00:00Z',
    featured: false,
  },
  {
    id: 'gallery-015',
    title: 'Quantum Half Adder',
    description: 'A quantum implementation of a half adder circuit. Computes the sum and carry of two input qubits using quantum gates.',
    author: { id: 'user-eve', displayName: 'eve_entangled' },
    framework: 'qiskit',
    code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

# 2 input qubits, 1 carry qubit, 2 classical bits
qc = QuantumCircuit(3, 2)

# Set inputs: try different combinations
# |00> -> sum=0, carry=0
# |01> -> sum=1, carry=0
# |10> -> sum=1, carry=0
# |11> -> sum=0, carry=1
qc.x(0)  # Input A = 1
qc.x(1)  # Input B = 1
qc.barrier()

# Carry: Toffoli gate (AND)
qc.ccx(0, 1, 2)

# Sum: CNOT (XOR)
qc.cx(0, 1)
qc.barrier()

# Measure sum (qubit 1) and carry (qubit 2)
qc.measure(1, 0)  # sum bit
qc.measure(2, 1)  # carry bit

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print("Half adder result (carry, sum):", counts)`,
    category: 'tutorial',
    tags: ['arithmetic', 'half-adder', 'classical-logic', 'beginner'],
    likes: 53,
    createdAt: '2026-03-20T16:15:00Z',
    featured: false,
  },
];
