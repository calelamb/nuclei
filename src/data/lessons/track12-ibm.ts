import type { Lesson } from './types';

export const TRACK12_LESSONS: Lesson[] = [
  // ── Lesson 12.1 ──
  {
    id: '12.1',
    title: 'IBM Quantum Hardware Access',
    description:
      'The IBM Quantum platform, real backends, job queues, and credits. Construct your first circuit and simulate it with Qiskit Aer.',
    difficulty: 'beginner',
    estimatedMinutes: 20,
    prerequisites: ['1.1'],
    tags: ['ibm', 'qiskit', 'hardware', 'aer', 'backends', 'jobs', 'credits'],
    diracContext:
      'This is the student\'s gateway to real quantum hardware. They likely have only used simulators. Explain the IBM Quantum platform: free tier, credits, job queues, and backend properties (qubit count, connectivity, error rates). Keep the demo on Aer so they can run it locally — but explain what it would look like to target real hardware. Emphasize that real devices have noise, limited connectivity, and queue wait times.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Real Quantum Computers, Real Access

IBM operates the world's largest fleet of quantum computers, and they are accessible through the cloud. The **IBM Quantum** platform gives researchers and students access to real superconducting processors — from 5 qubits to 1000+.

### The Platform

| Component | What It Does |
|-----------|-------------|
| **IBM Quantum** | Cloud platform — manage jobs, view backends, monitor results |
| **Qiskit** | Open-source SDK — build circuits, transpile, execute |
| **Qiskit Runtime** | Cloud execution environment — optimized primitives for real hardware |
| **Qiskit Aer** | Local simulator — test circuits before using real hardware |

### How Real Hardware Differs from Simulators

| Property | Simulator | Real Hardware |
|----------|-----------|--------------|
| **Noise** | None (unless added) | Always present — gate errors, decoherence, readout errors |
| **Connectivity** | All-to-all | Limited — only adjacent qubits can interact directly |
| **Speed** | Instant | Queue wait + execution time (seconds to minutes) |
| **Cost** | Free | Credits (free tier: 10 minutes/month of QPU time) |
| **Qubit count** | ~30 on laptop | 127–1000+ on IBM hardware |

### Backend Properties

Every IBM backend publishes its specifications:
- **Qubit count** and **coupling map** (which qubits connect)
- **Gate fidelities** (how accurate each gate is — typically 99%+ for single-qubit, 98–99.5% for two-qubit)
- **T₁ and T₂ times** (coherence — how long qubits hold information)
- **Readout fidelity** (measurement accuracy)`,
      },
      {
        type: 'concept-card',
        title: 'IBM Quantum Coupling Map',
        visual: 'circuit',
        explanation:
          'On a 127-qubit Eagle processor, qubits are arranged in a heavy-hex lattice. Each qubit connects to at most 3 neighbors. To run a CNOT between non-adjacent qubits, the transpiler inserts SWAP gates — each SWAP costs 3 additional CNOTs. This is why connectivity matters: deeper circuits mean more noise.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

# Build a Bell state — the same circuit you would run on real IBM hardware
qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])

# Simulate locally with Aer (no credits needed)
sim = AerSimulator()
result = sim.run(qc, shots=4096).result()
counts = result.get_counts()

print("Bell State — Ideal Simulation (Aer):")
for state, count in sorted(counts.items()):
    print(f"  |{state}⟩: {count} ({100*count/4096:.1f}%)")
print()
print("On a real IBM backend, you would see:")
print("  - Small populations in |01⟩ and |10⟩ (noise)")
print("  - Slightly unequal |00⟩ and |11⟩ (readout bias)")
print("  - The same circuit, but with nature's imperfections")`,
        framework: 'qiskit',
        description:
          'A Bell state simulated on Aer. On real hardware, noise would smear the clean 50/50 split. This is your baseline — compare it to real device runs later.',
        explorationPrompt:
          'Try adding noise_model to AerSimulator (like the hardware track demos). How much does even 1% depolarizing error change the results?',
      },
      {
        type: 'text',
        markdown: `## Targeting Real Hardware

When you are ready to run on a real backend:

\`\`\`python
from qiskit_ibm_runtime import QiskitRuntimeService

# One-time setup: save your API token
QiskitRuntimeService.save_account(
    channel='ibm_quantum',
    token='YOUR_API_TOKEN'
)

# Connect and list available backends
service = QiskitRuntimeService()
backends = service.backends()
for b in backends:
    print(f"{b.name}: {b.num_qubits} qubits, status={b.status().status_msg}")
\`\`\`

### Choosing a Backend

- **Least busy:** \`service.least_busy(min_num_qubits=5)\`
- **Best for your circuit:** Consider qubit count, connectivity, and error rates
- **Simulators:** \`ibmq_qasm_simulator\` for testing before hardware

### Credits and Fair Use

IBM provides free credits each month. A typical small circuit (~100 shots) uses seconds of QPU time. Plan your experiments — queues can be 1–30 minutes during peak hours.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '12.1-q1',
            question: 'Why does limited qubit connectivity on IBM hardware matter?',
            options: [
              'It prevents you from using Hadamard gates',
              'Non-adjacent CNOT gates require SWAP insertions, increasing circuit depth and noise',
              'Connectivity only matters for circuits with more than 100 qubits',
              'Limited connectivity makes circuits run faster',
            ],
            correctIndex: 1,
            explanation:
              'IBM processors have nearest-neighbor connectivity (heavy-hex lattice). A CNOT between non-adjacent qubits requires SWAP gates (each = 3 CNOTs), which increases depth and accumulates noise. The transpiler handles this automatically, but the cost is real.',
          },
          {
            id: '12.1-q2',
            question: 'What is Qiskit Aer used for?',
            options: [
              'Sending jobs to real IBM quantum hardware',
              'Managing IBM Quantum credits and billing',
              'Local classical simulation of quantum circuits, optionally with noise models',
              'Designing quantum chip layouts',
            ],
            correctIndex: 2,
            explanation:
              'Qiskit Aer is a high-performance local simulator. It runs quantum circuits on your own computer — perfect for development and testing before spending credits on real hardware. It supports ideal simulation and configurable noise models.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'From Simulator to Hardware',
        visual: 'circuit',
        explanation:
          'The workflow: (1) Build circuit in Qiskit. (2) Test on Aer locally — fast, free, ideal. (3) Add noise model to Aer — estimate hardware behavior. (4) Transpile for target backend — map to physical qubits. (5) Submit to IBM Quantum — real execution. (6) Compare ideal vs noisy vs real results.',
      },
    ],
  },

  // ── Lesson 12.2 ──
  {
    id: '12.2',
    title: 'Qiskit Runtime & Sessions',
    description:
      'Qiskit Runtime, Sessions for iterative algorithms, and the Sampler and Estimator primitives. The modern way to execute on IBM hardware.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['12.1'],
    tags: ['runtime', 'sessions', 'sampler', 'estimator', 'primitives', 'qiskit-runtime'],
    diracContext:
      'The student knows basic Qiskit circuit construction. Now introduce the modern execution model: Qiskit Runtime provides Sampler and Estimator as high-level primitives. Sessions keep a persistent connection to hardware for iterative algorithms (VQE, QAOA). Explain WHY primitives are better: they handle transpilation, error suppression, and result formatting. The demo should use Sampler on Aer so it runs locally.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Beyond circuit.run()

Early Qiskit workflows looked like: build circuit → transpile → submit job → get counts. The modern approach uses **primitives** — higher-level abstractions that handle optimization, error suppression, and result formatting.

### The Two Primitives

| Primitive | Input | Output | Use Case |
|-----------|-------|--------|----------|
| **Sampler** | Circuit(s) | Quasi-probability distributions | Sampling bitstrings, combinatorial optimization |
| **Estimator** | Circuit(s) + Observable(s) | Expectation values | VQE, molecular energy, operator measurements |

### Why Primitives?

- **Automatic transpilation** — optimized for the target backend
- **Error suppression** — built-in techniques like dynamical decoupling and twirled readout
- **Batching** — submit many circuits efficiently
- **Portable** — same API for simulators and real hardware

### Sessions

A **Session** is a persistent connection to a backend. Instead of queueing each job separately, a session reserves the device:

\`\`\`python
with Session(backend=backend) as session:
    estimator = Estimator(session=session)
    # All observe calls run on the same device
    # without re-queueing between iterations
    for params in optimization_loop:
        result = estimator.run(circuits, observables, params)
\`\`\`

This matters for variational algorithms: VQE might need 100+ iterations. Without sessions, each iteration waits in the queue. With sessions, they execute back-to-back.`,
      },
      {
        type: 'concept-card',
        title: 'Primitives vs Legacy Execution',
        visual: 'circuit',
        explanation:
          'Legacy: build → transpile → execute → get_counts() → manually compute expectation values. Primitives: build → Estimator.run(circuit, observable) → get expectation value directly. The primitive handles transpilation, error suppression, and result processing. Less code, better results.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler

# Build a parameterized circuit
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.measure_all()

# Use the Sampler primitive (local statevector-based)
sampler = StatevectorSampler()

# Run with shots
job = sampler.run([qc], shots=4096)
result = job.result()

# Access the quasi-probability distribution
pub_result = result[0]
counts = pub_result.data.meas.get_counts()

print("Sampler Primitive Results:")
for state, count in sorted(counts.items()):
    print(f"  |{state}⟩: {count} ({100*count/4096:.1f}%)")
print()
print("The Sampler handles everything:")
print("  - Circuit optimization")
print("  - Measurement formatting")
print("  - Error suppression (on real hardware)")`,
        framework: 'qiskit',
        description:
          'The Sampler primitive executing a Bell state. On real hardware, the same API adds error suppression automatically. StatevectorSampler is the local equivalent for testing.',
        explorationPrompt:
          'Try creating a 3-qubit GHZ state and sampling it. How does the Sampler output format compare to the old backend.run() approach?',
      },
      {
        type: 'text',
        markdown: `## The Estimator Primitive

While Sampler returns measurement distributions, **Estimator** computes expectation values — essential for variational algorithms:

\`\`\`python
from qiskit.primitives import StatevectorEstimator
from qiskit.quantum_info import SparsePauliOp

# Circuit that prepares a state
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)

# Observable: ZZ + 0.5*XX
observable = SparsePauliOp.from_list([
    ("ZZ", 1.0),
    ("XX", 0.5)
])

estimator = StatevectorEstimator()
job = estimator.run([(qc, observable)])
result = job.result()
print(f"⟨ZZ + 0.5*XX⟩ = {result[0].data.evs[0]:.4f}")
\`\`\`

### Session Workflow for VQE

\`\`\`python
from qiskit_ibm_runtime import Session, EstimatorV2

with Session(backend=backend) as session:
    estimator = EstimatorV2(session=session)

    for iteration in range(max_iterations):
        # Bind parameters and compute energy
        bound_circuit = ansatz.assign_parameters(current_params)
        job = estimator.run([(bound_circuit, hamiltonian)])
        energy = job.result()[0].data.evs[0]

        # Classical optimizer updates params
        current_params = optimizer.step(energy, current_params)
\`\`\`

The session keeps you on the same physical qubits across iterations — no re-queueing, no recalibration between steps.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '12.2-q1',
            question: 'What is the main advantage of using Qiskit Runtime Sessions for VQE?',
            options: [
              'Sessions make circuits run without noise',
              'Sessions keep a persistent connection to the backend, avoiding re-queueing between iterations',
              'Sessions double the number of available qubits',
              'Sessions are required for circuits with more than 10 qubits',
            ],
            correctIndex: 1,
            explanation:
              'VQE requires many iterative calls to the quantum backend. Without sessions, each iteration waits in the job queue. Sessions reserve the device, enabling back-to-back execution — critical for algorithms with 50–200 iterations.',
          },
          {
            id: '12.2-q2',
            question: 'When would you use Estimator instead of Sampler?',
            options: [
              'When you need bitstring samples for combinatorial optimization',
              'When you need expectation values of observables, like molecular energies in VQE',
              'Estimator and Sampler are interchangeable',
              'Estimator is only for error mitigation',
            ],
            correctIndex: 1,
            explanation:
              'Sampler returns measurement distributions (bitstrings and counts). Estimator returns expectation values ⟨ψ|O|ψ⟩. For VQE, QAOA with energy cost functions, or any algorithm that needs operator expectation values, Estimator is the right primitive.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The Primitives Ecosystem',
        visual: 'custom-svg',
        explanation:
          'Sampler: circuit → bitstring distribution. Estimator: circuit + observable → expectation value. Both run locally (StatevectorSampler/StatevectorEstimator) or on IBM hardware (through Qiskit Runtime). Same API, different backends — write once, run anywhere.',
      },
    ],
  },

  // ── Lesson 12.3 ──
  {
    id: '12.3',
    title: 'Error Mitigation Techniques',
    description:
      'Zero-noise extrapolation, probabilistic error cancellation, and twirled readout error extinction. Practical techniques for extracting signal from noisy hardware.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['12.1'],
    tags: ['error-mitigation', 'ZNE', 'PEC', 'TREX', 'noise', 'readout-error', 'resilience'],
    diracContext:
      'The student knows real hardware is noisy from 12.1. Now introduce practical mitigation — techniques that reduce the EFFECT of noise without full error correction. These are the NISQ-era workaround. Start with the simplest: readout error mitigation. Then ZNE (amplify noise, extrapolate to zero). Then PEC (cancel errors with extra circuits). Keep the math light — focus on intuition. The demo should show readout mitigation on a noisy Aer simulation.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Noise Is Not Defeat

Real quantum hardware produces noisy results. But noise is not random — it has **structure** that we can exploit. Error mitigation techniques extract better answers from noisy data, without the overhead of full quantum error correction.

### The Mitigation Toolbox

| Technique | Idea | Overhead | When to Use |
|-----------|------|----------|-------------|
| **Readout Error Mitigation** | Calibrate and invert measurement errors | Low (~2x shots) | Always — measurements are the noisiest part |
| **Zero-Noise Extrapolation (ZNE)** | Amplify noise intentionally, extrapolate to zero noise | Medium (~3–5x circuits) | Expectation values, smooth dependence on noise |
| **Twirled Readout (TREX)** | Randomize readout basis, average out bias | Low (~2x shots) | Readout-dominated errors |
| **Probabilistic Error Cancellation (PEC)** | Cancel gate errors with inverse operations | High (~100x+ shots) | Highest accuracy, small circuits |

### Readout Errors: The Low-Hanging Fruit

Measurement is the noisiest operation. A qubit in |0⟩ might be read as |1⟩ with 1–5% probability. This is a classical error — it happens AFTER the quantum computation.

**Calibration matrix approach:**
1. Prepare |00...0⟩, measure → learn P(read 1 | true 0)
2. Prepare |11...1⟩, measure → learn P(read 0 | true 1)
3. Build a confusion matrix
4. Invert it to correct your results

\`\`\`
True state    Measured
|0⟩     →     98% |0⟩, 2% |1⟩
|1⟩     →     3% |0⟩, 97% |1⟩
\`\`\`

By measuring how the detector misbehaves, you can mathematically undo the error.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, ReadoutError
import numpy as np

# Build a GHZ state (ideal: 50% |000⟩, 50% |111⟩)
qc = QuantumCircuit(3, 3)
qc.h(0)
qc.cx(0, 1)
qc.cx(1, 2)
qc.measure([0, 1, 2], [0, 1, 2])

# Add realistic readout errors (5% misread rate)
noise = NoiseModel()
p0_given1 = 0.05  # P(measure 0 | true state is 1)
p1_given0 = 0.03  # P(measure 1 | true state is 0)
readout_error = ReadoutError([[1 - p1_given0, p1_given0],
                               [p0_given1, 1 - p0_given1]])
noise.add_all_qubit_readout_error(readout_error)

# Run with noise
sim = AerSimulator(noise_model=noise)
noisy_result = sim.run(qc, shots=10000).result()
noisy_counts = noisy_result.get_counts()

# Simple readout mitigation: calibration
cal_circuits = []
for state in ['000', '111']:
    cal_qc = QuantumCircuit(3, 3)
    for i, bit in enumerate(reversed(state)):
        if bit == '1':
            cal_qc.x(i)
    cal_qc.measure([0, 1, 2], [0, 1, 2])
    cal_circuits.append(cal_qc)

# Run calibration circuits
cal_results = [sim.run(c, shots=5000).result().get_counts() for c in cal_circuits]

print("=== Noisy Results (uncorrected) ===")
for state, count in sorted(noisy_counts.items(), key=lambda x: -x[1])[:5]:
    print(f"  |{state}⟩: {count} ({100*count/10000:.1f}%)")

print()
print("=== Calibration Data ===")
print(f"  Prepared |000⟩, measured: {cal_results[0]}")
print(f"  Prepared |111⟩, measured: {cal_results[1]}")
print()
print("Readout errors cause ~8-14% of results to be wrong states.")
print("With mitigation, we can correct back toward the ideal 50/50 split.")`,
        framework: 'qiskit',
        description:
          'A GHZ state with realistic readout noise. The calibration circuits measure how the detector misbehaves, enabling correction. Notice the spurious states in the noisy output.',
        explorationPrompt:
          'Increase the readout error to 10%. How much worse do the results get? At what error rate does the GHZ signal become unrecoverable?',
      },
      {
        type: 'text',
        markdown: `## Zero-Noise Extrapolation (ZNE)

The most elegant trick in error mitigation:

1. Run your circuit at the **base noise level** → get result R₁
2. **Amplify the noise** (stretch gate durations or insert identity pairs) → get result R₂ at 2x noise
3. Optionally run at 3x noise → get R₃
4. **Extrapolate to zero noise** by fitting a curve through R₁, R₂, R₃

If the expectation value degrades linearly with noise:
> E(noise=0) ≈ 2·R₁ - R₂ (linear extrapolation)

### How to Amplify Noise

**Gate folding:** Replace each gate U with U·U†·U (same logical operation, 3x the noise):
\`\`\`
U → U·U†·U    (1-fold: 3x noise)
U → U·U†·U·U†·U  (2-fold: 5x noise)
\`\`\`

The logical circuit is unchanged (U†·U = I), but the physical noise compounds.

### When ZNE Works

- Expectation values that vary smoothly with noise
- Moderate noise levels (not too close to completely random)
- Gate errors dominate over readout errors

### When ZNE Fails

- Non-linear noise dependence (crosstalk, correlated errors)
- Very deep circuits where all signal is already destroyed
- Discrete observables (bitstring probabilities) — use for expectation values instead`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '12.3-q1',
            question: 'How does Zero-Noise Extrapolation work?',
            options: [
              'It removes noise from the quantum hardware physically',
              'It runs the circuit at multiple noise levels and extrapolates to the zero-noise limit',
              'It adds extra qubits to encode error correction',
              'It repeats the measurement until noise averages out',
            ],
            correctIndex: 1,
            explanation:
              'ZNE intentionally amplifies noise (e.g., by gate folding), measures at multiple noise levels, then fits a curve and extrapolates back to zero noise. The key insight: you can INCREASE noise easily; ZNE uses that to ESTIMATE the noiseless result.',
          },
          {
            id: '12.3-q2',
            question: 'Why is readout error mitigation considered "low-hanging fruit"?',
            options: [
              'Readout errors are the largest error source and can be calibrated with simple classical post-processing',
              'Readout errors only affect circuits with more than 10 qubits',
              'Readout mitigation requires no additional circuit runs',
              'Readout errors are quantum effects that cannot be modeled classically',
            ],
            correctIndex: 0,
            explanation:
              'Measurement is typically the noisiest operation (1–5% error rate). Readout errors are CLASSICAL — they happen after the quantum state collapses. A simple calibration (prepare known states, measure confusion matrix, invert) corrects most of the error with minimal overhead.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Error Mitigation vs Error Correction',
        visual: 'circuit',
        explanation:
          'Error CORRECTION uses extra qubits and syndrome measurements to detect and fix errors during computation — requires large overhead (1000+ physical qubits per logical qubit). Error MITIGATION uses clever post-processing to reduce error effects in the final result — works with today\'s hardware, but cannot remove all error. Mitigation is the NISQ bridge until correction hardware is ready.',
      },
    ],
  },

  // ── Lesson 12.4 ──
  {
    id: '12.4',
    title: 'Transpilation & Optimization',
    description:
      'Transpiler passes, optimization levels 0–3, basis gate translation, and understanding the cost of circuit compilation.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['12.1'],
    tags: ['transpilation', 'optimization', 'basis-gates', 'routing', 'layout', 'swap', 'depth'],
    diracContext:
      'The student has built circuits but may not realize what happens between construction and execution. The transpiler is critical: it maps logical qubits to physical qubits, routes CNOTs through the connectivity graph, decomposes gates into the hardware basis set, and optimizes. Show the dramatic difference between optimization levels. The demo should transpile the same circuit at levels 0–3 and compare depth.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## What Happens Before Execution

When you submit a circuit to IBM hardware, the **transpiler** transforms it from your abstract description into something the physical device can actually run. This process has several stages:

### Transpilation Pipeline

| Stage | What It Does |
|-------|-------------|
| **1. Unrolling** | Decompose high-level gates (Toffoli, SWAP) into basis gates |
| **2. Layout** | Map logical qubits → physical qubits on the chip |
| **3. Routing** | Insert SWAPs so all two-qubit gates act on connected qubits |
| **4. Translation** | Convert to the hardware's basis gate set |
| **5. Optimization** | Cancel redundant gates, merge rotations, simplify |

### Basis Gates

IBM hardware natively supports a small set of gates:

| Gate | Description |
|------|------------|
| **ECR** (or CX) | Entangling gate (two-qubit basis) |
| **RZ(θ)** | Z-rotation (virtual — no physical cost) |
| **SX** | √X gate (π/2 rotation around X) |
| **X** | Pauli-X (bit flip) |
| **ID** | Identity (delay) |

Everything else — H, CZ, Toffoli, SWAP — is decomposed into these. A Hadamard becomes RZ(π/2)·SX·RZ(π/2). A Toffoli becomes ~6 CX gates.

### Optimization Levels

Qiskit provides four optimization levels (0–3):

| Level | Strategy | Speed | Quality |
|-------|----------|-------|---------|
| **0** | No optimization — just map and route | Fastest | Worst circuits |
| **1** | Light optimization — cancel adjacent inverses | Fast | Good default |
| **2** | Medium — commutation analysis, more passes | Medium | Better |
| **3** | Heavy — exhaustive search, multiple layouts | Slowest | Best circuits |`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit, transpile
from qiskit.providers.fake_provider import GenericBackendV2

# Build a circuit with high-level gates
qc = QuantumCircuit(4)
qc.h(0)
qc.cx(0, 1)
qc.cx(0, 2)
qc.cx(0, 3)
qc.barrier()
qc.h([1, 2, 3])
qc.ccx(1, 2, 3)  # Toffoli — decomposes into many CX gates

# Create a fake 5-qubit backend with limited connectivity
backend = GenericBackendV2(num_qubits=5)

print("=== Original Circuit ===")
print(f"  Gates: {qc.count_ops()}")
print(f"  Depth: {qc.depth()}")
print()

# Transpile at each optimization level
for level in range(4):
    transpiled = transpile(qc, backend=backend, optimization_level=level, seed_transpiler=42)
    ops = transpiled.count_ops()
    cx_count = ops.get('ecr', 0) + ops.get('cx', 0)
    print(f"=== Level {level} ===")
    print(f"  Depth: {transpiled.depth()}")
    print(f"  Two-qubit gates: {cx_count}")
    print(f"  Total gates: {sum(ops.values())}")
    print()

print("Higher optimization = fewer gates = less noise on real hardware")
print("But transpilation takes longer at higher levels")`,
        framework: 'qiskit',
        description:
          'The same circuit transpiled at optimization levels 0 through 3. Watch the two-qubit gate count drop dramatically — each eliminated CX means less noise on real hardware.',
        explorationPrompt:
          'Try adding more long-range CNOTs (e.g., cx(0, 4)). How many SWAPs does the transpiler insert at each level? The routing overhead can dominate.',
      },
      {
        type: 'text',
        markdown: `## Understanding the Cost

Every transpilation decision has consequences:

### SWAP Overhead

When the transpiler needs to route a CNOT between non-adjacent qubits, it inserts SWAP gates. Each SWAP = 3 CX gates. On a heavy-hex lattice, reaching a qubit 3 hops away costs 9 extra CX gates.

### Layout Matters

Different qubit mappings produce different circuits:

\`\`\`python
# Let the transpiler choose the best layout
transpile(qc, backend, optimization_level=3)

# Force a specific layout
transpile(qc, backend, initial_layout=[0, 1, 3, 5])
\`\`\`

At optimization level 3, Qiskit tries multiple layouts and picks the one with the fewest total gates.

### Practical Tips

1. **Design connectivity-aware circuits** — keep interacting qubits close
2. **Use optimization level 2 or 3** for real hardware runs
3. **Check transpiled depth** before submitting — if it exceeds ~100 layers, noise will dominate
4. **Use dynamic circuits** — mid-circuit measurement and classical feedback can replace some gates
5. **Profile before paying** — transpile locally, check the cost, then decide whether to submit`,
      },
      {
        type: 'exercise',
        id: '12.4-ex1',
        title: 'Optimize a Circuit for Hardware',
        description:
          'Build a 4-qubit circuit with a Toffoli gate and multiple long-range CNOTs. Transpile it at optimization level 3 for a 5-qubit backend. Report the original vs transpiled gate count and depth.',
        starterCode: `from qiskit import QuantumCircuit, transpile
from qiskit.providers.fake_provider import GenericBackendV2

# Build a circuit that is hard for the transpiler
qc = QuantumCircuit(4)
qc.h(0)
# TODO: Add a Toffoli (ccx) and at least 2 long-range CNOTs
# Example: qc.ccx(0, 1, 3) and qc.cx(0, 3)

# Create a backend
backend = GenericBackendV2(num_qubits=5)

# TODO: Transpile at level 3 and print:
# 1. Original depth and gate count
# 2. Transpiled depth and gate count
# 3. Number of two-qubit gates before and after`,
        framework: 'qiskit',
        expectedProbabilities: {},
        expectedMeasurements: {},
        tolerancePercent: 15,
        hints: [
          'Use qc.count_ops() to see the gate breakdown and qc.depth() for circuit depth.',
          'After transpilation, count the "ecr" or "cx" entries in count_ops() — these are the expensive two-qubit gates.',
          'A Toffoli decomposes into ~6 CX gates. Long-range CNOTs add SWAP overhead. Your transpiled circuit will be much larger than the original.',
        ],
        successMessage:
          'You now understand the hidden cost of transpilation. On real hardware, circuit depth after transpilation determines whether your result will be signal or noise. Always check transpiled depth before submitting.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '12.4-q1',
            question: 'Why is RZ(θ) "free" on IBM hardware?',
            options: [
              'IBM hardware skips RZ gates entirely',
              'RZ is implemented as a virtual gate — a phase change in the reference frame of subsequent pulses, requiring no physical operation',
              'RZ gates have zero error by coincidence',
              'RZ is the only gate that does not need calibration',
            ],
            correctIndex: 1,
            explanation:
              'On superconducting hardware, RZ is a "virtual gate" — implemented by shifting the phase of subsequent microwave pulses. No physical operation is applied to the qubit, so it takes zero time and introduces zero error. This is why the transpiler decomposes many gates using RZ freely.',
          },
          {
            id: '12.4-q2',
            question: 'What does optimization level 3 do differently from level 1?',
            options: [
              'Level 3 uses a different programming language',
              'Level 3 tries multiple qubit layouts, uses commutation analysis, and runs more optimization passes to minimize gate count',
              'Level 3 only works on circuits with fewer than 5 qubits',
              'Level 3 adds extra error correction gates',
            ],
            correctIndex: 1,
            explanation:
              'Level 3 performs exhaustive layout search (trying many qubit-to-physical mappings), advanced gate cancellation using commutation relations, and multiple optimization passes. It takes longer to compile but produces shorter, lower-noise circuits.',
          },
        ],
      },
    ],
  },

  // ── Lesson 12.5 ──
  {
    id: '12.5',
    title: 'Pulse-Level Control',
    description:
      'Qiskit Pulse for microwave control, custom gate calibration, and pulse schedules. Program the hardware at the lowest level.',
    difficulty: 'advanced',
    estimatedMinutes: 20,
    prerequisites: ['12.4'],
    tags: ['pulse', 'microwave', 'calibration', 'drag', 'gaussian', 'drive-channel', 'qiskit-pulse'],
    diracContext:
      'The student understands gates and transpilation. Now go below gates to the physical layer: microwave pulses that drive superconducting qubits. Qiskit Pulse lets you define custom pulse shapes, calibrate gates, and experiment with control. This is advanced and conceptual — most students will not use it daily, but understanding it demystifies what gates actually ARE. Keep it visual: a Gaussian pulse envelope rotating the Bloch vector.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Below the Gate Level

Every gate you have used — H, X, CNOT — is ultimately a **microwave pulse** sent to a superconducting chip. Qiskit Pulse gives you direct control over these pulses.

### What Is a Pulse?

A shaped microwave signal (~5 GHz) that drives a qubit rotation. The pulse has:

| Parameter | Effect |
|-----------|--------|
| **Amplitude** | How fast the qubit rotates (Rabi frequency) |
| **Duration** | How long the pulse lasts (in dt units, ~0.222 ns each) |
| **Shape** | Gaussian, DRAG, square, or custom envelope |
| **Phase** | Determines the rotation axis on the Bloch sphere |
| **Frequency** | Must match the qubit's transition frequency |

### Channels

| Channel | Purpose |
|---------|---------|
| **DriveChannel(q)** | Single-qubit gates on qubit q |
| **ControlChannel(q)** | Cross-resonance drive for two-qubit gates |
| **MeasureChannel(q)** | Readout pulse |
| **AcquireChannel(q)** | Capture measurement signal |

### Why Pulse-Level Control?

- **Custom gates:** Define gates not in the standard set
- **Optimized calibration:** Tune pulse parameters for your specific qubits
- **Research:** Explore control theory, dynamical decoupling, quantum optimal control
- **Speed:** Hand-tuned pulses can be shorter than default calibrations`,
      },
      {
        type: 'concept-card',
        title: 'Pulse Shapes: Gaussian vs DRAG',
        visual: 'custom-svg',
        explanation:
          'A Gaussian pulse is the simplest shape — smooth on/off prevents spectral leakage. But Gaussian pulses can excite the |2⟩ level (leakage). The DRAG (Derivative Removal by Adiabatic Gate) correction adds a derivative component on the Y quadrature that suppresses leakage. Most IBM backends use DRAG pulses by default for single-qubit gates.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.circuit import Gate
from qiskit_aer import AerSimulator
import numpy as np

# We will demonstrate the concept of custom gates
# by creating a parameterized rotation gate

# Custom gate: rotation by arbitrary angle around arbitrary axis
# This is what pulse-level calibration achieves — precise control

# Create a custom unitary gate (simulating what a pulse achieves)
theta = np.pi / 3  # 60-degree rotation
phi = np.pi / 4    # axis between X and Y

# Build the unitary matrix for R_n(theta) where n is in XY plane
cos_t = np.cos(theta / 2)
sin_t = np.sin(theta / 2)
unitary = np.array([
    [cos_t, -sin_t * np.exp(1j * phi)],
    [sin_t * np.exp(-1j * phi), cos_t]
])

custom_gate = Gate('custom_pulse', 1, [theta, phi])

qc = QuantumCircuit(1, 1)
qc.append(custom_gate, [0])
qc.measure(0, 0)

# On real hardware, this custom gate would be a calibrated pulse
# On simulator, we use the unitary directly
sim = AerSimulator()
from qiskit.quantum_info import Operator
qc_sim = QuantumCircuit(1, 1)
qc_sim.unitary(Operator(unitary), [0])
qc_sim.measure(0, 0)

result = sim.run(qc_sim, shots=4096).result()
counts = result.get_counts()

print("Custom Gate (simulating pulse-level control):")
print(f"  Rotation: {np.degrees(theta):.1f} degrees")
print(f"  Axis angle: {np.degrees(phi):.1f} degrees from X in XY plane")
print()
for state, count in sorted(counts.items()):
    print(f"  |{state}⟩: {count} ({100*count/4096:.1f}%)")
print()
print("On real hardware, this would be a shaped microwave pulse:")
print(f"  - Gaussian envelope, ~50 ns duration")
print(f"  - Amplitude calibrated for {np.degrees(theta):.1f}-degree rotation")
print(f"  - Phase set to {np.degrees(phi):.1f} degrees")`,
        framework: 'qiskit',
        description:
          'A custom rotation gate simulating what pulse-level calibration achieves. On real hardware, this is a shaped microwave pulse with calibrated amplitude, duration, and phase.',
        explorationPrompt:
          'Change theta and phi. Notice how the measurement probabilities change — you are directly controlling the Bloch sphere rotation axis and angle, just like a microwave pulse does physically.',
      },
      {
        type: 'text',
        markdown: `## Pulse Schedules

A pulse schedule defines exactly what happens on each channel over time:

\`\`\`python
from qiskit import pulse

with pulse.build(backend) as schedule:
    # Drive channel for qubit 0
    drive_chan = pulse.drive_channel(0)

    # Gaussian pulse: X gate calibration
    pulse.play(
        pulse.Gaussian(
            duration=160,     # ~35 ns
            amp=0.5,          # Calibrated amplitude for π rotation
            sigma=40          # Gaussian width
        ),
        drive_chan
    )
\`\`\`

### DRAG Pulse (Standard for IBM)

\`\`\`python
pulse.play(
    pulse.Drag(
        duration=160,
        amp=0.5,
        sigma=40,
        beta=0.2    # DRAG correction parameter
    ),
    drive_chan
)
\`\`\`

### The Calibration Loop

Custom pulses require calibration:
1. **Rabi experiment** — sweep amplitude to find π rotation
2. **Ramsey experiment** — measure frequency detuning
3. **DRAG calibration** — sweep beta to minimize leakage
4. **Randomized benchmarking** — verify gate fidelity

This is the domain of quantum hardware engineers, but understanding it connects software gates to physical reality.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '12.5-q1',
            question: 'What problem does the DRAG pulse correction solve?',
            options: [
              'DRAG reduces readout errors',
              'DRAG suppresses leakage to the |2⟩ level during fast single-qubit gates',
              'DRAG increases the qubit coherence time',
              'DRAG enables two-qubit gates between non-adjacent qubits',
            ],
            correctIndex: 1,
            explanation:
              'Transmon qubits are not perfect two-level systems — they have a |2⟩ level nearby. Fast Gaussian pulses can excite this level (leakage). DRAG adds a derivative component to the pulse that destructively interferes with the leakage pathway, keeping the qubit in the {|0⟩, |1⟩} subspace.',
          },
          {
            id: '12.5-q2',
            question: 'What determines the rotation axis on the Bloch sphere for a microwave pulse?',
            options: [
              'The qubit temperature',
              'The phase of the microwave drive signal',
              'The number of qubits on the chip',
              'The measurement channel frequency',
            ],
            correctIndex: 1,
            explanation:
              'The phase of the microwave pulse determines which axis in the XY plane the qubit rotates around. Phase = 0 rotates around X, phase = π/2 rotates around Y. This is why RZ gates are "virtual" — you just shift the phase reference of subsequent pulses.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Gates Are Just Pulses',
        visual: 'bloch',
        explanation:
          'An X gate is a Gaussian/DRAG pulse at phase 0 with amplitude calibrated for π rotation. A Y gate is the same pulse at phase π/2. An H gate is a composite: RZ(π/2) + SX + RZ(π/2), where each component is either a virtual phase change or a physical pulse. Understanding this connects code to physics.',
      },
    ],
  },

  // ── Lesson 12.6 ──
  {
    id: '12.6',
    title: 'Circuit Knitting',
    description:
      'Breaking large circuits into smaller sub-circuits that fit on available hardware. Wire cutting, gate cutting, and running beyond device limits.',
    difficulty: 'advanced',
    estimatedMinutes: 20,
    prerequisites: ['12.4'],
    tags: ['circuit-knitting', 'wire-cutting', 'gate-cutting', 'distributed', 'large-circuits', 'QPD'],
    diracContext:
      'The student understands transpilation and hardware limitations. Circuit knitting is the next frontier: when your circuit is too large for available hardware, CUT it into sub-circuits that fit, run them separately, and reconstruct the result classically. This has exponential overhead in the number of cuts, so it is practical only for a few cuts. The concept is powerful: it lets you run circuits larger than any single device. Keep the explanation at the intuition level — show WHY cutting works using the concept of quasi-probability decomposition.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## When Circuits Do Not Fit

You have a 100-qubit algorithm, but your best backend has 27 qubits. What do you do?

**Circuit knitting** breaks a large circuit into smaller **sub-circuits** that each fit on available hardware. The results are recombined classically to approximate the output of the full circuit.

### Two Types of Cuts

| Cut Type | What It Cuts | Overhead | Use Case |
|----------|-------------|----------|----------|
| **Wire cutting** | A qubit wire between gates | O(4ᵏ) per cut | Split a circuit horizontally |
| **Gate cutting** | A two-qubit gate (e.g., CNOT) | O(4ᵏ) per cut | Remove entangling links between partitions |

### How Wire Cutting Works

Imagine a circuit where qubit 3 has gates early and late, with nothing in between. You can **cut** that wire:

1. In the first sub-circuit, **measure** qubit 3 at the cut point
2. In the second sub-circuit, **prepare** qubit 3 in various states (|0⟩, |1⟩, |+⟩, |−⟩, |i⟩, |−i⟩)
3. Run all combinations
4. Recombine using **quasi-probability decomposition** (QPD)

The QPD formula weights the sub-circuit results (some with negative weights) to reconstruct the full circuit's output. The negative weights are why this is "quasi-probability" — individual terms can be negative, but the sum is correct.

### The Cost

Each wire cut multiplies the number of required sub-circuit runs by ~4. Two cuts: 16x. Three cuts: 64x. This exponential overhead limits practical knitting to **2–5 cuts**.`,
      },
      {
        type: 'concept-card',
        title: 'Wire Cutting Intuition',
        visual: 'circuit',
        explanation:
          'Think of wire cutting like a magic trick: you slice a qubit wire in half, run the two halves as separate circuits, and stitch the results back together. The trick works because you sample the cut point in a tomographically complete basis (6 states). The classical recombination reconstructs the quantum correlations that the cut destroyed — but at exponential sampling cost.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np

# Demonstrate the CONCEPT of circuit knitting
# Full circuit: 4 qubits, entangled across a partition

# === Full circuit (what we WANT to run) ===
full_qc = QuantumCircuit(4, 4)
full_qc.h(0)
full_qc.cx(0, 1)    # Partition A: qubits 0-1
full_qc.cx(1, 2)    # This CNOT crosses the partition boundary
full_qc.cx(2, 3)    # Partition B: qubits 2-3
full_qc.measure([0, 1, 2, 3], [0, 1, 2, 3])

sim = AerSimulator()
full_result = sim.run(full_qc, shots=10000).result()
full_counts = full_result.get_counts()

# === Sub-circuits (what we CAN run on small devices) ===
# Partition A: qubits 0-1 (measure qubit 1 at cut point)
sub_a = QuantumCircuit(2, 2)
sub_a.h(0)
sub_a.cx(0, 1)
sub_a.measure([0, 1], [0, 1])

# Partition B: qubits 2-3 (prepare qubit 2 in |0⟩ or |1⟩)
sub_b0 = QuantumCircuit(2, 2)  # qubit 2 starts in |0⟩
sub_b0.cx(0, 1)
sub_b0.measure([0, 1], [0, 1])

sub_b1 = QuantumCircuit(2, 2)  # qubit 2 starts in |1⟩
sub_b1.x(0)
sub_b1.cx(0, 1)
sub_b1.measure([0, 1], [0, 1])

result_a = sim.run(sub_a, shots=10000).result().get_counts()
result_b0 = sim.run(sub_b0, shots=10000).result().get_counts()
result_b1 = sim.run(sub_b1, shots=10000).result().get_counts()

print("=== Full Circuit (ideal) ===")
for state, count in sorted(full_counts.items(), key=lambda x: -x[1])[:4]:
    print(f"  |{state}⟩: {count} ({100*count/10000:.1f}%)")

print()
print("=== Sub-Circuit A (qubits 0-1) ===")
for state, count in sorted(result_a.items(), key=lambda x: -x[1]):
    print(f"  |{state}⟩: {count}")

print()
print("=== Sub-Circuit B (qubits 2-3, prepared in |0⟩) ===")
for state, count in sorted(result_b0.items(), key=lambda x: -x[1]):
    print(f"  |{state}⟩: {count}")

print()
print("=== Sub-Circuit B (qubits 2-3, prepared in |1⟩) ===")
for state, count in sorted(result_b1.items(), key=lambda x: -x[1]):
    print(f"  |{state}⟩: {count}")

print()
print("Full knitting recombines these with QPD weights.")
print("Each cut costs ~4x overhead in sampling budget.")`,
        framework: 'qiskit',
        description:
          'A conceptual demonstration of circuit knitting. The 4-qubit circuit is split into 2-qubit sub-circuits at the partition boundary. Full QPD recombination would reconstruct the original distribution.',
        explorationPrompt:
          'The sub-circuits only show |0⟩ and |1⟩ preparations. Full wire cutting also uses |+⟩, |−⟩, |i⟩, |−i⟩ — 6 preparations total. How does this connect to quantum state tomography?',
      },
      {
        type: 'text',
        markdown: `## Gate Cutting

Instead of cutting wires, you can cut **entangling gates** directly:

A CNOT gate can be decomposed into a sum of **local operations** (tensor products of single-qubit operations) with quasi-probability weights:

> CNOT ≈ Σᵢ wᵢ · (Aᵢ ⊗ Bᵢ)

Where Aᵢ acts on the control qubit and Bᵢ acts on the target. Some weights wᵢ are negative — this is the quasi-probability decomposition.

### When to Knit

| Scenario | Approach |
|----------|----------|
| Circuit barely exceeds device size | 1–2 wire cuts |
| Weak entanglement across partition | Gate cutting on sparse CNOT connections |
| Many cuts needed (> 5) | Overhead becomes impractical |
| Variational algorithms | Knit the observable estimation, not the full state |

### The Qiskit Circuit Knitting Toolbox

\`\`\`python
from qiskit_addon_cutting import (
    partition_problem,
    generate_cutting_experiments,
    reconstruct_expectation_values,
)
\`\`\`

The toolbox automates the process:
1. Define your circuit and partition
2. Generate the sub-circuit experiments
3. Run them on available backends
4. Reconstruct the result

### The Big Picture

Circuit knitting turns a **hardware limitation** into a **classical compute tradeoff**. You cannot run 100 qubits on a 27-qubit chip directly, but you can if you are willing to run 4ᵏ more sub-circuits. For small k (1–3 cuts), this is practical. For large k, the overhead dominates.

This is a bridge technology — useful NOW while hardware scales up, eventually unnecessary when 1000+ qubit devices are routine.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '12.6-q1',
            question: 'What is the main cost of circuit knitting?',
            options: [
              'Circuits become deeper after knitting',
              'Each cut requires exponentially more sub-circuit runs (O(4^k) for k cuts)',
              'Knitting only works on trapped ion hardware',
              'Knitted circuits cannot use entanglement',
            ],
            correctIndex: 1,
            explanation:
              'Each wire or gate cut multiplies the sampling cost by approximately 4x. For k cuts, the overhead is O(4^k). This exponential cost limits practical circuit knitting to a few cuts — but even 2–3 cuts can extend effective circuit size significantly.',
          },
          {
            id: '12.6-q2',
            question: 'Why does circuit knitting use negative weights in the recombination?',
            options: [
              'Negative weights cancel out hardware noise',
              'The quasi-probability decomposition of quantum channels requires non-positive weights to exactly reconstruct entangled states',
              'Negative weights reduce the number of required measurements',
              'This is a bug in the algorithm that future versions will fix',
            ],
            correctIndex: 1,
            explanation:
              'Quantum channels (like CNOT) cannot always be decomposed into positive mixtures of local operations — some weights must be negative. This is fundamental: entanglement is a non-local resource, and decomposing it into local pieces requires quasi-probability (negative weights). The sum is still correct.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The Hardware Scaling Timeline',
        visual: 'histogram',
        explanation:
          'IBM roadmap: 2023 — 1121 qubits (Condor). 2024 — modular architecture (Flamingo). 2025+ — 100,000 qubits via interconnected modules. Circuit knitting is the bridge between today\'s 100-qubit chips and tomorrow\'s million-qubit systems. As hardware scales, fewer cuts are needed, and eventually knitting becomes unnecessary.',
      },
    ],
  },
];
