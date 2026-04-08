import type { Lesson } from './types';

export const TRACK7_LESSONS: Lesson[] = [
  // ── Lesson 7.1 ──
  {
    id: '7.1',
    title: 'From Molecules to Hamiltonians',
    description: 'Why quantum computers are nature\'s language for simulating molecules.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['1.6', '3.10'],
    tags: ['hamiltonian', 'electronic-structure', 'born-oppenheimer', 'pauli-operators'],
    diracContext: 'Introduce the electronic structure problem. Molecular Hamiltonians decompose into sums of Pauli operators. A molecule IS a quantum system — simulating it on a quantum computer is natural. Classical computers struggle because the Hilbert space grows exponentially.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Electronic Structure Problem

Feynman's 1981 insight: **nature isn't classical.** A molecule with N electrons lives in a Hilbert space of dimension 2^N — 50 electrons means ~10^15 amplitudes.

> "Nature isn't classical, dammit, and if you want to make a simulation of nature, you'd better make it quantum mechanical." — Feynman

The **Born-Oppenheimer approximation** freezes heavy nuclei in place and solves for electrons only. The Hamiltonian uses **fermionic operators** (a†, a) which map to **Pauli operators** (I, X, Y, Z) for qubits:

**H = c₀I + c₁Z₀ + c₂Z₁ + c₃Z₀Z₁ + c₄X₀X₁ + ...**

Each **Pauli string** has a coefficient. The ground-state energy is the smallest eigenvalue.`,
      },
      {
        type: 'concept-card',
        title: 'Born-Oppenheimer Approximation',
        visual: 'custom-svg',
        explanation: 'Nuclei are ~2000x heavier than electrons. Freeze them in place, solve for electrons only. This yields a Hamiltonian for electron-electron and electron-nucleus interactions at fixed nuclear positions.',
      },
      {
        type: 'demo',
        code: `from qiskit.quantum_info import SparsePauliOp

# H2 Hamiltonian at equilibrium bond length (0.735 A)
h2 = SparsePauliOp.from_list([
    ("II", -1.0523), ("IZ", 0.3979), ("ZI", -0.3979),
    ("ZZ", -0.0112), ("XX", 0.1809),
])
print("H2 Hamiltonian:")
print(h2)
print(f"\\n{len(h2)} Pauli terms on {h2.num_qubits} qubits")`,
        framework: 'qiskit',
        description: 'The hydrogen molecule Hamiltonian decomposed into 5 Pauli strings — one per electron orbital pair.',
        explorationPrompt: 'The II term is a constant energy offset. The ZZ and XX terms encode electron interactions. What happens to term count for larger molecules?',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '7.1-q1',
            question: 'Why are quantum computers naturally suited to molecular simulation?',
            options: [
              'They are faster at arithmetic',
              'Molecules are quantum systems — quantum hardware maps naturally onto them',
              'They have more memory than classical computers',
              'Classical computers cannot represent molecules at all',
            ],
            correctIndex: 1,
            explanation: 'Molecules are quantum mechanical. A quantum computer represents the exponentially large Hilbert space efficiently because its qubits live in that same space.',
          },
          {
            id: '7.1-q2',
            question: 'What does the Born-Oppenheimer approximation do?',
            options: [
              'Ignores electron-electron repulsion',
              'Treats nuclei as fixed points and solves for electrons only',
              'Reduces the molecule to a single qubit',
              'Eliminates the need for quantum simulation',
            ],
            correctIndex: 1,
            explanation: 'Nuclei are much heavier and slower than electrons, so we freeze them and solve the electronic Schrodinger equation at that fixed geometry.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Scaling: Why Classical Fails',
        visual: 'histogram',
        explanation: 'Caffeine (C8H10N4O2) has 102 electrons. Full configuration interaction needs ~2^102 amplitudes — more than atoms in the observable universe. Quantum computers encode this in ~102 qubits. This exponential compression is the core advantage.',
      },
    ],
  },

  // ── Lesson 7.2 ──
  {
    id: '7.2',
    title: 'Jordan-Wigner & Bravyi-Kitaev',
    description: 'Mapping fermionic operators to qubit operators — two strategies, different tradeoffs.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['7.1'],
    tags: ['jordan-wigner', 'bravyi-kitaev', 'fermion-to-qubit', 'parity', 'encoding'],
    diracContext: 'Explain fermion-to-qubit mappings. Jordan-Wigner is simpler (occupation encoding, Z-strings for parity). Bravyi-Kitaev has shorter Pauli strings but is harder to visualize. Show both on the same Hamiltonian.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Mapping Problem

Electrons are **fermions** with antisymmetric wavefunctions. Qubits have no built-in antisymmetry. We need mappings preserving **anticommutation relations**: {aᵢ, aⱼ†} = δᵢⱼ.

**Jordan-Wigner (1928):** Each orbital → one qubit (|1⟩ = occupied). Z-strings enforce antisymmetry but grow as O(N).

**Bravyi-Kitaev (2002):** Binary tree stores occupation + parity. Pauli weight: O(log N).

| Property | Jordan-Wigner | Bravyi-Kitaev |
|----------|:---:|:---:|
| Pauli weight | O(N) | O(log N) |
| Simplicity | High | Medium |

For 2-10 qubits, JW is standard. For 50+, BK wins.`,
      },
      {
        type: 'concept-card',
        title: 'Jordan-Wigner Z-Strings',
        visual: 'circuit',
        explanation: 'JW maps each orbital to one qubit: |1⟩ = occupied. The Z-string on preceding qubits enforces antisymmetry — swapping fermions produces a minus sign. Simple but grows linearly with system size.',
      },
      {
        type: 'demo',
        code: `from qiskit.quantum_info import SparsePauliOp

h2_jw = SparsePauliOp.from_list([
    ("II", -1.0523), ("IZ", 0.3979), ("ZI", -0.3979),
    ("ZZ", -0.0112), ("XX", 0.1809),
])
print("H2 Jordan-Wigner (2 qubits):")
for label, coeff in zip(h2_jw.paulis.to_labels(), h2_jw.coeffs):
    print(f"  {coeff:+.4f} * {label}")
print(f"\\nMax Pauli weight: {max(sum(1 for c in l if c != 'I') for l in h2_jw.paulis.to_labels())}")`,
        framework: 'qiskit',
        description: 'Inspect H2 Pauli decomposition under Jordan-Wigner. For 2 qubits the Z-strings are short — they grow linearly with system size.',
        explorationPrompt: 'The XX term represents electron hopping between orbitals. What physical process does that correspond to?',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '7.2-q1',
            question: 'Why does Jordan-Wigner need Z-strings on earlier qubits?',
            options: [
              'To initialize qubits to |0⟩',
              'To enforce fermionic antisymmetry (anticommutation relations)',
              'To measure the energy',
              'To reduce circuit depth',
            ],
            correctIndex: 1,
            explanation: 'Fermions anticommute: swapping two produces a minus sign. The Z-string tracks parity of preceding orbitals, encoding this sign in the qubit representation.',
          },
          {
            id: '7.2-q2',
            question: 'What is the main advantage of Bravyi-Kitaev over Jordan-Wigner?',
            options: [
              'Fewer qubits required',
              'Shorter Pauli strings — O(log N) vs O(N)',
              'More accurate energy estimates',
              'Works without Born-Oppenheimer',
            ],
            correctIndex: 1,
            explanation: 'BK encodes parity in a tree structure so each fermionic operator maps to O(log N) Pauli operators instead of O(N), reducing circuit depth for large molecules.',
          },
        ],
      },
    ],
  },

  // ── Lesson 7.3 ──
  {
    id: '7.3',
    title: 'VQE for Hydrogen',
    description: 'Find the ground-state energy of H2 — the flagship quantum chemistry demo.',
    difficulty: 'intermediate',
    estimatedMinutes: 30,
    prerequisites: ['7.2', '3.10'],
    tags: ['vqe', 'variational', 'h2', 'ground-state', 'ansatz', 'optimizer'],
    diracContext: 'VQE is the most important near-term quantum chemistry algorithm. The variational principle guarantees any trial state energy >= ground state. The quantum computer evaluates expectation values; the classical optimizer tunes parameters. Focus on H2 as a concrete, runnable example.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Variational Principle

**VQE** exploits: for any trial state |ψ(θ)⟩, **⟨ψ(θ)|H|ψ(θ)⟩ >= E₀**.

The loop: (1) **Prepare** |ψ(θ)⟩ via a parameterized circuit (the **ansatz**). (2) **Measure** ⟨H⟩ by sampling Pauli terms. (3) **Update** θ via classical optimizer (COBYLA, SPSA). (4) **Repeat** until convergence.

VQE is **hybrid**: quantum handles the exponential state space, classical handles optimization.`,
      },
      {
        type: 'concept-card',
        title: 'The VQE Loop',
        visual: 'circuit',
        explanation: 'The quantum computer prepares |ψ(θ)⟩ and measures Pauli terms. The classical optimizer receives the energy estimate and proposes new parameters. For H2 with 2 qubits, convergence typically takes 50-200 iterations.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import SparsePauliOp, Statevector
import numpy as np

h2_op = SparsePauliOp.from_list([
    ("II", -1.0523), ("IZ", 0.3979), ("ZI", -0.3979),
    ("ZZ", -0.0112), ("XX", 0.1809),
])

def h2_ansatz(theta):
    qc = QuantumCircuit(2)
    qc.ry(theta[0], 0)
    qc.ry(theta[1], 1)
    qc.cx(0, 1)
    qc.ry(theta[2], 1)
    return qc

def energy(theta):
    sv = Statevector.from_instruction(h2_ansatz(theta))
    return sv.expectation_value(h2_op).real

# 1D parameter scan
thetas = np.linspace(0, 2 * np.pi, 50)
energies = [energy([t, 0.0, 0.0]) for t in thetas]
min_idx = np.argmin(energies)
print(f"Best energy: {energies[min_idx]:.4f} Ha")
print(f"Best theta[0]: {thetas[min_idx]:.3f} rad")
print(f"Exact H2 ground state: -1.8573 Ha")`,
        framework: 'qiskit',
        description: 'A 1D parameter scan for H2. Real VQE uses a full optimizer over all parameters.',
        explorationPrompt: 'This scans only theta[0]. Try varying theta[1] too. How close can you get to -1.8573 Ha?',
      },
      {
        type: 'exercise',
        id: '7.3-ex1',
        title: 'Build a VQE Ansatz for H2',
        description: 'Build a 2-qubit ansatz (2+ RY gates, 1 CNOT). Find parameters giving energy below -1.05 Ha (beat Hartree-Fock).',
        starterCode: `from qiskit import QuantumCircuit
from qiskit.quantum_info import SparsePauliOp, Statevector

h2_op = SparsePauliOp.from_list([
    ("II", -1.0523), ("IZ", 0.3979), ("ZI", -0.3979),
    ("ZZ", -0.0112), ("XX", 0.1809),
])
# TODO: Build your ansatz
qc = QuantumCircuit(2)

sv = Statevector.from_instruction(qc)
print(f"Energy: {sv.expectation_value(h2_op).real:.4f} Ha")`,
        framework: 'qiskit',
        expectedProbabilities: {},
        tolerancePercent: 5,
        hints: [
          'Start with RY(theta, 0) and RY(theta, 1) to rotate both qubits.',
          'Add CX(0, 1) to entangle the two orbitals.',
          'Try theta values near pi — this prepares a state close to the bonding orbital.',
        ],
        successMessage: 'You beat Hartree-Fock! A full VQE optimizer would refine further toward -1.857 Ha.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '7.3-q1',
            question: 'What does the variational principle guarantee?',
            options: [
              'VQE always finds the exact ground state',
              'Measured energy is always >= the true ground-state energy',
              'The ansatz must be chemically motivated',
              'Only Qiskit can run VQE',
            ],
            correctIndex: 1,
            explanation: '⟨ψ|H|ψ⟩ >= E₀ for any normalized |ψ⟩. This gives VQE a clear target: minimize the energy.',
          },
        ],
      },
    ],
  },

  // ── Lesson 7.4 ──
  {
    id: '7.4',
    title: 'UCCSD Ansatz',
    description: 'Chemistry-inspired ansatz: Unitary Coupled Cluster Singles and Doubles.',
    difficulty: 'advanced',
    estimatedMinutes: 25,
    prerequisites: ['7.3'],
    tags: ['uccsd', 'coupled-cluster', 'ansatz', 'excitations', 'trotterization'],
    diracContext: 'UCCSD is the gold standard chemistry ansatz. Explain: HF reference -> single excitations -> double excitations. The unitary version is needed for quantum circuits. Trotterization maps the exponential to gates. Acknowledge deep circuits are the main challenge.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Chemistry-Informed Ansatze

**Classical coupled cluster** (CCSD): |ψ⟩ = e^(T₁+T₂)|HF⟩ where T₁ = single excitations, T₂ = doubles. But e^T is **not unitary**. **UCCSD** fixes this: |ψ⟩ = e^(T-T†)|HF⟩ — the antihermitian exponent guarantees unitarity.

**Trotter-Suzuki** converts to gates: e^(A+B) ≈ (e^(A/n) · e^(B/n))^n.

| Molecule | Qubits | Parameters | CNOTs |
|----------|--------|------------|-------|
| H₂ | 2 | 1 | 4 |
| LiH | 8 | ~20 | ~400 |
| H₂O | 14 | ~200 | ~20,000 |`,
      },
      {
        type: 'concept-card',
        title: 'Excitation Hierarchy',
        visual: 'custom-svg',
        explanation: 'Start from Hartree-Fock |HF⟩. Singles: promote one electron. Doubles: promote two. UCCSD includes both. Higher excitations exist but circuit depth becomes prohibitive.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# Minimal UCCSD-inspired ansatz for H2 (2 qubits)
# HF reference: |01⟩, double excitation: |01⟩ <-> |10⟩
def uccsd_h2(theta):
    qc = QuantumCircuit(2)
    qc.x(0)  # Prepare HF reference |01⟩
    # Double excitation via Trotterized e^{i*theta*(X0Y1 - Y0X1)/2}
    qc.cx(0, 1)
    qc.ry(2 * theta, 0)
    qc.cx(1, 0)
    qc.ry(2 * theta, 0)
    qc.cx(1, 0)
    qc.cx(0, 1)
    return qc

qc = uccsd_h2(0.22)  # optimal angle
print("UCCSD H2 circuit:")
print(qc.draw())
print(f"Depth: {qc.depth()}, CNOTs: {qc.count_ops().get('cx', 0)}")`,
        framework: 'qiskit',
        description: 'A minimal UCCSD circuit for H2. The double excitation mixes |01⟩ and |10⟩ with a tunable angle.',
        explorationPrompt: 'At theta=0 you get pure Hartree-Fock. What state do you get at theta=pi/4?',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '7.4-q1',
            question: 'Why must coupled cluster be made "unitary" for quantum computers?',
            options: [
              'Quantum gates must be reversible (unitary)',
              'It reduces the number of parameters',
              'Classical coupled cluster is more accurate',
              'Unitarity is required for Born-Oppenheimer',
            ],
            correctIndex: 0,
            explanation: 'All quantum operations are unitary. Classical CC uses e^T which is not unitary. UCCSD uses e^(T-T†) with an antihermitian exponent, guaranteeing a unitary operator.',
          },
          {
            id: '7.4-q2',
            question: 'What is the main practical limitation of UCCSD on near-term hardware?',
            options: [
              'It cannot represent entanglement',
              'Circuit depth grows rapidly with molecule size',
              'It only works for hydrogen',
              'It requires error correction',
            ],
            correctIndex: 1,
            explanation: 'UCCSD can require thousands of CNOTs for modest molecules. Noisy hardware has limited coherence, so deep circuits accumulate too much error.',
          },
        ],
      },
    ],
  },

  // ── Lesson 7.5 ──
  {
    id: '7.5',
    title: 'QPE for Chemistry',
    description: 'Quantum Phase Estimation for molecular eigenvalues — high precision, deep circuits.',
    difficulty: 'advanced',
    estimatedMinutes: 25,
    prerequisites: ['7.3', '3.5'],
    tags: ['qpe', 'phase-estimation', 'eigenvalue', 'fault-tolerant', 'molecular-energy'],
    diracContext: 'QPE gives exponentially more precise energies than VQE but requires fault-tolerant hardware. The unitary is e^(-iHt) where the phase encodes the eigenvalue (energy). This is the long-term approach; VQE is for near-term.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Beyond VQE: Exact Eigenvalues

**QPE** extracts eigenvalues of U = e^(-iHt) directly. If |ψ⟩ has energy Eₖ, then U|ψ⟩ = e^(-iEₖt)|ψ⟩. QPE reads Eₖ to **n bits of precision** using n ancilla qubits.

| | VQE | QPE |
|--|-----|-----|
| Hardware | NISQ | Fault-tolerant |
| Precision | Shot-noise limited | Exponential in ancillas |
| Depth | Shallow | Deep |`,
      },
      {
        type: 'concept-card',
        title: 'QPE for Molecular Energy',
        visual: 'circuit',
        explanation: 'Ancilla qubits extract the phase of U = e^(-iHt). Controlled-U operations apply Hamiltonian evolution conditioned on each ancilla. Inverse QFT converts accumulated phase into a binary energy readout. More ancillas = more precision.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
import numpy as np

# QPE for H = -0.5*Z (eigenvalues: -0.5, +0.5)
n_anc = 3
qc = QuantumCircuit(n_anc + 1, n_anc)

for i in range(n_anc):
    qc.h(i)

# Controlled-U^(2^k)
for k in range(n_anc):
    qc.cp(2 * 0.5 * (2 ** k), k, n_anc)

# Inverse QFT
for i in range(n_anc // 2):
    qc.swap(i, n_anc - 1 - i)
for i in range(n_anc):
    for j in range(i):
        qc.cp(-np.pi / (2 ** (i - j)), j, i)
    qc.h(i)

qc.measure(range(n_anc), range(n_anc))
print(qc.draw())
print(f"Precision: {1 / (2 ** n_anc):.4f} energy units")`,
        framework: 'qiskit',
        description: 'Conceptual QPE extracting an energy eigenvalue. Real molecular QPE needs Hamiltonian simulation subroutines inside the controlled-U blocks.',
        explorationPrompt: 'Try n_ancilla=5. How does precision improve? What is the depth tradeoff?',
      },
      {
        type: 'text',
        markdown: `## The Resource Gap

| Molecule | Logical Qubits | T-gates | Physical Qubits |
|----------|---------------|---------|-----------------|
| H₂ | ~4 | ~100 | ~100 |
| N₂ | ~40 | ~10⁹ | ~2,000 |
| FeMoCo | ~200 | ~10¹² | ~4,000,000 |

FeMoCo is the "holy grail." Roadmap: **VQE now → error-mitigated QPE → full fault-tolerant QPE.**`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '7.5-q1',
            question: 'How does QPE achieve better precision than VQE?',
            options: [
              'It uses a better optimizer',
              'Each additional ancilla qubit doubles energy precision',
              'It does not need a Hamiltonian',
              'It runs on faster hardware',
            ],
            correctIndex: 1,
            explanation: 'n ancilla qubits give n bits of phase precision. Each additional ancilla doubles precision without an optimization loop.',
          },
        ],
      },
    ],
  },

  // ── Lesson 7.6 ──
  {
    id: '7.6',
    title: 'Materials Science Applications',
    description: 'From batteries to drug discovery — how quantum simulation will reshape industries.',
    difficulty: 'advanced',
    estimatedMinutes: 20,
    prerequisites: ['7.3'],
    tags: ['materials-science', 'drug-discovery', 'catalysis', 'battery', 'industry'],
    diracContext: 'Forward-looking, application-oriented. Ground in specific problems: lithium cathodes, nitrogen fixation, drug docking. Be honest about timelines — near-term advantage is 5-10 years away. Connect each example to VQE/QPE from earlier lessons.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Real-World Targets

**Batteries** — LiCoO₂ cathodes have strongly correlated d-electrons that DFT approximates poorly. Quantum simulation could predict novel high-density cathode materials.

**Catalysis** — Haber-Bosch consumes ~2% of global energy. Nature's nitrogenase (FeMoCo) does nitrogen fixation at room temperature. Simulating FeMoCo could unlock efficient catalysts.

**Drug Discovery** — Molecular docking needs quantum effects (charge transfer, dispersion). Quantum computers could screen candidates far faster than classical molecular dynamics.`,
      },
      {
        type: 'concept-card',
        title: 'Quantum Advantage Timeline',
        visual: 'custom-svg',
        explanation: 'Near-term (2025-2028): VQE demos, error mitigation. Medium (2028-2033): early fault tolerance, real catalysts. Long (2033+): full QPE for FeMoCo, drug binding, superconductors.',
      },
      {
        type: 'demo',
        code: `from qiskit.quantum_info import SparsePauliOp

# LiH — 4-qubit Hamiltonian (STO-3G active space)
lih = SparsePauliOp.from_list([
    ("IIII", -7.4983), ("IIIZ", 0.2252), ("IIZI", -0.2252),
    ("IZII", 0.1717), ("ZIII", -0.1717), ("IIZZ", 0.1209),
    ("IZIZ", 0.0455), ("ZIIZ", 0.0455), ("IZZI", 0.0455),
    ("ZIZI", 0.0455), ("ZZII", 0.1688), ("IIXX", 0.0454),
])

print(f"LiH: {lih.num_qubits} qubits, {len(lih)} Pauli terms")
print(f"HF energy: -7.4983 Ha | Exact: ~-7.882 Ha")
print(f"Correlation energy gap: {abs(-7.882 - (-7.4983)):.3f} Ha")`,
        framework: 'qiskit',
        description: 'LiH on 4 qubits — the next step from H2. The correlation energy gap is what VQE targets.',
        explorationPrompt: 'LiH has 12 terms on 4 qubits vs 5 terms on 2 qubits for H2. How does term count scale?',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '7.6-q1',
            question: 'Why are transition metal compounds especially hard for classical computers?',
            options: [
              'They have too many atoms',
              'Their d-electrons are strongly correlated, breaking mean-field approximations',
              'They are too heavy for the Schrodinger equation',
              'Classical computers cannot represent metals',
            ],
            correctIndex: 1,
            explanation: 'Transition metals have partially filled d-orbitals with strongly correlated electrons. Classical mean-field methods like DFT break down for these systems.',
          },
          {
            id: '7.6-q2',
            question: 'Which molecule is the "holy grail" target for quantum chemistry simulation?',
            options: [
              'H₂ (hydrogen)',
              'H₂O (water)',
              'FeMoCo (nitrogenase active site)',
              'C₆₀ (buckminsterfullerene)',
            ],
            correctIndex: 2,
            explanation: 'FeMoCo is the iron-molybdenum cofactor in nitrogenase. Simulating it could revolutionize fertilizer production, but requires millions of error-corrected qubits.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Your Quantum Chemistry Toolkit',
        visual: 'circuit',
        explanation: 'The full stack: Hamiltonian (7.1) -> fermion-to-qubit mapping (7.2) -> VQE (7.3) with UCCSD (7.4) -> QPE for fault-tolerant future (7.5). This is the pipeline research groups use. Molecules get bigger; the workflow stays the same.',
      },
    ],
  },
];
