import type { Lesson } from './types';

export const TRACK15_LESSONS: Lesson[] = [
  // ── Lesson 15.1 ──
  {
    id: '15.1',
    title: 'BQP — What Quantum Computers Can Solve',
    description:
      'Complexity classes P, NP, BQP, and BPP. Where quantum computing fits in the landscape. What is provably faster and what remains open.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['3.1', '3.4'],
    tags: ['BQP', 'complexity', 'P', 'NP', 'BPP', 'speedup', 'decision-problems'],
    diracContext:
      'This lesson frames the theoretical power of quantum computers. Students should leave understanding that quantum computers are NOT magical NP-solvers — they occupy their own complexity class (BQP) that overlaps P and likely overlaps NP but probably does not contain all of NP. Use simple decision-problem examples. The demo compares Grover search (quadratic speedup) against classical brute force to make the speedup tangible.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Complexity Zoo

Computer scientists classify problems by how hard they are to **solve** or **verify**. Think of it as a filing system for difficulty:

| Class | Meaning | Example |
|-------|---------|---------|
| **P** | Solvable in polynomial time on a classical computer | Sorting a list, shortest path |
| **NP** | Solution verifiable in polynomial time (but maybe hard to find) | Sudoku, factoring (verifying is easy) |
| **BPP** | Solvable in polynomial time with bounded-error randomness | Primality testing (Miller-Rabin) |
| **BQP** | Solvable in polynomial time on a **quantum** computer with bounded error | Factoring (Shor's), simulation |

### Where Does BQP Sit?

\`\`\`
P ⊆ BPP ⊆ BQP ⊆ PSPACE

P ⊆ BQP  (anything classical can do, quantum can do)
BPP ⊆ BQP  (quantum is at least as powerful as randomized classical)
BQP ⊆ PSPACE  (quantum can be simulated with enough memory)
\`\`\`

The big open question: **does BQP contain NP-complete problems?**

Most researchers believe the answer is **no**. Quantum computers cannot solve arbitrary NP-complete problems efficiently. They shine on problems with specific algebraic structure — periodicity, symmetry, simulation.`,
      },
      {
        type: 'concept-card',
        title: 'The Complexity Landscape',
        visual: 'custom-svg',
        explanation:
          'Imagine nested circles: P sits inside BPP, BPP inside BQP, BQP inside PSPACE. NP overlaps with BQP but neither contains the other (we think). Factoring sits in the overlap: it is in NP (easy to verify) and in BQP (Shor solves it). But NP-complete problems like the traveling salesman probably sit outside BQP. Quantum gives you power over structure, not brute force.',
      },
      {
        type: 'text',
        markdown: `## Known Quantum Speedups

Not all speedups are created equal:

| Problem | Classical | Quantum | Speedup Type |
|---------|-----------|---------|-------------|
| **Factoring** | Sub-exponential (GNFS) | Polynomial (Shor) | Super-polynomial |
| **Unstructured search** | O(N) | O(√N) (Grover) | Quadratic |
| **Simulation of quantum systems** | Exponential | Polynomial | Exponential |
| **Linear systems** | O(N³) | O(poly(log N)) (HHL) | Exponential (with caveats) |
| **Optimization (general)** | Varies | Quadratic at best | Modest |

### The Honest Picture

- **Exponential speedups** exist but are rare and problem-specific (factoring, simulation)
- **Quadratic speedups** (Grover-type) are more general but may not survive real hardware overhead
- **No speedup** for many everyday tasks — sorting, searching sorted data, most ML training
- The overhead of error correction can erase modest speedups entirely

> **Key insight:** Quantum advantage is not universal. It is a precision tool for specific problem structures, not a magic accelerator for all computation.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import time
import random

# Compare classical brute-force search vs Grover's search
# Problem: find the marked item in an unstructured database

N = 16  # database size (4 qubits)
marked = 7  # the item we are looking for

# --- Classical: linear search (average N/2 queries) ---
random.seed(42)
database = list(range(N))
random.shuffle(database)

classical_queries = 0
for item in database:
    classical_queries += 1
    if item == marked:
        break

# --- Quantum: Grover's (approximately sqrt(N) iterations) ---
import math
n_qubits = 4
iterations = int(math.pi / 4 * math.sqrt(N))

qc = QuantumCircuit(n_qubits, n_qubits)

# Initialize superposition
qc.h(range(n_qubits))

for _ in range(iterations):
    # Oracle: flip phase of |0111> (marked = 7 = 0b0111)
    qc.x(3)  # flip qubit 3 so target becomes |1111>
    qc.h(3)
    qc.mcx([0, 1, 2], 3)  # multi-controlled X
    qc.h(3)
    qc.x(3)

    # Diffusion operator
    qc.h(range(n_qubits))
    qc.x(range(n_qubits))
    qc.h(n_qubits - 1)
    qc.mcx(list(range(n_qubits - 1)), n_qubits - 1)
    qc.h(n_qubits - 1)
    qc.x(range(n_qubits))
    qc.h(range(n_qubits))

qc.measure(range(n_qubits), range(n_qubits))

sim = AerSimulator()
result = sim.run(qc, shots=1024).result()
counts = result.get_counts()

print("=== Classical Brute-Force Search ===")
print(f"  Database size: {N}")
print(f"  Queries needed: {classical_queries} (average: {N//2})")

print(f"\\n=== Grover's Quantum Search ===")
print(f"  Database size: {N}")
print(f"  Grover iterations: {iterations} (≈ √{N} = {math.sqrt(N):.1f})")
print(f"  Top results:")
for state in sorted(counts, key=counts.get, reverse=True)[:3]:
    decimal = int(state, 2)
    pct = 100 * counts[state] / 1024
    print(f"    |{state}⟩ = {decimal}: {counts[state]} shots ({pct:.1f}%)")

print(f"\\n=== Speedup ===")
print(f"  Classical queries: O({N}) = {N}")
print(f"  Quantum queries:   O(√{N}) ≈ {iterations}")
print(f"  Speedup factor:    {N / iterations:.1f}x")`,
        framework: 'qiskit',
        description:
          'Compare classical brute-force search with Grover\'s quantum search on a 16-element database. See the quadratic speedup in action.',
        explorationPrompt:
          'Try changing the marked item. Does the number of Grover iterations change? What happens if you use 5 qubits (32 elements) — how does the speedup scale?',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '15.1-q1',
            question: 'Which complexity class describes problems solvable in polynomial time on a quantum computer?',
            options: ['P', 'NP', 'BQP', 'PSPACE'],
            correctIndex: 2,
            explanation:
              'BQP (Bounded-error Quantum Polynomial time) is the class of problems a quantum computer can solve in polynomial time with error probability at most 1/3.',
          },
          {
            id: '15.1-q2',
            question: 'Can quantum computers efficiently solve all NP-complete problems?',
            options: [
              'Yes — quantum computers can solve any problem faster',
              'No — most researchers believe NP-complete problems are outside BQP',
              'Yes — Grover\'s algorithm gives exponential speedup on NP problems',
              'We have proven they cannot',
            ],
            correctIndex: 1,
            explanation:
              'The consensus is that BQP does not contain NP-complete problems. Grover provides only a quadratic speedup, not exponential, and NP-complete problems appear to lack the algebraic structure quantum algorithms exploit.',
          },
          {
            id: '15.1-q3',
            question: 'What type of speedup does Grover\'s search provide over classical brute force?',
            options: ['Exponential', 'Quadratic', 'Polynomial (cubic)', 'Logarithmic'],
            correctIndex: 1,
            explanation:
              'Grover\'s algorithm searches N items in O(√N) queries compared to O(N) classically — a quadratic speedup. This is provably optimal for unstructured search.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Why "Quantum Computers Are Faster" Is Misleading',
        visual: 'histogram',
        explanation:
          'Quantum computers are not universally faster. They offer exponential speedups for problems with periodic/algebraic structure (factoring, simulation), quadratic speedups for unstructured search (Grover), and no speedup for many everyday tasks. The overhead of error correction means that modest speedups may not translate to real-world advantage until hardware matures significantly.',
      },
    ],
  },

  // ── Lesson 15.2 ──
  {
    id: '15.2',
    title: 'QMA — Quantum NP',
    description:
      'Quantum verification, QMA-complete problems, and the Local Hamiltonian problem. The quantum analogue of NP and its connection to physics.',
    difficulty: 'advanced',
    estimatedMinutes: 20,
    prerequisites: ['15.1'],
    tags: ['QMA', 'verification', 'local-Hamiltonian', 'quantum-NP', 'complexity', 'chemistry'],
    diracContext:
      'This is the most theoretical lesson in the track. QMA is the quantum analogue of NP — problems where a quantum proof can be verified efficiently on a quantum computer. The flagship QMA-complete problem is the Local Hamiltonian problem, which is directly connected to finding ground states in chemistry and materials science. Keep it conceptual — no code demos needed. Use analogies to NP verification to build intuition.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## From NP to QMA

Recall the definition of **NP**: a problem is in NP if, given a proposed solution (a "certificate"), you can **verify** it efficiently on a classical computer.

- **Sudoku**: Given a filled grid, checking all rows/columns/boxes takes polynomial time
- **Factoring**: Given p and q, checking that N = p × q is instant

**QMA** (Quantum Merlin-Arthur) is the quantum version:

| Class | Prover | Verifier | Certificate |
|-------|--------|----------|-------------|
| **NP** | Unlimited classical power | Polynomial-time classical | Classical bit string |
| **QMA** | Unlimited quantum power | Polynomial-time quantum | Quantum state |

In QMA, the "proof" is a **quantum state**. The verifier receives this state and runs a polynomial-time quantum algorithm to check it. If the answer is YES, there exists a quantum proof the verifier accepts with high probability. If NO, every quantum proof is rejected with high probability.`,
      },
      {
        type: 'concept-card',
        title: 'The Merlin-Arthur Protocol',
        visual: 'custom-svg',
        explanation:
          'Think of it as a courtroom: Merlin (all-powerful prover) sends a quantum state to Arthur (efficient quantum verifier). Arthur runs a quantum circuit on the state and measures. If the problem instance is a YES, Merlin can always convince Arthur. If it is a NO, no quantum state Merlin sends will fool Arthur. The quantum state is the "proof" — it can encode exponentially more than a classical string of the same length.',
      },
      {
        type: 'text',
        markdown: `## The Local Hamiltonian Problem

The flagship QMA-complete problem is the **Local Hamiltonian problem** — the quantum analogue of satisfiability (SAT).

### What Is It?

Given a **Hamiltonian** H (a matrix describing a quantum system's energy) that is a sum of "local" terms:

H = H₁ + H₂ + ... + Hₘ

where each Hᵢ acts on at most k qubits, decide:

> Is the ground state energy of H below some threshold a, or above some threshold b (where b > a)?

### Why It Matters

1. **Chemistry connection**: Finding the ground state energy of a molecule IS a Local Hamiltonian problem. This is why quantum simulation is so important — and so hard.

2. **Completeness**: Every problem in QMA can be reduced to Local Hamiltonian, just as every NP problem reduces to SAT. It captures the full difficulty of quantum verification.

3. **Physical meaning**: The ground state of a many-body quantum system encodes the answer. Nature "solves" this problem by cooling to the ground state — but doing so efficiently is the challenge.

### The k-Local Hierarchy

| k | Problem | Status |
|---|---------|--------|
| 5 | 5-local Hamiltonian | QMA-complete (Kitaev, 1999) |
| 2 | 2-local Hamiltonian | QMA-complete (Kempe, Kitaev, Regev, 2006) |
| 1 | 1-local Hamiltonian | In P (trivial — no interactions) |

Even restricting to nearest-neighbor interactions on a 2D grid keeps the problem QMA-complete. This is why condensed matter physics is computationally hard.`,
      },
      {
        type: 'text',
        markdown: `## QMA vs NP: Key Differences

| Property | NP | QMA |
|----------|-----|------|
| **Certificate** | Classical bits | Quantum state (qubits) |
| **Verifier** | Classical polynomial time | Quantum polynomial time |
| **Flagship complete problem** | SAT | Local Hamiltonian |
| **Physical connection** | Constraint satisfaction | Ground state energy |
| **Certificate reusability** | Can copy and reuse | No-cloning — single use |

### The No-Cloning Twist

In NP, once you have the certificate, you can copy it and verify multiple times. In QMA, the quantum certificate **cannot be cloned**. This makes the theory subtler — the verifier gets only one copy of the proof state.

### Open Questions

- **QMA vs NP**: Does QMA = NP? Almost certainly not — quantum proofs seem more powerful.
- **QMA vs QCMA**: QCMA uses *classical* certificates verified by a quantum computer. Is QMA = QCMA? Unknown — this asks whether quantum proofs are truly more powerful than classical ones.
- **QMA(2)**: What if the verifier receives *two unentangled* quantum proofs? This might be strictly more powerful than QMA.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '15.2-q1',
            question: 'What is the flagship QMA-complete problem?',
            options: ['Boolean satisfiability (SAT)', 'Graph coloring', 'The Local Hamiltonian problem', 'Integer factoring'],
            correctIndex: 2,
            explanation:
              'The Local Hamiltonian problem is QMA-complete — it is the quantum analogue of SAT. Determining the ground state energy of a local Hamiltonian captures the full difficulty of quantum verification.',
          },
          {
            id: '15.2-q2',
            question: 'In QMA, what serves as the "proof" that the verifier checks?',
            options: [
              'A classical bit string',
              'A quantum state',
              'A sequence of quantum gates',
              'A measurement record',
            ],
            correctIndex: 1,
            explanation:
              'In QMA, the prover sends a quantum state as the certificate. The verifier runs a polynomial-time quantum algorithm on this state to check validity. Unlike classical certificates, quantum certificates cannot be copied (no-cloning).',
          },
          {
            id: '15.2-q3',
            question: 'Why is the Local Hamiltonian problem directly relevant to quantum chemistry?',
            options: [
              'Chemistry problems are always in P',
              'Finding a molecule\'s ground state energy is a Local Hamiltonian problem',
              'Hamiltonians only appear in chemistry, not physics',
              'Classical computers can always solve Local Hamiltonian efficiently',
            ],
            correctIndex: 1,
            explanation:
              'The electronic structure of a molecule is described by a Hamiltonian. Finding its lowest energy (ground state) is exactly the Local Hamiltonian problem — which is QMA-complete, explaining why molecular simulation is so hard.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The Complexity Theory Connection to Real Science',
        visual: 'custom-svg',
        explanation:
          'QMA-completeness of Local Hamiltonian tells us something profound: understanding quantum materials and molecules is AS HARD AS any problem a quantum computer can verify. This is not just abstract theory — it explains why we need quantum computers to simulate quantum chemistry, and why classical approximations eventually break down for strongly correlated systems.',
      },
    ],
  },

  // ── Lesson 15.3 ──
  {
    id: '15.3',
    title: 'Quantum Supremacy Experiments',
    description:
      'Google Sycamore, Jiuzhang boson sampling, and IBM counter-claims. What "quantum supremacy" actually means and why it matters.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['15.1'],
    tags: ['supremacy', 'advantage', 'Sycamore', 'Jiuzhang', 'random-circuit-sampling', 'boson-sampling', 'Google', 'IBM'],
    diracContext:
      'This lesson covers the landmark quantum supremacy experiments. Be balanced: Google\'s 2019 Sycamore claim was significant but contested (IBM argued classical simulation in 2.5 days). Jiuzhang demonstrated photonic advantage. The debate is healthy and ongoing. Help students understand that "supremacy" means outperforming classical on ONE specific task — not general superiority. The demo shows random circuit sampling at toy scale.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## What Is Quantum Supremacy?

**Quantum supremacy** (also called **quantum advantage**) means demonstrating that a quantum computer can perform a specific computation that no classical computer can complete in any reasonable time.

Important nuances:

- It does NOT mean quantum computers are generally better than classical computers
- The task does not need to be *useful* — just classically intractable
- The classical hardness claim must hold against the *best known* classical algorithms
- "Supremacy" is a moving target — classical algorithms keep improving

### The Threshold

For random circuit sampling on n qubits with depth d, simulating the output distribution classically requires resources that grow exponentially with n × d. Once the circuit is large enough, no classical supercomputer can replicate the output distribution in a reasonable time.`,
      },
      {
        type: 'concept-card',
        title: 'The Supremacy Timeline',
        visual: 'custom-svg',
        explanation:
          'Key milestones: 2012 — Preskill coins "quantum supremacy". 2019 — Google Sycamore: 53 qubits, random circuits, claimed 200 seconds vs 10,000 years classical. 2019 — IBM contests: "we could do it in 2.5 days with enough disk". 2020 — USTC Jiuzhang: photonic boson sampling, 76 photons. 2021 — USTC Zuchongzhi: 66 superconducting qubits. 2023 — IBM shows 127-qubit utility experiments. 2024 — Google Willow: below threshold error correction.',
      },
      {
        type: 'text',
        markdown: `## Google Sycamore (2019)

The experiment that made headlines worldwide.

| Detail | Value |
|--------|-------|
| **Processor** | Sycamore — 53 superconducting qubits (54 fabricated, 1 defective) |
| **Task** | Random circuit sampling — 20 cycles of random single + two-qubit gates |
| **Quantum time** | 200 seconds for 1 million samples |
| **Classical estimate** | 10,000 years on Summit (then world's #1 supercomputer) |
| **Fidelity** | ~0.2% — tiny but above the noise floor |

### How Random Circuit Sampling Works

1. Apply random single-qubit gates drawn from {√X, √Y, √W} to each qubit
2. Apply CZ (controlled-Z) gates between neighboring pairs following a fixed pattern
3. Repeat for 20 cycles
4. Measure all qubits in the computational basis
5. The output distribution is NOT uniform — it has a specific "speckle pattern" determined by the circuit

Verifying the output uses **cross-entropy benchmarking (XEB)**: compare the quantum samples against the ideal distribution (computed for small instances) to confirm the quantum device is sampling from the correct distribution.

### IBM's Rebuttal

IBM argued they could simulate Sycamore classically in **2.5 days** (not 10,000 years) by using secondary storage (hard drives) to trade time for space. The debate continues — the key question is whether improved classical techniques can keep pace with scaling quantum hardware.`,
      },
      {
        type: 'text',
        markdown: `## Jiuzhang: Photonic Quantum Advantage (2020)

China's USTC team took a different approach: **boson sampling** with photons.

| Detail | Value |
|--------|-------|
| **System** | Jiuzhang — Gaussian boson sampling with squeezed light |
| **Detected photons** | Up to 76 photons in 100 modes |
| **Quantum time** | 200 seconds |
| **Classical estimate** | 2.5 billion years on Fugaku (then #1 supercomputer) |
| **Advantage** | No error correction needed — the physics does the computation |

### Boson Sampling

Instead of qubits and gates, boson sampling uses:
- **Input**: Single photons injected into different modes of an optical interferometer
- **Interferometer**: A network of beam splitters and phase shifters
- **Output**: Detect which modes contain photons

The output distribution is governed by the **permanent** of a complex matrix — a function that is #P-hard to compute classically. Sampling from this distribution is believed to be classically intractable.

### Why Multiple Approaches Matter

| Approach | Platform | Task | Advantage |
|----------|---------|------|-----------|
| Sycamore | Superconducting | Random circuit sampling | Programmable, universal gates |
| Jiuzhang | Photonic | Boson sampling | Room temperature, no error correction |
| Zuchongzhi | Superconducting | Random circuit sampling | Larger (66 qubits), higher fidelity |

Multiple independent demonstrations across different hardware platforms strengthen the overall case for quantum advantage.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import random
import math

# Toy random circuit sampling — the idea behind supremacy experiments
# Real experiments use 53+ qubits; we use 5 to see the concept

n = 5
depth = 6
random.seed(42)

qc = QuantumCircuit(n, n)

single_gates = ['sx', 'sy', 'h']  # simplified gate set

for layer in range(depth):
    # Random single-qubit gates on each qubit
    for q in range(n):
        gate = random.choice(single_gates)
        if gate == 'sx':
            qc.sx(q)
        elif gate == 'sy':
            qc.ry(math.pi / 2, q)
        else:
            qc.h(q)

    # Two-qubit entangling gates on alternating pairs
    start = layer % 2
    for q in range(start, n - 1, 2):
        qc.cz(q, q + 1)

qc.measure(range(n), range(n))

# Sample from the random circuit
sim = AerSimulator()
result = sim.run(qc, shots=4096).result()
counts = result.get_counts()

# Analyze the output distribution
n_states = 2 ** n
uniform_prob = 1 / n_states

print(f"Random circuit: {n} qubits, depth {depth}")
print(f"Total possible outcomes: {n_states}")
print(f"Uniform probability: {uniform_prob:.4f}")
print(f"Unique outcomes sampled: {len(counts)} / {n_states}")

print(f"\\nTop 10 most frequent outcomes:")
for state in sorted(counts, key=counts.get, reverse=True)[:10]:
    p = counts[state] / 4096
    ratio = p / uniform_prob
    bar = "█" * int(ratio * 10)
    print(f"  |{state}⟩: {counts[state]:>4} (p={p:.4f}, {ratio:.1f}× uniform) {bar}")

# The distribution is NOT uniform — this "speckle pattern"
# is what makes classical simulation hard at large scale
total_entropy = -sum(
    (c / 4096) * math.log2(c / 4096) for c in counts.values()
)
max_entropy = math.log2(n_states)
print(f"\\nShannon entropy: {total_entropy:.2f} / {max_entropy:.2f} (max)")
print(f"The non-uniform pattern is the 'signature' classical computers struggle to reproduce at scale.")`,
        framework: 'qiskit',
        description:
          'Build a miniature random circuit sampling experiment — the same concept behind Google\'s supremacy demonstration, scaled down to 5 qubits so you can see the output distribution pattern.',
        explorationPrompt:
          'Try changing the depth from 6 to 2. Does the distribution look more or less uniform? What about increasing to depth 12? The "speckle pattern" becomes more pronounced with depth.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '15.3-q1',
            question: 'What task did Google\'s Sycamore processor perform in the 2019 supremacy experiment?',
            options: [
              'Factoring a large number with Shor\'s algorithm',
              'Random circuit sampling',
              'Simulating a chemical molecule',
              'Solving an optimization problem with QAOA',
            ],
            correctIndex: 1,
            explanation:
              'Sycamore performed random circuit sampling — applying 20 cycles of random gates to 53 qubits and sampling the output distribution. The claim was that producing these samples would take a classical supercomputer 10,000 years.',
          },
          {
            id: '15.3-q2',
            question: 'What was IBM\'s main counterargument to Google\'s 10,000-year classical estimate?',
            options: [
              'The quantum results were wrong',
              'The task was not computationally meaningful',
              'Classical simulation could be done in ~2.5 days using disk storage',
              'Sycamore had too many errors to produce valid samples',
            ],
            correctIndex: 2,
            explanation:
              'IBM argued that by using secondary storage (hard drives) to trade time for memory, a classical supercomputer could simulate the Sycamore experiment in about 2.5 days — far less than Google\'s 10,000-year estimate.',
          },
          {
            id: '15.3-q3',
            question: 'What mathematical function makes boson sampling classically hard?',
            options: [
              'The determinant of a matrix',
              'The permanent of a matrix',
              'The eigenvalues of a Hamiltonian',
              'The discrete Fourier transform',
            ],
            correctIndex: 1,
            explanation:
              'The output probabilities of boson sampling are proportional to the permanent of a complex matrix — computing the permanent is #P-hard, making exact classical simulation of boson sampling intractable.',
          },
        ],
      },
    ],
  },

  // ── Lesson 15.4 ──
  {
    id: '15.4',
    title: 'The NISQ Era & Path Forward',
    description:
      'Noisy Intermediate-Scale Quantum: what we can do now, roadmaps from IBM, Google, and NVIDIA, and an honest assessment of when quantum will be useful.',
    difficulty: 'beginner',
    estimatedMinutes: 20,
    prerequisites: ['15.1'],
    tags: ['NISQ', 'roadmap', 'IBM', 'Google', 'NVIDIA', 'fault-tolerance', 'utility', 'timeline', 'error-correction'],
    diracContext:
      'This lesson should be honest and grounded. Students are excited about quantum computing but deserve a realistic picture. NISQ machines (50–1000+ qubits, no full error correction) can do interesting things but are NOT yet solving real-world problems better than classical computers in most cases. Walk through company roadmaps, highlight the error correction threshold as the key milestone, and be optimistic but honest about timelines.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Welcome to the NISQ Era

John Preskill coined **NISQ** (Noisy Intermediate-Scale Quantum) in 2018 to describe the current generation of quantum hardware:

| Property | NISQ Reality |
|----------|-------------|
| **Qubit count** | 50–1,200+ (but most are not usable simultaneously) |
| **Error rates** | ~0.1–1% per gate (too high for deep circuits) |
| **Coherence** | 50–300 μs (limits circuit depth to ~100–1,000 gates) |
| **Error correction** | Not yet — below the fault-tolerance threshold |
| **Useful advantage** | Demonstrated for specific tasks, not general-purpose |

### What NISQ Machines Can Do

- **Quantum simulation snippets**: Small molecules (H₂, LiH) to chemical accuracy
- **Variational algorithms**: VQE, QAOA on small instances (~20–50 qubits)
- **Machine learning exploration**: Quantum kernel methods, variational classifiers
- **Supremacy demonstrations**: Tasks with no practical application but provable quantum advantage
- **Error correction research**: Testing codes on real hardware, approaching the threshold

### What They Cannot Do (Yet)

- Factor RSA keys (needs thousands of logical qubits with error correction)
- Outperform classical ML on production datasets
- Simulate large molecules accurately (needs fault-tolerant hardware)
- Solve real optimization problems better than classical heuristics`,
      },
      {
        type: 'concept-card',
        title: 'Physical vs Logical Qubits',
        visual: 'custom-svg',
        explanation:
          'A physical qubit is a real hardware qubit with real errors. A logical qubit is encoded across many physical qubits using error correction. Example: the surface code needs ~1,000 physical qubits per logical qubit at current error rates. So a 1,000-qubit chip gives you roughly 1 logical qubit. To run Shor\'s algorithm on RSA-2048, you need ~4,000 logical qubits = ~4 million physical qubits. That is the scale of the challenge.',
      },
      {
        type: 'text',
        markdown: `## Company Roadmaps

### IBM

| Year | Milestone | Qubits |
|------|-----------|--------|
| 2023 | Condor | 1,121 physical qubits |
| 2024 | Heron (modular) | Improved fidelity, focused on quality |
| 2025 | Flamingo | Chip-to-chip links, multi-processor |
| 2029+ | 100,000+ qubits | Error-corrected logical qubits |

IBM's strategy: improve quality over quantity, modular architecture linking multiple chips, and Qiskit Runtime for cloud access.

### Google

| Year | Milestone |
|------|-----------|
| 2019 | Sycamore — quantum supremacy (53 qubits) |
| 2024 | Willow — below-threshold error correction |
| 2029+ | Useful error-corrected computation |

Google's strategy: reach the error correction threshold first, then scale. Willow showed logical error rates decreasing as code distance increases — a critical milestone.

### NVIDIA

NVIDIA is not building qubits but is critical to the ecosystem:
- **cuQuantum**: GPU-accelerated quantum simulation (up to 40+ qubits on a single GPU)
- **CUDA-Q**: Programming framework for hybrid quantum-classical workflows
- **DGX Quantum**: Paired classical GPU + quantum processor for real-time control
- Strategy: make classical simulation so fast that it sets a high bar for quantum advantage

### Others to Watch

| Company | Approach | Key Bet |
|---------|---------|---------|
| **Quantinuum** | Trapped ions (H-series) | Highest fidelity gates |
| **IonQ** | Trapped ions (Forte) | All-to-all connectivity |
| **QuEra** | Neutral atoms | Scalable error correction |
| **Xanadu** | Photonics (Borealis) | Room-temperature operation |
| **Microsoft** | Topological (Majorana) | Inherently protected qubits |`,
      },
      {
        type: 'text',
        markdown: `## The Path to Useful Quantum Computing

### The Key Milestone: Fault Tolerance

The entire roadmap hinges on one breakthrough: **fault-tolerant quantum error correction** at scale.

\`\`\`
Current state     →  Threshold crossed  →  Logical qubits scale  →  Real applications
(NISQ, noisy)        (errors decrease       (100s of logical         (drug discovery,
                      with code size)        qubits available)       cryptography, etc.)
\`\`\`

Google's Willow chip (2024) showed the first convincing evidence of below-threshold behavior. But scaling from "below threshold on one logical qubit" to "thousands of logical qubits" is still a massive engineering challenge.

### An Honest Timeline

| Timeframe | Realistic Expectation |
|-----------|----------------------|
| **Now (2025–2027)** | NISQ utility experiments, error correction demos, hybrid algorithms on small problems |
| **Near-term (2028–2030)** | First fault-tolerant computations, 10–100 logical qubits, narrow quantum advantage |
| **Medium-term (2030–2035)** | Hundreds of logical qubits, quantum chemistry breakthroughs, early cryptographic threats |
| **Long-term (2035+)** | Thousands of logical qubits, transformative applications, post-quantum crypto is essential |

### What Should You Do Now?

1. **Learn the fundamentals** — you are doing this right now
2. **Write real quantum code** — get comfortable with Qiskit, Cirq, or CUDA-Q
3. **Understand noise** — NISQ-era programmers must think about errors constantly
4. **Study error correction** — it is THE bottleneck and THE opportunity
5. **Stay skeptical of hype** — if a claim sounds too good, check the fine print
6. **Stay optimistic about progress** — the field is moving faster than most predictions`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '15.4-q1',
            question: 'What does NISQ stand for?',
            options: [
              'New Integrated Silicon Quantum',
              'Noisy Intermediate-Scale Quantum',
              'Non-Interactive Stabilizer Quantum',
              'Native Instruction Set for Qubits',
            ],
            correctIndex: 1,
            explanation:
              'NISQ (Noisy Intermediate-Scale Quantum) was coined by John Preskill in 2018. It describes current quantum hardware: 50–1,000+ qubits with error rates too high for full error correction.',
          },
          {
            id: '15.4-q2',
            question: 'Approximately how many physical qubits are needed per logical qubit with the surface code at current error rates?',
            options: ['10', '100', '1,000', '10,000'],
            correctIndex: 2,
            explanation:
              'At current error rates, the surface code requires roughly 1,000 physical qubits to encode one logical qubit. This overhead is why we need millions of physical qubits for algorithms like Shor\'s.',
          },
          {
            id: '15.4-q3',
            question: 'Which milestone did Google\'s Willow chip achieve in 2024?',
            options: [
              'Running Shor\'s algorithm on a 256-bit number',
              'Simulating a protein larger than any classical computer',
              'Below-threshold error correction (logical errors decrease with code size)',
              'Connecting two quantum chips over fiber optic cable',
            ],
            correctIndex: 2,
            explanation:
              'Willow demonstrated that logical error rates decrease as the surface code distance increases — meaning adding more physical qubits actually improves reliability. This is the key threshold for scalable error correction.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The Quantum Hype Cycle',
        visual: 'custom-svg',
        explanation:
          'Quantum computing has been through multiple hype cycles. The honest picture: we are past the "peak of inflated expectations" and moving through the "trough of disillusionment" toward the "slope of enlightenment." Real progress is accelerating (error correction thresholds, better hardware, maturing software), but transformative applications are still years away. The best attitude: excited realism.',
      },
    ],
  },
];
