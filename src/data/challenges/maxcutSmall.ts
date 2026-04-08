import type { QuantumChallenge } from '../../types/challenge';

export const maxcutSmall: QuantumChallenge = {
  id: 'maxcut-small-graphs',
  title: 'MaxCut: Small Graphs',
  difficulty: 'medium',
  category: 'optimization',
  description: `## MaxCut: Small Graphs

The **Maximum Cut (MaxCut)** problem is a classic combinatorial optimisation problem:

> Given an undirected graph \`G = (V, E)\`, partition the vertices into two sets
> \`S\` and \`\\u0305S\` such that the number of edges crossing the partition is maximised.

MaxCut is **NP-hard** in general, but small instances can be tackled with the
**Quantum Approximate Optimisation Algorithm (QAOA)**.

### QAOA in a Nutshell

QAOA alternates two parameterised layers:

1. **Cost layer** \u2014 encodes the objective function into phase rotations.
   For each edge \`(i, j)\`, apply:
   \`\`\`
   CNOT(i, j)  \u2192  RZ(\\u03B3, j)  \u2192  CNOT(i, j)
   \`\`\`
   This implements \`exp(-i \\u03B3 Z_i Z_j)\`, penalising configurations where
   qubits \`i\` and \`j\` are in the same partition.

2. **Mixer layer** \u2014 drives exploration across partitions.
   For each qubit \`i\`, apply:
   \`\`\`
   RX(2\\u03B2, i)
   \`\`\`

The parameters \`\\u03B3\` and \`\\u03B2\` are tuned to maximise the expected cut value.

### Your Task

Implement a QAOA circuit (or any other quantum approach) for the given graph.
Your solution must achieve an **approximation ratio of at least 0.7** relative
to the known optimal cut value.

### Approximation Ratio

\`ratio = measured_cut_value / optimal_cut_value\`

A ratio of **1.0** means you found the optimal solution.
A ratio of **0.7** means you captured at least 70% of the maximum possible cut.

### Tips

- Start with a single QAOA layer (\`p = 1\`)
- Try different \`\\u03B3\` and \`\\u03B2\` values by hand first
- For the triangle graph, \`\\u03B3 \\u2248 0.7\` and \`\\u03B2 \\u2248 0.5\` works well`,

  constraints: [
    'Use exactly n_nodes qubits (one per vertex)',
    'Achieve an approximation ratio >= 0.7',
    'You may use any quantum approach (QAOA is recommended)',
    'Circuit depth is not constrained but keep it reasonable',
  ],

  examples: [
    {
      input: 'Triangle: nodes=[0,1,2], edges=[(0,1),(1,2),(0,2)]',
      output: 'Cut value >= 2 (optimal = 2)',
      explanation:
        'Any partition that places one vertex on one side and two on the other cuts exactly 2 edges.',
    },
    {
      input: 'Square: nodes=[0,1,2,3], edges=[(0,1),(1,2),(2,3),(3,0)]',
      output: 'Cut value >= 3 (optimal = 4)',
      explanation:
        'The optimal cut places alternating vertices in opposite sets, cutting all 4 edges. 70% of 4 rounds to 3.',
    },
  ],

  testCases: [
    {
      id: 'maxcut-triangle',
      label: 'Triangle graph',
      description: '3 nodes, 3 edges. Optimal cut = 2.',
      params: {
        n_nodes: 3,
        edges: [[0, 1], [1, 2], [0, 2]],
      },
      validation: {
        type: 'metric',
        metric: 'approximation_ratio',
        threshold: 0.7,
        optimal: 2,
      },
      hidden: false,
      weight: 0.5,
    },
    {
      id: 'maxcut-square',
      label: 'Square graph',
      description: '4 nodes, 4 edges (cycle). Optimal cut = 4.',
      params: {
        n_nodes: 4,
        edges: [[0, 1], [1, 2], [2, 3], [3, 0]],
      },
      validation: {
        type: 'metric',
        metric: 'approximation_ratio',
        threshold: 0.7,
        optimal: 4,
      },
      hidden: false,
      weight: 0.5,
    },
  ],

  starterCode: {
    qiskit: `from qiskit import QuantumCircuit
import numpy as np

# n_nodes and edges are provided
# e.g., n_nodes = 3, edges = [[0,1], [1,2], [0,2]]

qc = QuantumCircuit(n_nodes, n_nodes)

# QAOA parameters (try different values!)
gamma = 0.5  # Cost layer parameter
beta = 0.5   # Mixer layer parameter

# Step 1: Initial superposition
for i in range(n_nodes):
    qc.h(i)

# Step 2: TODO - Cost layer
# For each edge (i, j), apply: CNOT(i,j), RZ(gamma, j), CNOT(i,j)
# This implements e^(-i * gamma * Z_i Z_j)

# Step 3: TODO - Mixer layer
# For each qubit i, apply RX(2 * beta, i)

# Measure all qubits
qc.measure(list(range(n_nodes)), list(range(n_nodes)))
`,
    cirq: `import cirq
import numpy as np

# n_nodes and edges are provided
# e.g., n_nodes = 3, edges = [[0,1], [1,2], [0,2]]

qubits = cirq.LineQubit.range(n_nodes)

# QAOA parameters (try different values!)
gamma = 0.5  # Cost layer parameter
beta = 0.5   # Mixer layer parameter

circuit = cirq.Circuit()

# Step 1: Initial superposition
circuit.append(cirq.H.on_each(*qubits))

# Step 2: TODO - Cost layer
# For each edge (i, j), apply: CNOT(i,j), RZ(gamma)(j), CNOT(i,j)

# Step 3: TODO - Mixer layer
# For each qubit, apply RX(2 * beta)

# Measure all qubits
circuit.append(cirq.measure(*qubits, key='result'))
`,
    'cuda-q': `import cudaq
import numpy as np

# n_nodes and edges are provided
# e.g., n_nodes = 3, edges = [[0,1], [1,2], [0,2]]

@cudaq.kernel
def qaoa(n: int, gamma: float, beta: float):
    qubits = cudaq.qvector(n)

    # Step 1: Initial superposition
    for i in range(n):
        h(qubits[i])

    # Step 2: TODO - Cost layer
    # For each edge (i, j), apply: cx(i,j), rz(gamma, j), cx(i,j)

    # Step 3: TODO - Mixer layer
    # For each qubit i, apply rx(2 * beta, i)

    mz(qubits)
`,
  },

  hints: [
    'The cost unitary for edge (i, j) is CNOT(i, j) -> RZ(gamma, j) -> CNOT(i, j)',
    'The mixer is RX(2 * beta) on each qubit',
    'Try gamma=0.7 and beta=0.5 for the triangle',
  ],

  tags: ['maxcut', 'qaoa', 'optimization', 'graph'],
  estimatedMinutes: 30,
  totalSubmissions: 432,
  acceptanceRate: 0.41,

  visualization: {
    type: 'graph',
    nodes: [
      { id: 0, label: '0' },
      { id: 1, label: '1' },
      { id: 2, label: '2' },
    ],
    edges: [
      { source: 0, target: 1 },
      { source: 1, target: 2 },
      { source: 0, target: 2 },
    ],
    optimalValue: 2,
  },
};
