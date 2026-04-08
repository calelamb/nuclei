import type { QuantumChallenge } from '../../types/challenge';

export const quantumTeleportation: QuantumChallenge = {
  id: 'quantum-teleportation',
  title: 'Quantum Teleportation',
  difficulty: 'medium',
  category: 'protocols',
  description: `## Quantum Teleportation

**Quantum teleportation** transfers the quantum state of one qubit to another
using a shared entangled pair and two bits of classical communication. No
physical qubit travels -- only information moves.

### The Protocol

The circuit uses three qubits:

| Qubit | Role |
|-------|------|
| 0 | **Source** -- holds the unknown state \`|\u03C8\u27E9\` to teleport |
| 1 | Alice's half of the Bell pair |
| 2 | Bob's half of the Bell pair (destination) |

The procedure has four stages:

1. **Prepare the Bell pair** between qubits 1 and 2:
   \`\`\`
   H(1)  then  CNOT(1, 2)
   \`\`\`
   This creates the shared entangled resource \`|\u03A6\u207A\u27E9 = (|00\u27E9 + |11\u27E9) / \u221A2\`.

2. **Bell measurement** on qubits 0 and 1:
   \`\`\`
   CNOT(0, 1)  then  H(0)  then  measure both
   \`\`\`
   This projects Alice's qubits into one of four Bell states, each equally likely.

3. **Classical communication** -- Alice sends her two measurement bits to Bob.

4. **Conditional corrections** on qubit 2:
   - If qubit 1 measured \`|1\u27E9\`, apply **X** to qubit 2
   - If qubit 0 measured \`|1\u27E9\`, apply **Z** to qubit 2

After corrections, qubit 2 is guaranteed to hold the original state \`|\u03C8\u27E9\`,
regardless of Alice's measurement outcomes.

### Why It Works

The Bell measurement entangles the source state with the shared pair, then
the classical bits tell Bob exactly which Pauli correction undoes the
measurement back-action. The net effect is a perfect state transfer.

### Simulation Note

In a statevector simulator, \`CNOT(1, 2)\` and \`CZ(0, 2)\` act as the
classically-controlled corrections because the simulator tracks all qubits
coherently. The measurement outcomes of qubits 0 and 1 will be uniformly
random, but qubit 2 will always end in the correct state.

### Your Task

Given a \`prep_gate\` (\`"none"\`, \`"x"\`, or \`"h"\`), prepare the corresponding
state on qubit 0, then teleport it to qubit 2 using the protocol above.
The validation checks the measurement statistics of **all three qubits** to
confirm qubit 2 received the correct state.`,

  constraints: [
    'Use exactly 3 qubits and 3 classical bits',
    'The Bell pair must be created between qubits 1 and 2',
    'The Bell measurement must be performed on qubits 0 and 1',
    'Conditional corrections must be applied to qubit 2',
    'You may only use H, X, Z, CNOT, and CZ gates',
  ],

  examples: [
    {
      input: 'prep_gate = "none"',
      output: '{ "000": 0.25, "010": 0.25, "100": 0.25, "110": 0.25 }',
      explanation:
        'Teleport |0>. Qubit 2 always measures 0; qubits 0,1 are uniformly random.',
    },
    {
      input: 'prep_gate = "x"',
      output: '{ "001": 0.25, "011": 0.25, "101": 0.25, "111": 0.25 }',
      explanation:
        'Teleport |1>. Qubit 2 always measures 1; qubits 0,1 are uniformly random.',
    },
  ],

  testCases: [
    {
      id: 'teleport-zero',
      label: 'Teleport |0\u27E9',
      description: 'prep_gate="none": teleport |0\u27E9 to qubit 2',
      params: { prep_gate: 'none' },
      validation: {
        type: 'probability_match',
        expected: {
          '000': 0.25,
          '010': 0.25,
          '100': 0.25,
          '110': 0.25,
        },
        tolerance: 0.05,
      },
      hidden: false,
      weight: 0.35,
    },
    {
      id: 'teleport-one',
      label: 'Teleport |1\u27E9',
      description: 'prep_gate="x": teleport |1\u27E9 to qubit 2',
      params: { prep_gate: 'x' },
      validation: {
        type: 'probability_match',
        expected: {
          '001': 0.25,
          '011': 0.25,
          '101': 0.25,
          '111': 0.25,
        },
        tolerance: 0.05,
      },
      hidden: false,
      weight: 0.35,
    },
    {
      id: 'teleport-plus',
      label: 'Teleport |+\u27E9 (hidden)',
      description: 'prep_gate="h": teleport |+\u27E9 to qubit 2',
      params: { prep_gate: 'h' },
      validation: {
        type: 'probability_match',
        expected: {
          '000': 0.125,
          '001': 0.125,
          '010': 0.125,
          '011': 0.125,
          '100': 0.125,
          '101': 0.125,
          '110': 0.125,
          '111': 0.125,
        },
        tolerance: 0.08,
      },
      hidden: true,
      weight: 0.3,
    },
  ],

  starterCode: {
    qiskit: `from qiskit import QuantumCircuit

# prep_gate is provided: "none", "x", or "h"
# This determines the state to teleport

qc = QuantumCircuit(3, 3)

# Prepare the state to teleport on qubit 0
if prep_gate == "x":
    qc.x(0)
elif prep_gate == "h":
    qc.h(0)

# TODO: Create Bell pair between qubits 1 and 2
# (This is the shared entangled resource)

# TODO: Bell measurement on qubits 0 and 1
# (CNOT(0,1) then H(0), then measure both)

qc.barrier()

# TODO: Classical corrections on qubit 2
# If qubit 1 measured |1>, apply X to qubit 2
# If qubit 0 measured |1>, apply Z to qubit 2
# In Qiskit, use: qc.cx(1, 2) and qc.cz(0, 2)
# (These act as classically-controlled gates in simulation)

qc.measure([0, 1, 2], [0, 1, 2])
`,
    cirq: `import cirq

# prep_gate is provided: "none", "x", or "h"
# This determines the state to teleport

q0, q1, q2 = cirq.LineQubit.range(3)

circuit = cirq.Circuit()

# Prepare the state to teleport on qubit 0
if prep_gate == "x":
    circuit.append(cirq.X(q0))
elif prep_gate == "h":
    circuit.append(cirq.H(q0))

# TODO: Create Bell pair between qubits 1 and 2
# circuit.append([cirq.H(q1), cirq.CNOT(q1, q2)])

# TODO: Bell measurement on qubits 0 and 1
# circuit.append([cirq.CNOT(q0, q1), cirq.H(q0)])

# TODO: Classical corrections on qubit 2
# circuit.append([cirq.CNOT(q1, q2), cirq.CZ(q0, q2)])

circuit.append(cirq.measure(q0, q1, q2, key='result'))
`,
    'cuda-q': `import cudaq

# prep_gate is provided: "none", "x", or "h"

@cudaq.kernel
def teleport():
    qubits = cudaq.qvector(3)

    # Prepare the state to teleport on qubit 0
    if prep_gate == "x":
        x(qubits[0])
    elif prep_gate == "h":
        h(qubits[0])

    # TODO: Create Bell pair between qubits 1 and 2
    # h(qubits[1])
    # cx(qubits[1], qubits[2])

    # TODO: Bell measurement on qubits 0 and 1
    # cx(qubits[0], qubits[1])
    # h(qubits[0])

    # TODO: Classical corrections on qubit 2
    # cx(qubits[1], qubits[2])
    # cz(qubits[0], qubits[2])

    mz(qubits)
`,
  },

  hints: [
    'Create a Bell pair: H on qubit 1, then CNOT(1,2)',
    'Bell measurement: CNOT(0,1) then H(0)',
    'Apply CNOT(1,2) and CZ(0,2) for corrections \u2014 in simulation these work as conditional gates',
  ],

  tags: ['teleportation', 'bell-state', 'classical-communication'],
  estimatedMinutes: 25,
  totalSubmissions: 521,
  acceptanceRate: 0.53,
};
