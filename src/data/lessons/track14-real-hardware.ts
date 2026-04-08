import type { Lesson } from './types';

export const TRACK14_LESSONS: Lesson[] = [
  // ── Lesson 14.1 ──
  {
    id: '14.1',
    title: 'Simulator vs Real Device',
    description:
      'What changes when you go from simulation to real hardware? Noise, decoherence, limited connectivity, queue times, and how to prepare.',
    difficulty: 'beginner',
    estimatedMinutes: 15,
    prerequisites: ['1.1'],
    tags: ['hardware', 'simulator', 'noise', 'decoherence', 'connectivity', 'fake-backend', 'comparison'],
    diracContext:
      'This is a reality check lesson. Students have been using perfect simulators and now need to understand what breaks when they move to real QPUs. Be honest but not discouraging: real hardware is noisy and limited, but that is exactly why learning to work with it is valuable. The demo uses a Qiskit fake backend to simulate noisy hardware without needing real QPU access. Emphasize that "my simulation works perfectly" does NOT mean it will work on hardware.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Simulation Comfort Zone

Everything you have built so far runs on a **simulator** — a classical program that computes what a quantum computer *would* do, perfectly. No noise, no errors, no waiting.

Real quantum hardware is a different world:

| Property | Simulator | Real Hardware |
|----------|:---------:|:------------:|
| **Gate fidelity** | 100% (perfect) | 99–99.9% (errors accumulate) |
| **Qubit connectivity** | Any-to-any | Limited topology (grid, heavy-hex) |
| **Coherence** | Infinite | T₁ ~ 100–300 μs (gates must finish before decoherence) |
| **Measurement error** | 0% | 0.5–3% (wrong bit read out) |
| **SWAP overhead** | None | Extra gates needed for non-adjacent qubits |
| **Execution time** | Seconds (local) | Minutes to hours (queue) |
| **Cost** | Free | Free tier limited, paid beyond |

### Why Circuits Break on Hardware

A 20-qubit circuit with depth 50 might work perfectly in simulation but produce garbage on hardware. Why?

1. **Gate errors compound**: 50 layers × 0.5% error per gate ≈ 22% chance of *at least one error per qubit*
2. **SWAP insertion**: Non-adjacent CNOT requires 3 extra CNOTs (each with ~1% error)
3. **Decoherence**: If your circuit takes longer than T₂, superposition decays before measurement
4. **Crosstalk**: Driving one qubit can slightly disturb its neighbors
5. **Measurement errors**: Even if the state is correct, the readout can flip a bit`,
      },
      {
        type: 'text',
        markdown: `## The Transpiler: Your Circuit's Translator

Real chips do not support arbitrary gates between arbitrary qubits. A **transpiler** rewrites your circuit to:

1. **Decompose** high-level gates into the chip's native gate set (e.g., IBM uses CX, ID, RZ, SX, X)
2. **Route** qubits: insert SWAPs so every two-qubit gate acts on physically connected qubits
3. **Optimize** gate cancellations and simplifications to reduce total gate count

\`\`\`python
from qiskit import transpile

# Before transpilation: your clean logical circuit
# After transpilation: hardware-specific, SWAP-heavy, deeper circuit
hw_circuit = transpile(
    circuit,
    backend=backend,
    optimization_level=3  # 0-3, higher = more aggressive optimization
)

print(f"Original depth: {circuit.depth()}")
print(f"Transpiled depth: {hw_circuit.depth()}")
print(f"SWAP gates added: {hw_circuit.count_ops().get('swap', 0)}")
\`\`\`

The transpiled circuit is always deeper than the original. **Circuit depth after transpilation** is the real metric that determines whether your algorithm will survive on hardware.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error, thermal_relaxation_error

# Build a 3-qubit GHZ circuit
qc = QuantumCircuit(3, 3)
qc.h(0)
qc.cx(0, 1)
qc.cx(0, 2)
qc.measure([0, 1, 2], [0, 1, 2])

# --- Perfect simulation ---
ideal_sim = AerSimulator()
ideal_result = ideal_sim.run(qc, shots=4096).result()
ideal_counts = ideal_result.get_counts()

# --- Noisy simulation mimicking real hardware ---
noise = NoiseModel()

# Single-qubit gate error (~0.1%)
noise.add_all_qubit_quantum_error(
    depolarizing_error(0.001), ['h', 'x', 'sx', 'rz']
)

# Two-qubit gate error (~1%)
noise.add_all_qubit_quantum_error(
    depolarizing_error(0.01), ['cx']
)

# T1/T2 relaxation (approximate: T1=150μs, T2=100μs, gate_time=50ns)
t1, t2, gate_time = 150e3, 100e3, 50  # nanoseconds
thermal_err_1q = thermal_relaxation_error(t1, t2, gate_time)
thermal_err_2q = thermal_relaxation_error(t1, t2, gate_time * 6).tensor(
    thermal_relaxation_error(t1, t2, gate_time * 6)
)
noise.add_all_qubit_quantum_error(thermal_err_1q, ['h', 'x'])
noise.add_all_qubit_quantum_error(thermal_err_2q, ['cx'])

noisy_sim = AerSimulator(noise_model=noise)
noisy_result = noisy_sim.run(qc, shots=4096).result()
noisy_counts = noisy_result.get_counts()

print("=== Ideal Simulator ===")
for state in sorted(ideal_counts, key=ideal_counts.get, reverse=True)[:4]:
    pct = 100 * ideal_counts[state] / 4096
    print(f"  |{state}⟩: {ideal_counts[state]:>4} ({pct:.1f}%)")

print("\\n=== Noisy (Hardware-like) ===")
for state in sorted(noisy_counts, key=noisy_counts.get, reverse=True)[:6]:
    pct = 100 * noisy_counts[state] / 4096
    print(f"  |{state}⟩: {noisy_counts[state]:>4} ({pct:.1f}%)")

# Compare ideal vs noisy for |000⟩ and |111⟩
ideal_signal = ideal_counts.get('000', 0) + ideal_counts.get('111', 0)
noisy_signal = noisy_counts.get('000', 0) + noisy_counts.get('111', 0)
print(f"\\nSignal (|000⟩ + |111⟩):")
print(f"  Ideal: {ideal_signal}/4096 ({100*ideal_signal/4096:.1f}%)")
print(f"  Noisy: {noisy_signal}/4096 ({100*noisy_signal/4096:.1f}%)")`,
        framework: 'qiskit',
        description:
          'Run the same GHZ circuit on a perfect simulator and a noise model mimicking real superconducting hardware. Compare how noise degrades the output.',
        explorationPrompt:
          'Try increasing the CX depolarizing error from 0.01 to 0.05. At what point does the GHZ signal drop below 50%? What happens if you add a fourth qubit?',
      },
      {
        type: 'exercise',
        id: '14.1-ex1',
        title: 'Compare Ideal vs Noisy Bell State',
        description:
          'Build a Bell state circuit and run it on both a perfect simulator and a noisy simulator with depolarizing error of 0.02 on single-qubit gates and 0.05 on cx. Compare the results — the noisy version should still show |00⟩ and |11⟩ as dominant but with visible noise.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error

# Build Bell state
qc = QuantumCircuit(2, 2)
# TODO: Add H on qubit 0, CX from 0 to 1, measure both

# TODO: Run on ideal simulator (4096 shots)
# ideal_sim = AerSimulator()

# TODO: Build noise model
# noise = NoiseModel()
# Add depolarizing_error(0.02) for ['h', 'x'] gates
# Add depolarizing_error(0.05) for ['cx'] gates

# TODO: Run on noisy simulator (4096 shots)
# noisy_sim = AerSimulator(noise_model=noise)

# TODO: Print both results
`,
        framework: 'qiskit',
        expectedMeasurements: { '00': 1800, '11': 1800 },
        tolerancePercent: 20,
        hints: [
          'Build the circuit: qc.h(0), qc.cx(0, 1), qc.measure([0, 1], [0, 1]).',
          'For the noise model: noise.add_all_qubit_quantum_error(depolarizing_error(0.02), [\'h\', \'x\']).',
          'Pass noise_model=noise to AerSimulator() constructor.',
          'The noisy Bell state will leak ~5-10% of shots into |01⟩ and |10⟩.',
        ],
        successMessage:
          'You can now see the gap between simulation and reality. On actual hardware, the noise would be even more complex — including T₁ relaxation, crosstalk, and measurement errors on top of gate depolarization.',
      },
      {
        type: 'concept-card',
        title: 'The Hardware Reality Checklist',
        visual: 'circuit',
        explanation:
          'Before submitting to real hardware, ask: (1) What is the transpiled depth? If > 100, it probably will not work. (2) How many SWAPs were inserted? Each costs 3 CX gates. (3) Is the total circuit time within T₂? (4) Did you set optimization_level=3? (5) Can you reduce qubit count? Fewer qubits = less routing overhead.',
      },
    ],
  },

  // ── Lesson 14.2 ──
  {
    id: '14.2',
    title: 'Submitting Jobs & Queue Management',
    description:
      'How to submit quantum jobs to IBM, IonQ, and other providers. Queue times, job monitoring, result retrieval, and best practices.',
    difficulty: 'beginner',
    estimatedMinutes: 20,
    prerequisites: ['14.1'],
    tags: ['job-submission', 'IBM', 'IonQ', 'queue', 'cloud', 'API', 'runtime', 'monitoring'],
    diracContext:
      'This is a practical workflow lesson. Students need to understand the full lifecycle of running on real hardware: authenticate, select backend, transpile, submit, wait, retrieve, analyze. The demos are conceptual — showing the Qiskit Runtime pattern without requiring actual credentials. Emphasize that queue times can be hours on free plans and that students should batch work intelligently. Make the process feel approachable, not intimidating.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Cloud Quantum Workflow

Real quantum computers live in labs — you access them over the cloud. The workflow:

\`\`\`
Write code → Transpile → Submit job → Wait in queue → Execute → Retrieve results
\`\`\`

Every major provider follows this pattern, though APIs differ.

### Major Providers (2026)

| Provider | Hardware | SDK | Free Tier |
|----------|---------|-----|-----------|
| **IBM Quantum** | Superconducting (Eagle, Heron) | Qiskit Runtime | 10 min/month |
| **IonQ** | Trapped ion | Qiskit, Cirq, native API | Limited via AWS/Azure |
| **Google Quantum AI** | Superconducting (Willow) | Cirq | Research access only |
| **Quantinuum** | Trapped ion (H-series) | TKET, Qiskit, Cirq | Limited via Azure |
| **Amazon Braket** | Multi-provider (IonQ, Rigetti, OQC) | Braket SDK | Pay-per-shot |
| **Azure Quantum** | Multi-provider | Qiskit, Cirq, Q# | Free credits for students |

### Authentication

Each provider requires an API token:

\`\`\`python
# IBM Quantum (Qiskit Runtime)
from qiskit_ibm_runtime import QiskitRuntimeService
service = QiskitRuntimeService(channel="ibm_quantum", token="YOUR_TOKEN")

# Save token locally so you only authenticate once
QiskitRuntimeService.save_account(token="YOUR_TOKEN")
\`\`\`

> **Security note:** Never hardcode tokens in your scripts. Use environment variables or the save_account method. Nuclei's settings panel can store your token securely.`,
      },
      {
        type: 'text',
        markdown: `## Selecting a Backend

Not all quantum computers are equal. Choosing the right backend matters:

\`\`\`python
# List available backends
backends = service.backends()
for b in backends:
    config = b.configuration()
    props = b.properties()
    print(f"{b.name}: {config.n_qubits} qubits, "
          f"queue: {b.status().pending_jobs} jobs")
\`\`\`

### Backend Selection Criteria

| Factor | What to Check | Why It Matters |
|--------|--------------|----------------|
| **Qubit count** | Must exceed your circuit's qubit requirement | Cannot run a 10-qubit circuit on a 7-qubit device |
| **Queue length** | \`backend.status().pending_jobs\` | Shorter queue = faster results |
| **Connectivity** | Coupling map — which qubits are connected | Better connectivity = fewer SWAP gates |
| **Gate fidelity** | Calibration data — error rates per gate | Higher fidelity = cleaner results |
| **T₁ / T₂** | Coherence times from calibration | Longer coherence = deeper circuits possible |
| **Calibration age** | When was it last calibrated? | Stale calibration = unpredictable performance |

### The Least-Busy Strategy

For simple experiments, pick the backend with the shortest queue:

\`\`\`python
from qiskit_ibm_runtime import QiskitRuntimeService

service = QiskitRuntimeService()
backend = service.least_busy(
    min_num_qubits=5,
    filters=lambda b: b.status().operational
)
print(f"Selected: {backend.name} ({backend.status().pending_jobs} in queue)")
\`\`\``,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator

# === Conceptual job submission workflow ===
# (Uses local simulator — same code structure as real hardware)

# Step 1: Build your circuit
qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])

print("Step 1 — Original circuit:")
print(qc.draw('text'))

# Step 2: Transpile for the target backend
# On real hardware: transpile(qc, backend=real_backend, optimization_level=3)
backend = AerSimulator()
transpiled = transpile(qc, backend=backend, optimization_level=3)
print(f"\\nStep 2 — Transpiled: depth={transpiled.depth()}, "
      f"gates={sum(transpiled.count_ops().values())}")

# Step 3: Submit the job
# On real hardware: job = backend.run(transpiled, shots=4096)
job = backend.run(transpiled, shots=4096)
print(f"\\nStep 3 — Job submitted: {job.job_id()}")

# Step 4: Monitor status
# On real hardware: job.status() returns QUEUED → RUNNING → DONE
print(f"Step 4 — Status: {job.status()}")

# Step 5: Retrieve results
result = job.result()
counts = result.get_counts()
print(f"\\nStep 5 — Results:")
for state, count in sorted(counts.items(), key=lambda x: -x[1]):
    print(f"  |{state}⟩: {count} ({100*count/4096:.1f}%)")

# Step 6: Analyze
total_signal = counts.get('00', 0) + counts.get('11', 0)
print(f"\\nBell state fidelity estimate: {total_signal/4096:.3f}")
print("\\n--- On real hardware, Steps 3-4 can take minutes to hours ---")`,
        framework: 'qiskit',
        description:
          'The complete job submission workflow — from circuit to results. Runs locally but mirrors the exact code structure you would use for real IBM Quantum hardware.',
        explorationPrompt:
          'This demo runs instantly because it uses a local simulator. On real hardware, the queue wait is the bottleneck. If you have IBM Quantum credentials, try replacing AerSimulator() with a real backend from QiskitRuntimeService.',
      },
      {
        type: 'text',
        markdown: `## Job Lifecycle & Best Practices

### Job States

\`\`\`
INITIALIZING → QUEUED → RUNNING → DONE
                                 ↘ ERROR / CANCELLED
\`\`\`

### Monitoring

\`\`\`python
import time

while not job.in_final_state():
    status = job.status()
    print(f"Status: {status}, Queue position: {job.queue_position()}")
    time.sleep(30)

if job.status().name == 'DONE':
    result = job.result()
else:
    print(f"Job failed: {job.error_message()}")
\`\`\`

### Best Practices

| Practice | Why |
|----------|-----|
| **Batch circuits** | Submit multiple circuits in one job to share queue time |
| **Set shots wisely** | 1024 for exploration, 4096+ for publication-quality data |
| **Save job IDs** | Retrieve results later: \`service.job(job_id)\` |
| **Transpile locally first** | Catch routing issues before waiting in queue |
| **Use sessions** | IBM Runtime sessions keep you on the same QPU across multiple jobs |
| **Check calibration** | Run on recently calibrated backends for best fidelity |
| **Set error budgets** | Know your circuit's noise tolerance before submitting |`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '14.2-q1',
            question: 'Why should you transpile your circuit locally before submitting to real hardware?',
            options: [
              'To make the circuit run faster on the quantum computer',
              'To catch routing issues, check depth, and understand SWAP overhead before waiting in a queue',
              'Transpilation is only possible on a local machine',
              'Real hardware does not support transpilation',
            ],
            correctIndex: 1,
            explanation:
              'Local transpilation lets you inspect the hardware-specific circuit — check its depth, count SWAP gates, and verify it fits the connectivity map — before spending time in a queue. Real backends also transpile, but you want to catch problems early.',
          },
          {
            id: '14.2-q2',
            question: 'What is the main advantage of using IBM Runtime "sessions"?',
            options: [
              'Sessions make circuits run with zero noise',
              'Sessions reserve a specific QPU so multiple jobs run on the same device without re-queuing',
              'Sessions allow you to run circuits with unlimited shots',
              'Sessions bypass the transpiler for faster execution',
            ],
            correctIndex: 1,
            explanation:
              'A session holds your place on a specific QPU. Multiple jobs within the session execute on the same device with consistent calibration, avoiding the queue for each job. This is essential for iterative algorithms like VQE.',
          },
          {
            id: '14.2-q3',
            question: 'When selecting a backend, which factor is LEAST important for a simple 2-qubit Bell state experiment?',
            options: [
              'Queue length',
              'Two-qubit gate fidelity',
              'Total qubit count (e.g., 127 vs 27)',
              'Recent calibration',
            ],
            correctIndex: 2,
            explanation:
              'A Bell state only needs 2 connected qubits. Whether the chip has 27 or 127 total qubits barely matters — you will use the same small subset. Queue length, gate fidelity, and calibration freshness have a direct impact on your experience and results.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Your First Hardware Submission Checklist',
        visual: 'custom-svg',
        explanation:
          'Before submitting: (1) Does the circuit work on a local simulator? (2) What is the transpiled depth? Keep it under ~100 for NISQ devices. (3) Did you check the backend\'s queue length? (4) Are your shots sufficient? 1024 minimum. (5) Did you save the job ID? You can always retrieve results later. (6) Is the backend recently calibrated? Check properties.last_update_date.',
      },
    ],
  },

  // ── Lesson 14.3 ──
  {
    id: '14.3',
    title: 'Interpreting Noisy Results',
    description:
      'Why real results don\'t match theory. Statistical analysis, confidence intervals, shot budgets, and error mitigation basics.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['14.1'],
    tags: ['statistics', 'noise', 'confidence-intervals', 'shot-budget', 'error-mitigation', 'analysis'],
    diracContext:
      'Students will see messy hardware data for the first time and need tools to make sense of it. This is a statistics-meets-quantum lesson. Focus on practical analysis: how many shots do I need? How do I know if my result is signal or noise? Introduce error mitigation conceptually — it is a deep topic but students should know it exists. Use concrete numbers and distributions rather than abstract formulas.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Messy Truth

You ran a Bell state on real hardware and expected a clean split between |00⟩ and |11⟩. Instead you got:

\`\`\`
|00⟩: 1847  (45.1%)
|11⟩: 1724  (42.1%)
|01⟩: 263   (6.4%)
|10⟩: 262   (6.4%)
\`\`\`

Is this result correct? Is the Bell state "working"? How confident can you be?

### Why Results Are Noisy

Even a perfect quantum state produces **statistical variation** from shot to shot — quantum mechanics is probabilistic. On top of that, hardware adds:

| Noise Source | Effect on Results |
|-------------|------------------|
| **Gate errors** | Wrong states appear (|01⟩, |10⟩ in a Bell state) |
| **Measurement errors** | Correct state read as wrong bit (|11⟩ → |10⟩) |
| **Decoherence** | State decays toward |0...0⟩ over time |
| **Crosstalk** | Neighboring qubit operations leak into your qubits |
| **Leakage** | Qubit exits the {|0⟩, |1⟩} subspace entirely |

### The Key Question

**Is the observed distribution statistically consistent with the expected distribution, given the known noise level?**

This requires three tools: shot budgets, confidence intervals, and signal-to-noise analysis.`,
      },
      {
        type: 'text',
        markdown: `## Shot Budgets: How Many Samples?

Each measurement is one **shot**. More shots = smaller statistical uncertainty.

For a probability p estimated from N shots, the standard error is:

**SE = sqrt(p(1-p) / N)**

| Shots (N) | SE for p=0.5 | 95% CI width |
|-----------|:------------:|:------------:|
| 100 | ±5.0% | ±9.8% |
| 1,024 | ±1.6% | ±3.1% |
| 4,096 | ±0.8% | ±1.5% |
| 10,000 | ±0.5% | ±1.0% |
| 100,000 | ±0.16% | ±0.3% |

**Rule of thumb:** 1,024 shots for quick exploration. 4,096 for decent statistics. 10,000+ for publication-quality data.

### Confidence Intervals

A **95% confidence interval** means: if you repeated the experiment many times, 95% of the intervals would contain the true probability.

\`\`\`python
import numpy as np

counts = {'00': 1847, '11': 1724, '01': 263, '10': 262}
total = sum(counts.values())

for state, count in counts.items():
    p = count / total
    se = np.sqrt(p * (1 - p) / total)
    ci_low, ci_high = p - 1.96 * se, p + 1.96 * se
    print(f"|{state}⟩: {p:.3f} ± {1.96*se:.3f} "
          f"  (95% CI: [{ci_low:.3f}, {ci_high:.3f}])")
\`\`\`

If the 95% CI for |00⟩ + |11⟩ includes 1.0, your signal is consistent with a perfect Bell state modulo noise. If it is far below, something went wrong beyond typical hardware noise.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error
import numpy as np

# Build Bell state
qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])

# Noisy simulator (mimics real hardware)
noise = NoiseModel()
noise.add_all_qubit_quantum_error(depolarizing_error(0.005), ['h'])
noise.add_all_qubit_quantum_error(depolarizing_error(0.02), ['cx'])

sim = AerSimulator(noise_model=noise)
shots = 4096
result = sim.run(qc, shots=shots).result()
counts = result.get_counts()

print("=== Noisy Bell State Analysis ===\n")

# Raw counts
print("Raw counts:")
for state in ['00', '01', '10', '11']:
    c = counts.get(state, 0)
    print(f"  |{state}⟩: {c:>4} ({100*c/shots:.1f}%)")

# Confidence intervals
print("\n95% Confidence intervals:")
for state in ['00', '01', '10', '11']:
    c = counts.get(state, 0)
    p = c / shots
    se = np.sqrt(p * (1 - p) / shots)
    ci = 1.96 * se
    print(f"  |{state}⟩: {p:.3f} ± {ci:.3f}  "
          f"[{max(0, p-ci):.3f}, {min(1, p+ci):.3f}]")

# Signal vs noise analysis
signal = counts.get('00', 0) + counts.get('11', 0)
noise_counts = counts.get('01', 0) + counts.get('10', 0)
snr = signal / max(noise_counts, 1)

print(f"\n=== Signal Analysis ===")
print(f"Signal (|00⟩ + |11⟩): {signal}/{shots} = {100*signal/shots:.1f}%")
print(f"Noise  (|01⟩ + |10⟩): {noise_counts}/{shots} = {100*noise_counts/shots:.1f}%")
print(f"Signal-to-noise ratio: {snr:.1f}")
print(f"Bell state fidelity estimate: {signal/shots:.3f}")

# Is this a good result?
threshold = 0.85
fidelity = signal / shots
if fidelity > threshold:
    print(f"\n✓ Result PASSES fidelity threshold ({threshold})")
else:
    print(f"\n✗ Result FAILS fidelity threshold ({threshold})")`,
        framework: 'qiskit',
        description:
          'Analyze a noisy Bell state with confidence intervals and signal-to-noise ratio. Learn to distinguish signal from noise in hardware-like output.',
        explorationPrompt:
          'Change the number of shots from 4096 to 100. How much wider do the confidence intervals get? At what shot count can you reliably distinguish a Bell state from a maximally mixed state (25% per outcome)?',
      },
      {
        type: 'text',
        markdown: `## Error Mitigation: Fighting Back

You cannot eliminate hardware noise, but you can **mitigate** its effects using clever post-processing:

### Common Techniques

| Technique | How It Works | Overhead |
|-----------|-------------|----------|
| **Measurement error mitigation** | Run calibration circuits to learn the confusion matrix, then invert it | 2ⁿ extra circuits (or tensor product approximation) |
| **Zero-noise extrapolation (ZNE)** | Intentionally amplify noise at multiple levels, then extrapolate back to zero | 3–5x more circuits |
| **Probabilistic error cancellation (PEC)** | Decompose noisy gates into quasi-probability distributions of ideal operations | Exponential sampling overhead |
| **Twirling** | Randomize error directions so they become depolarizing (easier to correct) | ~10x more circuits |
| **Dynamical decoupling** | Insert identity-equivalent pulse sequences to refocus unwanted interactions | Minimal circuit overhead |

### Measurement Error Mitigation (Most Accessible)

The most practical starting point:

\`\`\`python
# 1. Run calibration circuits: prepare |00⟩, |01⟩, |10⟩, |11⟩ and measure
# 2. Build confusion matrix M (what you measure vs what you prepared)
# 3. Apply M⁻¹ to your experimental counts
\`\`\`

This corrects readout errors without modifying the quantum circuit itself. On most hardware, measurement errors account for 30–50% of total error — mitigating them alone significantly improves results.`,
      },
      {
        type: 'exercise',
        id: '14.3-ex1',
        title: 'Determine If Results Support the Expected Output',
        description:
          'Run a GHZ state (3 qubits) on a noisy simulator with CX depolarizing error of 0.03. Analyze whether the output distribution supports the expected |000⟩ + |111⟩ result. Compute the signal fraction (|000⟩ + |111⟩) and check if it exceeds 0.70.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error
import numpy as np

# Build GHZ state
qc = QuantumCircuit(3, 3)
# TODO: H on qubit 0, CX from 0->1, CX from 1->2, measure all

# TODO: Build noise model with depolarizing_error(0.03) on ['cx']
# and depolarizing_error(0.005) on ['h']

# TODO: Run with 4096 shots on noisy simulator

# TODO: Compute signal fraction
# signal = (counts for |000⟩ + counts for |111⟩) / total_shots
# Print whether signal > 0.70 threshold
`,
        framework: 'qiskit',
        expectedProbabilities: { '000': 0.42, '111': 0.42 },
        tolerancePercent: 20,
        hints: [
          'Build the GHZ: qc.h(0), qc.cx(0, 1), qc.cx(1, 2), qc.measure([0,1,2], [0,1,2]).',
          'Signal states are "000" and "111" in the counts dictionary.',
          'signal_fraction = (counts.get("000", 0) + counts.get("111", 0)) / 4096.',
          'With 3% CX error and 2 CX gates, expect ~5-10% leakage into non-GHZ states.',
        ],
        successMessage:
          'You analyzed noisy data like a real quantum experimentalist. The signal fraction tells you how much of your intended computation survived the noise. In practice, you would also report confidence intervals and compare against a noise-free baseline.',
      },
      {
        type: 'concept-card',
        title: 'The Error Budget Framework',
        visual: 'histogram',
        explanation:
          'Before running on hardware, estimate your error budget: (1) Count the total gates after transpilation. (2) Multiply each gate count by its error rate. (3) Add measurement error per qubit. (4) The product of (1 - error) for all operations gives an approximate circuit fidelity. If this number is below ~0.5, your circuit is too deep for the hardware — simplify or use error mitigation.',
      },
    ],
  },

  // ── Lesson 14.4 ──
  {
    id: '14.4',
    title: 'Benchmarking Your Quantum Code',
    description:
      'Quantum volume, CLOPS, circuit metrics, and how to measure your code\'s performance on real and simulated hardware.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['14.1'],
    tags: ['benchmarking', 'quantum-volume', 'CLOPS', 'depth', 'gate-count', 'SWAP', 'metrics', 'transpilation'],
    diracContext:
      'Students need to move beyond "does it give the right answer" to "how efficient is my circuit." This lesson introduces both hardware-agnostic metrics (depth, gate count, SWAP overhead) and hardware-specific benchmarks (quantum volume, CLOPS). Keep the focus practical: these numbers help you predict whether a circuit will work before you run it, and help you compare different implementations. The demo should produce concrete metrics students can optimize against.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Beyond "Does It Work?"

A quantum circuit that gives the right answer on a simulator might fail spectacularly on hardware. **Benchmarking** tells you *why* and *what to improve*.

### Circuit-Level Metrics

These describe your specific circuit:

| Metric | What It Measures | Why It Matters |
|--------|-----------------|----------------|
| **Depth** | Longest path from input to output (in gate layers) | Deeper = more decoherence time = more errors |
| **Gate count** | Total number of gates | More gates = more error opportunities |
| **2Q gate count** | Number of two-qubit gates (CNOT/CZ) | 2Q gates have 5–10x higher error than 1Q gates |
| **SWAP count** | Number of SWAP gates inserted by transpiler | Each SWAP = 3 CX gates of overhead |
| **Circuit width** | Number of qubits used | Must fit on the hardware topology |
| **T-count** | Number of T gates (for fault-tolerant circuits) | T gates are the most expensive in error correction |

### Hardware Benchmarks

These describe the quantum computer itself:

| Benchmark | What It Measures | Current Range |
|-----------|-----------------|:-------------:|
| **Quantum Volume (QV)** | Largest random square circuit the device can run reliably | 32–65536 |
| **CLOPS** | Circuit Layer Operations Per Second — throughput | 800–100,000+ |
| **2Q gate fidelity** | Success rate of two-qubit gates | 99.0–99.9% |
| **T₁ / T₂** | Coherence times | 50–300 μs (superconducting) |
| **Readout fidelity** | Measurement accuracy | 97–99.5% |`,
      },
      {
        type: 'text',
        markdown: `## Quantum Volume Explained

**Quantum Volume (QV)** is the most widely cited single-number benchmark for a quantum computer. Introduced by IBM, it captures the interplay between qubit count, connectivity, gate fidelity, and compiler quality.

### How It Works

1. Pick a width d (number of qubits) and depth d (same number of layers)
2. Generate random SU(4) two-qubit gates for each layer
3. Transpile and run on the device
4. Check if the heavy output probability exceeds 2/3
5. The **quantum volume** is 2^d for the largest d that passes

| QV | Effective Qubits | What It Means |
|----|:-:|----------------|
| 8 | 3 | Can reliably run 3×3 random circuits |
| 32 | 5 | 5×5 circuits — typical NISQ threshold |
| 128 | 7 | Competitive modern device |
| 512+ | 9+ | Leading-edge hardware |

### Limitations of QV

- It tests random circuits, not application-specific workloads
- A device with QV 128 might outperform a QV 256 device on *your* specific algorithm
- Does not capture throughput (CLOPS fills that gap)

## CLOPS: Speed Matters Too

**Circuit Layer Operations Per Second** measures how many circuit layers the system can execute per second end-to-end, including classical processing and data transfer.

High CLOPS means faster iterative algorithms (VQE, QAOA) where you run hundreds of circuits in a feedback loop.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator

def analyze_circuit(name, qc, backend):
    """Compute comprehensive circuit metrics."""
    # Pre-transpilation metrics
    pre_depth = qc.depth()
    pre_ops = qc.count_ops()
    pre_total = sum(v for k, v in pre_ops.items() if k != 'measure')

    # Transpile for hardware
    transpiled = transpile(qc, backend=backend, optimization_level=3)
    post_depth = transpiled.depth()
    post_ops = transpiled.count_ops()
    post_total = sum(v for k, v in post_ops.items() if k != 'measure')

    # Count specific gate types
    cx_count = post_ops.get('cx', 0)
    swap_count = post_ops.get('swap', 0)
    single_q = post_total - cx_count - swap_count

    print(f"=== {name} ===")
    print(f"Qubits: {qc.num_qubits}")
    print(f"\nBefore transpilation:")
    print(f"  Depth: {pre_depth}")
    print(f"  Gates: {pre_total} ({dict(pre_ops)})")
    print(f"\nAfter transpilation (opt level 3):")
    print(f"  Depth: {post_depth} ({post_depth/max(pre_depth,1):.1f}x)")
    print(f"  Total gates: {post_total}")
    print(f"  1Q gates: {single_q}")
    print(f"  CX gates: {cx_count}")
    print(f"  SWAP gates: {swap_count} (= {swap_count * 3} extra CX)")
    print(f"\nEstimated circuit fidelity:")
    # Rough estimate: F ≈ (1-e1q)^n1q × (1-e2q)^n2q
    e1q, e2q = 0.001, 0.01  # typical error rates
    fidelity = (1 - e1q)**single_q * (1 - e2q)**(cx_count + swap_count*3)
    print(f"  F ≈ {fidelity:.4f} ({100*fidelity:.1f}%)")
    print(f"  (assuming 0.1% 1Q error, 1% 2Q error)")
    return post_depth, post_total, fidelity

# Simulated backend with limited connectivity
backend = AerSimulator()

# --- Circuit 1: Simple Bell state ---
bell = QuantumCircuit(2, 2)
bell.h(0)
bell.cx(0, 1)
bell.measure([0, 1], [0, 1])
d1, g1, f1 = analyze_circuit("Bell State (2Q)", bell, backend)

print("\n" + "="*50 + "\n")

# --- Circuit 2: 4-qubit GHZ ---
ghz4 = QuantumCircuit(4, 4)
ghz4.h(0)
for i in range(3):
    ghz4.cx(i, i+1)
ghz4.measure(range(4), range(4))
d2, g2, f2 = analyze_circuit("GHZ State (4Q)", ghz4, backend)

print("\n" + "="*50 + "\n")

# --- Circuit 3: QFT on 4 qubits ---
from qiskit.circuit.library import QFT
qft4 = QuantumCircuit(4, 4)
qft4.compose(QFT(4), inplace=True)
qft4.measure(range(4), range(4))
d3, g3, f3 = analyze_circuit("QFT (4Q)", qft4, backend)

print("\n" + "="*50)
print("\n=== Summary ===")
print(f"{'Circuit':<20} {'Depth':>6} {'Gates':>6} {'Fidelity':>10}")
print(f"{'Bell':<20} {d1:>6} {g1:>6} {f1:>10.4f}")
print(f"{'GHZ-4':<20} {d2:>6} {g2:>6} {f2:>10.4f}")
print(f"{'QFT-4':<20} {d3:>6} {g3:>6} {f3:>10.4f}")`,
        framework: 'qiskit',
        description:
          'Analyze three circuits with increasing complexity: Bell state, GHZ-4, and QFT-4. Compare depth, gate counts, and estimated fidelity before and after transpilation.',
        explorationPrompt:
          'Try adding a 5-qubit or 6-qubit GHZ state. How fast does the gate count and estimated fidelity change? What about a QFT on 6 qubits — is it realistic for NISQ hardware?',
      },
      {
        type: 'text',
        markdown: `## Optimization Strategies

Once you know your metrics, you can improve them:

### Reducing Depth

| Strategy | How | Impact |
|----------|-----|--------|
| **Parallelize gates** | Put independent operations in the same layer | Reduces depth without changing gate count |
| **Use native gates** | Write circuits in the hardware's native gate set | Eliminates decomposition overhead |
| **Optimize CNOT chains** | Use linear nearest-neighbor patterns that minimize routing | Fewer SWAPs |
| **Circuit identities** | HZH = X, CX·CX = I, commutation rules | Cancel redundant gates |

### Reducing Gate Count

| Strategy | How | Impact |
|----------|-----|--------|
| **Higher optimization level** | \`transpile(qc, optimization_level=3)\` | More aggressive simplification |
| **Template matching** | Replace known sub-circuits with shorter equivalents | Circuit-specific savings |
| **Approximate compilation** | Allow small errors for fewer gates | Trade accuracy for efficiency |
| **Problem-specific tricks** | Exploit problem symmetry or sparsity | Can dramatically reduce circuit size |

### The Optimization Tradeoff

More optimization takes more classical compilation time. For variational algorithms running hundreds of circuits, aggressive optimization on each one may slow total wall-clock time even as it improves per-circuit fidelity.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '14.4-q1',
            question: 'What does Quantum Volume measure?',
            options: [
              'The total number of qubits on a quantum chip',
              'The maximum depth of circuits the device can run',
              'The largest width-equals-depth random circuit the device executes reliably',
              'The speed at which the device processes quantum circuits',
            ],
            correctIndex: 2,
            explanation:
              'Quantum Volume tests random d-wide, d-deep circuits. QV = 2^d for the largest d where the device achieves heavy output probability > 2/3. It captures qubit count, connectivity, fidelity, and compiler quality in one number.',
          },
          {
            id: '14.4-q2',
            question: 'Why are two-qubit gate counts more important than single-qubit gate counts for estimating circuit fidelity?',
            options: [
              'Two-qubit gates use twice as many qubits',
              'Two-qubit gates have 5-10x higher error rates than single-qubit gates',
              'Single-qubit gates do not introduce any errors',
              'Two-qubit gates are slower to compile',
            ],
            correctIndex: 1,
            explanation:
              'On typical hardware, single-qubit gate fidelity is ~99.9% while two-qubit gate fidelity is ~99.0-99.5%. A circuit with 20 CX gates at 99% fidelity has ~18% chance of an error from CX alone, while 50 single-qubit gates at 99.9% fidelity contribute only ~5%.',
          },
          {
            id: '14.4-q3',
            question: 'A circuit has depth 15 before transpilation and depth 47 after. What is the most likely cause of the increase?',
            options: [
              'The transpiler added noise to the circuit',
              'SWAP gates were inserted to route qubits on the hardware topology',
              'The transpiler duplicated the circuit for error correction',
              'Measurement operations were added at the end',
            ],
            correctIndex: 1,
            explanation:
              'The ~3x depth increase is characteristic of SWAP insertion. When qubits in a two-qubit gate are not physically adjacent, the transpiler inserts SWAP gates (each requiring 3 CX gates) to move qubit states into neighboring positions. This is the primary source of transpilation overhead.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Your Benchmarking Workflow',
        visual: 'histogram',
        explanation:
          'For every quantum circuit you build: (1) Measure pre-transpilation depth and gate count — this is your algorithmic complexity. (2) Transpile at optimization_level=3 and measure post-transpilation metrics — this is what the hardware actually executes. (3) Estimate fidelity: F ≈ (0.999)^(1Q gates) x (0.99)^(2Q gates). (4) If F < 0.5, the circuit is too deep — simplify or use error mitigation. (5) Compare multiple implementations and pick the one with the best metrics.',
      },
    ],
  },
];
