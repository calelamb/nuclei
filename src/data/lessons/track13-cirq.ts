import type { Lesson } from './types';

export const TRACK13_LESSONS: Lesson[] = [
  // ── Lesson 13.1 ──
  {
    id: '13.1',
    title: 'Cirq Architecture & Moments',
    description:
      'Cirq\'s design: qubits, gates, moments, circuits. How Cirq differs from Qiskit and why Google built it that way.',
    difficulty: 'beginner',
    estimatedMinutes: 20,
    prerequisites: ['1.1'],
    tags: ['cirq', 'google', 'moments', 'architecture', 'bell-state', 'framework-comparison'],
    diracContext:
      'This is the student\'s introduction to Cirq. They likely learned Qiskit first. Highlight the structural differences: Cirq uses explicit Moment objects instead of implicit append-to-end, qubits are first-class objects you define up front, and measurement keys replace classical registers. Cirq\'s philosophy is "closer to the hardware" — less magic, more control. Be encouraging about learning a second framework.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Why Another Framework?

Qiskit is IBM's toolkit. **Cirq** is Google's — built by the team that ran the 2019 quantum supremacy experiment on Sycamore. Where Qiskit optimizes for breadth and accessibility, Cirq optimizes for **control and hardware fidelity**.

The key philosophical difference: Cirq wants you to think about *when* gates happen, not just *what* gates happen.

### Core Concepts

| Cirq | Qiskit Equivalent | Purpose |
|------|-------------------|---------|
| \`cirq.LineQubit\` / \`cirq.GridQubit\` | Implicit integer indices | Named qubit objects with topology |
| \`cirq.Moment\` | No direct equivalent | A time slice — gates in one Moment execute simultaneously |
| \`cirq.Circuit\` | \`QuantumCircuit\` | Ordered list of Moments |
| \`cirq.measure()\` | \`qc.measure()\` | Measurement with a string key, no classical register |
| \`cirq.Simulator()\` | \`AerSimulator\` | Statevector simulation engine |

### Qubits Are Objects

In Qiskit, qubits are integers. In Cirq, qubits are **objects** with identity and topology:

\`\`\`python
# LineQubits — 1D chain (for algorithm work)
q0, q1, q2 = cirq.LineQubit.range(3)

# GridQubits — 2D lattice (mirrors real chip layout)
q = cirq.GridQubit(row=2, col=3)
\`\`\`

This matters because real Google chips have 2D grid connectivity. By using \`GridQubit\`, your circuit maps directly onto hardware without a separate routing step.`,
      },
      {
        type: 'text',
        markdown: `## Moments: Explicit Parallelism

In Qiskit, you append gates and the transpiler figures out what can run in parallel. In Cirq, **you** decide.

A **Moment** is a single time slice where all operations execute simultaneously. Gates in the same Moment must act on different qubits.

\`\`\`python
import cirq

q0, q1 = cirq.LineQubit.range(2)

# Two moments, explicit timing:
circuit = cirq.Circuit([
    cirq.Moment([cirq.H(q0)]),                    # Moment 0: H on q0
    cirq.Moment([cirq.CNOT(q0, q1)]),              # Moment 1: CNOT
])
\`\`\`

Or let Cirq pack operations automatically:

\`\`\`python
# InsertStrategy.EARLIEST packs gates as early as possible
circuit = cirq.Circuit()
circuit.append(cirq.H(q0), strategy=cirq.InsertStrategy.EARLIEST)
circuit.append(cirq.CNOT(q0, q1), strategy=cirq.InsertStrategy.EARLIEST)
\`\`\`

The Moment model gives you precise control over circuit depth — critical for noisy hardware where every time step costs fidelity.`,
      },
      {
        type: 'demo',
        code: `import cirq

# Define qubits
q0, q1 = cirq.LineQubit.range(2)

# Build a Bell state circuit with explicit moments
circuit = cirq.Circuit([
    cirq.Moment([cirq.H(q0)]),
    cirq.Moment([cirq.CNOT(q0, q1)]),
    cirq.Moment([cirq.measure(q0, q1, key='result')])
])

# Print the circuit diagram (Cirq has nice ASCII art)
print("Circuit:")
print(circuit)
print()

# Simulate
simulator = cirq.Simulator()
result = simulator.run(circuit, repetitions=1000)

# Results use the measurement key
print("Measurement results:")
print(result.histogram(key='result'))`,
        framework: 'cirq',
        description:
          'A Bell state in Cirq — notice the Moment-based structure and measurement keys instead of classical registers.',
        explorationPrompt:
          'Try adding a third qubit and extending the Bell state into a GHZ state. Can you put both CNOT gates in the same Moment? Why or why not?',
      },
      {
        type: 'text',
        markdown: `## Circuit Inspection

Cirq gives you rich introspection tools:

\`\`\`python
print(circuit)          # ASCII diagram
print(len(circuit))     # Number of moments (depth)
print(circuit.all_qubits())  # Set of qubits used
\`\`\`

The ASCII output uses time flowing left-to-right, with qubit wires stacked vertically — similar to Qiskit's \`draw('text')\` but with Moments clearly delimited.

### When to Choose Cirq

| Use Cirq When | Use Qiskit When |
|---------------|-----------------|
| Targeting Google hardware (Sycamore, Willow) | Targeting IBM hardware |
| You need precise Moment-level control | You want automatic transpilation |
| Working with 2D grid connectivity | You want the broadest ecosystem |
| Running noise-aware research | You are a beginner wanting the smoothest onramp |
| Building custom decompositions | You need access to 100+ backends |

Both frameworks can express any quantum circuit. The difference is in defaults and philosophy.`,
      },
      {
        type: 'exercise',
        id: '13.1-ex1',
        title: 'Build a GHZ State in Cirq',
        description:
          'Create a 3-qubit GHZ state (|000⟩ + |111⟩)/√2 using Cirq. Use LineQubits and explicit Moments. Measure all three qubits with the key "ghz".',
        starterCode: `import cirq

# TODO: Create 3 LineQubits
# Hint: q0, q1, q2 = cirq.LineQubit.range(3)

# TODO: Build the circuit with Moments
# Moment 1: H gate on q0
# Moment 2: CNOT from q0 to q1
# Moment 3: CNOT from q1 to q2
# Moment 4: Measure all three with key='ghz'

# TODO: Simulate with 1024 repetitions
# simulator = cirq.Simulator()
# result = simulator.run(circuit, repetitions=1024)
# print(result.histogram(key='ghz'))
`,
        framework: 'cirq',
        expectedMeasurements: { '0': 512, '7': 512 },
        tolerancePercent: 15,
        hints: [
          'Use cirq.LineQubit.range(3) to create q0, q1, q2.',
          'Each CNOT depends on the previous gate\'s output, so they must be in separate Moments.',
          'cirq.measure(q0, q1, q2, key="ghz") creates a measurement on all three.',
          'The histogram returns integer keys: 0 for |000⟩ and 7 for |111⟩ (binary 111 = 7).',
        ],
        successMessage:
          'You built a GHZ state in Cirq. Notice how the Moment structure makes the circuit depth explicit — three layers of entangling gates, one measurement layer.',
      },
      {
        type: 'concept-card',
        title: 'Cirq vs Qiskit: Mental Models',
        visual: 'circuit',
        explanation:
          'Qiskit: "Append gates, let the transpiler sort it out." Cirq: "You are the transpiler — define exactly when each gate fires." Both produce valid quantum circuits. Cirq\'s approach is valuable when you need to minimize circuit depth on noisy hardware or when you want your software circuit to match the hardware schedule exactly.',
      },
    ],
  },

  // ── Lesson 13.2 ──
  {
    id: '13.2',
    title: 'Google\'s Quantum Supremacy',
    description:
      'The 2019 Sycamore experiment: random circuit sampling, cross-entropy benchmarking, what it proved, and what it didn\'t.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['13.1'],
    tags: ['sycamore', 'supremacy', 'random-circuit-sampling', 'cross-entropy', 'google', 'computational-advantage'],
    diracContext:
      'This lesson covers a landmark but controversial experiment. Be balanced: the 2019 result was genuine but narrow. IBM challenged the classical simulation bound. Explain cross-entropy benchmarking conceptually — do not get lost in formulas. Students should understand what "quantum advantage" means and what it does NOT mean (not useful computation, just something hard to simulate classically). Keep it accessible and historically grounded.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## October 2019: A Milestone

Google's quantum computing team announced that their 53-qubit **Sycamore** processor had performed a computation in 200 seconds that would take the world's most powerful classical supercomputer an estimated **10,000 years**.

The task? **Random circuit sampling** — running a random quantum circuit and sampling from its output distribution.

This was the first credible claim of **quantum computational advantage** (originally called "quantum supremacy"). Let's understand what actually happened.

### The Experiment

1. Design a random quantum circuit: 53 qubits, 20 layers of random single-qubit gates + nearest-neighbor CZ (controlled-Z) gates
2. Run it on Sycamore, collect ~1 million output bit strings
3. Compute the **cross-entropy benchmarking fidelity (XEB)** — a score that measures whether the samples match the expected quantum distribution
4. Argue that no classical computer can produce samples with the same XEB fidelity in reasonable time

### Why Random Circuits?

Random circuits are the *worst case* for classical simulation. Their output distributions have no structure to exploit. The more qubits and layers you add, the exponentially harder they become to simulate.

| Property | Value |
|----------|-------|
| Qubits | 53 (54 on chip, 1 defective) |
| Depth | 20 cycles |
| Gates per cycle | ~430 (mix of 1Q + 2Q) |
| Sampling time | ~200 seconds |
| Classical estimate | ~10,000 years (Google) |`,
      },
      {
        type: 'concept-card',
        title: 'Cross-Entropy Benchmarking (XEB)',
        visual: 'histogram',
        explanation:
          'XEB compares the probabilities assigned by the ideal quantum circuit to the bit strings actually sampled by the noisy hardware. If the hardware is doing real quantum computation, the samples will be biased toward high-probability outcomes of the ideal distribution. A random coin-flipper would score ~0. Perfect quantum hardware scores 1.0. Sycamore scored ~0.002 — tiny but exponentially unlikely to fake classically.',
      },
      {
        type: 'text',
        markdown: `## The Controversy

IBM responded within days: they argued that by using more disk space (secondary storage on Summit supercomputer), the classical simulation could be done in **2.5 days**, not 10,000 years.

The debate continues, but the key points:

### What the Experiment Proved

- A quantum processor can sample from distributions that are **genuinely hard** for classical computers
- The XEB fidelity scaled as predicted by quantum mechanics — the chip was doing real quantum computation
- Google's noise model accurately predicted the hardware's behavior

### What It Did NOT Prove

- It was **not useful computation** — random circuit sampling solves no practical problem
- The classical bound keeps shifting as classical algorithms improve
- IBM and others have since tightened classical simulation techniques
- "Advantage" depends on which classical algorithm and hardware you compare against

### Beyond Sycamore: Willow (2024)

Google's next-generation chip, **Willow**, demonstrated:

- **105 qubits** with significantly lower error rates
- Below-threshold error correction — adding more qubits *reduced* logical error rates
- An extended random circuit sampling task estimated at 10²⁵ years classically

The field has moved from "can we beat classical?" to "can we do something *useful* with the advantage?"`,
      },
      {
        type: 'text',
        markdown: `## The Bigger Picture

Quantum computational advantage exists on a spectrum:

| Level | Description | Status (2026) |
|-------|-------------|:---:|
| **Sampling advantage** | Sample from hard-to-simulate distributions | Demonstrated (2019, 2024) |
| **Approximate advantage** | Outperform best classical heuristics on an optimization task | Contested — some claims, no clear winner |
| **Exact advantage** | Produce correct answers faster than any classical approach | Not yet demonstrated |
| **Practical advantage** | Solve a real-world problem cheaper/faster than classical | Not yet |
| **Fault-tolerant advantage** | Run error-corrected algorithms (Shor's, etc.) beyond classical reach | Decades away |

The supremacy experiment was Level 1 — important as proof of concept, but the journey to practical advantage continues.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '13.2-q1',
            question: 'What task did the Sycamore processor perform in the 2019 quantum supremacy experiment?',
            options: [
              'Factoring a 2048-bit RSA key',
              'Simulating a complex molecule for drug discovery',
              'Sampling from the output distribution of random quantum circuits',
              'Solving a travelling salesman optimization problem',
            ],
            correctIndex: 2,
            explanation:
              'The task was random circuit sampling — running random quantum circuits and collecting output bit strings. It has no practical application but is believed to be exponentially hard for classical computers.',
          },
          {
            id: '13.2-q2',
            question: 'What does cross-entropy benchmarking (XEB) measure?',
            options: [
              'The entropy of the quantum state before measurement',
              'How well the sampled bit strings match the ideal quantum distribution',
              'The error rate of individual quantum gates',
              'The time it takes to run a circuit on hardware vs a simulator',
            ],
            correctIndex: 1,
            explanation:
              'XEB computes the correlation between the hardware\'s output samples and the ideal probability distribution. A score significantly above zero indicates the device is performing genuine quantum computation, not just random noise.',
          },
          {
            id: '13.2-q3',
            question: 'Why was IBM\'s response to the supremacy claim significant?',
            options: [
              'They showed Sycamore had a hardware defect',
              'They proved the quantum computation was incorrect',
              'They argued better classical algorithms could narrow the gap from 10,000 years to 2.5 days',
              'They demonstrated a larger quantum processor that was faster',
            ],
            correctIndex: 2,
            explanation:
              'IBM argued that with enough disk space and optimized algorithms, a classical supercomputer could complete the task in ~2.5 days. This highlighted that "advantage" depends on the classical baseline you compare against — it\'s a moving target.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The Advantage Spectrum',
        visual: 'custom-svg',
        explanation:
          'Quantum advantage is not binary. Sampling advantage (demonstrated) means a quantum device can sample from distributions classical computers struggle with. Practical advantage (not yet) means solving real problems faster and cheaper. Most near-term value lies in hybrid algorithms that combine quantum sampling with classical optimization.',
      },
    ],
  },

  // ── Lesson 13.3 ──
  {
    id: '13.3',
    title: 'Noise Models in Cirq',
    description:
      'Cirq\'s noise simulation tools: depolarizing channels, amplitude damping, custom noise. Build and analyze noisy circuits.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['13.1'],
    tags: ['cirq', 'noise', 'depolarizing', 'amplitude-damping', 'fidelity', 'density-matrix', 'simulation'],
    diracContext:
      'Students have seen clean simulations and possibly noise in Qiskit (track 10). Now they learn Cirq\'s approach to noise modeling. Cirq treats noise as explicit channel objects inserted into the circuit. Emphasize the practical impact: real hardware always has noise, and understanding noise models helps you predict how your algorithm will perform before you pay for real QPU time. Be concrete with numbers — depolarizing error of 0.01 means ~1% chance of a random error per gate.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Why Simulate Noise?

Every real quantum gate has errors. Before submitting a job to a real QPU (and waiting in a queue), you can **model** the expected noise and test whether your algorithm survives it.

Cirq provides a rich noise simulation toolkit built around **quantum channels** — mathematical descriptions of how noise affects a qubit.

### Common Noise Channels

| Channel | Physical Meaning | Cirq Class |
|---------|-----------------|------------|
| **Depolarizing** | Random Pauli error (X, Y, or Z) with probability p | \`cirq.depolarize(p)\` |
| **Amplitude damping** | Energy relaxation — |1⟩ decays to |0⟩ (T₁ process) | \`cirq.amplitude_damp(gamma)\` |
| **Phase damping** | Phase randomization without energy loss (T₂ process) | \`cirq.phase_damp(gamma)\` |
| **Asymmetric depolarizing** | Different probabilities for X, Y, Z errors | \`cirq.asymmetric_depolarize(px, py, pz)\` |
| **Bit flip** | X error with probability p | \`cirq.bit_flip(p)\` |
| **Phase flip** | Z error with probability p | \`cirq.phase_flip(p)\` |

### Adding Noise to a Circuit

Two approaches in Cirq:

**Approach 1: Explicit insertion** — add noise channels as operations:

\`\`\`python
circuit = cirq.Circuit([
    cirq.H(q0),
    cirq.depolarize(0.01).on(q0),  # 1% depolarizing after H
    cirq.CNOT(q0, q1),
    cirq.depolarize(0.02).on(q0),  # 2% depolarizing after CNOT
    cirq.depolarize(0.02).on(q1),
])
\`\`\`

**Approach 2: Noise model** — apply noise rules to all gates automatically:

\`\`\`python
class SimpleNoise(cirq.NoiseModel):
    def noisy_moment(self, moment, system_qubits):
        noise_ops = []
        for op in moment.operations:
            noise_ops.append(op)
            for q in op.qubits:
                noise_ops.append(cirq.depolarize(0.01).on(q))
        return cirq.Moment(noise_ops)
\`\`\``,
      },
      {
        type: 'text',
        markdown: `## Density Matrix Simulation

Clean simulations use statevectors. Noisy simulations need **density matrices** — they can represent mixed states (statistical mixtures of pure states caused by noise).

Cirq provides \`cirq.DensityMatrixSimulator()\` for this:

\`\`\`python
noisy_sim = cirq.DensityMatrixSimulator()
result = noisy_sim.simulate(noisy_circuit)
\`\`\`

The density matrix ρ is an n×n matrix where n = 2^(number of qubits). For a pure state |ψ⟩, ρ = |ψ⟩⟨ψ|. For a mixed state, ρ is a weighted sum of pure state projectors.

### Fidelity: Measuring Noise Impact

**Fidelity** quantifies how close a noisy state is to the ideal state:

F(ρ, |ψ⟩) = ⟨ψ|ρ|ψ⟩

- F = 1.0 → perfect, no noise impact
- F = 0.5 → halfway to random
- F = 1/2ⁿ → completely random (maximally mixed)

In Cirq:

\`\`\`python
fidelity = cirq.fidelity(
    noisy_state,
    ideal_state,
    qid_shape=(2,) * n_qubits
)
\`\`\``,
      },
      {
        type: 'demo',
        code: `import cirq
import numpy as np

q0, q1 = cirq.LineQubit.range(2)

# Build a clean Bell state circuit (no measurement for statevector sim)
clean_circuit = cirq.Circuit([
    cirq.H(q0),
    cirq.CNOT(q0, q1),
])

# Build a noisy version: depolarizing noise after each gate
noisy_circuit = cirq.Circuit([
    cirq.H(q0),
    cirq.depolarize(0.02).on(q0),
    cirq.CNOT(q0, q1),
    cirq.depolarize(0.05).on(q0),
    cirq.depolarize(0.05).on(q1),
])

# Simulate both
dm_sim = cirq.DensityMatrixSimulator()
clean_result = dm_sim.simulate(clean_circuit)
noisy_result = dm_sim.simulate(noisy_circuit)

# Compute fidelity
fid = cirq.fidelity(
    noisy_result.final_density_matrix,
    clean_result.final_density_matrix,
    qid_shape=(2, 2)
)
print(f"Fidelity: {fid:.4f}")
print(f"Noise impact: {(1 - fid) * 100:.1f}% degradation")

# Sample from both to see measurement distributions
clean_with_meas = clean_circuit + cirq.measure(q0, q1, key='m')
noisy_with_meas = noisy_circuit + cirq.measure(q0, q1, key='m')

sim = cirq.Simulator()
clean_counts = sim.run(clean_with_meas, repetitions=2048).histogram(key='m')
noisy_counts = sim.run(noisy_with_meas, repetitions=2048).histogram(key='m')

print("\\nClean Bell state samples:")
for k, v in sorted(clean_counts.items()):
    print(f"  |{k:02b}⟩: {v}")

print("\\nNoisy Bell state samples:")
for k, v in sorted(noisy_counts.items()):
    print(f"  |{k:02b}⟩: {v}")`,
        framework: 'cirq',
        description:
          'Compare a clean Bell state against a noisy version with depolarizing errors. Watch how noise smears the ideal 50/50 distribution and reduces fidelity.',
        explorationPrompt:
          'Try increasing the depolarizing probability from 0.05 to 0.15. At what noise level does fidelity drop below 0.5? Replace depolarize with amplitude_damp — how does the error pattern change?',
      },
      {
        type: 'text',
        markdown: `## Amplitude Damping: Real Relaxation

Depolarizing noise is symmetric — errors in all directions. Real qubits have **asymmetric** noise dominated by **amplitude damping** (T₁ relaxation): |1⟩ spontaneously decays to |0⟩.

\`\`\`python
# gamma relates to T₁ and gate time:
# gamma ≈ 1 - exp(-t_gate / T₁)
# For t_gate = 50ns, T₁ = 100μs: gamma ≈ 0.0005
cirq.amplitude_damp(gamma=0.001).on(q0)
\`\`\`

This creates a bias: after amplitude damping, you see more |0⟩ outcomes than expected. Phase damping (T₂) destroys superposition without changing populations — the off-diagonal elements of the density matrix decay.

### Combining Noise Channels

Real hardware has multiple noise sources simultaneously:

\`\`\`python
# Stack channels: T₁ relaxation + dephasing + gate error
noise_ops = [
    cirq.amplitude_damp(0.001).on(q),   # T₁
    cirq.phase_damp(0.002).on(q),        # T₂
    cirq.depolarize(0.005).on(q),        # Gate imperfection
]
\`\`\``,
      },
      {
        type: 'exercise',
        id: '13.3-ex1',
        title: 'Observe Fidelity Drop Under Noise',
        description:
          'Build a 2-qubit Bell state in Cirq, add depolarizing noise with probability 0.03 after the H gate and 0.08 after the CNOT, then measure with 2048 shots. The noisy distribution should still show |00⟩ and |11⟩ as dominant but with visible leakage to |01⟩ and |10⟩.',
        starterCode: `import cirq

q0, q1 = cirq.LineQubit.range(2)

# TODO: Build a noisy Bell state circuit
# Step 1: H gate on q0
# Step 2: Depolarizing noise (p=0.03) on q0
# Step 3: CNOT from q0 to q1
# Step 4: Depolarizing noise (p=0.08) on q0 and q1
# Step 5: Measure both qubits with key='bell'

# TODO: Simulate with 2048 repetitions
# sim = cirq.Simulator()
# result = sim.run(circuit, repetitions=2048)
# print(result.histogram(key='bell'))
`,
        framework: 'cirq',
        expectedMeasurements: { '0': 900, '3': 900 },
        tolerancePercent: 25,
        hints: [
          'Use cirq.depolarize(0.03).on(q0) after the H gate.',
          'After CNOT, add cirq.depolarize(0.08).on(q0) and cirq.depolarize(0.08).on(q1) as separate operations.',
          'cirq.measure(q0, q1, key="bell") adds the measurement.',
          'The histogram keys are integers: 0 for |00⟩, 1 for |01⟩, 2 for |10⟩, 3 for |11⟩.',
        ],
        successMessage:
          'You built a noisy circuit in Cirq. Notice the leakage into |01⟩ and |10⟩ — these are outcomes that should never appear in a perfect Bell state but emerge from depolarizing errors corrupting the entanglement.',
      },
      {
        type: 'concept-card',
        title: 'Noise Channel Zoo',
        visual: 'bloch',
        explanation:
          'On the Bloch sphere: depolarizing noise shrinks the Bloch vector toward the center (all directions). Amplitude damping pulls it toward |0⟩ (north pole). Phase damping squishes it toward the z-axis (losing x and y coherence). Real noise is a combination of all three, dominated by T₁ (amplitude damping) and T₂ (phase damping) timescales.',
      },
    ],
  },

  // ── Lesson 13.4 ──
  {
    id: '13.4',
    title: 'Cirq for Error Correction',
    description:
      'Google\'s surface code experiments, Cirq\'s error correction tools, and building a repetition code.',
    difficulty: 'advanced',
    estimatedMinutes: 20,
    prerequisites: ['13.3', '5.1'],
    tags: ['cirq', 'error-correction', 'surface-code', 'repetition-code', 'google', 'willow', 'below-threshold'],
    diracContext:
      'This connects Cirq to Google\'s flagship research program: quantum error correction. Students should already know basic error correction concepts from track 5. Focus on what Google has demonstrated experimentally — the repetition code and the below-threshold result on Willow. The surface code explanation should be conceptual, not a full implementation. Keep the demo practical: a repetition code they can run in Cirq.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Google's Error Correction Journey

Google has made quantum error correction (QEC) a central pillar of their roadmap. Their progress tells a story:

| Year | Chip | QEC Milestone |
|------|------|---------------|
| 2021 | Sycamore | First exponential error suppression in repetition code |
| 2023 | Sycamore v2 | Improved logical error rates, real-time decoding |
| 2024 | Willow (105 qubits) | **Below-threshold surface code** — adding qubits *reduces* error rate |

The **below-threshold** result on Willow is the most significant: it means error correction is actually *working* — the logical qubit improves as you add more physical qubits. This is the prerequisite for fault-tolerant quantum computing.

### The Surface Code

Google's target is the **surface code** — a 2D grid of data and measurement qubits:

| Component | Role |
|-----------|------|
| **Data qubits** | Store the logical information |
| **Measure-X qubits** | Detect bit-flip errors between neighbors |
| **Measure-Z qubits** | Detect phase-flip errors between neighbors |
| **Syndrome** | Pattern of measurement outcomes that reveals error locations |
| **Decoder** | Classical algorithm that identifies and corrects errors |

A distance-d surface code uses O(d²) physical qubits to encode 1 logical qubit. The logical error rate drops exponentially as d increases — but only if the physical error rate is **below threshold** (~1% per gate for surface codes).`,
      },
      {
        type: 'text',
        markdown: `## The Repetition Code in Cirq

Before tackling the full surface code, let's implement its 1D predecessor: the **repetition code**. This corrects bit-flip errors only but demonstrates the core QEC workflow.

A distance-3 repetition code:
- 3 data qubits encoding |0⟩ as |000⟩ or |1⟩ as |111⟩
- 2 measurement qubits that check parity between adjacent data qubits
- Multiple rounds of syndrome measurement to catch errors over time

\`\`\`
Data:    q0 ── q1 ── q2
              ╱          ╲
Measure:   m0            m1
\`\`\`

Each round:
1. CNOT from q0 to m0, CNOT from q1 to m0 → m0 measures parity(q0, q1)
2. CNOT from q1 to m1, CNOT from q2 to m1 → m1 measures parity(q1, q2)
3. Measure m0 and m1

If all parities are 0, no error detected. If a parity flips, it flags which data qubit may have been corrupted.

### Cirq's QEC Tools

Cirq provides utilities for working with error correction:
- \`cirq.MeasurementKey\` for tracking syndrome measurements across rounds
- Named qubits (\`cirq.NamedQubit\`) for readable error correction circuits
- Efficient density matrix simulation for noisy QEC experiments
- Integration with Google's decoder libraries`,
      },
      {
        type: 'demo',
        code: `import cirq

# Distance-3 repetition code
data = cirq.LineQubit.range(3)       # Data qubits: q0, q1, q2
meas = cirq.LineQubit.range(3, 5)    # Measure qubits: m0, m1

# Encode |0⟩ → |000⟩ (trivial — already in |000⟩)
# For |1⟩ → |111⟩, you would start with X on q0 and CNOT to q1, q2

circuit = cirq.Circuit()

# --- Round 1: Syndrome extraction ---
# Parity check 1: m0 = q0 XOR q1
circuit.append([cirq.CNOT(data[0], meas[0]), cirq.CNOT(data[1], meas[0])])
# Parity check 2: m1 = q1 XOR q2
circuit.append([cirq.CNOT(data[1], meas[1]), cirq.CNOT(data[2], meas[1])])
# Measure syndrome
circuit.append(cirq.measure(meas[0], key='s0_r1'))
circuit.append(cirq.measure(meas[1], key='s1_r1'))
# Reset measure qubits for next round
circuit.append([cirq.reset(meas[0]), cirq.reset(meas[1])])

# --- Inject a bit-flip error on q1 ---
circuit.append(cirq.X(data[1]))

# --- Round 2: Syndrome extraction after error ---
circuit.append([cirq.CNOT(data[0], meas[0]), cirq.CNOT(data[1], meas[0])])
circuit.append([cirq.CNOT(data[1], meas[1]), cirq.CNOT(data[2], meas[1])])
circuit.append(cirq.measure(meas[0], key='s0_r2'))
circuit.append(cirq.measure(meas[1], key='s1_r2'))

# --- Final data measurement ---
circuit.append(cirq.measure(*data, key='data'))

print("Repetition code circuit:")
print(circuit)
print()

# Simulate
sim = cirq.Simulator()
result = sim.run(circuit, repetitions=100)

print("Round 1 syndromes (should be 0,0 — no error yet):")
print(f"  s0: {result.measurements['s0_r1'][:5].flatten()}")
print(f"  s1: {result.measurements['s1_r1'][:5].flatten()}")

print("Round 2 syndromes (should be 1,1 — error on q1 detected):")
print(f"  s0: {result.measurements['s0_r2'][:5].flatten()}")
print(f"  s1: {result.measurements['s1_r2'][:5].flatten()}")

print("Data (without correction, q1 is flipped):")
print(f"  {result.histogram(key='data')}")`,
        framework: 'cirq',
        description:
          'A distance-3 repetition code in Cirq. Two rounds of syndrome measurement — the first detects no error, the second catches the injected X error on qubit 1. Syndrome pattern (1,1) identifies q1 as the culprit.',
        explorationPrompt:
          'Try moving the X error to data[0] instead. How does the syndrome pattern change? What pattern would data[2] produce? Can you add a correction step based on the syndrome?',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '13.4-q1',
            question: 'What did Google\'s Willow chip demonstrate for quantum error correction?',
            options: [
              'That error correction is impossible with current noise levels',
              'That adding more physical qubits reduces the logical error rate (below threshold)',
              'That a single qubit can be protected indefinitely without error correction',
              'That classical error correction is sufficient for quantum computers',
            ],
            correctIndex: 1,
            explanation:
              'Willow demonstrated "below-threshold" operation: as you increase the code distance (add more qubits), the logical error rate decreases exponentially. This is the fundamental requirement for fault-tolerant quantum computing to work.',
          },
          {
            id: '13.4-q2',
            question: 'In a repetition code, what does a syndrome measurement of (1, 1) on two parity check qubits indicate?',
            options: [
              'No error has occurred',
              'An error on the qubit shared by both parity checks (the middle qubit)',
              'Errors on both end qubits simultaneously',
              'The measurement apparatus is broken',
            ],
            correctIndex: 1,
            explanation:
              'Each parity check qubit monitors the parity between two adjacent data qubits. If both checks flag (1, 1), the common qubit — the one in the middle — has flipped. Syndrome (1, 0) or (0, 1) would indicate an end qubit error.',
          },
          {
            id: '13.4-q3',
            question: 'Why does the surface code use a 2D grid instead of a 1D chain like the repetition code?',
            options: [
              'It is faster to execute on 2D hardware',
              'A 2D grid can detect both bit-flip AND phase-flip errors simultaneously',
              'The repetition code requires too many qubits',
              '2D grids are easier to manufacture',
            ],
            correctIndex: 1,
            explanation:
              'The repetition code only catches bit-flip (X) errors. By extending to 2D, the surface code adds Z-type parity checks that detect phase-flip errors. This provides protection against arbitrary single-qubit errors — essential for fault-tolerant computation.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The Road to Fault Tolerance',
        visual: 'circuit',
        explanation:
          'Google\'s roadmap: (1) Demonstrate below-threshold error correction (done with Willow). (2) Build logical qubits with useful lifetimes. (3) Implement logical gates between logical qubits. (4) Run algorithms on logical qubits that outperform anything achievable without error correction. Each step requires better hardware AND better software — Cirq is the software backbone for all of it.',
      },
    ],
  },
];
