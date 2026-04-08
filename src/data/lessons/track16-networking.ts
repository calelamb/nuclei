import type { Lesson } from './types';

export const TRACK16_LESSONS: Lesson[] = [
  // ── Lesson 16.1 ──
  {
    id: '16.1',
    title: 'Quantum Repeaters',
    description:
      'Why classical repeaters cannot work for quantum information, how entanglement swapping solves the distance problem, and the road to long-range quantum communication.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['1.5', '4.5'],
    tags: ['repeaters', 'no-cloning', 'entanglement-swapping', 'Bell-measurement', 'quantum-network', 'distance'],
    diracContext:
      'The student should already understand entanglement and teleportation. The key insight: classical repeaters amplify signals by copying them, but no-cloning forbids copying quantum states. The solution is entanglement swapping — performing a Bell measurement on two independently entangled pairs to create entanglement between distant endpoints that never directly interacted. The demo builds the entanglement swapping circuit step by step.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Distance Problem

Quantum information cannot travel far through optical fiber. Photons get absorbed or scattered — after about 100 km, the signal is essentially gone.

Classical networks solved this with **repeaters** that amplify the signal:

\`\`\`
Classical: Alice ──signal──▷ [Repeater copies & amplifies] ──▷ Bob
\`\`\`

But quantum networks cannot do this. The **no-cloning theorem** forbids copying an unknown quantum state. You cannot amplify a qubit without destroying the quantum information it carries.

| Property | Classical Repeater | Quantum "Repeater" |
|----------|-------------------|-------------------|
| **Mechanism** | Copy and amplify | Entanglement swapping |
| **Signal loss** | Fully compensated | Requires fresh entanglement |
| **Error handling** | Error correction on bits | Entanglement purification |
| **Cloning needed** | Yes (copies the signal) | No (uses entanglement) |

### The Quantum Solution

Instead of copying the quantum state, **quantum repeaters** use a completely different strategy:

1. Create entangled pairs over short distances (50–100 km)
2. **Swap** entanglement between segments to extend range
3. **Purify** the resulting entanglement to improve fidelity
4. Use the long-distance entanglement for teleportation or QKD`,
      },
      {
        type: 'concept-card',
        title: 'Entanglement Swapping — The Core Trick',
        visual: 'circuit',
        explanation:
          'Start with two independent Bell pairs: Alice-Relay and Relay-Bob. The relay station performs a Bell measurement on its two qubits (one from each pair). This collapses Alice and Bob\'s qubits into an entangled state — even though they never interacted. Think of it as "transferring" entanglement across a gap. The Bell measurement result must be classically communicated so Bob can apply a correction.',
      },
      {
        type: 'text',
        markdown: `## How Entanglement Swapping Works

Consider three nodes: **Alice**, **Relay**, and **Bob**.

**Step 1:** Create two Bell pairs independently:
- Pair 1: Alice's qubit A₁ entangled with Relay's qubit R₁
- Pair 2: Relay's qubit R₂ entangled with Bob's qubit B₁

**Step 2:** Relay performs a **Bell measurement** on R₁ and R₂ (CNOT + H + measure).

**Step 3:** Relay sends the 2-bit measurement result to Bob.

**Step 4:** Bob applies a correction (I, X, Z, or XZ) based on the result.

**Result:** A₁ and B₁ are now entangled — a Bell pair spanning Alice-to-Bob, even though no quantum information traveled that full distance.

### Chaining Repeaters

For very long distances, chain multiple swaps:

\`\`\`
Alice ──EP── R₁ ──EP── R₂ ──EP── R₃ ──EP── Bob
         swap       swap       swap
     └────────EP────────┘           │
                    └──────────EP───┘
                         └──────EP──────┘  (Alice-Bob entangled)
\`\`\`

EP = Entangled Pair. Each swap doubles the range. With log₂(N) layers of swaps, N segments become one end-to-end pair.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

# Entanglement swapping: create entanglement between qubits
# that never directly interacted

# 4 qubits: A1 (Alice), R1 (Relay), R2 (Relay), B1 (Bob)
# A1-R1 form Bell pair 1, R2-B1 form Bell pair 2
qc = QuantumCircuit(4, 4)

# Step 1: Create Bell pair 1 (Alice - Relay_left)
qc.h(0)       # A1
qc.cx(0, 1)   # A1 -> R1, now A1-R1 entangled
qc.barrier()

# Step 2: Create Bell pair 2 (Relay_right - Bob)
qc.h(2)       # R2
qc.cx(2, 3)   # R2 -> B1, now R2-B1 entangled
qc.barrier()

# Step 3: Bell measurement at Relay (on R1 and R2)
qc.cx(1, 2)   # CNOT: R1 -> R2
qc.h(1)       # Hadamard on R1
qc.barrier()

# Measure relay qubits
qc.measure(1, 1)  # R1 result
qc.measure(2, 2)  # R2 result

# Step 4: Bob corrects based on relay measurement
# (In a real protocol, these would be classically controlled)
# For simulation, we apply conditional corrections:
qc.cx(2, 3)   # if R2=1, apply X to Bob
qc.cz(1, 3)   # if R1=1, apply Z to Bob

# Measure Alice and Bob to verify entanglement
qc.measure(0, 0)  # Alice
qc.measure(3, 3)  # Bob

sim = AerSimulator()
result = sim.run(qc, shots=4096).result()
counts = result.get_counts()

print("=== Entanglement Swapping Results ===")
print("Qubit order: B1 R2 R1 A1 (right to left)")
print()

# Check Alice-Bob correlations
alice_bob_same = 0
alice_bob_diff = 0
for state, count in counts.items():
    alice_bit = int(state[-1])    # rightmost = qubit 0 (Alice)
    bob_bit = int(state[0])       # leftmost = qubit 3 (Bob)
    if alice_bit == bob_bit:
        alice_bob_same += count
    else:
        alice_bob_diff += count

total = alice_bob_same + alice_bob_diff
print(f"Alice-Bob correlation:")
print(f"  Same outcome: {alice_bob_same}/{total} ({100*alice_bob_same/total:.1f}%)")
print(f"  Diff outcome: {alice_bob_diff}/{total} ({100*alice_bob_diff/total:.1f}%)")
print()
print("Top outcomes:")
for state in sorted(counts, key=counts.get, reverse=True)[:6]:
    pct = 100 * counts[state] / 4096
    print(f"  |{state}⟩: {counts[state]:>4} ({pct:.1f}%)")
print()
print("Alice and Bob are now entangled — they never directly interacted!")
print("The relay's Bell measurement 'swapped' entanglement across the gap.")`,
        framework: 'qiskit',
        description:
          'Build the entanglement swapping circuit: two independent Bell pairs linked through a Bell measurement at the relay station. Verify that Alice and Bob end up correlated.',
        explorationPrompt:
          'Try removing the correction gates (cx and cz from relay results to Bob). What happens to the Alice-Bob correlation? Why is the classical communication of measurement results essential?',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '16.1-q1',
            question: 'Why can\'t classical repeater techniques work for quantum communication?',
            options: [
              'Quantum signals are too fast to intercept',
              'The no-cloning theorem forbids copying quantum states',
              'Quantum fiber optics do not exist yet',
              'Classical repeaters are too expensive for quantum networks',
            ],
            correctIndex: 1,
            explanation:
              'Classical repeaters work by copying and amplifying the signal. The no-cloning theorem proves that an unknown quantum state cannot be perfectly copied, so this approach is fundamentally impossible for quantum information.',
          },
          {
            id: '16.1-q2',
            question: 'In entanglement swapping, what operation does the relay station perform?',
            options: [
              'Copies the quantum state from one pair to the other',
              'A Bell measurement on one qubit from each pair',
              'Entangles all four qubits into a GHZ state',
              'Teleports Alice\'s qubit directly to Bob',
            ],
            correctIndex: 1,
            explanation:
              'The relay performs a Bell measurement on its two qubits (one from each independent pair). This projects Alice\'s and Bob\'s remaining qubits into an entangled state, effectively extending entanglement beyond the range of either original pair.',
          },
          {
            id: '16.1-q3',
            question: 'How many layers of entanglement swaps are needed to connect N segments into one end-to-end pair?',
            options: ['N', 'N/2', 'log₂(N)', '2^N'],
            correctIndex: 2,
            explanation:
              'Each layer of swaps halves the number of segments, so log₂(N) layers are needed. This logarithmic scaling is what makes quantum repeater chains practical for long distances.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Quantum Memory — The Missing Piece',
        visual: 'custom-svg',
        explanation:
          'Real quantum repeaters need quantum memory — the ability to store a qubit while waiting for the other half of the swap to succeed. Current quantum memories hold states for milliseconds to seconds, while photon transmission across 100 km takes ~0.5 ms. This timing mismatch is one of the main engineering challenges. Without reliable quantum memory, repeater protocols must succeed on the first try or start over.',
      },
    ],
  },

  // ── Lesson 16.2 ──
  {
    id: '16.2',
    title: 'Entanglement Distribution',
    description:
      'Creating shared entanglement over distance: photon pair sources, fiber and free-space channels, purification protocols, and fidelity management.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['16.1'],
    tags: ['entanglement-distribution', 'purification', 'fidelity', 'photon-pair', 'SPDC', 'Werner-state'],
    diracContext:
      'Building on the repeater lesson, this covers the practical challenge of distributing entanglement over real channels. Photon pairs are generated via SPDC, one photon is kept locally and the other sent through fiber. Channel loss and noise degrade fidelity. Entanglement purification allows combining multiple noisy pairs into fewer high-fidelity pairs. The demo shows the concept of purification using a simplified circuit.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Generating Entangled Photon Pairs

The starting point for any quantum network is a source of **entangled photon pairs**. The most common method:

### Spontaneous Parametric Down-Conversion (SPDC)

A high-energy "pump" photon enters a nonlinear crystal and spontaneously splits into two lower-energy photons that are entangled in polarization, time-bin, or frequency.

| Property | Detail |
|----------|--------|
| **Crystal** | BBO, PPLN, or PPKTP |
| **Input** | UV or blue laser pump photon |
| **Output** | Two entangled photons (signal + idler) |
| **Entanglement type** | Polarization: |HV⟩ + |VH⟩ or time-bin |
| **Rate** | ~10⁶–10⁹ pairs per second |
| **Pair quality** | >95% fidelity to a Bell state |

One photon stays at the source node; the other is sent through fiber or free space to a remote node.

### Channel Loss

Optical fiber absorbs photons: at telecom wavelength (1550 nm), loss is about **0.2 dB/km**. This means:

| Distance | Transmission |
|----------|-------------|
| 10 km | 50% of photons arrive |
| 50 km | 10% arrive |
| 100 km | 1% arrive |
| 200 km | 0.01% arrive |

This exponential loss is why we need repeaters for long distances — you cannot just "boost the power" because each photon is a quantum state.`,
      },
      {
        type: 'text',
        markdown: `## Entanglement Purification

Even when a photon arrives, channel noise degrades the entanglement. After 100 km of fiber, your "Bell pair" might have a fidelity of only 80% — mixed with noise.

**Entanglement purification** distills high-fidelity pairs from multiple noisy ones:

### The BBPSSW Protocol

1. Start with two noisy Bell pairs shared between Alice and Bob (fidelity F < 1)
2. Both Alice and Bob apply a **CNOT** between their two qubits (one from each pair)
3. Both measure one qubit
4. If results agree, keep the remaining pair (now higher fidelity)
5. If results disagree, discard both pairs and try again

| Input | Output | Trade-off |
|-------|--------|-----------|
| 2 noisy pairs (fidelity F) | 1 pair (fidelity F' > F) | 50% success rate |
| 4 noisy pairs | ~1 pair (even higher fidelity) | Multiple rounds |
| Many noisy pairs | Few high-fidelity pairs | Resource intensive |

### When It Works

Purification succeeds when the input fidelity exceeds **F > 0.5** (above the separability threshold). Below 0.5, the pairs are too noisy to recover.

The formula for one round (simplified):

F' = F² / (F² + (1-F)²)

If F = 0.75: F' = 0.5625 / (0.5625 + 0.0625) = 0.90. One round boosts 75% to 90%.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import math

# Demonstrate entanglement purification concept
# Two noisy Bell pairs -> one higher-fidelity pair

# We simulate noise by mixing a perfect Bell pair
# with depolarizing noise using rotation errors

def create_noisy_bell(noise_angle: float) -> QuantumCircuit:
    """Create a Bell pair with controlled noise (rotation error)."""
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    # Add noise: unwanted rotation simulating channel effects
    qc.ry(noise_angle, 0)
    qc.ry(noise_angle, 1)
    return qc

# Purification circuit: 4 qubits (2 pairs), measure pair 2
# If measurement outcomes agree, pair 1 is purified
noise = 0.4  # radians of noise — moderate degradation

qc = QuantumCircuit(4, 4)

# Create noisy Bell pair 1 (qubits 0, 1)
qc.h(0)
qc.cx(0, 1)
qc.ry(noise, 0)
qc.ry(noise, 1)
qc.barrier()

# Create noisy Bell pair 2 (qubits 2, 3)
qc.h(2)
qc.cx(2, 3)
qc.ry(noise, 2)
qc.ry(noise, 3)
qc.barrier()

# Purification: bilateral CNOT
# Alice applies CNOT: qubit 0 (control) -> qubit 2 (target)
# Bob applies CNOT: qubit 1 (control) -> qubit 3 (target)
qc.cx(0, 2)
qc.cx(1, 3)
qc.barrier()

# Measure the "sacrifice" pair (qubits 2, 3)
qc.measure(2, 2)
qc.measure(3, 3)

# Also measure the "kept" pair to check fidelity
qc.measure(0, 0)
qc.measure(1, 1)

sim = AerSimulator()
result = sim.run(qc, shots=8192).result()
counts = result.get_counts()

# Analyze: when sacrifice measurements AGREE, kept pair is purified
agree_counts = {}
disagree_counts = {}

for state, count in counts.items():
    # state format: q3 q2 q1 q0
    q0 = int(state[-1])  # kept pair - Alice
    q1 = int(state[-2])  # kept pair - Bob
    q2 = int(state[-3])  # sacrifice - Alice
    q3 = int(state[-4])  # sacrifice - Bob

    if q2 == q3:  # sacrifice measurements agree -> keep
        key = f"{q1}{q0}"
        agree_counts[key] = agree_counts.get(key, 0) + count
    else:
        key = f"{q1}{q0}"
        disagree_counts[key] = disagree_counts.get(key, 0) + count

total_agree = sum(agree_counts.values())
total_disagree = sum(disagree_counts.values())

print(f"Noise level: {noise:.2f} radians")
print(f"\\n=== When Sacrifice Pair AGREES (purified) ===")
print(f"  Events: {total_agree}/{8192} ({100*total_agree/8192:.1f}%)")
correlated = agree_counts.get('00', 0) + agree_counts.get('11', 0)
anti = agree_counts.get('01', 0) + agree_counts.get('10', 0)
if total_agree > 0:
    fidelity_purified = correlated / total_agree
    print(f"  |00⟩ + |11⟩ (Bell-like): {correlated} ({100*fidelity_purified:.1f}%)")
    print(f"  |01⟩ + |10⟩ (noise):     {anti} ({100*anti/total_agree:.1f}%)")

print(f"\\n=== When Sacrifice Pair DISAGREES (discarded) ===")
print(f"  Events: {total_disagree}/{8192} ({100*total_disagree/8192:.1f}%)")

# Compare with raw noisy pair fidelity
print(f"\\n=== Purification Effect ===")
raw_fid = math.cos(noise / 2) ** 4 + math.sin(noise / 2) ** 4
print(f"  Estimated raw fidelity: {100*raw_fid:.1f}%")
if total_agree > 0:
    print(f"  Purified fidelity:      {100*fidelity_purified:.1f}%")
    print(f"  Improvement:            +{100*(fidelity_purified - raw_fid):.1f} percentage points")`,
        framework: 'qiskit',
        description:
          'Simulate entanglement purification: start with two noisy Bell pairs, apply bilateral CNOTs, measure the sacrifice pair, and verify the remaining pair has improved fidelity.',
        explorationPrompt:
          'Try increasing the noise parameter from 0.4 to 0.8. Does purification still help? At what noise level does the protocol start to fail? What happens at noise=0 (perfect pairs)?',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '16.2-q1',
            question: 'What is the primary method for generating entangled photon pairs?',
            options: [
              'Laser beam splitting',
              'Spontaneous Parametric Down-Conversion (SPDC)',
              'Quantum dot emission',
              'Microwave pulse mixing',
            ],
            correctIndex: 1,
            explanation:
              'SPDC uses a nonlinear crystal to split a pump photon into two lower-energy photons that are entangled. This is the workhorse of quantum networking experiments.',
          },
          {
            id: '16.2-q2',
            question: 'What is the approximate photon transmission through 100 km of standard telecom fiber?',
            options: ['50%', '10%', '1%', '0.001%'],
            correctIndex: 2,
            explanation:
              'At 0.2 dB/km loss, 100 km gives 20 dB of attenuation, meaning only about 1% of photons arrive. This exponential loss is the fundamental reason quantum repeaters are needed.',
          },
          {
            id: '16.2-q3',
            question: 'What does entanglement purification trade to improve fidelity?',
            options: [
              'Distance for fidelity',
              'Multiple noisy pairs for fewer high-fidelity pairs',
              'Classical bits for quantum bits',
              'Speed for accuracy',
            ],
            correctIndex: 1,
            explanation:
              'Purification sacrifices quantity for quality: you start with many noisy entangled pairs and distill them into fewer pairs with higher fidelity. Each round has about a 50% success rate.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The Entanglement Distribution Stack',
        visual: 'custom-svg',
        explanation:
          'Think of quantum networking as a stack: Layer 1 — Physical (photon sources, fiber, detectors). Layer 2 — Link (entanglement generation between adjacent nodes). Layer 3 — Network (entanglement swapping across repeaters). Layer 4 — Purification (distilling high-quality pairs). Layer 5 — Application (QKD, teleportation, distributed computing). Each layer solves one problem and builds on the one below.',
      },
    ],
  },

  // ── Lesson 16.3 ──
  {
    id: '16.3',
    title: 'Quantum Internet Architecture',
    description:
      'The stages of quantum internet development: from simple QKD networks to full distributed quantum computing. Current deployments and future vision.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['16.1', '16.2'],
    tags: ['quantum-internet', 'network-architecture', 'QKD-network', 'stages', 'China', 'EU', 'distributed-computing'],
    diracContext:
      'This lesson is conceptual and forward-looking. Walk through Wehner, Elkouss, and Hanson\'s six-stage quantum internet framework. Current deployments are mostly Stage 1–2 (QKD networks). Highlight real deployments in China (Beijing-Shanghai backbone), EU (Quantum Internet Alliance), and others. Be realistic: full quantum internet is decades away, but incremental progress is real and measurable.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Vision: A Quantum Internet

A **quantum internet** connects quantum processors with quantum communication channels, enabling capabilities impossible with classical networks alone:

- **Unconditionally secure communication** (QKD — already deployed)
- **Distributed quantum sensing** (enhanced precision measurements)
- **Blind quantum computing** (compute on a remote quantum computer without revealing your data)
- **Distributed quantum computing** (link multiple small processors into one large quantum computer)

### The Six Stages (Wehner et al., 2018)

Researchers at QuTech proposed a roadmap with six stages of increasing capability:

| Stage | Name | Key Capability |
|-------|------|---------------|
| **0** | Trusted-node QKD | Point-to-point QKD with trusted relay nodes |
| **1** | Prepare & Measure | End-to-end QKD without trusting relays |
| **2** | Entanglement Distribution | Share Bell pairs between any two nodes |
| **3** | Quantum Memory | Store and retrieve qubits; enable teleportation |
| **4** | Few-Qubit Fault-Tolerant | Small error-corrected operations at nodes |
| **5** | Quantum Computing Network | Full distributed quantum computing |

We are currently at **Stage 0–1** in deployed networks, with **Stage 2** demonstrated in labs.`,
      },
      {
        type: 'concept-card',
        title: 'Classical Internet vs Quantum Internet',
        visual: 'custom-svg',
        explanation:
          'The classical internet transmits copyable bits; routers read, copy, and forward packets. The quantum internet transmits un-copyable qubits; "routers" must use entanglement swapping (no reading or copying). Classical internet took 30+ years from ARPANET (1969) to the modern web. The quantum internet is on a similar trajectory: QKD networks (2000s) are our ARPANET moment.',
      },
      {
        type: 'text',
        markdown: `## Current Deployments

### China — The Global Leader in QKD Networks

| Network | Year | Distance | Notes |
|---------|------|----------|-------|
| **Beijing-Shanghai backbone** | 2017 | 2,000 km | 32 trusted nodes, fiber-based QKD |
| **Integrated space-ground** | 2017–2020 | 4,600 km | Micius satellite + fiber backbone |
| **Hefei metro network** | 2021 | City-wide | Commercial QKD for banking |

China has deployed the world's most extensive QKD infrastructure, combining fiber networks with satellite links.

### European Union — Quantum Internet Alliance

| Initiative | Scope |
|-----------|-------|
| **EuroQCI** | Pan-European QKD infrastructure connecting all 27 EU member states |
| **Quantum Internet Alliance** | Research network at QuTech (Delft) building multi-node quantum networks |
| **QIA testbed** | Three-node entanglement-based network demonstrated (2022) — the first "true" quantum network |

The QuTech team demonstrated entanglement distribution between three nodes using nitrogen-vacancy (NV) centers in diamond — a Stage 2 milestone.

### Other Notable Efforts

| Country/Org | Status |
|------------|--------|
| **South Korea** | 48-node QKD network for government use |
| **Japan** | Tokyo QKD Network (NICT) operational since 2010 |
| **UK** | UK Quantum Network linking Bristol, Cambridge, and London |
| **USA** | DOE quantum networking testbeds (Chicago, BNL-Stony Brook) |`,
      },
      {
        type: 'text',
        markdown: `## Technical Challenges by Stage

### Stage 0–1: QKD Networks (Current)
- ✅ Commercially available (ID Quantique, Toshiba)
- ✅ Deployed in production networks
- ❌ Trusted nodes are a security assumption — not truly end-to-end
- ❌ Limited to point-to-point key distribution

### Stage 2: Entanglement Distribution
- ✅ Lab demonstrations with 2–3 nodes
- ❌ Entanglement generation rates are slow (~1–100 pairs/second over distance)
- ❌ Quantum memories needed to synchronize across links
- ❌ Requires quantum repeaters for distances >100 km

### Stage 3–4: Quantum Memory & Fault Tolerance
- ❌ Quantum memory coherence times too short for networking delays
- ❌ Error correction at the network level largely unexplored
- ❌ Standardized protocols (routing, addressing) not yet defined
- ❌ Hardware heterogeneity (photons, atoms, ions) creates interface challenges

### Stage 5: Full Quantum Computing Network
- ❌ Requires large-scale fault-tolerant processors at each node
- ❌ Distributed entanglement at scale not yet achievable
- ❌ Decades away by most estimates

### The Path Forward

\`\`\`
QKD networks (now)
  → Repeater demonstrations (2025–2028)
    → Metro-scale entanglement networks (2028–2032)
      → Intercity quantum links (2032–2040)
        → Quantum internet (2040+)
\`\`\``,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '16.3-q1',
            question: 'At what stage of the quantum internet roadmap are current deployed networks?',
            options: [
              'Stage 0–1 (QKD with trusted or prepare-and-measure nodes)',
              'Stage 2–3 (entanglement distribution with memory)',
              'Stage 4 (fault-tolerant nodes)',
              'Stage 5 (full quantum computing network)',
            ],
            correctIndex: 0,
            explanation:
              'Current deployed networks are at Stage 0–1: they provide QKD using trusted relay nodes or prepare-and-measure protocols. Stage 2 (entanglement distribution) has been demonstrated in labs but is not yet deployed at scale.',
          },
          {
            id: '16.3-q2',
            question: 'Which country has deployed the most extensive QKD network infrastructure?',
            options: ['United States', 'Japan', 'China', 'Germany'],
            correctIndex: 2,
            explanation:
              'China leads with the 2,000 km Beijing-Shanghai QKD backbone (2017), the Micius satellite link, and multiple metro-scale networks for banking and government use.',
          },
          {
            id: '16.3-q3',
            question: 'What makes a "trusted-node" QKD network less secure than a true quantum network?',
            options: [
              'The encryption keys are shorter',
              'Each relay node decrypts and re-encrypts, so it can read the key',
              'The photons are classical, not quantum',
              'The fiber optic cable can be tapped',
            ],
            correctIndex: 1,
            explanation:
              'In a trusted-node network, each relay station holds the key material in plaintext during the relay process. A compromised relay reveals the key. True quantum networks (Stage 2+) use end-to-end entanglement, eliminating this trust requirement.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The Internet Analogy',
        visual: 'custom-svg',
        explanation:
          'In 1972, the internet was two nodes exchanging packets. Nobody imagined Netflix or smartphones. Today\'s QKD networks are our two-node moment. We can send secret keys between cities, but we cannot yet do distributed quantum computing. The killer applications of the quantum internet may not even be imaginable yet — just as ARPANET researchers could not have predicted social media.',
      },
    ],
  },

  // ── Lesson 16.4 ──
  {
    id: '16.4',
    title: 'Quantum Satellite Communication',
    description:
      'The Micius satellite, space-to-ground QKD, why space helps with decoherence, and future quantum constellation plans.',
    difficulty: 'intermediate',
    estimatedMinutes: 15,
    prerequisites: ['16.1'],
    tags: ['satellite', 'Micius', 'space-QKD', 'free-space', 'photon-loss', 'constellation', 'intercontinental'],
    diracContext:
      'This lesson explains why sending quantum information through space is easier than through fiber for very long distances. Fiber loss is exponential and relentless. Free-space loss is mostly geometric (1/r² diffraction) — the vacuum does not absorb photons. The Micius satellite demonstrated this beautifully with intercontinental QKD and entanglement distribution. Keep it accessible and inspiring.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Why Space?

Sending quantum information through fiber has an exponential attenuation problem:

| Distance | Fiber Transmission | Free-Space Transmission (satellite) |
|----------|-------------------|-------------------------------------|
| 100 km | ~1% | ~30% (depending on weather, altitude) |
| 500 km | ~0.00001% | ~10% |
| 1,000 km | Effectively zero | ~3% |

The key difference: fiber loss is **exponential** (Beer-Lambert law), while free-space loss is mainly **geometric** (beam spreading as 1/r²). In the vacuum of space, there is:

- No absorption (vacuum does not eat photons)
- No scattering (no air molecules above the atmosphere)
- Only diffraction and pointing loss (manageable with good optics)

The atmosphere causes loss and turbulence, but only for the ~10 km closest to the ground. A satellite-to-ground link passes through far less lossy medium than 500 km of fiber.`,
      },
      {
        type: 'concept-card',
        title: 'Fiber vs Free-Space: The Loss Comparison',
        visual: 'custom-svg',
        explanation:
          'Imagine fiber as a foggy tunnel — the farther you go, the more photons get absorbed (exponential loss). Free space is like shining a flashlight from a mountaintop — the beam spreads out (1/r²) but nothing absorbs it. At 500+ km, free space wins overwhelmingly. This is why satellite quantum communication can span continents while fiber cannot.',
      },
      {
        type: 'text',
        markdown: `## The Micius Mission

China's **Micius satellite** (named after the ancient Chinese philosopher Mo-Tzu) launched in 2016 and demonstrated a series of quantum communication firsts:

### Key Experiments

| Year | Achievement | Distance | Significance |
|------|------------|----------|-------------|
| **2017** | Satellite-to-ground QKD | 1,200 km | First space QKD demonstration |
| **2017** | Entanglement distribution | 1,203 km | Bell pairs shared between two ground stations |
| **2017** | Quantum teleportation | Ground-to-satellite | First uplink teleportation |
| **2018** | Intercontinental QKD | Vienna–Beijing (~7,600 km) | First intercontinental quantum-secured video call |

### How It Works

1. **Downlink QKD**: Micius generates entangled photon pairs onboard. One photon is measured on the satellite; the other is sent to a ground station through a telescope.

2. **Entanglement distribution**: Both photons are sent to *different* ground stations. After photons arrive, the stations share entanglement spanning 1,200 km.

3. **Ground stations**: Located at high-altitude observatories (less atmosphere) with 1-meter telescopes for photon collection. Requires clear night sky.

### Limitations

| Challenge | Detail |
|-----------|--------|
| **Weather** | Clouds block photons — needs clear skies |
| **Daytime** | Solar background photons overwhelm the signal |
| **Orbit** | Low Earth orbit — each pass gives ~5 minutes of link time |
| **Trust model** | Satellite holds key material (trusted-node model) |
| **Rate** | Key generation: ~1 kbit/s (enough for key exchange, not bulk data) |`,
      },
      {
        type: 'text',
        markdown: `## The Next Generation

### Daylight QKD

Recent experiments have demonstrated QKD during **daytime** using:
- Narrowband spectral filters (accept only the exact photon wavelength)
- Fast time-gating (accept photons only in narrow time windows)
- Adaptive optics (compensate for atmospheric turbulence)

### Constellation Plans

The next step is moving from single satellites to **constellations**:

| Plan | Organization | Concept |
|------|-------------|---------|
| **EuroQCI Space** | EU | Constellation of QKD satellites covering all of Europe |
| **QKD constellation** | SpeQtral (Singapore) | Commercial LEO satellite QKD service |
| **QSNET** | UK | Satellite-based quantum network testbed |
| **Chinese expansion** | CAST/CAS | GEO satellite + expanded LEO constellation |

### Medium-Earth and Geostationary Orbits

| Orbit | Altitude | Link Time | Loss |
|-------|---------|-----------|------|
| **LEO** | 500 km | 5 min/pass | Low (~10 dB) |
| **MEO** | 10,000 km | Hours | Medium (~25 dB) |
| **GEO** | 36,000 km | Continuous | High (~40 dB), but always visible |

GEO satellites would provide continuous links but require much better detectors. MEO is a compromise. The trend is toward hybrid constellations: LEO for high-rate distribution, GEO for persistent coverage.

### The Long-Term Vision

\`\`\`
Ground QKD networks  +  Satellite links  =  Global quantum internet backbone
     (metro-scale)      (intercontinental)
\`\`\`

Satellites solve the long-haul problem. Ground fiber solves the last-mile problem. Together they create a global quantum network. Combined with quantum repeaters (when mature), the system could support entanglement distribution anywhere on Earth.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '16.4-q1',
            question: 'Why is free-space (satellite) transmission better than fiber for very long distances?',
            options: [
              'Satellites can amplify quantum signals',
              'Fiber loss is exponential while free-space loss is mainly geometric (1/r²)',
              'Photons travel faster in space',
              'Satellites can clone photons to compensate for loss',
            ],
            correctIndex: 1,
            explanation:
              'Fiber optic loss is exponential (each km absorbs the same fraction). Free-space loss is mainly geometric — the beam spreads but the vacuum does not absorb. At distances above ~500 km, free-space channels dramatically outperform fiber.',
          },
          {
            id: '16.4-q2',
            question: 'What was the first intercontinental quantum-secured communication demonstrated by Micius?',
            options: [
              'A text message between Beijing and New York',
              'A video call between Vienna and Beijing',
              'Quantum teleportation from Tokyo to London',
              'Entanglement distribution between Sydney and Geneva',
            ],
            correctIndex: 1,
            explanation:
              'In 2018, the Micius satellite enabled a quantum-key-secured video conference between the Chinese Academy of Sciences in Beijing and the Austrian Academy of Sciences in Vienna — spanning approximately 7,600 km.',
          },
          {
            id: '16.4-q3',
            question: 'What is the main limitation of current satellite QKD?',
            options: [
              'Photons cannot survive in space',
              'It requires clear night sky, and the satellite uses a trusted-node model',
              'The key rate is too fast to process',
              'Ground stations are too expensive to build',
            ],
            correctIndex: 1,
            explanation:
              'Current satellite QKD needs clear weather and nighttime (to avoid solar background). The satellite itself holds key material, making it a trusted node — not true end-to-end quantum security. Daylight QKD and entanglement-based protocols are being developed to address these limitations.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Quantum Communication: Where We Stand',
        visual: 'custom-svg',
        explanation:
          'The quantum communication landscape in 2026: QKD over fiber works reliably up to ~100 km. Satellites extend this to intercontinental distances. Quantum repeaters (lab demonstrations) will eventually fill the gap. The technology stack is coming together: better sources, better detectors, better memories. The question is not "if" but "when" — and most estimates point to operational quantum networks in the 2030s.',
      },
    ],
  },
];
