import type { Lesson } from './types';

export const TRACK10_LESSONS: Lesson[] = [
  // ── Lesson 10.1 ──
  {
    id: '10.1',
    title: 'Superconducting Qubits',
    description:
      'IBM, Google, Rigetti — transmon qubits, microwave control, and dilution refrigerators. How the most popular quantum computers work.',
    difficulty: 'beginner',
    estimatedMinutes: 20,
    prerequisites: ['1.1'],
    tags: ['superconducting', 'transmon', 'microwave', 'dilution-refrigerator', 'IBM', 'Google', 'Rigetti'],
    diracContext:
      'This is the first hardware lesson. The student may have only worked with simulators. Emphasize the physical picture: a tiny aluminum circuit on a chip, cooled to 15 millikelvin, manipulated by microwave pulses. Compare to classical transistors. Use analogies — the dilution fridge is colder than outer space. Keep it visual and grounded.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## From Software to Silicon

Every circuit you have built so far ran on a **simulator** — classical code pretending to be quantum. Real quantum computers are physical machines, and the most common type today uses **superconducting qubits**.

IBM (Eagle, Heron), Google (Sycamore, Willow), and Rigetti all build on this technology. If you have ever seen a golden chandelier hanging in a lab photo, that is a **dilution refrigerator** — the machine that cools superconducting chips to 15 millikelvin, 100 times colder than outer space.

### The Transmon Qubit

A **transmon** is a tiny circuit made of aluminum on a sapphire or silicon chip. Two superconducting electrodes sandwich a **Josephson junction** — a thin insulating barrier that electrons tunnel through.

| Component | Role |
|-----------|------|
| **Josephson junction** | Creates the nonlinear energy spectrum that gives you discrete |0⟩ and |1⟩ levels |
| **Capacitor pads** | Tune the qubit frequency and reduce charge noise |
| **Microwave drive line** | Sends shaped pulses to rotate the qubit state |
| **Readout resonator** | Coupled cavity whose frequency shifts depending on qubit state |

The key insight: a superconducting circuit has **quantized energy levels**, just like an atom. You use only the two lowest levels as |0⟩ and |1⟩.`,
      },
      {
        type: 'concept-card',
        title: 'Anatomy of a Dilution Refrigerator',
        visual: 'custom-svg',
        explanation:
          'The fridge has multiple temperature stages: 300 K (room temp) → 40 K → 4 K → 700 mK → 100 mK → 15 mK at the mixing chamber. The quantum chip sits at the bottom. Each stage has attenuators and filters to prevent thermal photons from disturbing qubits. The golden wiring carries microwave control signals.',
      },
      {
        type: 'text',
        markdown: `## How Gates Work

Microwave pulses at the qubit's resonant frequency (~5 GHz) rotate the Bloch vector. A calibrated pulse lasting ~20–50 nanoseconds implements one gate.

| Operation | Physical Mechanism |
|-----------|-------------------|
| **X gate (bit flip)** | Resonant microwave pulse, π rotation |
| **Z gate (phase)** | Virtual — shift the reference frame of subsequent pulses |
| **CNOT / CZ** | Flux-tunable coupling between adjacent qubits, or cross-resonance drive |
| **Measurement** | Probe the readout resonator; frequency shift reveals |0⟩ vs |1⟩ |

Gate times are ~20–100 ns, while coherence times (T₁, T₂) are 50–300 μs. That gives you roughly **1000–5000 gate operations** before the qubit decoheres — the race against noise.

### Strengths and Limitations

| ✅ Strengths | ❌ Limitations |
|-------------|---------------|
| Fast gate times (~50 ns) | Requires extreme cooling (15 mK) |
| Mature fabrication (lithography) | Limited connectivity (nearest-neighbor) |
| Largest processors (1000+ qubits) | Frequency crowding as chips scale |
| Strong ecosystem (Qiskit, Cirq) | Each qubit is slightly different (variability) |`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error

# Simulate what running on a real superconducting chip feels like:
# nearest-neighbor connectivity + depolarizing noise
qc = QuantumCircuit(3, 3)
qc.h(0)
qc.cx(0, 1)  # Adjacent — direct CNOT
qc.cx(1, 2)  # Adjacent — direct CNOT
qc.measure([0, 1, 2], [0, 1, 2])

# Build a simple noise model (typical superconducting fidelities)
noise = NoiseModel()
noise.add_all_qubit_quantum_error(depolarizing_error(0.001), ['h'])
noise.add_all_qubit_quantum_error(depolarizing_error(0.01), ['cx'])

sim = AerSimulator(noise_model=noise)
result = sim.run(qc, shots=4096).result()
counts = result.get_counts()
print("GHZ state with superconducting-like noise:")
for state, count in sorted(counts.items(), key=lambda x: -x[1])[:6]:
    print(f"  |{state}⟩: {count} ({100*count/4096:.1f}%)")`,
        framework: 'qiskit',
        description:
          'A 3-qubit GHZ state with depolarizing noise mimicking superconducting gate fidelities. Notice how noise smears the ideal 50/50 split between |000⟩ and |111⟩.',
        explorationPrompt:
          'Try increasing the depolarizing error on cx to 0.05. How much worse does the output get? What if you add more qubits in the chain?',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '10.1-q1',
            question: 'What creates the discrete energy levels in a transmon qubit?',
            options: [
              'A laser beam focused on a silicon atom',
              'A Josephson junction providing a nonlinear inductance',
              'A magnetic field applied to a trapped ion',
              'An optical cavity reflecting photons',
            ],
            correctIndex: 1,
            explanation:
              'The Josephson junction is a nonlinear element whose inductance depends on current. This nonlinearity splits the energy levels unevenly, letting you address only the two lowest as |0⟩ and |1⟩.',
          },
          {
            id: '10.1-q2',
            question: 'Why must superconducting qubits be cooled to ~15 millikelvin?',
            options: [
              'Superconductivity requires zero resistance, which only occurs near absolute zero',
              'Thermal photons at higher temperatures would excite the qubit out of |0⟩',
              'Both — superconductivity and thermal noise suppression',
              'The microwave pulses only propagate at low temperatures',
            ],
            correctIndex: 2,
            explanation:
              'The aluminum must be superconducting (below its critical temperature), AND thermal energy must be far below the qubit transition energy (~5 GHz ≈ 240 mK) to avoid spontaneous excitation.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The Gate Speed vs Coherence Race',
        visual: 'histogram',
        explanation:
          'Gate time ~50 ns. T₁ ~200 μs. That ratio gives ~4000 operations before decoherence. But two-qubit gates are slower (~300 ns) and noisier (~99% fidelity), so practical circuit depth is limited to a few hundred layers on current hardware.',
      },
    ],
  },

  // ── Lesson 10.2 ──
  {
    id: '10.2',
    title: 'Trapped Ion Qubits',
    description:
      'IonQ, Quantinuum — individual atoms held by electric fields and controlled by lasers. All-to-all connectivity and long coherence times.',
    difficulty: 'beginner',
    estimatedMinutes: 20,
    prerequisites: ['1.1'],
    tags: ['trapped-ion', 'IonQ', 'Quantinuum', 'laser-control', 'all-to-all', 'ytterbium'],
    diracContext:
      'Contrast with superconducting from 10.1. Trapped ions have ALL-to-ALL connectivity (any qubit can talk to any other), much longer coherence times, but slower gates. Use analogies — ions in a Paul trap are like beads on a string held by electric fields. Laser pulses replace microwave pulses.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Atoms as Qubits

What if your qubit was a single atom — perfect, identical, and provided by nature?

**Trapped ion quantum computers** use individual ions (usually ytterbium-171 or barium-133) held in place by oscillating electric fields called a **Paul trap**. Two internal energy levels of the ion serve as |0⟩ and |1⟩.

### How It Works

1. **Trapping:** Radio-frequency electric fields create a potential well. Ions float in vacuum, arranged in a line like beads on a string
2. **Cooling:** Laser cooling brings ions to near rest (microkelvin temperatures — warm compared to superconducting, but the qubits are naturally isolated)
3. **Single-qubit gates:** A focused laser pulse drives transitions between |0⟩ and |1⟩ within one ion
4. **Two-qubit gates:** Lasers excite shared vibrational modes of the ion chain — the ions "talk" through their collective motion (Mølmer-Sørensen or XX gate)
5. **Measurement:** Shine a resonant laser; if the ion is in |1⟩, it fluoresces. A camera detects the glow.

> **Key advantage:** Because the vibrational bus connects all ions, ANY pair can interact directly — **all-to-all connectivity**. No SWAP chains needed.`,
      },
      {
        type: 'concept-card',
        title: 'Paul Trap: Ions in a Line',
        visual: 'custom-svg',
        explanation:
          'Ions are confined by oscillating (RF) electric fields into a linear chain. Each glowing dot is one qubit — a single atom. Focused laser beams address individual ions for gates. Shared vibrational modes (phonons) mediate entanglement between any pair.',
      },
      {
        type: 'text',
        markdown: `## Superconducting vs Trapped Ion

| Property | Superconducting | Trapped Ion |
|----------|:-:|:-:|
| **Qubit** | Aluminum circuit | Single atom |
| **Gate time (1Q)** | ~50 ns | ~10 μs |
| **Gate time (2Q)** | ~300 ns | ~200 μs |
| **T₁ coherence** | 50–300 μs | Seconds to minutes |
| **Connectivity** | Nearest-neighbor | All-to-all |
| **2Q fidelity** | ~99.5% | ~99.5–99.9% |
| **Qubit count (2025)** | 1000+ | ~50–60 |
| **Operating temp** | 15 mK | Room temp (vacuum) |
| **Key players** | IBM, Google, Rigetti | IonQ, Quantinuum |

The tradeoff is clear: **trapped ions are slower but more accurate and flexible**. Superconducting is faster but noisier and connectivity-constrained.

### Scaling Challenges

Adding ions to a single chain makes it heavier and slower. Solutions include:
- **Quantum charge-coupled devices (QCCD):** Shuttle ions between zones on a chip
- **Photonic interconnects:** Entangle ions in separate traps via photons
- **2D trap arrays:** Move beyond linear chains`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error

# Trapped ion advantage: all-to-all connectivity
# Every qubit can directly entangle with every other — no SWAPs needed
qc = QuantumCircuit(4, 4)
qc.h(0)
# Direct long-range CNOTs (impossible on nearest-neighbor hardware)
qc.cx(0, 3)  # Qubit 0 directly entangles with qubit 3
qc.cx(0, 2)  # And with qubit 2
qc.cx(0, 1)  # And with qubit 1
qc.measure([0, 1, 2, 3], [0, 1, 2, 3])

# Trapped ion noise model: higher 2Q fidelity than superconducting
noise = NoiseModel()
noise.add_all_qubit_quantum_error(depolarizing_error(0.0005), ['h'])
noise.add_all_qubit_quantum_error(depolarizing_error(0.003), ['cx'])

sim = AerSimulator(noise_model=noise)
result = sim.run(qc, shots=4096).result()
counts = result.get_counts()
print("4-qubit GHZ with trapped-ion-like noise (all-to-all):")
for state, count in sorted(counts.items(), key=lambda x: -x[1])[:6]:
    print(f"  |{state}⟩: {count} ({100*count/4096:.1f}%)")`,
        framework: 'qiskit',
        description:
          'A 4-qubit GHZ state using direct long-range CNOTs — no SWAP overhead. The noise model reflects higher trapped-ion fidelities.',
        explorationPrompt:
          'Compare the output distribution to the superconducting demo in 10.1. Which has less noise leakage? What is the tradeoff?',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '10.2-q1',
            question: 'How do trapped ion qubits perform two-qubit gates?',
            options: [
              'By physically moving ions next to each other',
              'Through shared vibrational modes (phonons) of the ion chain',
              'By sending photons between ions in separate traps',
              'By applying a magnetic field gradient',
            ],
            correctIndex: 1,
            explanation:
              'Laser pulses excite collective vibrational modes (phonons) that couple any pair of ions in the chain, enabling all-to-all two-qubit gates like the Mølmer-Sørensen gate.',
          },
          {
            id: '10.2-q2',
            question: 'What is the main advantage of trapped ion all-to-all connectivity?',
            options: [
              'Faster gate times',
              'No need for SWAP gates to connect distant qubits',
              'Lower operating temperatures',
              'More qubits per chip',
            ],
            correctIndex: 1,
            explanation:
              'All-to-all connectivity means any qubit can interact with any other directly. On nearest-neighbor hardware, connecting distant qubits requires SWAP chains that add depth and noise.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Measurement by Fluorescence',
        visual: 'custom-svg',
        explanation:
          'Shine a laser tuned to a cycling transition. If the ion is in the "bright" state, it scatters thousands of photons — visible as a glowing dot on a camera. The "dark" state does not fluoresce. This gives >99% measurement fidelity with a single shot.',
      },
    ],
  },

  // ── Lesson 10.3 ──
  {
    id: '10.3',
    title: 'Photonic Quantum Computing',
    description:
      'Xanadu, PsiQuantum — photons as qubits, beam splitters, squeezed light, and room-temperature operation.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['10.1'],
    tags: ['photonic', 'Xanadu', 'PsiQuantum', 'boson-sampling', 'squeezed-light', 'beam-splitter'],
    diracContext:
      'Photonic QC is fundamentally different — qubits are photons, gates are optical elements, and the whole thing can run at room temperature. The catch: photons do not naturally interact, making two-qubit gates probabilistic. Cover measurement-based and fusion-based approaches. Boson sampling is the key advantage demo.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Light as a Quantum Computer

What if your qubits were particles of light?

**Photonic quantum computing** encodes information in photons — their polarization, path, or arrival time. The machines run at **room temperature** (photons do not decohere from heat the way matter qubits do) and can transmit quantum information over optical fibers.

### Encoding Schemes

| Encoding | |0⟩ | |1⟩ | Gate mechanism |
|----------|-----|-----|----------------|
| **Polarization** | Horizontal (H) | Vertical (V) | Wave plates |
| **Dual-rail** | Photon in mode A | Photon in mode B | Beam splitters |
| **Squeezed states** | Continuous variable | Continuous variable | Homodyne detection |
| **Time-bin** | Early pulse | Late pulse | Interferometers |

### Key Components

- **Beam splitters:** The photonic equivalent of a Hadamard gate
- **Phase shifters:** Apply Z-like rotations
- **Squeezed light sources:** Generate entangled photon pairs
- **Photon detectors:** Measurement — but destructive (photon is absorbed)

> **The fundamental challenge:** Photons do not naturally interact with each other. Two-qubit gates require either measurement-induced nonlinearity (KLM protocol) or **fusion gates** that succeed probabilistically.`,
      },
      {
        type: 'concept-card',
        title: 'Beam Splitter as Hadamard',
        visual: 'circuit',
        explanation:
          'A 50:50 beam splitter transforms a photon in path A into a superposition of path A and path B — exactly like a Hadamard gate on a dual-rail qubit. The phase shifter then acts like an Rz rotation. Linear optics gives you all single-qubit gates for free.',
      },
      {
        type: 'text',
        markdown: `## Approaches to Photonic QC

### Measurement-Based (MBQC)
Build a massive entangled cluster state first, then perform the computation by measuring individual photons in chosen bases. Each measurement teleports and processes information. Xanadu and PsiQuantum pursue this model.

### Boson Sampling
Not universal QC, but a task photonic systems excel at: send identical photons through an interferometer and sample the output distribution. Classically intractable for ~50+ photons. China's Jiuzhang and Xanadu's Borealis demonstrated this.

### Fusion-Based (FBQC)
Generate small entangled "resource states," then fuse them together with probabilistic Bell measurements. Failed fusions are handled by redundancy. PsiQuantum's primary approach.

| ✅ Strengths | ❌ Limitations |
|-------------|---------------|
| Room-temperature operation | Probabilistic two-qubit gates |
| Natural for quantum networking | Photon loss is the dominant error |
| Fast (speed of light) | Generating identical photons at scale is hard |
| Silicon photonic integration | Photon detectors are imperfect |`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

# Simulate a simple photonic-style interferometer
# Two modes (dual-rail encoding) passing through beam splitters
qc = QuantumCircuit(2, 2)

# Input: one photon in mode 0 (|10⟩ in dual-rail)
qc.x(0)

# Beam splitter = Hadamard on the mode basis
qc.h(0)

# Phase shifter on mode 1
qc.rz(3.14159 / 4, 1)

# Second beam splitter
qc.h(0)
qc.cx(0, 1)  # Entangling interaction (idealized)

qc.measure([0, 1], [0, 1])

sim = AerSimulator()
result = sim.run(qc, shots=4096).result()
counts = result.get_counts()
print("Photonic interferometer simulation:")
for state, count in sorted(counts.items(), key=lambda x: -x[1]):
    print(f"  |{state}⟩: {count} ({100*count/4096:.1f}%)")`,
        framework: 'qiskit',
        description:
          'A simplified dual-rail photonic interferometer simulated with qubits. Real photonic circuits use beam splitters and phase shifters rather than H and Rz gates, but the math is identical.',
        explorationPrompt:
          'Vary the Rz angle. How does the output distribution change? In a real photonic chip, this phase shifter is a thermo-optic element you can tune continuously.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '10.3-q1',
            question: 'Why is the two-qubit gate the hardest part of photonic quantum computing?',
            options: [
              'Photons move too fast to control',
              'Photons do not naturally interact with each other',
              'Beam splitters always destroy photons',
              'Phase shifters cannot produce entanglement',
            ],
            correctIndex: 1,
            explanation:
              'Photons are non-interacting bosons. Single-qubit gates (beam splitters, phase shifters) are easy, but making two photons influence each other requires indirect methods like measurement-induced nonlinearity.',
          },
          {
            id: '10.3-q2',
            question: 'What is boson sampling?',
            options: [
              'A universal quantum algorithm for optimization',
              'Sampling the output distribution of identical photons through an interferometer',
              'A technique for cooling photonic chips',
              'A method for generating entangled photon pairs',
            ],
            correctIndex: 1,
            explanation:
              'Boson sampling sends identical photons through a linear optical network and samples where they exit. The output distribution is governed by matrix permanents, which are classically hard to compute.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Room Temperature Advantage',
        visual: 'custom-svg',
        explanation:
          'Superconducting qubits need 15 mK. Trapped ions need vacuum and laser cooling. Photons propagate happily at room temperature — no cryogenics needed. This makes photonic systems attractive for scaling and integration with telecom fiber networks.',
      },
    ],
  },

  // ── Lesson 10.4 ──
  {
    id: '10.4',
    title: 'Neutral Atom Qubits',
    description:
      'QuEra, Pasqal — optical tweezers, Rydberg interactions, and reconfigurable qubit arrays for analog and digital quantum computing.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['10.2'],
    tags: ['neutral-atom', 'QuEra', 'Pasqal', 'optical-tweezers', 'Rydberg', 'analog-simulation'],
    diracContext:
      'Neutral atoms are a newer platform gaining momentum. Key differentiator: you can REARRANGE the qubits mid-computation using optical tweezers. Rydberg blockade enables entangling gates by exciting atoms to giant orbital states. Compare with trapped ions — similar (atoms) but different trapping and entanglement mechanism.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Atoms Held by Light

Neutral atom quantum computers trap individual atoms (usually rubidium-87 or cesium-133) using **optical tweezers** — tightly focused laser beams that hold atoms in place like tiny tractor beams.

Unlike trapped ions, these atoms have **no electric charge**, so they do not repel each other. You can pack them close together and rearrange them at will.

### How It Works

1. **Loading:** A magneto-optical trap captures a cloud of cold atoms. Optical tweezers pick them up one by one and arrange them in a 2D or 3D array
2. **Rearrangement:** Moving the tweezer beams repositions atoms — you can reconfigure the qubit connectivity graph between circuit layers
3. **Single-qubit gates:** Laser or microwave pulses drive transitions between hyperfine ground states
4. **Two-qubit gates (Rydberg blockade):** Excite one atom to a highly excited Rydberg state (n ~ 50–100). Its enormous electric dipole field shifts the energy of nearby atoms, blocking double excitation — a controlled interaction
5. **Measurement:** Fluorescence imaging, similar to trapped ions

> **Unique advantage:** You can literally pick up qubits and move them. No other platform offers reconfigurable connectivity.`,
      },
      {
        type: 'concept-card',
        title: 'Rydberg Blockade',
        visual: 'custom-svg',
        explanation:
          'When atom A is excited to a Rydberg state, its giant electron cloud creates a strong dipole field. Any atom B within the "blockade radius" cannot also be excited — the energy levels shift out of resonance. This conditional behavior is a natural CNOT-like gate.',
      },
      {
        type: 'text',
        markdown: `## Analog vs Digital Mode

Neutral atoms excel at **analog quantum simulation** — directly mimicking Hamiltonians of interest rather than compiling into gates.

| Mode | Description | Strength |
|------|-------------|----------|
| **Digital** | Gate-by-gate circuits (like other platforms) | Universal computation |
| **Analog** | Evolve under a programmable Hamiltonian | Natural for many-body physics, optimization |
| **Hybrid** | Alternate digital and analog blocks | Best of both worlds |

### Scaling Prospects

| Property | Current (2025) | Near-term |
|----------|:-:|:-:|
| Qubit count | ~200–300 | 1000+ |
| 2Q gate fidelity | ~99.5% | >99.9% (target) |
| Connectivity | Reconfigurable | Full 2D/3D arrays |

### Key Players

- **QuEra** (Harvard/MIT spin-off): Rubidium atoms, digital + analog hybrid
- **Pasqal** (France): Cesium/rubidium atoms, focus on optimization and simulation
- **Atom Computing** (acquired by Quantum Circuits): Nuclear spin qubits in strontium, long coherence`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

# Neutral atom advantage: reconfigurable connectivity
# Simulate an arrangement where non-adjacent qubits interact directly
# (representing optical tweezer rearrangement between layers)

qc = QuantumCircuit(6, 6)

# Layer 1: Create pairs (atoms arranged as neighbors)
qc.h(0)
qc.cx(0, 1)  # Pair (0,1)
qc.h(2)
qc.cx(2, 3)  # Pair (2,3)
qc.h(4)
qc.cx(4, 5)  # Pair (4,5)

qc.barrier()

# Layer 2: Rearrange atoms! Now (1,2) and (3,4) are neighbors
qc.cx(1, 2)  # After rearrangement
qc.cx(3, 4)  # After rearrangement

qc.measure(range(6), range(6))

sim = AerSimulator()
result = sim.run(qc, shots=4096).result()
counts = result.get_counts()
print("6-qubit cluster state (reconfigurable connectivity):")
for state, count in sorted(counts.items(), key=lambda x: -x[1])[:8]:
    print(f"  |{state}⟩: {count} ({100*count/4096:.1f}%)")`,
        framework: 'qiskit',
        description:
          'Simulating reconfigurable connectivity: qubits are rearranged between circuit layers. On fixed-topology hardware, this would require SWAP chains.',
        explorationPrompt:
          'Think about graph coloring or optimization problems. How would reconfigurable connectivity help encode problem graphs directly into the qubit layout?',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '10.4-q1',
            question: 'What makes the Rydberg blockade useful for two-qubit gates?',
            options: [
              'It cools atoms to lower temperatures',
              'An excited atom prevents nearby atoms from being excited — a conditional interaction',
              'It increases the speed of single-qubit gates',
              'It allows atoms to be detected without fluorescence',
            ],
            correctIndex: 1,
            explanation:
              'A Rydberg atom has such a large dipole that it shifts the energy levels of neighbors out of resonance. This "blockade" is a controllable conditional interaction — exactly what you need for entangling gates.',
          },
          {
            id: '10.4-q2',
            question: 'What unique capability do optical tweezers provide?',
            options: [
              'Faster gate operations',
              'Longer coherence times',
              'Reconfigurable qubit connectivity by physically moving atoms',
              'The ability to operate without lasers',
            ],
            correctIndex: 2,
            explanation:
              'Optical tweezers can pick up and reposition individual atoms between circuit layers, changing which qubits are neighbors. No other platform offers this mid-computation reconfiguration.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Analog Quantum Simulation',
        visual: 'circuit',
        explanation:
          'Instead of compiling a problem into H, CNOT, Rz gates, analog mode directly programs the interaction Hamiltonian. For condensed matter physics and optimization, this can be exponentially more efficient than the gate model — fewer layers, less noise, more natural.',
      },
    ],
  },

  // ── Lesson 10.5 ──
  {
    id: '10.5',
    title: 'Topological Qubits',
    description:
      'Microsoft\'s approach — Majorana fermions, non-Abelian anyons, and inherently error-protected qubits. The furthest from realization but the most ambitious.',
    difficulty: 'advanced',
    estimatedMinutes: 20,
    prerequisites: ['10.1', '5.1'],
    tags: ['topological', 'Microsoft', 'Majorana', 'anyon', 'non-Abelian', 'fault-tolerant'],
    diracContext:
      'This is the most speculative platform. Microsoft bet big on topological qubits and only demonstrated basic feasibility in 2025. The key idea: encode information in the TOPOLOGY of particle braids, not in fragile local states. Errors require global changes, making the qubit inherently protected. Use analogies — braiding shoelaces, knots that cannot be undone by local wiggling.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Computing with Knots

Every other qubit technology stores quantum information in a **local** property — an energy level, a spin, a polarization. Local information is fragile: any local disturbance can flip it.

**Topological qubits** store information in **global** properties — specifically, in the braiding patterns of exotic particles called **non-Abelian anyons**. Local noise cannot change a braid without cutting the string. This makes topological qubits **inherently error-protected**.

### The Concept

In certain 2D materials at very low temperatures, collective excitations behave as **anyons** — particles that are neither bosons nor fermions. A special subclass called **non-Abelian anyons** have a remarkable property: when you exchange (braid) them, the quantum state of the system changes in a way that depends on the **order** of the exchanges, not just the number.

| Concept | Analogy |
|---------|---------|
| **Anyon** | A quasiparticle living in a 2D plane |
| **Braiding** | Moving one anyon around another — like braiding hair |
| **Topological protection** | The information is in the braid pattern; local wiggling cannot undo a knot |
| **Gate = braid** | Different braid sequences implement different quantum gates |`,
      },
      {
        type: 'concept-card',
        title: 'Braiding as Computation',
        visual: 'custom-svg',
        explanation:
          'Imagine two anyons on a table. Moving anyon A counterclockwise around anyon B implements a quantum gate. The gate depends on the topology of the path — not on its exact shape. Small perturbations (noise) do not change the topology, so the gate is inherently protected.',
      },
      {
        type: 'text',
        markdown: `## Microsoft's Approach: Majorana Zero Modes

Microsoft is pursuing **Majorana zero modes** — quasiparticles predicted to exist at the ends of special nanowires (topological superconductors). Two Majorana modes form one topological qubit.

### The Hardware Stack

1. **Nanowire:** Indium arsenide (InAs) semiconductor coated with aluminum (superconductor)
2. **Magnetic field + electrostatic gates:** Tune the wire into the topological phase
3. **Majorana zero modes:** Appear at wire endpoints — these are the qubit
4. **Braiding:** Move Majorana modes by tuning gate voltages along a network of wires

### Current Status (2025)

Microsoft announced the first demonstration of a topological qubit in 2025, but this technology remains **years behind** other platforms:

| Milestone | Status |
|-----------|--------|
| Detect Majorana signatures | Achieved (with debate) |
| Create a topological qubit | Basic demonstration (2025) |
| Two-qubit gate | Not yet demonstrated |
| Error correction advantage | Theoretical |
| Fault-tolerant processor | 10+ years away |

### Why It Matters

If topological qubits work as theorized, the error rates would be **exponentially suppressed** by the energy gap of the topological phase. You would need far fewer physical qubits per logical qubit — potentially 10–100x fewer than surface codes on superconducting hardware.

| ✅ Promise | ❌ Reality Check |
|-----------|-----------------|
| Inherent error protection | Extremely difficult to fabricate |
| Fewer physical qubits needed | Basic operations not yet demonstrated |
| Elegant mathematical framework | Furthest from practical computation |
| Could leapfrog other approaches | Decades of materials science ahead |`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '10.5-q1',
            question: 'Why are topological qubits considered inherently error-protected?',
            options: [
              'They operate at higher temperatures than other qubits',
              'Information is stored in global topological properties that local noise cannot change',
              'They use stronger magnetic fields to shield from interference',
              'Majorana fermions are perfectly stable particles',
            ],
            correctIndex: 1,
            explanation:
              'Topological protection means information is encoded in the braiding pattern of anyons — a global property. Local perturbations (noise) cannot change a braid without cutting it, providing exponential error suppression.',
          },
          {
            id: '10.5-q2',
            question: 'What are Majorana zero modes?',
            options: [
              'Photons trapped in an optical cavity',
              'Quasiparticles at the ends of topological superconductor nanowires',
              'Vibrations in a trapped ion chain',
              'Energy levels in a transmon qubit',
            ],
            correctIndex: 1,
            explanation:
              'Majorana zero modes are exotic quasiparticles predicted to appear at the boundaries of topological superconductors. Two Majorana modes encode one topological qubit.',
          },
          {
            id: '10.5-q3',
            question: 'What is the current practical status of topological quantum computing?',
            options: [
              'Ready for commercial applications',
              'Demonstrated advantage over classical computers',
              'Basic qubit demonstrated but two-qubit gates not yet achieved',
              'Thousands of topological qubits available',
            ],
            correctIndex: 2,
            explanation:
              'As of 2025, Microsoft demonstrated basic topological qubit feasibility, but multi-qubit operations and error correction advantage remain theoretical. This is the least mature platform.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The Topological Bet',
        visual: 'custom-svg',
        explanation:
          'Microsoft has spent over a decade and billions of dollars on topological qubits. The bet: if you solve the materials science problem once, you get qubits that are orders of magnitude better than any other approach. The risk: the materials science problem may take another decade or more to solve at scale.',
      },
    ],
  },

  // ── Lesson 10.6 ──
  {
    id: '10.6',
    title: 'Noise, Decoherence & T1/T2',
    description:
      'T₁ relaxation, T₂ dephasing, gate fidelity, and readout error — the quantitative language of hardware noise. Simulate realistic noise on a Bell state.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['10.1', '1.5'],
    tags: ['noise', 'decoherence', 'T1', 'T2', 'gate-fidelity', 'readout-error', 'noise-model'],
    diracContext:
      'Now that the student knows the platforms, teach the QUANTITATIVE language of noise. T1 and T2 are not abstract — they determine how deep your circuits can be. Gate fidelity compounds multiplicatively. This lesson is CODE-HEAVY: build a realistic noise model step by step. Connect back to specific hardware numbers from earlier lessons.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Language of Noise

You have seen T₁ and T₂ mentioned in every hardware lesson. Now let us make them precise.

### T₁: Energy Relaxation

A qubit in |1⟩ spontaneously decays to |0⟩ over time. The probability of still being in |1⟩ after time t is:

**P(|1⟩, t) = e^(-t/T₁)**

| Platform | Typical T₁ |
|----------|-----------|
| Superconducting (transmon) | 50–300 μs |
| Trapped ion | 1–100 seconds |
| Neutral atom | 1–10 seconds |
| Photonic | N/A (photon loss instead) |

### T₂: Dephasing

The relative phase between |0⟩ and |1⟩ randomizes over time. A qubit in |+⟩ = (|0⟩+|1⟩)/√2 drifts toward a mixed state:

**⟨X(t)⟩ = e^(-t/T₂) · ⟨X(0)⟩**

T₂ ≤ 2·T₁ always. In practice, T₂ is often much shorter due to low-frequency noise (1/f noise, flux noise).

### Gate Fidelity

The fidelity of a gate is the overlap between the ideal and actual output states. A 99.9% single-qubit gate and 99% two-qubit gate are typical for superconducting hardware.

**Circuit fidelity ≈ ∏ᵢ Fᵢ** (product of individual gate fidelities)

For a circuit with 100 two-qubit gates at 99% fidelity: F_total ≈ 0.99^100 ≈ 36.6%.`,
      },
      {
        type: 'concept-card',
        title: 'T₁ vs T₂ on the Bloch Sphere',
        visual: 'bloch',
        explanation:
          'T₁ decay pulls the Bloch vector toward the north pole (|0⟩). T₂ dephasing shrinks the x-y component, collapsing the state toward the z-axis. Together, any pure state decays to a point near |0⟩ — the thermal equilibrium at millikelvin temperatures.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, thermal_relaxation_error

# Build a realistic noise model with T1/T2 relaxation
T1 = 200e-6       # 200 microseconds
T2 = 100e-6       # 100 microseconds (T2 <= 2*T1)
gate_time_1q = 50e-9   # 50 nanoseconds
gate_time_2q = 300e-9  # 300 nanoseconds
gate_time_meas = 5e-6  # 5 microseconds

# Create thermal relaxation errors
error_1q = thermal_relaxation_error(T1, T2, gate_time_1q)
error_2q = thermal_relaxation_error(T1, T2, gate_time_2q).tensor(
    thermal_relaxation_error(T1, T2, gate_time_2q)
)
error_meas = thermal_relaxation_error(T1, T2, gate_time_meas)

# Build the noise model
noise = NoiseModel()
noise.add_all_qubit_quantum_error(error_1q, ['h', 'x', 'rz'])
noise.add_all_qubit_quantum_error(error_2q, ['cx'])
noise.add_all_qubit_quantum_error(error_meas, ['measure'])

# Bell state circuit
qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])

# Compare ideal vs noisy
ideal_sim = AerSimulator()
noisy_sim = AerSimulator(noise_model=noise)

ideal_counts = ideal_sim.run(qc, shots=4096).result().get_counts()
noisy_counts = noisy_sim.run(qc, shots=4096).result().get_counts()

print("=== Bell State: Ideal vs Realistic Noise ===")
print("\\nIdeal:")
for s, c in sorted(ideal_counts.items()):
    print(f"  |{s}⟩: {c} ({100*c/4096:.1f}%)")
print("\\nWith T1/T2 noise (T1=200μs, T2=100μs):")
for s, c in sorted(noisy_counts.items()):
    print(f"  |{s}⟩: {c} ({100*c/4096:.1f}%)")`,
        framework: 'qiskit',
        description:
          'Build a thermal relaxation noise model from real hardware parameters and see how it corrupts a Bell state.',
        explorationPrompt:
          'Try reducing T2 to 20 μs (very noisy). Then try T1=10 seconds (trapped ion scale). How do the results change?',
      },
      {
        type: 'text',
        markdown: `## Readout Error

Even if the qubit state is perfect, the measurement can be wrong. A readout error matrix describes the confusion:

| True State | Read as |0⟩ | Read as |1⟩ |
|:---:|:---:|:---:|
| **|0⟩** | 98% | 2% |
| **|1⟩** | 3% | 97% |

Note the asymmetry: |1⟩→|0⟩ errors are more common because T₁ decay during readout pulls |1⟩ toward |0⟩.

**Readout error mitigation** measures calibration circuits and inverts the error matrix — a classical post-processing step that significantly improves results.`,
      },
      {
        type: 'exercise',
        id: '10.6-ex1',
        title: 'Add Realistic Noise to a GHZ Circuit',
        description:
          'Create a 3-qubit GHZ state with a noise model that includes depolarizing gate errors and thermal relaxation. The ideal GHZ state gives 50% |000⟩ and 50% |111⟩. Your noisy version should show error leakage but keep |000⟩ and |111⟩ as the dominant outcomes.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error, thermal_relaxation_error

# TODO: Define noise parameters
# T1 = ???  (try 150 microseconds)
# T2 = ???  (must be <= 2*T1)

# TODO: Build the noise model
noise = NoiseModel()
# Add depolarizing error for 1Q gates (try 0.001)
# Add depolarizing error for 2Q gates (try 0.01)

# GHZ circuit
qc = QuantumCircuit(3, 3)
qc.h(0)
qc.cx(0, 1)
qc.cx(1, 2)
qc.measure([0, 1, 2], [0, 1, 2])

# Run with noise
sim = AerSimulator(noise_model=noise)
result = sim.run(qc, shots=4096).result()
counts = result.get_counts()
print("Noisy GHZ state:")
for state, count in sorted(counts.items(), key=lambda x: -x[1])[:8]:
    print(f"  |{state}⟩: {count} ({100*count/4096:.1f}%)")`,
        framework: 'qiskit',
        expectedProbabilities: { '000': 0.4, '111': 0.4 },
        tolerancePercent: 15,
        hints: [
          'T2 must be <= 2*T1. Try T1=150e-6 and T2=80e-6.',
          'Use noise.add_all_qubit_quantum_error() to add errors for specific gate types.',
          'Depolarizing error rates of 0.001 (1Q) and 0.01 (2Q) are realistic for superconducting hardware.',
        ],
        successMessage:
          'You built a realistic noise model. The |000⟩ and |111⟩ peaks remain dominant but noise leaks probability into other states — exactly what happens on real hardware.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '10.6-q1',
            question: 'A circuit has 200 two-qubit gates, each with 99% fidelity. What is the approximate circuit fidelity?',
            options: [
              '98%',
              '86.6%',
              '13.4%',
              '0.99%',
            ],
            correctIndex: 2,
            explanation:
              '0.99^200 ≈ 0.134, or about 13.4%. Gate errors compound multiplicatively. This is why circuit depth is severely limited on current hardware.',
          },
          {
            id: '10.6-q2',
            question: 'Why is T₂ always ≤ 2·T₁?',
            options: [
              'It is a convention, not a physical law',
              'Energy relaxation (T₁) also destroys phase coherence, setting an upper bound on T₂',
              'Measurement errors limit T₂',
              'Gate operations consume T₂ faster than T₁',
            ],
            correctIndex: 1,
            explanation:
              'T₁ processes (energy decay) inherently cause dephasing. So even without additional pure dephasing, T₂ cannot exceed 2·T₁. Additional noise sources usually make T₂ much shorter.',
          },
        ],
      },
    ],
  },

  // ── Lesson 10.7 ──
  {
    id: '10.7',
    title: 'Qubit Connectivity & Topology',
    description:
      'Heavy-hex (IBM), linear chains (trapped ion), 2D grids (Google). How hardware topology affects circuit compilation and SWAP overhead.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['10.1', '10.2'],
    tags: ['connectivity', 'topology', 'heavy-hex', 'SWAP', 'transpilation', 'coupling-map'],
    diracContext:
      'This is where hardware meets software. The student writes circuits assuming any qubit can talk to any other, but real hardware has a COUPLING MAP. The compiler (transpiler) inserts SWAP gates to route interactions. More SWAPs = more depth = more noise. Show this concretely with Qiskit transpilation.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Why Topology Matters

When you write \`qc.cx(0, 5)\`, you assume qubit 0 and qubit 5 can interact directly. On a simulator, they can. On real hardware, they probably cannot.

Each quantum processor has a **coupling map** — a graph showing which qubits are physically connected. A CNOT gate can only act on connected pairs.

### Major Topologies

| Topology | Platform | Description |
|----------|----------|-------------|
| **Heavy-hex** | IBM (Eagle, Heron) | Degree-2 and degree-3 nodes in a hexagonal lattice. Optimized for surface code error correction |
| **2D grid** | Google (Sycamore) | Square lattice with some edges removed. Each qubit connects to ~4 neighbors |
| **Linear chain** | Trapped ions | All ions in a line, but all-to-all gates via shared phonon modes |
| **Reconfigurable** | Neutral atoms | Optical tweezers rearrange atoms between layers |

### The SWAP Problem

If qubits 0 and 5 are not connected, the compiler inserts **SWAP gates** to move the quantum state through intermediate qubits:

\`\`\`
SWAP(0,1) → SWAP(1,2) → CNOT(2,5) → SWAP(1,2) → SWAP(0,1)
\`\`\`

Each SWAP = 3 CNOTs. This **routing overhead** can triple or quadruple circuit depth on heavily constrained topologies.`,
      },
      {
        type: 'concept-card',
        title: 'IBM Heavy-Hex Topology',
        visual: 'custom-svg',
        explanation:
          'Heavy-hex has alternating degree-2 and degree-3 nodes arranged in a hexagonal pattern. It minimizes frequency collisions (crosstalk) while supporting surface code error correction. The tradeoff: lower average connectivity means more SWAP routing for algorithms that need all-to-all interaction.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
from qiskit.transpiler import CouplingMap

# Define a small heavy-hex-like coupling map (7 qubits)
edges = [(0,1),(1,2),(2,3),(3,4),(1,5),(3,6)]
coupling_map = CouplingMap(couplinglist=edges)

# A circuit that needs long-range connectivity
qc = QuantumCircuit(7)
qc.h(0)
qc.cx(0, 4)  # Not directly connected!
qc.cx(0, 6)  # Even farther apart!
qc.cx(2, 5)  # Also not adjacent

# Transpile for the constrained topology
pm = generate_preset_pass_manager(optimization_level=2, coupling_map=coupling_map)
transpiled = pm.run(qc)

print("Original circuit:")
print(f"  Depth: {qc.depth()}, Gates: {qc.count_ops()}")
print(f"\\nTranspiled for heavy-hex topology:")
print(f"  Depth: {transpiled.depth()}, Gates: {transpiled.count_ops()}")
print(f"\\nSWAP overhead added {transpiled.depth() - qc.depth()} layers of depth")
print(f"Coupling map edges: {edges}")`,
        framework: 'qiskit',
        description:
          'Transpile a circuit with long-range CNOTs onto a constrained coupling map and see the SWAP overhead.',
        explorationPrompt:
          'Try optimization_level=0 vs optimization_level=3. How much does the optimizer reduce the SWAP overhead? What if you add more edges to the coupling map?',
      },
      {
        type: 'text',
        markdown: `## Transpilation Strategies

The **transpiler** (Qiskit, Cirq, TKET) maps logical circuits to physical hardware:

1. **Layout:** Assign logical qubits to physical qubits (initial placement matters!)
2. **Routing:** Insert SWAPs when gates require unconnected qubits
3. **Optimization:** Cancel redundant gates, merge rotations, minimize depth
4. **Basis translation:** Decompose gates into the hardware's native gate set

### Impact on Real Algorithms

| Algorithm | Ideal Depth | Transpiled (Heavy-hex) | SWAP Overhead |
|-----------|:-:|:-:|:-:|
| 4-qubit QFT | 12 | ~30–40 | 2–3x |
| 8-qubit Grover | 45 | ~120–150 | 3x |
| 10-qubit VQE layer | 20 | ~50–80 | 2.5–4x |

> **Rule of thumb:** On nearest-neighbor hardware, expect 2–4x depth overhead from routing. All-to-all platforms (trapped ions) pay zero routing cost.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '10.7-q1',
            question: 'How many CNOT gates does a single SWAP gate decompose into?',
            options: [
              '1 CNOT',
              '2 CNOTs',
              '3 CNOTs',
              '4 CNOTs',
            ],
            correctIndex: 2,
            explanation:
              'A SWAP gate decomposes into exactly 3 CNOT gates. Each SWAP gate inserted for routing costs 3x in two-qubit gate count — this is why topology-aware compilation matters.',
          },
          {
            id: '10.7-q2',
            question: 'Which hardware platform has zero SWAP overhead for arbitrary two-qubit interactions?',
            options: [
              'IBM superconducting (heavy-hex)',
              'Google superconducting (2D grid)',
              'Trapped ions (all-to-all connectivity)',
              'All platforms require SWAPs',
            ],
            correctIndex: 2,
            explanation:
              'Trapped ions have all-to-all connectivity through shared vibrational modes. Any qubit can interact with any other directly, eliminating routing overhead entirely.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Layout Matters',
        visual: 'circuit',
        explanation:
          'Two different initial qubit placements on the same coupling map can result in dramatically different SWAP counts. Qiskit optimization level 2+ uses heuristic search to find a good layout. For small circuits, this can eliminate SWAPs entirely.',
      },
    ],
  },

  // ── Lesson 10.8 ──
  {
    id: '10.8',
    title: 'Comparing Hardware Platforms',
    description:
      'Side-by-side comparison of every platform. Strengths, weaknesses, and which to choose for which application.',
    difficulty: 'beginner',
    estimatedMinutes: 15,
    prerequisites: ['10.1', '10.2'],
    tags: ['comparison', 'hardware-selection', 'roadmap', 'NISQ', 'fault-tolerant'],
    diracContext:
      'Wrap up the track with a big-picture comparison. The student should leave with a mental framework for choosing (or at least understanding) which hardware suits which use case. Emphasize that there is no winner yet — the race is still on. Connect to their own coding: when they run on IBM Quantum, they are using superconducting qubits; when they target IonQ, trapped ions.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Quantum Hardware Landscape

There is no single "best" quantum computer. Each platform makes different engineering tradeoffs, and the winner depends on the application.

### The Comparison Table

| Property | Superconducting | Trapped Ion | Photonic | Neutral Atom | Topological |
|----------|:-:|:-:|:-:|:-:|:-:|
| **Qubit** | Transmon circuit | Single ion | Photon | Neutral atom | Majorana mode |
| **Operating temp** | 15 mK | Room (vacuum) | Room temp | ~μK (laser cooled) | ~mK |
| **1Q gate time** | ~50 ns | ~10 μs | ~ps (passive) | ~1 μs | TBD |
| **2Q gate time** | ~300 ns | ~200 μs | Probabilistic | ~1 μs | TBD |
| **T₁** | 50–300 μs | 1–100 s | N/A (photon loss) | 1–10 s | Topologically protected |
| **Connectivity** | Nearest-neighbor | All-to-all | Configurable | Reconfigurable | TBD |
| **Max qubits (2025)** | ~1000+ | ~50–60 | ~200 (modes) | ~200–300 | ~1 |
| **2Q fidelity** | ~99–99.5% | ~99.5–99.9% | ~95–99% | ~99.5% | TBD |
| **Key players** | IBM, Google, Rigetti | IonQ, Quantinuum | Xanadu, PsiQuantum | QuEra, Pasqal | Microsoft |`,
      },
      {
        type: 'concept-card',
        title: 'The Race to Useful Quantum Computing',
        visual: 'histogram',
        explanation:
          'Each platform is racing toward "quantum utility" — the point where quantum computers reliably outperform classical ones on practical problems. IBM leads in qubit count, trapped ions lead in fidelity, neutral atoms in flexibility, photonics in networking potential, and topological in theoretical error protection. The finish line keeps moving as classical algorithms improve too.',
      },
      {
        type: 'text',
        markdown: `## Which Platform for Which Application?

| Application | Best Platform(s) | Why |
|-------------|-----------------|-----|
| **Chemistry simulation** | Trapped ion, superconducting | High fidelity for variational circuits; deep circuits for QPE |
| **Optimization (QAOA)** | Neutral atom, superconducting | Analog mode (neutral atom) maps natively; fast gates (SC) enable many iterations |
| **Machine learning** | Superconducting, photonic | Fast gate cycles for variational training; photonic for Gaussian boson sampling |
| **Quantum networking** | Photonic, trapped ion | Photons travel in fiber; ions emit compatible photons |
| **Condensed matter sim** | Neutral atom | Analog simulation of spin models is natural |
| **Cryptography (Shor's)** | Fault-tolerant (any platform) | Requires millions of error-corrected qubits — not yet available on any platform |

### The NISQ vs Fault-Tolerant Divide

We are currently in the **Noisy Intermediate-Scale Quantum (NISQ)** era:
- 50–1000 physical qubits
- No error correction (or very limited)
- Circuits limited to a few hundred layers
- Algorithms must be noise-tolerant (VQE, QAOA)

The **fault-tolerant** era requires:
- Millions of physical qubits (for error correction overhead)
- Logical error rates below 10⁻¹⁰
- Deep circuits running thousands of logical gates
- This is where Shor's algorithm, full QPE, and quantum simulation at scale become possible

> **Honest assessment:** No quantum computer has demonstrated a practical advantage over classical computers on a real-world problem — yet. The demonstrations so far (random circuit sampling, boson sampling) prove quantum mechanics works at scale but do not solve useful problems. The next decade will determine which hardware platform crosses the utility threshold first.`,
      },
      {
        type: 'text',
        markdown: `## Connecting to Your Code

When you run circuits in Nuclei or on cloud quantum services, you are choosing a platform:

| Service | Platform | What You Learned |
|---------|----------|-----------------|
| **IBM Quantum** | Superconducting (transmon) | Heavy-hex topology, microwave gates, 15 mK cooling |
| **IonQ (via AWS/Azure)** | Trapped ion (ytterbium) | All-to-all connectivity, laser gates, long coherence |
| **Quantinuum** | Trapped ion (QCCD) | Highest published 2Q fidelity, ion shuttling |
| **QuEra (via AWS)** | Neutral atom (rubidium) | Reconfigurable arrays, analog + digital modes |
| **Xanadu Cloud** | Photonic (squeezed light) | Room temperature, photonic circuits |

Every noise model you build in Qiskit Aer is an approximation of what happens on one of these machines. The T₁, T₂, and gate fidelity numbers come from real calibration data published by hardware vendors.

### What's Next

The quantum hardware landscape changes fast. Key milestones to watch:
- **Logical qubit demonstrations** (IBM, Google, Quantinuum pursuing aggressively)
- **1000+ qubit processors** (IBM Flamingo, neutral atom arrays)
- **Quantum networking** (linking processors via photonic channels)
- **Practical quantum advantage** (solving a useful problem faster than any classical approach)`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '10.8-q1',
            question: 'Which platform currently offers the most qubits?',
            options: [
              'Trapped ion',
              'Superconducting',
              'Photonic',
              'Topological',
            ],
            correctIndex: 1,
            explanation:
              'Superconducting processors from IBM have surpassed 1000 physical qubits. Trapped ions and neutral atoms are in the 50–300 range. Topological has demonstrated only ~1 qubit.',
          },
          {
            id: '10.8-q2',
            question: 'Which platform has the highest two-qubit gate fidelity?',
            options: [
              'Superconducting',
              'Trapped ion',
              'Photonic',
              'Neutral atom',
            ],
            correctIndex: 1,
            explanation:
              'Trapped ion platforms (especially Quantinuum) have published the highest two-qubit gate fidelities, reaching 99.9%+. Their slow gate times are compensated by exceptional precision.',
          },
          {
            id: '10.8-q3',
            question: 'What defines the NISQ era?',
            options: [
              'Quantum computers that are faster than classical for all tasks',
              'Noisy processors with 50–1000 qubits and no error correction',
              'Processors using topological qubits exclusively',
              'The era after fault-tolerant quantum computing is achieved',
            ],
            correctIndex: 1,
            explanation:
              'NISQ (Noisy Intermediate-Scale Quantum) describes current hardware: moderate qubit counts, significant noise, limited circuit depth, and no full error correction. Algorithms in this era must tolerate noise.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Your Hardware Checklist',
        visual: 'circuit',
        explanation:
          'When choosing a quantum backend, ask: (1) How many qubits do I need? (2) How deep is my circuit? (3) Do I need all-to-all connectivity? (4) Am I running variational or fault-tolerant algorithms? (5) What is my noise budget? The answers point to a platform — there is no universal best choice.',
      },
    ],
  },
];
