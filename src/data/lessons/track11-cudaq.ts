import type { Lesson } from './types';

export const TRACK11_LESSONS: Lesson[] = [
  // ── Lesson 11.1 ──
  {
    id: '11.1',
    title: 'CUDA-Q Architecture',
    description:
      'What is CUDA-Q, kernel-based quantum programming, and GPU-native quantum simulation. Your first circuit in NVIDIA\'s quantum platform.',
    difficulty: 'beginner',
    estimatedMinutes: 20,
    prerequisites: ['1.1'],
    tags: ['cuda-q', 'nvidia', 'gpu', 'kernel', 'cudaq', 'gpu-simulation'],
    diracContext:
      'This is the student\'s introduction to CUDA-Q. They likely know Qiskit or Cirq already. Emphasize the paradigm shift: CUDA-Q uses a kernel-based model where quantum code is defined as Python functions decorated with @cudaq.kernel. The GPU handles simulation natively — no separate simulator object. Draw parallels to CUDA in classical HPC. Keep it welcoming; the student does not need GPU programming experience.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## A Different Way to Think About Quantum Code

You have written quantum circuits in Qiskit or Cirq — create an object, append gates, run a simulator. **CUDA-Q** flips the model.

In CUDA-Q, quantum programs are **kernels**: Python functions decorated with \`@cudaq.kernel\`. Inside a kernel, you write gate operations directly — no circuit object, no append calls. The NVIDIA runtime compiles and executes these kernels on **GPUs**, CPUs, or real quantum hardware through a unified interface.

### Why CUDA-Q?

| Feature | Benefit |
|---------|---------|
| **Kernel-based model** | Quantum code reads like a function, not a builder pattern |
| **GPU-native simulation** | Leverages NVIDIA GPUs for massive state vector simulation |
| **Hybrid workflows** | Classical and quantum code live in the same program naturally |
| **Multi-backend** | Same kernel targets simulators, GPU clusters, or QPUs |
| **cuQuantum under the hood** | State-of-the-art tensor network and state vector libraries |

CUDA-Q is NVIDIA's bet on quantum computing — built by the company that made GPUs the backbone of AI. The same hardware acceleration philosophy now applies to quantum simulation.

### The Kernel Model

\`\`\`python
import cudaq

@cudaq.kernel
def my_circuit():
    qubit = cudaq.qubit()   # Allocate one qubit
    h(qubit)                 # Apply Hadamard
    mz(qubit)                # Measure in Z basis
\`\`\`

No \`QuantumCircuit()\`. No \`.append()\`. Just a decorated function with direct gate calls. The runtime handles compilation, optimization, and execution.`,
      },
      {
        type: 'concept-card',
        title: 'Kernel Model vs Circuit Model',
        visual: 'circuit',
        explanation:
          'In the circuit model (Qiskit, Cirq), you build a circuit object and then hand it to a separate simulator. In the kernel model (CUDA-Q), the quantum program IS a function — the runtime compiles and executes it directly. Think of it like writing a CUDA kernel for a GPU: you define the computation, and the platform handles dispatch.',
      },
      {
        type: 'demo',
        code: `import cudaq

# Your first CUDA-Q program — a Bell state
@cudaq.kernel
def bell():
    q = cudaq.qvector(2)
    h(q[0])
    cx(q[0], q[1])
    mz(q)

# Sample the kernel — CUDA-Q handles simulation
result = cudaq.sample(bell, shots_count=1000)
print("Bell state results:")
print(result)
print(f"Most probable: {result.most_probable()}")`,
        framework: 'cuda-q',
        description:
          'A Bell state in CUDA-Q. Notice the difference from Qiskit: no circuit object, no simulator object. The @cudaq.kernel decorator and cudaq.sample() handle everything.',
        explorationPrompt:
          'Try adding a third qubit and creating a GHZ state. How does the syntax compare to what you know from Qiskit?',
      },
      {
        type: 'text',
        markdown: `## Key Concepts

### qvector and qubit

CUDA-Q gives you two ways to allocate quantum memory:
- \`cudaq.qubit()\` — a single qubit
- \`cudaq.qvector(n)\` — a register of n qubits, indexable like a list

### Gate Syntax

Gates are **free functions** called inside kernels, not methods on a circuit:

| Gate | CUDA-Q Syntax | Qiskit Equivalent |
|------|--------------|-------------------|
| Hadamard | \`h(q)\` | \`qc.h(q)\` |
| CNOT | \`cx(control, target)\` | \`qc.cx(c, t)\` |
| Pauli-X | \`x(q)\` | \`qc.x(q)\` |
| Rotation Z | \`rz(theta, q)\` | \`qc.rz(theta, q)\` |
| Toffoli | \`x.ctrl(c1, c2, target)\` | \`qc.ccx(c1, c2, t)\` |
| Measure | \`mz(q)\` | \`qc.measure(q, c)\` |

### Running Programs

- \`cudaq.sample(kernel, shots_count=N)\` — sample measurement outcomes
- \`cudaq.get_state(kernel)\` — get the full state vector
- \`cudaq.observe(kernel, observable)\` — compute expectation values`,
      },
      {
        type: 'concept-card',
        title: 'CUDA-Q Execution Pipeline',
        visual: 'custom-svg',
        explanation:
          'Python kernel → MLIR compilation → NVIDIA runtime → GPU state vector simulation (or QPU dispatch). The multi-level IR (MLIR) step is what makes CUDA-Q fast: your Python function is compiled to optimized GPU code, not interpreted line by line.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '11.1-q1',
            question: 'How does CUDA-Q differ from Qiskit\'s circuit model?',
            options: [
              'CUDA-Q uses XML to define circuits',
              'CUDA-Q defines quantum programs as decorated kernel functions, not circuit objects',
              'CUDA-Q only works with trapped ion hardware',
              'CUDA-Q requires you to write raw CUDA C++ code',
            ],
            correctIndex: 1,
            explanation:
              'CUDA-Q uses a kernel-based model: quantum programs are Python functions decorated with @cudaq.kernel. Gates are called as free functions inside the kernel. The runtime compiles and dispatches — no separate circuit object or simulator needed.',
          },
          {
            id: '11.1-q2',
            question: 'What does cudaq.sample() do?',
            options: [
              'Compiles the kernel to machine code without running it',
              'Returns the unitary matrix of the circuit',
              'Executes the kernel multiple times and returns measurement statistics',
              'Sends the kernel to IBM Quantum hardware',
            ],
            correctIndex: 2,
            explanation:
              'cudaq.sample(kernel, shots_count=N) executes the quantum kernel N times, collecting measurement outcomes into a histogram of results — analogous to running a circuit with shots on any other platform.',
          },
        ],
      },
    ],
  },

  // ── Lesson 11.2 ──
  {
    id: '11.2',
    title: 'GPU-Accelerated Simulation',
    description:
      'cuStateVec, cuTensorNet, and why GPUs are ideal for quantum simulation. Benchmark large circuits that would be slow classically.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['11.1'],
    tags: ['gpu', 'custatevec', 'cutensornet', 'simulation', 'performance', 'state-vector', 'tensor-network'],
    diracContext:
      'The student understands basic CUDA-Q kernels. Now explain WHY GPUs matter for quantum simulation. A state vector of n qubits has 2^n amplitudes — this is embarrassingly parallel. GPUs with thousands of cores and high-bandwidth memory are perfect for this. Compare wall-clock times: a 30-qubit simulation on CPU vs GPU. Keep the explanation accessible — no need for deep GPU architecture knowledge.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Why GPUs for Quantum Simulation?

A quantum state of **n qubits** is a vector of **2ⁿ complex amplitudes**. Applying a gate means multiplying or updating subsets of these amplitudes — millions to billions of independent operations.

This is exactly what GPUs are built for.

| Qubits | State Vector Size | Amplitudes |
|--------|------------------|------------|
| 20 | 16 MB | 1,048,576 |
| 25 | 512 MB | 33,554,432 |
| 30 | 16 GB | 1,073,741,824 |
| 35 | 512 GB | 34,359,738,368 |
| 40 | 16 TB | ~1.1 trillion |

An NVIDIA A100 GPU has **80 GB of HBM3 memory** and **thousands of CUDA cores** running in parallel. It can simulate ~32 qubits in state vector mode on a single GPU — far faster than any CPU.

### Two Simulation Engines

CUDA-Q provides two backends through the **cuQuantum SDK**:

| Engine | Method | Best For |
|--------|--------|----------|
| **cuStateVec** | Full state vector | Exact simulation up to ~32–35 qubits per GPU |
| **cuTensorNet** | Tensor network contraction | Approximate simulation of larger/shallower circuits |

**cuStateVec** stores the entire state vector in GPU memory and applies gates as matrix operations. Fast and exact, but memory-limited.

**cuTensorNet** represents the circuit as a tensor network and contracts it. Memory-efficient for shallow or structured circuits, but contraction order matters and deep circuits can be slow.`,
      },
      {
        type: 'concept-card',
        title: 'State Vector: CPU vs GPU',
        visual: 'histogram',
        explanation:
          'For a 28-qubit random circuit: CPU (single-threaded) takes ~45 seconds. Multi-core CPU (16 threads) takes ~6 seconds. A single A100 GPU takes ~0.3 seconds — a 150x speedup over the multi-core case. The advantage grows with qubit count because GPU memory bandwidth dominates.',
      },
      {
        type: 'demo',
        code: `import cudaq

# Simulate a circuit that benefits from GPU acceleration
# 15 qubits with layers of entangling gates
@cudaq.kernel
def deep_circuit():
    q = cudaq.qvector(15)

    # Layer 1: Superposition
    for i in range(15):
        h(q[i])

    # Layer 2: Entangling ladder
    for i in range(14):
        cx(q[i], q[i + 1])

    # Layer 3: Rotations
    for i in range(15):
        rz(0.5, q[i])

    # Layer 4: Reverse entangling
    for i in range(13, -1, -1):
        cx(q[i], q[i + 1])

    mz(q)

# GPU-accelerated sampling
result = cudaq.sample(deep_circuit, shots_count=10000)
print(f"Simulated 15 qubits, 4 layers, 10000 shots")
print(f"Unique measurement outcomes: {len(result)}")
print(f"Most probable state: {result.most_probable()}")`,
        framework: 'cuda-q',
        description:
          'A 15-qubit, 4-layer circuit sampled 10,000 times. On a GPU, this runs in milliseconds. The same simulation on a CPU would take significantly longer as qubit count increases.',
        explorationPrompt:
          'Increase the qubit count to 20 or 25 (if your GPU has enough memory). Observe how the number of unique outcomes explodes — this is the exponential state space.',
      },
      {
        type: 'text',
        markdown: `## Choosing a Backend

CUDA-Q lets you select the simulation backend at runtime:

\`\`\`python
# State vector (exact, GPU-accelerated)
cudaq.set_target("nvidia")

# Tensor network (memory-efficient)
cudaq.set_target("tensornet")

# CPU fallback
cudaq.set_target("qpp-cpu")
\`\`\`

### When to Use What

| Scenario | Recommended Backend |
|----------|-------------------|
| Exact simulation, < 32 qubits | \`nvidia\` (cuStateVec) |
| Shallow circuits, > 32 qubits | \`tensornet\` (cuTensorNet) |
| No GPU available | \`qpp-cpu\` |
| Noisy simulation | \`nvidia\` with noise model |
| Expectation values (VQE/QAOA) | \`nvidia\` for speed |

### Memory Planning

Rule of thumb: each qubit **doubles** the memory requirement. For state vector simulation:
- 30 qubits → 16 GB (fits on most GPUs)
- 32 qubits → 64 GB (needs A100 80GB)
- 34 qubits → 256 GB (needs multi-GPU)`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '11.2-q1',
            question: 'Why are GPUs well-suited for quantum state vector simulation?',
            options: [
              'GPUs have more cache than CPUs',
              'Gate operations update billions of amplitudes in parallel — matching GPU architecture',
              'GPUs can run Python code faster than CPUs',
              'GPUs use quantum effects internally for speedup',
            ],
            correctIndex: 1,
            explanation:
              'A state vector of n qubits has 2^n amplitudes. Applying a gate updates large subsets of these in parallel — a pattern that maps perfectly to GPU architecture with thousands of cores and high memory bandwidth.',
          },
          {
            id: '11.2-q2',
            question: 'What is the key difference between cuStateVec and cuTensorNet?',
            options: [
              'cuStateVec is for Qiskit, cuTensorNet is for Cirq',
              'cuStateVec simulates full state vectors exactly; cuTensorNet uses tensor network contraction for larger circuits',
              'cuTensorNet is always faster than cuStateVec',
              'cuStateVec only works on CPUs',
            ],
            correctIndex: 1,
            explanation:
              'cuStateVec stores the full 2^n state vector and applies gates directly — exact but memory-limited. cuTensorNet represents the circuit as a tensor network and contracts it, trading exactness for the ability to handle larger or shallower circuits.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The Qubit-Memory Wall',
        visual: 'histogram',
        explanation:
          'At 30 qubits you need 16 GB. At 40 qubits you need 16 TB. At 50 qubits you need 16 PB. No amount of GPU memory solves this exponential scaling — which is precisely why we need real quantum hardware. GPU simulation is a bridge, not the destination.',
      },
    ],
  },

  // ── Lesson 11.3 ──
  {
    id: '11.3',
    title: 'Hybrid Quantum-Classical Workflows',
    description:
      'Classical preprocessing, quantum kernels, and classical postprocessing. Build a VQE-style hybrid optimization loop in CUDA-Q.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['11.2'],
    tags: ['hybrid', 'vqe', 'variational', 'classical-quantum', 'optimization', 'observe'],
    diracContext:
      'The student has run basic CUDA-Q kernels. Now introduce the hybrid loop: classical code calls a quantum kernel with parameters, measures an expectation value, and a classical optimizer updates the parameters. This is the NISQ-era workhorse pattern. CUDA-Q makes this natural because kernels are just functions that accept arguments. Show the cudaq.observe() API for expectation values. Keep the VQE example simple — minimize ⟨Z⟩ on one qubit as a warm-up.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Hybrid Loop

Most useful quantum algorithms today follow a pattern:

1. **Classical preprocessing** — choose initial parameters
2. **Quantum kernel** — prepare a parameterized state, measure an observable
3. **Classical postprocessing** — evaluate the cost, update parameters
4. **Repeat** until converged

This is the **variational quantum eigensolver (VQE)** pattern, and CUDA-Q makes it natural because kernels accept classical arguments:

\`\`\`python
@cudaq.kernel
def ansatz(theta: float):
    q = cudaq.qubit()
    ry(theta, q)
\`\`\`

The classical optimizer calls \`ansatz(theta)\` with different angles until it finds the minimum energy.

### cudaq.observe()

Instead of sampling bitstrings, \`cudaq.observe()\` computes the **expectation value** of an observable directly:

\`\`\`python
hamiltonian = spin.z(0)  # The Pauli-Z operator on qubit 0
result = cudaq.observe(ansatz, hamiltonian, theta)
energy = result.expectation()
\`\`\`

This is more efficient than sampling — you get a floating-point energy value without needing thousands of shots.`,
      },
      {
        type: 'concept-card',
        title: 'The Variational Loop',
        visual: 'circuit',
        explanation:
          'Classical optimizer proposes θ → Quantum kernel prepares state |ψ(θ)⟩ → Measure ⟨ψ(θ)|H|ψ(θ)⟩ → Return energy to optimizer → Optimizer proposes new θ → Repeat. The quantum computer evaluates the cost function; the classical computer navigates the parameter landscape.',
      },
      {
        type: 'demo',
        code: `import cudaq
from cudaq import spin

# Simple VQE: find the ground state of H = Z
# The minimum eigenvalue of Z is -1, achieved by |1⟩ (theta = pi)

@cudaq.kernel
def ansatz(theta: float):
    q = cudaq.qubit()
    ry(theta, q)

# Define the Hamiltonian: just Pauli-Z on qubit 0
hamiltonian = spin.z(0)

# Manual optimization loop
import math
best_energy = 999.0
best_theta = 0.0

# Sweep theta from 0 to 2*pi
for i in range(50):
    theta = 2 * math.pi * i / 50
    result = cudaq.observe(ansatz, hamiltonian, theta)
    energy = result.expectation()

    if energy < best_energy:
        best_energy = energy
        best_theta = theta

print(f"Optimal theta: {best_theta:.4f} (expected: {math.pi:.4f})")
print(f"Minimum energy: {best_energy:.4f} (expected: -1.0)")
print(f"State at optimum: cos(theta/2)|0> + sin(theta/2)|1>")`,
        framework: 'cuda-q',
        description:
          'A minimal VQE: find the angle that minimizes ⟨Z⟩. The answer is θ = π (the state |1⟩), giving energy = -1. This sweep is simple; real VQE uses gradient-based optimizers.',
        explorationPrompt:
          'Change the Hamiltonian to spin.x(0) instead of spin.z(0). What angle minimizes ⟨X⟩? Verify on the Bloch sphere.',
      },
      {
        type: 'text',
        markdown: `## Building Real Hybrid Workflows

The sweep above is a toy example. In practice, CUDA-Q supports proper optimization:

### Using cudaq.optimizers

\`\`\`python
optimizer = cudaq.optimizers.COBYLA()
optimizer.max_iterations = 100

def cost(params):
    result = cudaq.observe(ansatz, hamiltonian, params[0])
    return result.expectation()

optimal_value, optimal_params = optimizer.optimize(
    dimensions=1,
    function=cost
)
\`\`\`

### Multi-Parameter Ansatze

Real molecules need multiple rotation angles:

\`\`\`python
@cudaq.kernel
def molecular_ansatz(thetas: list[float]):
    q = cudaq.qvector(4)
    # Reference state
    x(q[0])
    x(q[1])
    # Variational layers
    ry(thetas[0], q[0])
    ry(thetas[1], q[1])
    cx(q[0], q[2])
    cx(q[1], q[3])
    ry(thetas[2], q[2])
    ry(thetas[3], q[3])
\`\`\`

The number of parameters scales with the problem. GPU acceleration via \`cudaq.observe()\` makes each energy evaluation fast, so the classical optimizer can explore the landscape efficiently.`,
      },
      {
        type: 'exercise',
        id: '11.3-ex1',
        title: 'Minimize a Two-Qubit Hamiltonian',
        description:
          'Write a parameterized CUDA-Q kernel for 2 qubits with two rotation angles. Use cudaq.observe() to find the minimum energy of the Hamiltonian H = Z₀Z₁ + 0.5·X₀. Sweep both parameters and report the minimum energy.',
        starterCode: `import cudaq
from cudaq import spin
import math

# Define the Hamiltonian: Z0*Z1 + 0.5*X0
hamiltonian = spin.z(0) * spin.z(1) + 0.5 * spin.x(0)

@cudaq.kernel
def ansatz(theta0: float, theta1: float):
    q = cudaq.qvector(2)
    # TODO: Apply parameterized gates
    # Hint: use ry() rotations and a cx() entangling gate
    pass

# TODO: Sweep theta0 and theta1 from 0 to 2*pi
# Find the minimum expectation value of the Hamiltonian
best_energy = 999.0
best_params = (0.0, 0.0)

# Your optimization loop here

print(f"Minimum energy: {best_energy:.4f}")
print(f"Optimal params: theta0={best_params[0]:.4f}, theta1={best_params[1]:.4f}")`,
        framework: 'cuda-q',
        expectedProbabilities: {},
        expectedMeasurements: {},
        tolerancePercent: 10,
        hints: [
          'Apply ry(theta0, q[0]) and ry(theta1, q[1]) for single-qubit rotations, then cx(q[0], q[1]) for entanglement.',
          'Use a nested loop: for each theta0 in range, for each theta1 in range, compute the energy.',
          'The minimum energy of Z₀Z₁ + 0.5·X₀ is approximately -1.118 — check if your answer is close.',
        ],
        successMessage:
          'You have built a hybrid quantum-classical optimization loop in CUDA-Q. This pattern scales to real molecular Hamiltonians with dozens of parameters — the GPU makes each observe() call fast enough to optimize over.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '11.3-q1',
            question: 'What does cudaq.observe() return?',
            options: [
              'A histogram of measurement bitstrings',
              'The expectation value of an observable with respect to the kernel\'s output state',
              'The unitary matrix of the circuit',
              'A list of qubit indices that were measured',
            ],
            correctIndex: 1,
            explanation:
              'cudaq.observe(kernel, observable, *args) computes ⟨ψ|O|ψ⟩ — the expectation value of the observable O on the state prepared by the kernel. This is more efficient than sampling for variational algorithms.',
          },
        ],
      },
    ],
  },

  // ── Lesson 11.4 ──
  {
    id: '11.4',
    title: 'Multi-GPU Simulation',
    description:
      'Scaling quantum simulation across multiple GPUs. Distributed state vectors and the path to 40+ qubit simulation.',
    difficulty: 'advanced',
    estimatedMinutes: 20,
    prerequisites: ['11.2'],
    tags: ['multi-gpu', 'distributed', 'mgpu', 'scaling', 'custatevec', 'nvidia'],
    diracContext:
      'The student understands single-GPU simulation from 11.2. Now explain multi-GPU: the state vector is partitioned across GPU memories, and gates that span the partition boundary require inter-GPU communication. This is conceptually like distributed computing. CUDA-Q abstracts this — you just set a target. Emphasize the qubit limit push: single GPU maxes at ~32 qubits, multi-GPU can reach 36-40. Keep it conceptual — the student is unlikely to have multiple GPUs, so focus on understanding the architecture.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Beyond One GPU

A single GPU maxes out at about **32–33 qubits** (64–128 GB). But many interesting problems need more. Multi-GPU simulation distributes the state vector across multiple GPUs:

| GPUs | Combined Memory | Max Qubits (approx) |
|------|----------------|---------------------|
| 1 | 80 GB | ~33 |
| 2 | 160 GB | ~34 |
| 4 | 320 GB | ~35 |
| 8 | 640 GB | ~36 |
| 256 (DGX cluster) | 20 TB | ~40 |

### How Distribution Works

The state vector of n qubits has 2ⁿ amplitudes. In multi-GPU mode:

1. **Partition:** The top k qubits define which GPU holds each amplitude chunk. With 2 GPUs, qubit n-1 determines the partition — amplitudes with that qubit in |0⟩ go to GPU 0, amplitudes with |1⟩ go to GPU 1.

2. **Local gates:** Gates acting on "local" qubits (within one GPU's partition) execute with zero communication — pure GPU speed.

3. **Global gates:** Gates acting on "global" qubits (the partition qubits) require **all-to-all GPU communication** via NVLink or NVSwitch. This is the bottleneck.

4. **Optimization:** Smart qubit ordering minimizes global gate communication. CUDA-Q's runtime handles this automatically.`,
      },
      {
        type: 'concept-card',
        title: 'State Vector Partitioning',
        visual: 'custom-svg',
        explanation:
          'For 4 GPUs simulating 34 qubits: the top 2 qubits partition the state vector into 4 chunks of 2^32 amplitudes each. Gates on the bottom 32 qubits are local (fast). Gates on the top 2 qubits require cross-GPU data movement (slow). The NVLink interconnect bandwidth determines how fast global gates execute.',
      },
      {
        type: 'demo',
        code: `import cudaq

# Multi-GPU target: just change the target string
# cudaq.set_target("nvidia", option="mgpu")

# The kernel code is IDENTICAL to single-GPU — no code changes needed
@cudaq.kernel
def ghz_large():
    q = cudaq.qvector(10)

    h(q[0])
    for i in range(1, 10):
        cx(q[0], q[i])

    mz(q)

# On a multi-GPU system, this would distribute across GPUs automatically
# Here we run on whatever is available
result = cudaq.sample(ghz_large, shots_count=5000)
print("10-qubit GHZ state (scales to 40+ qubits on multi-GPU):")
print(f"  |{'0'*10}⟩: {result.count('0'*10)}")
print(f"  |{'1'*10}⟩: {result.count('1'*10)}")
print(f"  Total unique outcomes: {len(result)}")
print()
print("Key insight: the kernel code never changes.")
print("Only the target changes: 'nvidia' -> 'nvidia,mgpu'")`,
        framework: 'cuda-q',
        description:
          'A 10-qubit GHZ state that would scale transparently to 40+ qubits on a multi-GPU cluster. The kernel code is identical — only the target configuration changes.',
        explorationPrompt:
          'Think about which gates in this circuit would be "local" vs "global" on a 2-GPU system partitioning by the top qubit. The first H gate on q[0] would be global — why?',
      },
      {
        type: 'text',
        markdown: `## The Communication Bottleneck

Multi-GPU is not a free lunch. The performance depends on **interconnect bandwidth**:

| Interconnect | Bandwidth | Typical Setup |
|-------------|-----------|---------------|
| PCIe 5.0 | ~64 GB/s | Consumer multi-GPU |
| NVLink 4.0 | ~900 GB/s | DGX H100 |
| NVSwitch | ~900 GB/s per GPU | DGX SuperPOD |

Global gates require moving half the state vector between GPUs. For 34 qubits, that is ~64 GB of data per global gate. On NVLink, this takes ~70 ms. On PCIe, it takes ~1 second.

### Practical Implications

- **Circuit design matters:** Circuits with gates mostly on low-index qubits are "communication-friendly"
- **Qubit mapping:** CUDA-Q can reorder qubits to minimize global gates
- **Batch observe:** Running multiple expectation values amortizes setup cost
- **Tensor network alternative:** For some circuits, cuTensorNet on a single GPU beats multi-GPU state vector

### CUDA-Q Makes It Easy

\`\`\`python
# Single GPU
cudaq.set_target("nvidia")

# Multi-GPU (same kernel, same code)
cudaq.set_target("nvidia", option="mgpu")

# Multi-node (MPI-based, cluster)
cudaq.set_target("nvidia", option="mqpu")
\`\`\`

The abstraction is clean: you write the kernel once and scale horizontally by changing the target.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '11.4-q1',
            question: 'What is the main bottleneck in multi-GPU quantum simulation?',
            options: [
              'GPU compute speed — GPUs are too slow for quantum simulation',
              'Inter-GPU communication when gates act on partition qubits',
              'Python interpreter overhead',
              'Insufficient GPU cache for the circuit description',
            ],
            correctIndex: 1,
            explanation:
              'When a gate acts on the qubits used to partition the state vector across GPUs, large data transfers are needed between GPUs. This inter-GPU communication via NVLink or PCIe is the bottleneck — the GPU compute itself is fast.',
          },
          {
            id: '11.4-q2',
            question: 'How do you switch from single-GPU to multi-GPU in CUDA-Q?',
            options: [
              'Rewrite the kernel with explicit GPU allocation calls',
              'Change the target: cudaq.set_target("nvidia", option="mgpu")',
              'Use a different Python package (cudaq-multi)',
              'Add @cudaq.multi_gpu decorator to the kernel',
            ],
            correctIndex: 1,
            explanation:
              'CUDA-Q abstracts multi-GPU behind the target system. The kernel code is unchanged — you simply set the target to "nvidia" with the "mgpu" option and the runtime handles state vector distribution.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Simulation Frontier',
        visual: 'histogram',
        explanation:
          'Single CPU: ~25 qubits practical. Single GPU: ~33 qubits. Multi-GPU node: ~36 qubits. GPU cluster: ~40 qubits. Beyond that, classical simulation becomes fundamentally impossible — which is exactly where quantum advantage begins.',
      },
    ],
  },

  // ── Lesson 11.5 ──
  {
    id: '11.5',
    title: 'CUDA-Q Optimizers',
    description:
      'Built-in classical optimizers for variational algorithms. Optimize QAOA parameters on a GPU-accelerated backend.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['11.3'],
    tags: ['optimizer', 'cobyla', 'nelder-mead', 'qaoa', 'variational', 'maxcut', 'parameter-optimization'],
    diracContext:
      'The student built a manual sweep in 11.3. Now upgrade to real optimizers. CUDA-Q bundles COBYLA, Nelder-Mead, and gradient-based methods. Show QAOA for MaxCut on a small graph — this is a flagship variational algorithm. Keep the graph to 4 nodes so it is easy to verify. The exercise should have the student optimize a simple QAOA instance themselves.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## From Brute-Force to Smart Search

In Lesson 11.3, you swept parameters in a grid. That works for 1–2 parameters, but real variational algorithms have dozens or hundreds. You need a proper optimizer.

CUDA-Q includes built-in classical optimizers:

| Optimizer | Type | Best For |
|-----------|------|----------|
| **COBYLA** | Derivative-free | General purpose, noisy landscapes |
| **Nelder-Mead** | Derivative-free | Low-dimensional, smooth landscapes |
| **L-BFGS** | Gradient-based | Smooth landscapes with many parameters |
| **SPSA** | Stochastic gradient | Noisy quantum hardware |

### Using an Optimizer

\`\`\`python
optimizer = cudaq.optimizers.COBYLA()
optimizer.max_iterations = 100

energy, params = optimizer.optimize(
    dimensions=num_params,
    function=cost_function
)
\`\`\`

The optimizer calls your cost function repeatedly, adjusting parameters to minimize the returned value. Each cost function evaluation runs the quantum kernel on the GPU.

### QAOA: Quantum Approximate Optimization

QAOA is a variational algorithm for **combinatorial optimization** — problems like MaxCut, graph coloring, and scheduling. The circuit alternates between:
- **Cost layer:** Encodes the problem as phase rotations
- **Mixer layer:** Drives exploration with X rotations

Each layer has one parameter (γ for cost, β for mixer). With p layers, you have 2p parameters to optimize.`,
      },
      {
        type: 'demo',
        code: `import cudaq
from cudaq import spin
import math

# QAOA for MaxCut on a 4-node graph
# Graph: 0-1, 1-2, 2-3, 0-3 (a square)
# MaxCut = partition nodes so max edges cross the cut

# Build the cost Hamiltonian: sum of (1 - Z_i * Z_j) / 2 for each edge
hamiltonian = 0.5 * (spin.i(0) - spin.z(0) * spin.z(1))
hamiltonian += 0.5 * (spin.i(0) - spin.z(1) * spin.z(2))
hamiltonian += 0.5 * (spin.i(0) - spin.z(2) * spin.z(3))
hamiltonian += 0.5 * (spin.i(0) - spin.z(0) * spin.z(3))

# QAOA kernel with p=1 layer
@cudaq.kernel
def qaoa_kernel(gamma: float, beta: float):
    q = cudaq.qvector(4)

    # Initial superposition
    for i in range(4):
        h(q[i])

    # Cost layer: ZZ interactions for each edge
    cx(q[0], q[1])
    rz(2.0 * gamma, q[1])
    cx(q[0], q[1])

    cx(q[1], q[2])
    rz(2.0 * gamma, q[2])
    cx(q[1], q[2])

    cx(q[2], q[3])
    rz(2.0 * gamma, q[3])
    cx(q[2], q[3])

    cx(q[0], q[3])
    rz(2.0 * gamma, q[3])
    cx(q[0], q[3])

    # Mixer layer: X rotations
    for i in range(4):
        rx(2.0 * beta, q[i])

# Optimize using COBYLA
optimizer = cudaq.optimizers.COBYLA()
optimizer.max_iterations = 75
optimizer.initial_parameters = [0.5, 0.5]

def cost(params):
    result = cudaq.observe(qaoa_kernel, hamiltonian, params[0], params[1])
    return result.expectation()

energy, optimal_params = optimizer.optimize(
    dimensions=2,
    function=cost
)

print(f"Optimal gamma: {optimal_params[0]:.4f}")
print(f"Optimal beta:  {optimal_params[1]:.4f}")
print(f"MaxCut value:  {-energy:.4f}")
print(f"(Maximum possible for this graph: 4.0)")`,
        framework: 'cuda-q',
        description:
          'QAOA with p=1 on a 4-node square graph, optimized by COBYLA. The MaxCut value should approach 4 (all edges cut). GPU acceleration makes each observe() call fast.',
        explorationPrompt:
          'The p=1 QAOA may not find the exact maximum. Try increasing to p=2 by adding another cost+mixer layer with two more parameters. Does the result improve?',
      },
      {
        type: 'text',
        markdown: `## Gradient-Based Optimization

For smooth cost landscapes, gradient-based optimizers converge faster. CUDA-Q can compute **parameter-shift gradients** automatically:

\`\`\`python
gradient = cudaq.gradients.ParameterShift()
optimizer = cudaq.optimizers.LBFGS()

energy, params = optimizer.optimize(
    dimensions=num_params,
    function=lambda p: (
        cudaq.observe(kernel, hamiltonian, *p).expectation(),
        gradient.compute(p, kernel, hamiltonian)
    )
)
\`\`\`

The parameter-shift rule evaluates the kernel at θ ± π/2 for each parameter to estimate the gradient. This doubles the number of kernel evaluations but converges much faster.

### Optimizer Selection Guide

| Situation | Recommended Optimizer |
|-----------|---------------------|
| Few parameters, unknown landscape | COBYLA |
| Many parameters, smooth landscape | L-BFGS with parameter-shift |
| Noisy hardware execution | SPSA (stochastic perturbation) |
| Quick prototyping | Nelder-Mead |`,
      },
      {
        type: 'exercise',
        id: '11.5-ex1',
        title: 'Optimize a Triangle Graph QAOA',
        description:
          'Implement QAOA for MaxCut on a triangle graph (3 nodes, edges 0-1, 1-2, 0-2). Use cudaq.optimizers.COBYLA() to find optimal gamma and beta. The maximum cut of a triangle is 2 (any partition cuts exactly 2 of the 3 edges).',
        starterCode: `import cudaq
from cudaq import spin

# Build the MaxCut Hamiltonian for a triangle graph
# Edges: 0-1, 1-2, 0-2
# Each edge contributes 0.5 * (I - Z_i * Z_j)
hamiltonian = 0.5 * (spin.i(0) - spin.z(0) * spin.z(1))
# TODO: Add the other two edges

@cudaq.kernel
def qaoa_triangle(gamma: float, beta: float):
    q = cudaq.qvector(3)
    # TODO: Initial superposition (H on all qubits)

    # TODO: Cost layer — ZZ interaction for each edge
    # Pattern: cx, rz(2*gamma), cx

    # TODO: Mixer layer — rx(2*beta) on all qubits
    pass

# TODO: Set up COBYLA optimizer and find minimum energy
# Print the optimal parameters and MaxCut value`,
        framework: 'cuda-q',
        expectedProbabilities: {},
        expectedMeasurements: {},
        tolerancePercent: 15,
        hints: [
          'The full Hamiltonian is: 0.5*(I - Z₀Z₁) + 0.5*(I - Z₁Z₂) + 0.5*(I - Z₀Z₂). The negated energy gives the MaxCut value.',
          'For each ZZ edge, use: cx(q[i], q[j]), rz(2*gamma, q[j]), cx(q[i], q[j]).',
          'The maximum cut of a triangle is 2. Your optimizer should find an energy near -2.0.',
        ],
        successMessage:
          'You ran QAOA on a triangle graph using CUDA-Q optimizers. The MaxCut value of 2 means any bipartition cuts 2 of the 3 edges — you cannot cut all 3 because the graph has an odd cycle. This is the power of QAOA: encoding combinatorial structure into quantum phases.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '11.5-q1',
            question: 'Why might COBYLA be preferred over L-BFGS for optimizing quantum circuits on real hardware?',
            options: [
              'COBYLA runs on GPUs while L-BFGS runs on CPUs',
              'COBYLA does not require gradients, which are expensive and noisy on quantum hardware',
              'L-BFGS cannot optimize more than 2 parameters',
              'COBYLA always finds the global minimum',
            ],
            correctIndex: 1,
            explanation:
              'COBYLA is derivative-free — it does not need gradient evaluations, which require extra circuit runs and are corrupted by hardware noise. On real quantum hardware, gradient-free optimizers are often more practical despite slower convergence.',
          },
        ],
      },
    ],
  },

  // ── Lesson 11.6 ──
  {
    id: '11.6',
    title: 'cuQuantum SDK Deep Dive',
    description:
      'Low-level SDK components, integration with other frameworks, and the future roadmap for GPU-accelerated quantum computing.',
    difficulty: 'advanced',
    estimatedMinutes: 20,
    prerequisites: ['11.2', '11.4'],
    tags: ['cuquantum', 'sdk', 'integration', 'cirq', 'qiskit', 'pennylane', 'roadmap', 'nvidia'],
    diracContext:
      'The student has used CUDA-Q at the high level. Now peel back the layer: cuQuantum is the SDK underneath, and it can accelerate other frameworks too — Qiskit Aer can use cuStateVec, Cirq can use cuTensorNet, PennyLane has an NVIDIA plugin. Also discuss the roadmap: quantum error correction simulation, hardware integration, and the convergence of HPC and quantum. This lesson is about the bigger picture.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Under the Hood: cuQuantum

CUDA-Q is the programming model. **cuQuantum** is the SDK powering it. But cuQuantum is not exclusive to CUDA-Q — it accelerates quantum simulation across the ecosystem.

### SDK Components

| Component | Purpose | Used By |
|-----------|---------|---------|
| **cuStateVec** | GPU-accelerated state vector operations | CUDA-Q, Qiskit Aer, Cirq |
| **cuTensorNet** | GPU-accelerated tensor network contraction | CUDA-Q, Cirq, cuTensorNet Python |
| **cuDensityMat** | Density matrix simulation (noisy circuits) | CUDA-Q, research tools |

### Framework Integration

The same GPU acceleration works across frameworks:

**Qiskit + cuStateVec:**
\`\`\`python
from qiskit_aer import AerSimulator
sim = AerSimulator(
    method='statevector',
    device='GPU',
    cuStateVec_enable=True
)
\`\`\`

**Cirq + cuTensorNet:**
\`\`\`python
import cirq
import cuquantum
# Use cuTensorNet for tensor network contraction
simulator = cirq.DensityMatrixSimulator()
# Or use cuQuantum-backed simulators
\`\`\`

**PennyLane + NVIDIA:**
\`\`\`python
import pennylane as qml
dev = qml.device("lightning.gpu", wires=30)
\`\`\`

The message: **GPU acceleration is not locked to one framework**. Whatever you write in, NVIDIA GPUs can speed it up.`,
      },
      {
        type: 'concept-card',
        title: 'The cuQuantum Ecosystem',
        visual: 'custom-svg',
        explanation:
          'Application layer: CUDA-Q, Qiskit, Cirq, PennyLane, Braket. SDK layer: cuStateVec, cuTensorNet, cuDensityMat. Hardware layer: NVIDIA GPUs (A100, H100, B200). The SDK is the bridge — it provides optimized GPU primitives that any framework can call. Think of cuQuantum like cuBLAS for linear algebra: a foundational library that everything builds on.',
      },
      {
        type: 'demo',
        code: `import cudaq
from cudaq import spin

# Demonstrate the CUDA-Q + cuQuantum stack with a practical example:
# Compute the ground state energy of a simple molecular Hamiltonian
# H2 molecule at equilibrium bond distance (simplified)

# Molecular Hamiltonian (simplified H2 in STO-3G basis)
hamiltonian = (
    -0.4804 * spin.i(0) * spin.i(1)
    + 0.3435 * spin.i(0) * spin.z(1)
    - 0.4347 * spin.z(0) * spin.i(1)
    + 0.5716 * spin.z(0) * spin.z(1)
    + 0.0910 * spin.x(0) * spin.x(1)
    + 0.0910 * spin.y(0) * spin.y(1)
)

@cudaq.kernel
def h2_ansatz(theta: float):
    q = cudaq.qvector(2)
    x(q[0])
    ry(theta, q[1])
    cx(q[1], q[0])

# Optimize
optimizer = cudaq.optimizers.COBYLA()
optimizer.max_iterations = 100
optimizer.initial_parameters = [0.0]

def cost(params):
    return cudaq.observe(h2_ansatz, hamiltonian, params[0]).expectation()

energy, params = optimizer.optimize(dimensions=1, function=cost)

print("H2 Molecule Ground State (simplified)")
print(f"  Optimal theta: {params[0]:.4f}")
print(f"  Ground state energy: {energy:.6f} Hartree")
print(f"  Exact value: -1.1373 Hartree")
print(f"  Error: {abs(energy - (-1.1373)):.6f} Hartree")
print()
print("This runs on cuStateVec under the hood —")
print("the same GPU library that accelerates Qiskit and Cirq.")`,
        framework: 'cuda-q',
        description:
          'VQE for a simplified H2 molecule using the full CUDA-Q + cuQuantum stack. The same cuStateVec library powers this computation whether you use CUDA-Q, Qiskit, or Cirq.',
        explorationPrompt:
          'The simplified Hamiltonian has 6 terms. Real molecular Hamiltonians can have thousands. How would GPU acceleration help with larger molecules?',
      },
      {
        type: 'text',
        markdown: `## The Road Ahead

NVIDIA's quantum roadmap extends well beyond simulation:

### Near-Term (2025-2026)
- **Quantum Error Correction simulation** — simulate surface codes on GPUs to develop decoders before hardware is ready
- **Hybrid HPC+quantum** — integrate quantum kernels into existing GPU-accelerated HPC workflows
- **Hardware backends** — CUDA-Q already targets IonQ, Quantinuum, and OQC through cloud APIs

### Medium-Term (2026-2028)
- **DGX Quantum** — hybrid classical-quantum nodes with direct GPU-QPU interconnect
- **Distributed MQPU** — orchestrate multiple quantum processors from a single CUDA-Q program
- **Quantum-enhanced ML** — native integration with NVIDIA's AI stack

### Long-Term Vision
NVIDIA sees quantum computing as an extension of accelerated computing. The future is:

**GPU ↔ QPU integration:** The same program targets GPUs for classical parts and QPUs for quantum parts, with the runtime deciding which device executes each kernel.

### What This Means for You

If you learn CUDA-Q now, you are learning the programming model that will likely bridge simulation and real hardware. The kernel you write today for a GPU simulator is the same kernel that will run on tomorrow's QPU.

| Today (Simulation) | Tomorrow (Hardware) |
|--------------------|-------------------|
| \`cudaq.set_target("nvidia")\` | \`cudaq.set_target("ionq")\` |
| GPU runs the state vector | QPU runs the actual qubits |
| Same kernel code | Same kernel code |`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '11.6-q1',
            question: 'How can Qiskit users benefit from cuQuantum without switching to CUDA-Q?',
            options: [
              'They cannot — cuQuantum is exclusive to CUDA-Q',
              'Qiskit Aer can use cuStateVec as a GPU-accelerated backend',
              'They must rewrite all circuits in CUDA-Q syntax first',
              'cuQuantum only works with Cirq',
            ],
            correctIndex: 1,
            explanation:
              'cuQuantum provides GPU-accelerated simulation libraries (cuStateVec, cuTensorNet) that multiple frameworks integrate. Qiskit Aer supports cuStateVec as a backend — you enable it with device="GPU" and cuStateVec_enable=True.',
          },
          {
            id: '11.6-q2',
            question: 'What is NVIDIA\'s long-term vision for quantum computing?',
            options: [
              'Replace GPUs entirely with quantum processors',
              'Build quantum computers from photonic GPUs',
              'Integrate GPU and QPU execution under a unified programming model where the runtime dispatches to the best device',
              'Abandon quantum computing in favor of neuromorphic chips',
            ],
            correctIndex: 2,
            explanation:
              'NVIDIA envisions GPU-QPU hybrid computing: a unified programming model (CUDA-Q) where the same kernel can target GPUs for simulation or QPUs for real hardware. The runtime handles dispatch — the programmer writes the algorithm once.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The Full Stack',
        visual: 'circuit',
        explanation:
          'You have now seen the full CUDA-Q stack: kernel programming (11.1) → GPU simulation (11.2) → hybrid loops (11.3) → multi-GPU scaling (11.4) → optimization (11.5) → ecosystem integration (11.6). This stack bridges today\'s simulators and tomorrow\'s quantum hardware — with your kernel code unchanged.',
      },
    ],
  },
];
