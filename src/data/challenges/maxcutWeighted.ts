import type { QuantumChallenge } from '../../types/challenge';

export const maxcutWeighted: QuantumChallenge = {
  id: 'maxcut-weighted',
  title: 'MaxCut: Weighted Graphs',
  difficulty: 'hard',
  category: 'optimization',
  description: `## MaxCut: Weighted Graphs

The **Maximum Cut** problem partitions the vertices of a graph into two sets
such that the total weight of edges crossing the partition is maximised.
MaxCut is NP-hard in general, making it a prime target for quantum
approximate optimisation.

### Problem Definition

Given a graph \`G = (V, E)\` with edge weights \`w(i, j)\`:

\`\`\`
MaxCut(G) = max_{S \u2286 V} \u2211_{(i,j) \u2208 E, i \u2208 S, j \u2209 S} w(i, j)
\`\`\`

A vertex assignment \`z \u2208 {0, 1}^n\` encodes which set each vertex belongs to.
Edge \`(i, j)\` contributes weight \`w(i, j)\` to the cut when \`z_i \u2260 z_j\`.

### QAOA Approach

The **Quantum Approximate Optimization Algorithm** (QAOA) encodes the MaxCut
cost function into a parameterised quantum circuit with two alternating layers:

1. **Cost layer** -- for each edge \`(i, j, w)\`, apply a weighted ZZ interaction:
   \`\`\`
   CNOT(i, j)  \u2192  RZ(\u03B3 \u00B7 w, j)  \u2192  CNOT(i, j)
   \`\`\`
   This accumulates a phase proportional to \`\u03B3 \u00B7 w\` when qubits \`i\` and \`j\`
   differ, encoding the cut value into the quantum state.

2. **Mixer layer** -- apply \`RX(2\u03B2, i)\` to every qubit. This drives
   exploration across different partitions.

### Multi-Layer QAOA

For weighted graphs, a single QAOA layer (\`p = 1\`) rarely achieves a good
approximation ratio. Using \`p \u2265 2\` layers with independent \`(\u03B3_k, \u03B2_k)\`
parameters per layer dramatically improves solution quality.

\`\`\`python
for layer in range(p):
    # Cost layer with gamma[layer]
    for (i, j, w) in edges:
        CNOT(i, j)
        RZ(gamma[layer] * w, j)
        CNOT(i, j)

    # Mixer layer with beta[layer]
    for i in range(n_nodes):
        RX(2 * beta[layer], i)
\`\`\`

### Scoring

Your solution is evaluated by **approximation ratio**:

\`\`\`
ratio = measured_cut_value / optimal_cut_value
\`\`\`

A ratio \u2265 0.5 passes. Better parameter choices yield higher ratios.

### Your Task

Implement a multi-layer QAOA circuit for the given weighted graph. The
circuit should produce bitstrings that correspond to high-quality cuts.`,

  constraints: [
    'Use exactly n_nodes qubits (one per vertex)',
    'Implement at least p=2 QAOA layers for acceptable approximation',
    'Edge weights must scale the RZ rotation angle in the cost layer',
    'The mixer layer uses RX gates on every qubit',
    'You may use H, CNOT, RZ, and RX gates',
  ],

  examples: [
    {
      input: 'n_nodes=4, edges=[[0,1,2],[1,2,1],[2,3,2]]',
      output: 'approximation_ratio >= 0.5 (optimal cut = 5)',
      explanation:
        'A weighted path graph. The optimal partition cuts edges (0,1) and (2,3) for a total weight of 4, or (0,1) and (1,2) and (2,3) strategically for 5.',
    },
  ],

  testCases: [
    {
      id: 'maxcut-weighted-path',
      label: 'Weighted path graph',
      description: '5-node path with weights [2,3,1,2]; optimal cut = 7',
      params: {
        n_nodes: 5,
        edges: [
          [0, 1, 2],
          [1, 2, 3],
          [2, 3, 1],
          [3, 4, 2],
        ],
      },
      validation: {
        type: 'metric',
        metric: 'approximation_ratio',
        threshold: 0.5,
        optimal: 7,
      },
      hidden: false,
      weight: 0.5,
    },
    {
      id: 'maxcut-weighted-cross',
      label: 'Weighted graph with cross edges (hidden)',
      description: '5-node graph with cross edges and weights 1\u20133; optimal cut = 9',
      params: {
        n_nodes: 5,
        edges: [
          [0, 1, 2],
          [1, 2, 3],
          [2, 3, 1],
          [3, 4, 2],
          [0, 3, 1],
        ],
      },
      validation: {
        type: 'metric',
        metric: 'approximation_ratio',
        threshold: 0.5,
        optimal: 9,
      },
      hidden: true,
      weight: 0.5,
    },
  ],

  starterCode: {
    qiskit: `from qiskit import QuantumCircuit
import numpy as np

# n_nodes and edges are provided
# edges is a list of [source, target, weight]
# e.g., edges = [[0,1,2], [1,2,3], [2,3,1], [3,4,2]]

qc = QuantumCircuit(n_nodes, n_nodes)

# QAOA parameters -- use multiple layers for better results
p = 2  # Number of QAOA layers
gammas = [0.6, 0.3]  # Cost layer parameters (one per layer)
betas = [0.4, 0.7]   # Mixer layer parameters (one per layer)

# Initial superposition
for i in range(n_nodes):
    qc.h(i)

# TODO: Apply p layers of QAOA
for layer in range(p):
    gamma = gammas[layer]
    beta = betas[layer]

    # Cost layer: for each edge (i, j, w), apply weighted ZZ interaction
    # CNOT(i,j) -> RZ(gamma * w, j) -> CNOT(i,j)

    # Mixer layer: RX(2 * beta, i) for each qubit

qc.measure(list(range(n_nodes)), list(range(n_nodes)))
`,
    cirq: `import cirq
import numpy as np

# n_nodes and edges are provided
# edges is a list of [source, target, weight]

qubits = cirq.LineQubit.range(n_nodes)

circuit = cirq.Circuit()

# QAOA parameters
p = 2
gammas = [0.6, 0.3]
betas = [0.4, 0.7]

# Initial superposition
circuit.append(cirq.H.on_each(*qubits))

# TODO: Apply p layers of QAOA
for layer in range(p):
    gamma = gammas[layer]
    beta = betas[layer]

    # Cost layer: for each edge (i, j, w)
    # CNOT(i,j) -> RZ(gamma * w)(j) -> CNOT(i,j)

    # Mixer layer: RX(2 * beta) on each qubit

circuit.append(cirq.measure(*qubits, key='result'))
`,
    'cuda-q': `import cudaq
import numpy as np

# n_nodes and edges are provided
# edges is a list of [source, target, weight]

@cudaq.kernel
def qaoa():
    qubits = cudaq.qvector(n_nodes)

    p = 2
    gammas = [0.6, 0.3]
    betas = [0.4, 0.7]

    # Initial superposition
    for i in range(n_nodes):
        h(qubits[i])

    # TODO: Apply p layers of QAOA
    for layer in range(p):
        gamma = gammas[layer]
        beta = betas[layer]

        # Cost layer: weighted ZZ interaction per edge
        # cx(qubits[i], qubits[j])
        # rz(gamma * w, qubits[j])
        # cx(qubits[i], qubits[j])

        # Mixer layer: rx(2 * beta, qubit) for each qubit

    mz(qubits)
`,
  },

  hints: [
    'Scale the RZ rotation angle by the edge weight: RZ(gamma * weight)',
    'More QAOA layers (p=2 or p=3) significantly improve results on weighted graphs',
    'Try optimizing gamma and beta values \u2014 start with gamma~0.5, beta~0.5 per layer',
  ],

  tags: ['maxcut', 'qaoa', 'weighted-graph', 'optimization'],
  estimatedMinutes: 45,
  totalSubmissions: 198,
  acceptanceRate: 0.24,

  visualization: {
    type: 'graph',
    nodes: [
      { id: 0, label: '0' },
      { id: 1, label: '1' },
      { id: 2, label: '2' },
      { id: 3, label: '3' },
      { id: 4, label: '4' },
    ],
    edges: [
      { source: 0, target: 1, weight: 2 },
      { source: 1, target: 2, weight: 3 },
      { source: 2, target: 3, weight: 1 },
      { source: 3, target: 4, weight: 2 },
    ],
    optimalValue: 7,
  },
};
