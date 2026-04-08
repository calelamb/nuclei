import type { Lesson } from './types';

export const TRACK6_LESSONS: Lesson[] = [
  // ── Lesson 6.1 ──
  {
    id: '6.1',
    title: 'Classical vs Quantum ML',
    description: 'When does quantum help? NISQ limitations and the honest landscape of quantum advantage in machine learning.',
    difficulty: 'beginner',
    estimatedMinutes: 15,
    prerequisites: ['1.3', '2.1'],
    tags: ['quantum-ml', 'nisq', 'advantage', 'overview'],
    diracContext: 'Set honest expectations. Emphasize that QML is a research frontier, not a magic bullet. Cover where quantum kernels and variational circuits might help, and where classical ML still wins. Avoid hype.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Machine Learning Meets Quantum Computing

Classical ML learns patterns from data using **parameterized functions** (neural networks, SVMs, decision trees). Quantum ML asks: can **parameterized quantum circuits** do this better?

The honest answer: **sometimes, maybe, and we're still figuring it out.**

### Where Quantum Might Help

| Area | Why Quantum? |
|------|-------------|
| **Kernel methods** | Quantum circuits define feature maps in exponentially large Hilbert spaces |
| **Generative models** | Quantum systems naturally produce probability distributions |
| **Optimization** | Variational algorithms explore cost landscapes differently |
| **Simulation data** | Quantum data from quantum systems is naturally quantum |

### The NISQ Reality

Current quantum computers are **Noisy Intermediate-Scale Quantum** (NISQ) devices: 50–1000+ qubits, limited coherence, noisy gates. This means:
- Circuits can't be too deep (noise accumulates)
- Training is hard (barren plateaus — Lesson 6.9)
- Classical simulation can often match small quantum circuits`,
      },
      {
        type: 'concept-card',
        title: 'The QML Landscape',
        visual: 'custom-svg',
        explanation: 'Quantum ML sits at the intersection of quantum computing and machine learning. The core idea: replace or augment classical function approximators with parameterized quantum circuits. Data goes in (encoding), a trainable quantum circuit processes it, and measurements produce predictions. The classical optimizer updates circuit parameters based on a loss function — just like training a neural network, but the "network" is a quantum circuit.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np

# A taste: the simplest "quantum model" — a single rotation gate
# Input x controls the rotation angle; measurement gives a prediction
qc = QuantumCircuit(1, 1)
x = 0.7  # input data point
theta = 1.2  # trainable parameter

qc.ry(x, 0)       # encode data
qc.ry(theta, 0)    # trainable rotation
qc.measure(0, 0)

sim = AerSimulator()
result = sim.run(qc, shots=1024).result()
counts = result.get_counts()
print("Counts:", counts)

# P(1) acts as the model's prediction
p1 = counts.get('1', 0) / 1024
print(f"P(|1⟩) = {p1:.3f} — this is our 'prediction'")`,
        framework: 'qiskit',
        description: 'The simplest quantum model: a rotation gate encoding data, followed by a trainable rotation. The measurement probability is the prediction.',
        explorationPrompt: 'Try different values of x and theta. How does P(|1⟩) change? Can you make P(|1⟩) close to 1.0?',
      },
      {
        type: 'text',
        markdown: `## The QML Workflow

Every QML algorithm follows this loop:

1. **Encode** classical data into quantum states (Lesson 6.2)
2. **Process** through a parameterized quantum circuit (Lesson 6.3)
3. **Measure** to extract a classical prediction
4. **Optimize** parameters using a classical optimizer (gradient descent, COBYLA, etc.)
5. **Repeat** until the model converges

> **Key insight:** The quantum circuit is the *model* — it replaces the neural network. Training still happens classically, because measuring a quantum state gives classical data that a classical optimizer can work with.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '6.1-q1',
            question: 'What does NISQ stand for?',
            options: [
              'New Integrated Silicon Quantum',
              'Noisy Intermediate-Scale Quantum',
              'Non-Interacting Spin Qubits',
              'Numerical Integrated Simulation of Qubits',
            ],
            correctIndex: 1,
            explanation: 'NISQ = Noisy Intermediate-Scale Quantum. These are today\'s quantum computers: enough qubits to be interesting, but too noisy for full error correction.',
          },
          {
            id: '6.1-q2',
            question: 'In a QML workflow, what role does the quantum circuit play?',
            options: [
              'It replaces the classical optimizer',
              'It acts as the parameterized model (like a neural network)',
              'It stores the training data',
              'It computes gradients analytically',
            ],
            correctIndex: 1,
            explanation: 'The parameterized quantum circuit is the model — the quantum analogue of a neural network. Data encoding, processing, and measurement happen on the quantum device; optimization remains classical.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Quantum vs Classical: Not a Competition',
        visual: 'custom-svg',
        explanation: 'The best QML results so far are **hybrid**: classical networks handle feature extraction from raw data (images, text), and quantum circuits handle a specific processing step where high-dimensional correlations matter. Think of quantum circuits as a specialized layer, not a replacement for the entire classical stack.',
      },
    ],
  },

  // ── Lesson 6.2 ──
  {
    id: '6.2',
    title: 'Data Encoding',
    description: 'Amplitude encoding, angle encoding, basis encoding — how classical data enters a quantum circuit.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['6.1', '1.5'],
    tags: ['data-encoding', 'amplitude-encoding', 'angle-encoding', 'basis-encoding', 'feature-map'],
    diracContext: 'Data encoding is the first and often most important step in QML. Emphasize that encoding choice affects expressivity and circuit depth. Show angle encoding as the most practical for NISQ.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Getting Classical Data Into a Quantum Circuit

Quantum circuits operate on qubits, not floats. **Data encoding** (also called **embedding** or **feature mapping**) converts classical data x into a quantum state |ψ(x)⟩.

### Three Encoding Strategies

| Encoding | Idea | Qubits Needed | Depth |
|----------|------|---------------|-------|
| **Basis** | Map bit strings to computational basis states | n bits → n qubits | O(n) |
| **Angle** | Map each feature to a rotation angle | 1 qubit per feature | O(n) |
| **Amplitude** | Encode 2ⁿ features in amplitudes of n qubits | log₂(N) qubits | O(2ⁿ) |

> **Tradeoff:** Amplitude encoding is qubit-efficient but requires exponentially deep circuits. Angle encoding is practical for NISQ but uses more qubits.`,
      },
      {
        type: 'concept-card',
        title: 'Angle Encoding',
        visual: 'circuit',
        explanation: 'Each classical feature xᵢ maps to a rotation angle on qubit i: Ry(xᵢ)|0⟩. For a 3-feature data point [x₁, x₂, x₃], you need 3 qubits with Ry(x₁), Ry(x₂), Ry(x₃). Simple, shallow, and the workhorse of NISQ QML.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
from qiskit.quantum_info import Statevector
import numpy as np

# === Angle Encoding ===
# Data point: [0.3, 1.2, 2.1] (3 features)
data = [0.3, 1.2, 2.1]
qc_angle = QuantumCircuit(3)
for i, x in enumerate(data):
    qc_angle.ry(x, i)

sv = Statevector.from_instruction(qc_angle)
print("Angle encoding state vector:")
print(np.round(sv.data, 3))

# === Basis Encoding ===
# Encode the bit string "101"
qc_basis = QuantumCircuit(3)
qc_basis.x(0)  # flip qubit 0
qc_basis.x(2)  # flip qubit 2
# State is now |101⟩
sv_basis = Statevector.from_instruction(qc_basis)
print("\\nBasis encoding |101⟩:")
print(np.round(sv_basis.data, 3))`,
        framework: 'qiskit',
        description: 'Compare angle encoding (rotations) and basis encoding (bit flips). Observe the resulting state vectors.',
        explorationPrompt: 'Try encoding [π/2, π/2, π/2]. What state does angle encoding produce? What classical data point would give an equal superposition on each qubit?',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

# === Amplitude Encoding ===
# Encode 4 values into amplitudes of 2 qubits
# Data must be normalized: sum of squares = 1
raw_data = [1.0, 2.0, 3.0, 4.0]
norm = np.linalg.norm(raw_data)
amplitudes = [x / norm for x in raw_data]
print(f"Normalized amplitudes: {np.round(amplitudes, 4)}")

qc = QuantumCircuit(2)
qc.initialize(amplitudes, [0, 1])
sv = Statevector.from_instruction(qc)
print("\\nState vector (amplitude encoding):")
for i, amp in enumerate(sv.data):
    print(f"  |{i:02b}⟩: {amp:.4f}")

# Verify: probabilities match normalized squared data
probs = np.abs(sv.data) ** 2
print(f"\\nProbabilities: {np.round(probs, 4)}")
print(f"Sum: {sum(probs):.4f}")`,
        framework: 'qiskit',
        description: 'Amplitude encoding packs 4 data values into the amplitudes of 2 qubits. Exponentially compact but deep circuits.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '6.2-q1',
            question: 'To angle-encode a data point with 8 features, how many qubits do you need?',
            options: ['3', '4', '8', '256'],
            correctIndex: 2,
            explanation: 'Angle encoding uses 1 qubit per feature. 8 features = 8 qubits.',
          },
          {
            id: '6.2-q2',
            question: 'To amplitude-encode a vector of 8 values, how many qubits do you need?',
            options: ['2', '3', '8', '64'],
            correctIndex: 1,
            explanation: 'Amplitude encoding packs 2ⁿ values into n qubits. 8 = 2³, so you need 3 qubits.',
          },
          {
            id: '6.2-q3',
            question: 'Which encoding is most practical for NISQ devices?',
            options: ['Amplitude encoding', 'Basis encoding', 'Angle encoding', 'They are equally practical'],
            correctIndex: 2,
            explanation: 'Angle encoding produces shallow circuits (one rotation per qubit) and is the workhorse of NISQ QML. Amplitude encoding requires exponentially deep state preparation circuits.',
          },
        ],
      },
      {
        type: 'text',
        markdown: `## Encoding = Feature Map

In the language of kernel methods, your encoding circuit defines a **feature map** φ(x) that maps classical data into Hilbert space. The choice of encoding determines which patterns the quantum model can detect.

> **Rule of thumb:** Start with angle encoding. Use amplitude encoding only if you need qubit efficiency and can afford the circuit depth. Basis encoding is mainly for educational examples and specific algorithms.`,
      },
    ],
  },

  // ── Lesson 6.3 ──
  {
    id: '6.3',
    title: 'Parameterized Quantum Circuits',
    description: 'PQCs as the quantum analogue of neural networks — layers of rotation gates and entangling gates.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['6.2', '2.3'],
    tags: ['pqc', 'ansatz', 'variational', 'rotation-gates', 'entangling-layers'],
    diracContext: 'PQCs are the core building block of all variational QML. Emphasize the analogy to neural network layers: rotation gates = weights, entangling gates = connectivity. Show how depth and entanglement affect expressivity.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Quantum Neural Network

A **Parameterized Quantum Circuit** (PQC) — also called an **ansatz** or **variational form** — is a quantum circuit with tunable rotation angles. It's the quantum analogue of a neural network:

| Neural Network | PQC |
|----------------|-----|
| Weights & biases | Rotation angles θ |
| Layers | Repeated circuit blocks |
| Activation functions | Entangling gates |
| Forward pass | Circuit execution + measurement |
| Backprop | Parameter-shift rule or finite differences |

### Anatomy of a PQC Layer

One layer typically has:
1. **Rotation sub-layer:** Ry(θ₁), Ry(θ₂), ... on each qubit
2. **Entangling sub-layer:** CNOT ladder or ring connecting qubits

Stack L layers → 2·n·L trainable parameters (for n qubits).`,
      },
      {
        type: 'concept-card',
        title: 'PQC Layer Structure',
        visual: 'circuit',
        explanation: 'Each PQC layer alternates single-qubit rotations (Ry, Rz) with entangling gates (CNOT). Rotations are the trainable parameters; CNOTs create correlations between qubits. More layers = more expressive, but also deeper circuits and harder training.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

def build_pqc(n_qubits: int, n_layers: int, params: list[float]) -> QuantumCircuit:
    """Build a hardware-efficient PQC ansatz."""
    qc = QuantumCircuit(n_qubits)
    idx = 0
    for layer in range(n_layers):
        # Rotation sub-layer: Ry on each qubit
        for q in range(n_qubits):
            qc.ry(params[idx], q)
            idx += 1
        # Entangling sub-layer: CNOT chain
        for q in range(n_qubits - 1):
            qc.cx(q, q + 1)
        qc.barrier()
    return qc

# 2 qubits, 3 layers = 6 parameters
n_qubits, n_layers = 2, 3
params = np.random.uniform(0, 2 * np.pi, n_qubits * n_layers).tolist()
print(f"Parameters: {np.round(params, 3)}")

qc = build_pqc(n_qubits, n_layers, params)
print(qc.draw())

sv = Statevector.from_instruction(qc)
probs = sv.probabilities_dict()
print("\\nOutput probabilities:")
for state, prob in sorted(probs.items()):
    if prob > 0.001:
        print(f"  |{state}⟩: {prob:.4f}")`,
        framework: 'qiskit',
        description: 'Build a hardware-efficient PQC with rotation and entangling layers. Random parameters give a random output distribution.',
        explorationPrompt: 'Try setting all params to 0. What state do you get? Now try all params = π. What happens?',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

# The full QML pipeline: encode data, apply PQC, measure
def qml_forward(x: float, theta: list[float]) -> float:
    """Single-qubit QML model: encode x, apply trainable rotations, measure."""
    qc = QuantumCircuit(1)
    qc.ry(x, 0)           # data encoding
    qc.ry(theta[0], 0)    # trainable layer 1
    qc.rz(theta[1], 0)    # trainable layer 2
    qc.ry(theta[2], 0)    # trainable layer 3

    sv = Statevector.from_instruction(qc)
    return sv.probabilities()[1]  # P(|1⟩)

# Sweep input x with fixed parameters
theta = [0.5, 1.2, -0.8]
xs = np.linspace(0, 2 * np.pi, 20)
for x_val in xs:
    pred = qml_forward(x_val, theta)
    bar = '█' * int(pred * 40)
    print(f"x={x_val:.2f}  P(1)={pred:.3f}  {bar}")`,
        framework: 'qiskit',
        description: 'A complete single-qubit QML model: data encoding + PQC + measurement. Sweep the input to see how the model responds.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '6.3-q1',
            question: 'A 4-qubit PQC with 5 layers has how many Ry rotation parameters?',
            options: ['4', '5', '9', '20'],
            correctIndex: 3,
            explanation: '4 qubits x 5 layers = 20 rotation parameters (one Ry per qubit per layer).',
          },
          {
            id: '6.3-q2',
            question: 'What is the role of CNOT gates in a PQC?',
            options: [
              'They encode classical data',
              'They create entanglement between qubits',
              'They measure the output',
              'They compute gradients',
            ],
            correctIndex: 1,
            explanation: 'CNOT gates create entanglement — correlations between qubits that single-qubit rotations alone cannot produce. This is what gives PQCs their expressive power.',
          },
        ],
      },
      {
        type: 'text',
        markdown: `## The Parameter-Shift Rule

To train a PQC, you need gradients. The **parameter-shift rule** lets you compute exact gradients by evaluating the circuit at two shifted parameter values:

**∂f/∂θ = [f(θ + π/2) − f(θ − π/2)] / 2**

This requires **2 circuit evaluations per parameter** — expensive, but exact (unlike finite differences). For n parameters, you need 2n circuit runs per gradient step.`,
      },
    ],
  },

  // ── Lesson 6.4 ──
  {
    id: '6.4',
    title: 'Variational Classifiers',
    description: 'Encode data, apply a PQC, measure, optimize — build a quantum classifier from scratch.',
    difficulty: 'intermediate',
    estimatedMinutes: 30,
    prerequisites: ['6.3'],
    tags: ['variational-classifier', 'vqc', 'classification', 'optimization', 'cost-function'],
    diracContext: 'Walk through a complete variational classification pipeline. Emphasize the classical-quantum hybrid loop. The exercise asks them to classify a simple dataset by adjusting a PQC.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Building a Quantum Classifier

A **Variational Quantum Classifier** (VQC) is the full pipeline:

1. **Encode** each data point x → |ψ(x)⟩
2. **Apply** a trainable PQC U(θ)
3. **Measure** to get a prediction ŷ = ⟨Z⟩ or P(|1⟩)
4. **Compute** a loss: L = Σ (ŷᵢ − yᵢ)²
5. **Update** θ using a classical optimizer (COBYLA, Adam, etc.)
6. **Repeat** until convergence

This is identical to training a neural network — the quantum circuit is just a different kind of function approximator.

### A Simple Task

Classify points on a line: x < π → class 0, x ≥ π → class 1. Our quantum model needs to learn a decision boundary.`,
      },
      {
        type: 'concept-card',
        title: 'The Hybrid Training Loop',
        visual: 'custom-svg',
        explanation: 'The quantum device evaluates the model (forward pass): encode data, run PQC, measure. The classical computer handles everything else: computing the loss, calculating gradients (via parameter-shift rule), and updating parameters. This hybrid loop is the foundation of all variational QML.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

def variational_classifier(x: float, params: list[float]) -> float:
    """2-qubit variational classifier."""
    qc = QuantumCircuit(2)
    # Data encoding (repeated for expressivity)
    qc.ry(x, 0)
    qc.ry(x * 0.5, 1)
    # PQC layer 1
    qc.ry(params[0], 0)
    qc.ry(params[1], 1)
    qc.cx(0, 1)
    # PQC layer 2
    qc.ry(params[2], 0)
    qc.ry(params[3], 1)
    qc.cx(1, 0)

    sv = Statevector.from_instruction(qc)
    return sv.probabilities()[0]  # P(|00⟩) as class probability

# Training data: x < pi => label 0, x >= pi => label 1
X_train = [0.5, 1.0, 1.5, 2.0, 3.5, 4.0, 4.5, 5.5]
y_train = [0,   0,   0,   0,   1,   1,   1,   1  ]

# Before training (random params)
params = [0.1, 0.2, 0.3, 0.4]
print("Before training:")
for x_val, y_val in zip(X_train, y_train):
    pred = variational_classifier(x_val, params)
    label = 0 if pred > 0.5 else 1
    print(f"  x={x_val:.1f}  true={y_val}  pred={label}  P(00)={pred:.3f}")`,
        framework: 'qiskit',
        description: 'A 2-qubit variational classifier with random parameters. Before training, predictions are essentially random.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np
from scipy.optimize import minimize

def model(x: float, params: list[float]) -> float:
    qc = QuantumCircuit(2)
    qc.ry(x, 0)
    qc.ry(x * 0.5, 1)
    qc.ry(params[0], 0)
    qc.ry(params[1], 1)
    qc.cx(0, 1)
    qc.ry(params[2], 0)
    qc.ry(params[3], 1)
    qc.cx(1, 0)
    sv = Statevector.from_instruction(qc)
    return sv.probabilities()[0]

X = [0.5, 1.0, 1.5, 2.0, 3.5, 4.0, 4.5, 5.5]
y = [0,   0,   0,   0,   1,   1,   1,   1  ]

def cost(params):
    total = 0.0
    for xi, yi in zip(X, y):
        pred = model(xi, params.tolist())
        target = 1.0 if yi == 0 else 0.0  # P(00) high for class 0
        total += (pred - target) ** 2
    return total / len(X)

result = minimize(cost, x0=np.random.uniform(0, np.pi, 4), method='COBYLA', options={'maxiter': 200})
print(f"Optimized params: {np.round(result.x, 3)}")
print(f"Final cost: {result.fun:.4f}\\n")

print("After training:")
correct = 0
for xi, yi in zip(X, y):
    pred = model(xi, result.x.tolist())
    label = 0 if pred > 0.5 else 1
    ok = '✓' if label == yi else '✗'
    correct += label == yi
    print(f"  x={xi:.1f}  true={yi}  pred={label}  {ok}")
print(f"\\nAccuracy: {correct}/{len(X)}")`,
        framework: 'qiskit',
        description: 'Full training loop: COBYLA optimizes the PQC parameters to minimize classification loss. Watch accuracy improve.',
      },
      {
        type: 'exercise',
        id: '6.4-ex1',
        title: 'Train a 3-Class Quantum Classifier',
        description: 'Extend the variational classifier to use 2 qubits and classify 3 regions: x < 2 → class 0, 2 ≤ x < 4 → class 1, x ≥ 4 → class 2. Use P(|00⟩), P(|01⟩), P(|10⟩) as class probabilities. Complete the encoding and PQC layers.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

def three_class_model(x: float, params: list[float]) -> list[float]:
    qc = QuantumCircuit(2)
    # TODO: Encode x into both qubits using ry
    # TODO: Add at least 2 PQC layers (ry rotations + cx entangling)
    # Use params[0], params[1], ... for rotations

    sv = Statevector.from_instruction(qc)
    probs = sv.probabilities()
    return [probs[0], probs[1], probs[2]]  # P(00), P(01), P(10)

# Test with some parameters
params = [0.5] * 8  # adjust size to match your circuit
x_test = 1.0
probs = three_class_model(x_test, params)
print(f"x={x_test}: P(00)={probs[0]:.3f}, P(01)={probs[1]:.3f}, P(10)={probs[2]:.3f}")`,
        framework: 'qiskit',
        tolerancePercent: 5,
        hints: [
          'Encode data: qc.ry(x, 0) and qc.ry(x * 0.7, 1)',
          'Layer pattern: qc.ry(params[i], 0), qc.ry(params[i+1], 1), qc.cx(0, 1)',
          'You need at least 8 parameters for 2 layers on 2 qubits',
        ],
        successMessage: 'You built a multi-class quantum classifier! The same architecture scales to more qubits and classes.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '6.4-q1',
            question: 'In a variational classifier, what runs on the quantum device?',
            options: [
              'The entire training loop',
              'Only the data encoding and PQC evaluation',
              'Only the gradient computation',
              'Only the loss function',
            ],
            correctIndex: 1,
            explanation: 'The quantum device handles the forward pass: encoding data and evaluating the PQC. The classical computer handles loss computation, gradients, and parameter updates.',
          },
        ],
      },
    ],
  },

  // ── Lesson 6.5 ──
  {
    id: '6.5',
    title: 'Quantum Kernels',
    description: 'The kernel trick in Hilbert space — quantum kernel estimation and quantum advantage through feature maps.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['6.2', '6.3'],
    tags: ['quantum-kernel', 'kernel-method', 'svm', 'feature-map', 'fidelity'],
    diracContext: 'Quantum kernels are one of the most promising routes to quantum advantage. Emphasize the connection to classical SVMs: the quantum circuit defines a feature map, and the kernel is the inner product in Hilbert space.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Kernel Trick, Quantized

In classical ML, **kernel methods** (like SVMs) compute similarity between data points in a feature space without explicitly computing the features. The **kernel** K(x, x') = ⟨φ(x), φ(x')⟩.

Quantum circuits define feature maps into **exponentially large** Hilbert spaces. The quantum kernel is:

**K(x, x') = |⟨0|U†(x')U(x)|0⟩|²**

This is the **fidelity** between the quantum states produced by encoding x and x'. If the states are similar, K ≈ 1. If orthogonal, K ≈ 0.

### Why This Matters

- Classical kernel computation in this Hilbert space would require exponential time
- The quantum computer estimates K(x, x') efficiently via the **swap test** or **compute-uncompute** method
- If the quantum feature map captures the right structure, you get quantum advantage`,
      },
      {
        type: 'concept-card',
        title: 'Compute-Uncompute Method',
        visual: 'circuit',
        explanation: 'To compute K(x, x\'): (1) Apply U(x) to |0⟩ to get |ψ(x)⟩. (2) Apply U†(x\') to get U†(x\')|ψ(x)⟩. (3) Measure probability of getting |0⟩ back. This probability equals |⟨ψ(x\')|ψ(x)⟩|² = K(x, x\'). No ancilla qubits needed.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

def feature_map(x: float, n_qubits: int = 2) -> QuantumCircuit:
    """ZZ feature map: encodes data with entangling interactions."""
    qc = QuantumCircuit(n_qubits)
    for q in range(n_qubits):
        qc.h(q)
        qc.rz(x, q)
    # Entangling: ZZ interaction
    for q in range(n_qubits - 1):
        qc.cx(q, q + 1)
        qc.rz(x * x, q + 1)
        qc.cx(q, q + 1)
    return qc

def quantum_kernel(x1: float, x2: float) -> float:
    """Compute kernel via state vector fidelity."""
    fm1 = feature_map(x1)
    fm2 = feature_map(x2)
    sv1 = Statevector.from_instruction(fm1)
    sv2 = Statevector.from_instruction(fm2)
    fidelity = np.abs(sv1.inner(sv2)) ** 2
    return fidelity

# Compute kernel matrix for a small dataset
data = [0.0, 1.0, 2.0, 3.0, 4.0]
n = len(data)
K = np.zeros((n, n))
for i in range(n):
    for j in range(n):
        K[i][j] = quantum_kernel(data[i], data[j])

print("Quantum Kernel Matrix:")
print(np.round(K, 3))
print("\\nNotice: diagonal = 1 (self-similarity), off-diagonal decays with distance")`,
        framework: 'qiskit',
        description: 'Compute a quantum kernel matrix using the ZZ feature map and state vector fidelity.',
        explorationPrompt: 'Try changing the feature map (use Ry instead of Rz, or remove the entangling gates). How does the kernel matrix change?',
      },
      {
        type: 'text',
        markdown: `## Quantum Kernel Classification

Once you have the kernel matrix K, classification is purely classical:

1. Compute K(xᵢ, xⱼ) for all training pairs → kernel matrix
2. Feed K into a classical **SVM** (support vector machine)
3. For new data x*, compute K(x*, xᵢ) for all training points
4. SVM predicts the label

> **Key insight:** The quantum computer only computes kernel values. The classifier itself is classical. This makes quantum kernels robust to noise — you only need accurate kernel estimates, not precise quantum states.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '6.5-q1',
            question: 'The quantum kernel K(x, x\') measures:',
            options: [
              'The Euclidean distance between x and x\'',
              'The fidelity between quantum states |ψ(x)⟩ and |ψ(x\')⟩',
              'The entanglement between two qubits',
              'The depth of the encoding circuit',
            ],
            correctIndex: 1,
            explanation: 'K(x, x\') = |⟨ψ(x\')|ψ(x)⟩|² — the squared overlap (fidelity) between the quantum states produced by encoding x and x\'.',
          },
          {
            id: '6.5-q2',
            question: 'Why might quantum kernels offer advantage over classical kernels?',
            options: [
              'Quantum computers are always faster',
              'The quantum feature space can be exponentially large, hard to simulate classically',
              'Quantum kernels never overfit',
              'Quantum kernels don\'t need training data',
            ],
            correctIndex: 1,
            explanation: 'Quantum circuits map data into a 2ⁿ-dimensional Hilbert space. If the relevant patterns live in this space, computing the kernel classically would require exponential resources.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Kernel Methods vs Variational Methods',
        visual: 'custom-svg',
        explanation: 'Two QML paradigms: (1) Quantum Kernels — no training on quantum device, just kernel evaluation, then classical SVM. Robust to noise. (2) Variational classifiers — train parameters on quantum device via optimization loop. More flexible but harder to train. Both are valid; the best choice depends on the problem.',
      },
    ],
  },

  // ── Lesson 6.6 ──
  {
    id: '6.6',
    title: 'Quantum Convolutional Neural Networks',
    description: 'QCNN architecture: convolution and pooling layers on qubits, inspired by classical CNNs.',
    difficulty: 'advanced',
    estimatedMinutes: 25,
    prerequisites: ['6.3', '6.4'],
    tags: ['qcnn', 'convolution', 'pooling', 'classification', 'phase-recognition'],
    diracContext: 'QCNNs adapt the CNN structure to quantum: local unitary "convolution" layers + measurement-based "pooling" that discards qubits. Emphasize that QCNNs avoid barren plateaus due to locality.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Convolutional Neural Networks, Quantized

Classical CNNs use **convolution** (local pattern detection) + **pooling** (downsampling) to build hierarchical features. QCNNs adapt this:

### QCNN Architecture

| Classical CNN | QCNN |
|---------------|------|
| Convolution filter | 2-qubit unitary applied to neighboring pairs |
| Pooling (max/avg) | Measure one qubit, apply conditional gate to neighbor |
| Feature map shrinks | Number of active qubits halves each layer |
| Final dense layer | Measurement of remaining qubit(s) |

For **n** qubits: log₂(n) layers of convolution + pooling, ending with 1 qubit.

### Why QCNNs Are Special

- **No barren plateaus** — local structure preserves gradients (unlike random PQCs)
- **O(log n) depth** — efficient for NISQ devices
- Proven useful for **quantum phase recognition** (classifying quantum states)`,
      },
      {
        type: 'concept-card',
        title: 'QCNN Layer Structure',
        visual: 'circuit',
        explanation: 'Convolution layer: apply parameterized 2-qubit unitaries to all neighboring pairs (odd-even, then even-odd). Pooling layer: measure every other qubit and use the result to conditionally rotate its neighbor. After pooling, half the qubits are discarded. Repeat until 1 qubit remains.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
import numpy as np

def conv_layer(qc: QuantumCircuit, qubits: list[int], params: list[float]) -> int:
    """Apply parameterized 2-qubit gates to neighboring pairs."""
    idx = 0
    # Even-odd pairs
    for i in range(0, len(qubits) - 1, 2):
        qc.ry(params[idx], qubits[i])
        qc.ry(params[idx + 1], qubits[i + 1])
        qc.cx(qubits[i], qubits[i + 1])
        qc.ry(params[idx + 2], qubits[i + 1])
        idx += 3
    # Odd-even pairs
    for i in range(1, len(qubits) - 1, 2):
        qc.ry(params[idx], qubits[i])
        qc.ry(params[idx + 1], qubits[i + 1])
        qc.cx(qubits[i], qubits[i + 1])
        qc.ry(params[idx + 2], qubits[i + 1])
        idx += 3
    return idx

def pool_layer(qc: QuantumCircuit, qubits: list[int], params: list[float]) -> list[int]:
    """Pooling: controlled rotation then trace out every other qubit."""
    surviving = []
    idx = 0
    for i in range(0, len(qubits) - 1, 2):
        qc.crz(params[idx], qubits[i], qubits[i + 1])
        surviving.append(qubits[i + 1])
        idx += 1
    return surviving

# Build a 4-qubit QCNN
qc = QuantumCircuit(4, 1)
params = np.random.uniform(0, np.pi, 20).tolist()
active = [0, 1, 2, 3]

# Convolution 1 + Pooling 1: 4 qubits → 2 qubits
p_idx = 0
used = conv_layer(qc, active, params[p_idx:])
p_idx += used
qc.barrier()
active = pool_layer(qc, active, params[p_idx:])
p_idx += len(active)
qc.barrier()

# Convolution 2 + Pooling 2: 2 qubits → 1 qubit
used = conv_layer(qc, active, params[p_idx:])
p_idx += used
qc.barrier()
active = pool_layer(qc, active, params[p_idx:])
qc.barrier()

# Measure final qubit
qc.measure(active[0], 0)
print(qc.draw())
print(f"\\nActive qubits after pooling: {active}")
print(f"Total parameters used: {p_idx}")`,
        framework: 'qiskit',
        description: 'Build a 4-qubit QCNN with two convolution-pooling layers. Watch qubits get progressively pooled down to a single output.',
      },
      {
        type: 'text',
        markdown: `## QCNN for Quantum Phase Recognition

The original QCNN paper showed these circuits can classify **quantum phases of matter** — distinguishing symmetry-protected topological phases from trivial phases. This is a natural quantum task where QCNNs have clear advantages over classical methods.

> **The takeaway:** QCNNs inherit the best properties of CNNs (locality, hierarchy, efficiency) while adding quantum expressivity. Their local structure also makes them resistant to barren plateaus — a major advantage over generic PQCs.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '6.6-q1',
            question: 'How does pooling work in a QCNN?',
            options: [
              'Max pooling over measurement outcomes',
              'Measure one qubit, conditionally rotate its neighbor, discard the measured qubit',
              'Average all qubit amplitudes',
              'Apply Hadamard to every other qubit',
            ],
            correctIndex: 1,
            explanation: 'QCNN pooling: measure one qubit from each pair and use the classical result to conditionally adjust the surviving qubit. The measured qubit is discarded (traced out).',
          },
          {
            id: '6.6-q2',
            question: 'Why are QCNNs less susceptible to barren plateaus?',
            options: [
              'They use fewer parameters',
              'Their local structure preserves gradient information',
              'They don\'t use entangling gates',
              'They only work on small circuits',
            ],
            correctIndex: 1,
            explanation: 'QCNNs have local connectivity: each gate only affects nearby qubits. This locality prevents the exponential concentration of gradients that causes barren plateaus in global random circuits.',
          },
        ],
      },
    ],
  },

  // ── Lesson 6.7 ──
  {
    id: '6.7',
    title: 'Quantum Generative Models',
    description: 'Born machines and quantum circuit training to generate target probability distributions.',
    difficulty: 'advanced',
    estimatedMinutes: 25,
    prerequisites: ['6.3', '6.4'],
    tags: ['born-machine', 'generative-model', 'probability-distribution', 'qgan', 'sampling'],
    diracContext: 'Born machines exploit the fact that quantum measurements naturally produce probability distributions. Training a PQC to output a desired distribution is generative modeling. Show the connection to classical GANs and Boltzmann machines.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Quantum Circuits as Probability Generators

Every quantum measurement produces a **probability distribution**. A **Born machine** exploits this directly:

**P(x) = |⟨x|U(θ)|0⟩|²**

The circuit U(θ) is trained so that its output distribution P(x) matches a target distribution p*(x).

### Why Quantum?

- Quantum circuits can represent distributions that are **hard to sample from classically** (certain IQP circuits)
- The Born rule gives probabilities *naturally* — no need for softmax or normalization tricks
- Quantum interference creates correlations between outputs that are hard to replicate classically

### Training Objective

Minimize a distance between distributions:
- **KL divergence:** D_KL(p* || P_θ)
- **MMD** (Maximum Mean Discrepancy)
- **Adversarial loss** (quantum GANs)`,
      },
      {
        type: 'concept-card',
        title: 'Born Machine',
        visual: 'histogram',
        explanation: 'A Born machine is a PQC trained to produce a target probability distribution. The name comes from Max Born\'s probability rule: the probability of measuring outcome x is |⟨x|ψ⟩|². Training adjusts θ in U(θ) until the measurement statistics match the target. Think of it as a quantum sampler.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np
from scipy.optimize import minimize

def born_machine(params: list[float]) -> dict[str, float]:
    """2-qubit Born machine: PQC whose measurement distribution we train."""
    qc = QuantumCircuit(2)
    qc.ry(params[0], 0)
    qc.ry(params[1], 1)
    qc.cx(0, 1)
    qc.ry(params[2], 0)
    qc.rz(params[3], 1)
    qc.cx(1, 0)
    qc.ry(params[4], 0)
    qc.ry(params[5], 1)

    sv = Statevector.from_instruction(qc)
    probs = sv.probabilities()
    return {'00': probs[0], '01': probs[1], '10': probs[2], '11': probs[3]}

# Target distribution: we want P(00)=0.1, P(01)=0.4, P(10)=0.4, P(11)=0.1
target = {'00': 0.1, '01': 0.4, '10': 0.4, '11': 0.1}

def kl_divergence(params):
    q_dist = born_machine(params.tolist())
    kl = 0.0
    for key in target:
        p = target[key]
        q = max(q_dist[key], 1e-10)  # avoid log(0)
        kl += p * np.log(p / q)
    return kl

result = minimize(kl_divergence, x0=np.random.uniform(0, np.pi, 6), method='COBYLA', options={'maxiter': 300})
trained = born_machine(result.x.tolist())

print("Target vs Trained distribution:")
for key in ['00', '01', '10', '11']:
    bar_t = '█' * int(target[key] * 40)
    bar_q = '▓' * int(trained[key] * 40)
    print(f"  |{key}⟩  target={target[key]:.3f} {bar_t}")
    print(f"        trained={trained[key]:.3f} {bar_q}")`,
        framework: 'qiskit',
        description: 'Train a Born machine to reproduce a target probability distribution by minimizing KL divergence.',
        explorationPrompt: 'Try a different target distribution, like P(00)=0.5, P(11)=0.5 (a Bell-like distribution). Can the Born machine learn it?',
      },
      {
        type: 'text',
        markdown: `## Quantum GANs

A **Quantum GAN** pits two circuits against each other:

- **Generator:** PQC that produces quantum states
- **Discriminator:** Another PQC (or classical network) that tries to distinguish generated states from real data

The generator learns to fool the discriminator, producing increasingly realistic distributions. This adversarial training is harder to stabilize than KL-based training, but can handle more complex distributions.

> **Practical note:** Born machines with KL or MMD loss are more stable and commonly used in current QML research than full quantum GANs.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '6.7-q1',
            question: 'What makes quantum circuits natural generative models?',
            options: [
              'They can store exponentially many parameters',
              'Measurement naturally produces probability distributions via the Born rule',
              'They always converge faster than classical models',
              'They don\'t need optimization',
            ],
            correctIndex: 1,
            explanation: 'The Born rule guarantees that measuring a quantum state produces a valid probability distribution. Training a PQC to match a target distribution is a natural fit.',
          },
          {
            id: '6.7-q2',
            question: 'In a Born machine, what is being optimized?',
            options: [
              'The number of qubits',
              'The circuit depth',
              'The rotation parameters to match a target distribution',
              'The measurement basis',
            ],
            correctIndex: 2,
            explanation: 'A Born machine optimizes the PQC parameters θ so that the measurement distribution P_θ(x) = |⟨x|U(θ)|0⟩|² approximates the target distribution.',
          },
        ],
      },
    ],
  },

  // ── Lesson 6.8 ──
  {
    id: '6.8',
    title: 'Quantum Boltzmann Machines',
    description: 'Quantum thermodynamic sampling, thermal states, and the connection to classical restricted Boltzmann machines.',
    difficulty: 'advanced',
    estimatedMinutes: 20,
    prerequisites: ['6.7', '4.1'],
    tags: ['boltzmann-machine', 'thermal-state', 'rbm', 'sampling', 'gibbs-state'],
    diracContext: 'Quantum Boltzmann Machines extend classical RBMs using quantum Hamiltonians. The thermal state e^(-βH)/Z is the quantum generalization of a Boltzmann distribution. Focus on conceptual understanding and the simple demo.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## From Classical to Quantum Boltzmann Machines

A **classical Restricted Boltzmann Machine** (RBM) defines a probability distribution via an energy function:

**P(v) = Σ_h e^{-E(v,h)} / Z**

where v = visible units, h = hidden units, and Z is the partition function.

### The Quantum Extension

A **Quantum Boltzmann Machine** (QBM) replaces the classical energy function with a **quantum Hamiltonian**:

**ρ = e^{-βH} / Tr(e^{-βH})**

This **thermal state** (Gibbs state) has richer structure than classical Boltzmann distributions because H can include **off-diagonal terms** that create quantum coherence.

| Classical RBM | Quantum BM |
|---------------|-----------|
| Binary units {0, 1} | Qubits |
| Energy function E(v, h) | Hamiltonian H |
| Boltzmann distribution | Gibbs/thermal state |
| Classical sampling | Quantum sampling |
| Diagonal interactions | Off-diagonal terms (tunneling) |`,
      },
      {
        type: 'concept-card',
        title: 'Thermal States',
        visual: 'bloch',
        explanation: 'A thermal state at inverse temperature β is ρ = e^{-βH}/Z. At β=0 (infinite temperature), ρ = I/2ⁿ — maximally mixed, at the center of the Bloch ball. At β→∞ (zero temperature), ρ approaches the ground state — on the Bloch sphere surface. Temperature controls the "purity" of the distribution.',
      },
      {
        type: 'demo',
        code: `from qiskit.quantum_info import SparsePauliOp, Statevector
import numpy as np
from scipy.linalg import expm

# Simple 2-qubit Hamiltonian: H = -J*Z1Z2 - h*(X1 + X2)
# This has both diagonal (ZZ) and off-diagonal (X) terms
J = 1.0    # coupling strength
h_field = 0.5  # transverse field

# Build Hamiltonian matrix
I2 = np.eye(2)
X = np.array([[0, 1], [1, 0]])
Z = np.array([[1, 0], [0, -1]])

H = -J * np.kron(Z, Z) - h_field * (np.kron(X, I2) + np.kron(I2, X))
print("Hamiltonian H:")
print(np.round(H, 3))

# Compute thermal state at different temperatures
for beta in [0.1, 1.0, 5.0, 20.0]:
    rho = expm(-beta * H)
    rho = rho / np.trace(rho)  # normalize
    diag = np.real(np.diag(rho))
    purity = np.real(np.trace(rho @ rho))
    print(f"\\nβ={beta:5.1f}  P(00)={diag[0]:.3f}  P(01)={diag[1]:.3f}  P(10)={diag[2]:.3f}  P(11)={diag[3]:.3f}  purity={purity:.3f}")`,
        framework: 'qiskit',
        description: 'Compute thermal states of a 2-qubit Hamiltonian at different temperatures. Watch the distribution sharpen as temperature drops.',
        explorationPrompt: 'Try increasing h_field to 2.0. How does the transverse field change the thermal state? Notice how off-diagonal terms mix the computational basis states.',
      },
      {
        type: 'text',
        markdown: `## Training QBMs

Training a QBM involves:
1. Define a parameterized Hamiltonian H(θ)
2. Prepare the thermal state ρ(θ) (hard in general — requires quantum Gibbs sampling)
3. Compute ⟨O⟩_ρ for observables O (via measurement)
4. Update θ to match training data statistics

### The Challenge

Preparing thermal states is one of the hardest problems in quantum computing. Current approaches:
- **Variational thermalizers** — PQCs trained to approximate thermal states
- **Quantum imaginary time evolution**
- **Quantum Metropolis sampling**

> **Bottom line:** QBMs are theoretically elegant but practically challenging. They're an active research area, not a production tool (yet).`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '6.8-q1',
            question: 'What does a quantum Boltzmann machine generalize compared to a classical RBM?',
            options: [
              'It uses more hidden units',
              'It replaces the energy function with a quantum Hamiltonian that can have off-diagonal terms',
              'It uses deeper neural networks',
              'It removes the need for a partition function',
            ],
            correctIndex: 1,
            explanation: 'The key generalization: a quantum Hamiltonian can have off-diagonal terms (like X operators) that create quantum coherence — something a classical energy function cannot represent.',
          },
          {
            id: '6.8-q2',
            question: 'At infinite temperature (β → 0), what is the thermal state?',
            options: [
              'The ground state of H',
              'A pure superposition state',
              'The maximally mixed state I/2ⁿ',
              'The most excited state of H',
            ],
            correctIndex: 2,
            explanation: 'At β=0, e^{-βH} = I, so ρ = I/Z = I/2ⁿ — the maximally mixed state. All basis states are equally likely. As β increases, the distribution sharpens toward the ground state.',
          },
        ],
      },
    ],
  },

  // ── Lesson 6.9 ──
  {
    id: '6.9',
    title: 'Barren Plateaus',
    description: 'The vanishing gradient problem for quantum circuits — why random initialization fails and how to fix it.',
    difficulty: 'advanced',
    estimatedMinutes: 20,
    prerequisites: ['6.3', '6.4'],
    tags: ['barren-plateau', 'vanishing-gradient', 'trainability', 'initialization', 'expressibility'],
    diracContext: 'Barren plateaus are the biggest practical obstacle in variational QML. Emphasize the intuition: random deep circuits scramble information so thoroughly that local measurements can\'t detect parameter changes. Cover concrete mitigation strategies.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Vanishing Gradient Crisis

The biggest obstacle in training variational quantum circuits is the **barren plateau**: as circuits get deeper and wider, gradients **vanish exponentially**.

### The Problem

For a random PQC with n qubits and sufficient depth:

**Var(∂C/∂θ) ∝ 1/2ⁿ**

This means:
- 10 qubits: gradients ≈ 10⁻³ — training is sluggish
- 20 qubits: gradients ≈ 10⁻⁶ — training is essentially frozen
- 50 qubits: gradients ≈ 10⁻¹⁵ — indistinguishable from zero

### Why It Happens

A deep random circuit scrambles the input so thoroughly that it approximates a **random unitary** (Haar-random). In this regime:
- The cost landscape becomes **exponentially flat**
- Gradients are exponentially small *everywhere*, not just at bad starting points
- No optimizer can escape — it's not a local minimum, it's a **desert**`,
      },
      {
        type: 'concept-card',
        title: 'Barren Plateau Visualization',
        visual: 'custom-svg',
        explanation: 'Imagine a cost landscape: with few qubits and shallow depth, the landscape has hills and valleys that gradients can follow. With many qubits and deep random circuits, the landscape becomes exponentially flat — a vast plateau with no discernible slope. The optimizer wanders randomly, unable to find a direction to improve.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

def compute_gradient_variance(n_qubits: int, n_layers: int, n_samples: int = 50) -> float:
    """Estimate gradient variance by sampling random parameters."""
    gradients = []
    for _ in range(n_samples):
        n_params = n_qubits * n_layers
        params = np.random.uniform(0, 2 * np.pi, n_params)

        # Evaluate cost at theta and theta + shift (parameter-shift rule)
        shift = np.pi / 2
        shifted_params = params.copy()
        shifted_params[0] += shift  # shift first parameter

        def build_circuit(p):
            qc = QuantumCircuit(n_qubits)
            idx = 0
            for layer in range(n_layers):
                for q in range(n_qubits):
                    qc.ry(p[idx], q)
                    idx += 1
                for q in range(n_qubits - 1):
                    qc.cx(q, q + 1)
            return qc

        sv_plus = Statevector.from_instruction(build_circuit(shifted_params))
        shifted_params[0] -= 2 * shift
        sv_minus = Statevector.from_instruction(build_circuit(shifted_params))

        # Cost = P(|00...0⟩)
        grad = (sv_plus.probabilities()[0] - sv_minus.probabilities()[0]) / 2
        gradients.append(grad)

    return float(np.var(gradients))

# Show gradient variance shrinking with qubit count
print("Gradient variance vs qubit count (3 layers):")
print("-" * 45)
for n in [2, 3, 4, 5, 6]:
    var = compute_gradient_variance(n, 3, 80)
    bar = '█' * max(1, int(var * 500))
    print(f"  {n} qubits: Var = {var:.6f}  {bar}")`,
        framework: 'qiskit',
        description: 'Measure gradient variance as qubit count increases. Watch it shrink exponentially — the barren plateau in action.',
        explorationPrompt: 'Try increasing n_layers from 3 to 10. Does more depth make the barren plateau worse?',
      },
      {
        type: 'text',
        markdown: `## Mitigation Strategies

| Strategy | Idea | When to Use |
|----------|------|-------------|
| **Shallow circuits** | Fewer layers = weaker scrambling | Default starting point |
| **Local cost functions** | Measure local observables, not global ones | When possible |
| **Layer-wise training** | Train one layer at a time, freeze others | Deep circuits |
| **Identity initialization** | Start near identity (small angles) | General PQCs |
| **QCNN structure** | Local connectivity preserves gradients | Classification tasks |
| **Correlated parameters** | Tie parameters across layers | Reduce effective dimension |
| **Classical pre-training** | Use a classical model to initialize θ | Hybrid workflows |

> **Rule of thumb:** If you need > 10 qubits with random initialization and a deep ansatz, you will hit a barren plateau. Plan your architecture to avoid it.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '6.9-q1',
            question: 'How does gradient variance scale with qubit count in a barren plateau?',
            options: [
              'Linearly: Var ∝ n',
              'Polynomially: Var ∝ 1/n²',
              'Exponentially: Var ∝ 1/2ⁿ',
              'It stays constant',
            ],
            correctIndex: 2,
            explanation: 'Gradient variance decays exponentially: Var(∂C/∂θ) ∝ 1/2ⁿ. This is the defining characteristic of barren plateaus.',
          },
          {
            id: '6.9-q2',
            question: 'Which strategy does NOT help mitigate barren plateaus?',
            options: [
              'Using shallower circuits',
              'Using local cost functions',
              'Adding more random layers',
              'Identity initialization (small initial angles)',
            ],
            correctIndex: 2,
            explanation: 'Adding more random layers makes barren plateaus WORSE — deeper random circuits scramble information more thoroughly, leading to even flatter cost landscapes.',
          },
        ],
      },
    ],
  },

  // ── Lesson 6.10 ──
  {
    id: '6.10',
    title: 'Quantum Transfer Learning',
    description: 'Combining pre-trained classical networks with quantum layers — hybrid pipelines for practical QML.',
    difficulty: 'advanced',
    estimatedMinutes: 20,
    prerequisites: ['6.4', '6.3'],
    tags: ['transfer-learning', 'hybrid', 'classical-quantum', 'pre-trained', 'fine-tuning'],
    diracContext: 'Transfer learning is the most practical path to useful QML today. Pre-trained classical networks handle feature extraction; a quantum circuit handles the final classification. Emphasize that this is how QML reaches real-world data like images.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Practical Path to Quantum ML

Raw quantum circuits struggle with real-world data (images, text, audio) because:
1. **Data encoding is expensive** — encoding a 224x224 image would need ~50,000 qubits
2. **Feature extraction is classical** — CNNs already excel at learning visual features
3. **Quantum advantage** (if any) lies in the *final processing*, not raw input handling

### The Solution: Quantum Transfer Learning

1. Take a **pre-trained classical network** (ResNet, VGG, etc.)
2. **Remove** the final classification layer
3. Use the classical network as a **feature extractor** → outputs a small vector (e.g., 512 features)
4. **Reduce** to a handful of features (e.g., 4–8) with a classical dense layer
5. **Feed** into a quantum circuit for final classification

> **Key insight:** The classical network compresses high-dimensional data into a small representation that a quantum circuit can handle. The quantum circuit processes the *compressed features*, not the raw data.`,
      },
      {
        type: 'concept-card',
        title: 'Hybrid Pipeline Architecture',
        visual: 'custom-svg',
        explanation: 'Image → Pre-trained CNN (frozen) → Feature vector [512] → Dense layer → Compact vector [4] → Angle encoding → PQC → Measurement → Class prediction. The classical layers are frozen (pre-trained); only the dense reduction layer and PQC parameters are trained. This gives you the best of both worlds.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np
from scipy.optimize import minimize

# Simulate the hybrid pipeline (without actual images)
# Classical network output: 4 features per data point
# These would come from a pre-trained CNN in practice

np.random.seed(42)

# Simulated features from a pre-trained network
# Class 0: features cluster around [0.2, 0.8, 0.3, 0.1]
# Class 1: features cluster around [0.9, 0.2, 0.7, 0.8]
X_class0 = np.random.normal([0.2, 0.8, 0.3, 0.1], 0.15, (5, 4)).clip(0, 1)
X_class1 = np.random.normal([0.9, 0.2, 0.7, 0.8], 0.15, (5, 4)).clip(0, 1)
X = np.vstack([X_class0, X_class1]) * np.pi  # scale to [0, π]
y = [0] * 5 + [1] * 5

def quantum_head(features: np.ndarray, params: list[float]) -> float:
    """Quantum classification head: angle encode features + PQC."""
    qc = QuantumCircuit(4)
    # Angle encoding of pre-processed features
    for i in range(4):
        qc.ry(features[i], i)
    # PQC layer 1
    for i in range(4):
        qc.ry(params[i], i)
    qc.cx(0, 1); qc.cx(1, 2); qc.cx(2, 3)
    # PQC layer 2
    for i in range(4):
        qc.ry(params[4 + i], i)
    qc.cx(3, 2); qc.cx(2, 1); qc.cx(1, 0)

    sv = Statevector.from_instruction(qc)
    return sv.probabilities()[0]  # P(|0000⟩) → class 0 confidence

def cost(params):
    loss = 0.0
    for xi, yi in zip(X, y):
        pred = quantum_head(xi, params.tolist())
        target = 1.0 if yi == 0 else 0.0
        loss += (pred - target) ** 2
    return loss / len(X)

# Train the quantum head
result = minimize(cost, x0=np.random.uniform(0, np.pi, 8), method='COBYLA', options={'maxiter': 300})

print("Quantum Transfer Learning Results:")
print("=" * 50)
correct = 0
for xi, yi in zip(X, y):
    pred = quantum_head(xi, result.x.tolist())
    label = 0 if pred > 0.5 else 1
    ok = '✓' if label == yi else '✗'
    correct += label == yi
    print(f"  true={yi}  pred={label}  conf={pred:.3f}  {ok}")
print(f"\\nAccuracy: {correct}/{len(X)} = {correct/len(X)*100:.0f}%")`,
        framework: 'qiskit',
        description: 'Simulate quantum transfer learning: pre-trained classical features (simulated) are classified by a quantum circuit head. Only the quantum parameters are trained.',
        explorationPrompt: 'Try making the classes harder to separate (reduce the gap between cluster centers). When does the quantum head start to struggle?',
      },
      {
        type: 'text',
        markdown: `## Practical Considerations

### When Transfer Learning Makes Sense

- **Image classification** — Classical CNNs extract features, quantum circuit classifies
- **Medical imaging** — Pre-trained models + quantum final layer for rare disease detection
- **Any domain with pre-trained models** — NLP embeddings, audio features, etc.

### Current Limitations

- No proven advantage over a classical final layer (yet)
- The quantum bottleneck: only 4–10 features can be processed quantum-mechanically
- Quantum noise in the final layer can hurt accuracy

### The Honest Assessment

Quantum transfer learning is the **most practical QML approach today** because it avoids the encoding problem entirely. Whether the quantum layer provides genuine advantage over a classical layer of equal parameter count is still an **open research question**.

> **Takeaway:** Start here if you want to apply QML to real data. It works, it's testable, and it gives you a framework for evaluating quantum advantage empirically.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '6.10-q1',
            question: 'In quantum transfer learning, which part of the pipeline is quantum?',
            options: [
              'The entire pipeline from raw data to prediction',
              'Only the feature extraction (CNN)',
              'Only the final classification head (PQC)',
              'Only the data preprocessing',
            ],
            correctIndex: 2,
            explanation: 'The classical pre-trained network handles feature extraction. The quantum circuit replaces only the final classification layer — a small but potentially powerful substitution.',
          },
          {
            id: '6.10-q2',
            question: 'Why can\'t we encode a 224x224 image directly into a quantum circuit?',
            options: [
              'Images are not quantum data',
              'It would require ~50,000 qubits for angle encoding, far beyond current hardware',
              'Quantum circuits only process binary data',
              'Images don\'t have quantum features',
            ],
            correctIndex: 1,
            explanation: 'A 224x224 RGB image has ~150,000 pixel values. Even with efficient encoding, this far exceeds available qubit counts. Classical feature extraction compresses this to a manageable size first.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The QML Stack',
        visual: 'custom-svg',
        explanation: 'The practical QML stack: (1) Classical preprocessing and feature extraction handle raw data. (2) A dimensionality reduction layer compresses features to qubit-scale. (3) Angle encoding maps features to quantum states. (4) A PQC processes the encoded data. (5) Measurement extracts a classical prediction. This hybrid stack is where QML delivers value today.',
      },
    ],
  },
];
