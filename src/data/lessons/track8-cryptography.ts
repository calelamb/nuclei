import type { Lesson } from './types';

export const TRACK8_LESSONS: Lesson[] = [
  // ── Lesson 8.1 ──
  {
    id: '8.1',
    title: 'BB84 Quantum Key Distribution',
    description:
      'The protocol that started it all — distributing secret keys using the laws of quantum mechanics.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['1.3', '1.5'],
    tags: ['BB84', 'QKD', 'key-distribution', 'eavesdropper', 'basis-choice', 'one-time-pad'],
    diracContext:
      'Walk through BB84 step by step. Alice picks random bits AND random bases (Z or X). She prepares qubits accordingly. Bob picks random bases to measure. They publicly compare bases (not values), keep matching ones. An eavesdropper collapses superpositions and introduces detectable errors. Emphasize: security comes from quantum mechanics itself, not computational hardness.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Key Distribution Problem

Classical cryptography has an Achilles heel: **key distribution.** AES-256 is unbreakable in practice — but how do you get the same 256-bit key to both parties without an eavesdropper intercepting it?

Public-key cryptography (RSA, Diffie-Hellman) solves this with mathematical hardness assumptions. But those assumptions fall to Shor's algorithm on a quantum computer.

**BB84** (Bennett & Brassard, 1984) solves key distribution using physics instead of math:

| Property | Classical Key Exchange | BB84 |
|----------|----------------------|------|
| Security basis | Computational hardness | Laws of quantum mechanics |
| Vulnerable to quantum computers | Yes (Shor's algorithm) | No |
| Detects eavesdroppers | No | Yes — disturbance is measurable |
| Requires quantum channel | No | Yes — single photons |

> **Key insight:** Measuring a quantum state disturbs it. An eavesdropper cannot copy qubits (no-cloning) and cannot measure without leaving a trace.`,
      },
      {
        type: 'concept-card',
        title: 'BB84 Protocol Flow',
        visual: 'circuit',
        explanation:
          'Step 1: Alice picks random bits and random bases (Z or X). Step 2: She encodes each bit in the chosen basis — |0⟩, |1⟩ for Z-basis; |+⟩, |−⟩ for X-basis. Step 3: Bob picks random bases and measures. Step 4: They publicly announce bases (not results). Step 5: Keep only bits where bases matched — this is the raw key. Step 6: Sacrifice a subset to check for eavesdropper-induced errors.',
      },
      {
        type: 'text',
        markdown: `## The Four BB84 States

Alice encodes bits into one of two bases:

| Bit | Z-basis (standard) | X-basis (Hadamard) |
|-----|-------------------|-------------------|
| 0 | \|0⟩ | \|+⟩ = (|0⟩ + |1⟩)/√2 |
| 1 | \|1⟩ | \|−⟩ = (|0⟩ − |1⟩)/√2 |

When Bob measures in the **same** basis Alice used, he gets the correct bit with 100% certainty. When he measures in the **wrong** basis, he gets a random result — 50/50.

## How Eavesdropping Is Detected

Eve intercepts a qubit, measures it in a randomly chosen basis, and forwards her result. But if Eve chose the wrong basis:

1. Her measurement collapses the state to the wrong basis
2. When Bob measures in Alice's original basis, he gets the wrong answer ~25% of the time
3. Alice and Bob compare a sample of their key bits — error rates above ~11% signal eavesdropping

> **This is information-theoretic security.** No amount of computing power helps Eve — the physics itself prevents undetected interception.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import random

random.seed(42)
n_bits = 16

# Alice: random bits and random bases
alice_bits = [random.randint(0, 1) for _ in range(n_bits)]
alice_bases = [random.choice(['Z', 'X']) for _ in range(n_bits)]

# Bob: random measurement bases
bob_bases = [random.choice(['Z', 'X']) for _ in range(n_bits)]

# Simulate BB84: prepare, (optionally intercept), measure
bob_results = []
for i in range(n_bits):
    qc = QuantumCircuit(1, 1)

    # Alice prepares
    if alice_bits[i] == 1:
        qc.x(0)
    if alice_bases[i] == 'X':
        qc.h(0)

    # Bob measures in his basis
    if bob_bases[i] == 'X':
        qc.h(0)
    qc.measure(0, 0)

    sim = AerSimulator()
    result = sim.run(qc, shots=1).result()
    bit = int(list(result.get_counts().keys())[0])
    bob_results.append(bit)

# Sifting: keep only matching bases
sifted_alice = []
sifted_bob = []
for i in range(n_bits):
    if alice_bases[i] == bob_bases[i]:
        sifted_alice.append(alice_bits[i])
        sifted_bob.append(bob_results[i])

print(f"Alice bits:  {alice_bits}")
print(f"Alice bases: {alice_bases}")
print(f"Bob bases:   {bob_bases}")
print(f"Bob results: {bob_results}")
print(f"\\nMatching bases: {sum(1 for a, b in zip(alice_bases, bob_bases) if a == b)}/{n_bits}")
print(f"Sifted key (Alice): {sifted_alice}")
print(f"Sifted key (Bob):   {sifted_bob}")
print(f"Keys match: {sifted_alice == sifted_bob}")`,
        framework: 'qiskit',
        description:
          'Full BB84 simulation — Alice prepares qubits in random bases, Bob measures in random bases, then they sift for matching bases.',
        explorationPrompt:
          'Try changing the seed or n_bits. Notice that about half the bases match (probability 1/2 for each). The sifted keys always agree when there is no eavesdropper.',
      },
      {
        type: 'exercise',
        id: '8.1-ex1',
        title: 'Detect an Eavesdropper',
        description:
          'Modify the BB84 protocol to include an eavesdropper (Eve) who intercepts each qubit, measures in a random basis, and re-sends. Compare the sifted keys — they should disagree on roughly 25% of bits.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import random

random.seed(99)
n_bits = 20

alice_bits = [random.randint(0, 1) for _ in range(n_bits)]
alice_bases = [random.choice(['Z', 'X']) for _ in range(n_bits)]
bob_bases = [random.choice(['Z', 'X']) for _ in range(n_bits)]

# TODO: Add Eve's random bases
eve_bases = [random.choice(['Z', 'X']) for _ in range(n_bits)]

bob_results = []
for i in range(n_bits):
    qc = QuantumCircuit(1, 1)

    # Alice prepares
    if alice_bits[i] == 1:
        qc.x(0)
    if alice_bases[i] == 'X':
        qc.h(0)

    # TODO: Eve intercepts — measure in eve_bases[i], then re-prepare
    # Step 1: If eve_bases[i] == 'X', apply H before measuring
    # Step 2: Measure to get Eve's bit
    # Step 3: Re-prepare: start from |0>, apply X if Eve got 1,
    #         apply H if eve_bases[i] == 'X'

    # Bob measures
    if bob_bases[i] == 'X':
        qc.h(0)
    qc.measure(0, 0)

    sim = AerSimulator()
    result = sim.run(qc, shots=1).result()
    bit = int(list(result.get_counts().keys())[0])
    bob_results.append(bit)

# Sift and compare
sifted_alice = []
sifted_bob = []
for i in range(n_bits):
    if alice_bases[i] == bob_bases[i]:
        sifted_alice.append(alice_bits[i])
        sifted_bob.append(bob_results[i])

errors = sum(a != b for a, b in zip(sifted_alice, sifted_bob))
rate = errors / len(sifted_alice) if sifted_alice else 0
print(f"Sifted key length: {len(sifted_alice)}")
print(f"Errors: {errors}")
print(f"Error rate: {rate:.1%}")
print(f"Eavesdropper detected: {rate > 0.11}")
`,
        framework: 'qiskit',
        tolerancePercent: 15,
        hints: [
          'Eve measures by adding H (if X-basis) then measuring. Use a separate circuit or reset to re-prepare.',
          'After Eve measures, she gets a classical bit. She re-prepares: |0⟩, optionally X (if bit=1), optionally H (if her basis was X).',
          'Use qc.reset(0) after Eve measures, then re-prepare based on Eve\'s result and basis.',
          'The error rate should hover around 25% — Eve picks the wrong basis half the time, and when she does, Bob gets the wrong answer half of that.',
        ],
        successMessage:
          'Eve introduces ~25% errors in the sifted key. Alice and Bob sacrifice a few bits to check — if error rate exceeds ~11%, they know someone is listening and abort. This is the power of quantum key distribution.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '8.1-q1',
            question: 'In BB84, what do Alice and Bob publicly announce?',
            options: [
              'The raw key bits',
              'The measurement results',
              'The bases they used for each qubit',
              'The encryption algorithm they will use',
            ],
            correctIndex: 2,
            explanation:
              'They announce only the bases, not the bit values. They keep bits where bases matched and discard the rest.',
          },
          {
            id: '8.1-q2',
            question: 'Why does an eavesdropper introduce ~25% errors in the sifted key?',
            options: [
              'Eve always measures in the wrong basis',
              'Eve guesses the wrong basis 50% of the time, and when she does, Bob gets the wrong bit 50% of that time — 50% × 50% = 25%',
              'Quantum noise adds 25% error regardless',
              'Bob\'s detector has 25% error rate',
            ],
            correctIndex: 1,
            explanation:
              'Eve picks the wrong basis with probability 1/2. When she does, her re-sent qubit is in the wrong state. Bob then measures in Alice\'s basis and gets the wrong bit with probability 1/2. Total error: 1/2 × 1/2 = 1/4 = 25%.',
          },
          {
            id: '8.1-q3',
            question: 'What fraction of exchanged qubits survive the sifting step (no eavesdropper)?',
            options: ['100%', '75%', '50%', '25%'],
            correctIndex: 2,
            explanation:
              'Alice and Bob each independently choose Z or X with equal probability. They agree on the basis with probability 1/2, so about half the bits survive sifting.',
          },
        ],
      },
    ],
  },

  // ── Lesson 8.2 ──
  {
    id: '8.2',
    title: 'E91 Protocol',
    description:
      'Entanglement-based quantum key distribution — Bell inequality violation guarantees security.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['1.5', '8.1'],
    tags: ['E91', 'entanglement', 'QKD', 'Bell-inequality', 'CHSH', 'Ekert'],
    diracContext:
      'E91 uses shared Bell pairs instead of one-way qubit transmission. Alice and Bob each measure their half of an entangled pair. When they use the same basis, their results are perfectly correlated — instant shared key. When they use different bases, the correlations violate the CHSH inequality, proving no one has tampered with the entanglement. Security from Bell\'s theorem itself.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## From BB84 to Entanglement

Artur Ekert (1991) had a beautiful insight: use **entanglement** and **Bell's theorem** for key distribution.

Instead of Alice preparing and sending qubits, a source distributes **Bell pairs** — one qubit to Alice, one to Bob:

**|Φ⁺⟩ = (|00⟩ + |11⟩) / √2**

When both measure in the **same** basis, they get perfectly correlated results — instant shared random bit. When they measure in **different** bases, the correlations satisfy a Bell inequality test.

| Feature | BB84 | E91 |
|---------|------|-----|
| Quantum resource | Single qubits | Entangled pairs |
| Security proof | No-cloning + disturbance | Bell inequality violation |
| Eavesdropper detection | Error rate in sifted key | Reduced Bell violation |
| Practical advantage | Simpler to implement | Device-independent security |

## The CHSH Inequality

The **Clauser-Horne-Shimony-Holt** inequality puts a classical bound on correlations. For measurement settings a₁, a₂ (Alice) and b₁, b₂ (Bob):

**S = |E(a₁,b₁) − E(a₁,b₂) + E(a₂,b₁) + E(a₂,b₂)| ≤ 2** (classical)

Quantum mechanics allows **S = 2√2 ≈ 2.83**. If Eve intercepts and re-sends, entanglement is broken and S drops below 2√2. If S is significantly below the quantum maximum, the key is compromised.`,
      },
      {
        type: 'concept-card',
        title: 'Bell Inequality as Security Witness',
        visual: 'histogram',
        explanation:
          'The CHSH value S acts as a security meter. S = 2√2 means full entanglement — no eavesdropper. S drops toward 2 (the classical limit) as Eve gains information. Below 2, there is no quantum advantage at all. E91 directly translates Bell violation strength into key security bounds.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import random
import math

random.seed(42)

def create_bell_pair():
    """Create a Bell pair |Phi+> = (|00> + |11>) / sqrt(2)."""
    qc = QuantumCircuit(2, 2)
    qc.h(0)
    qc.cx(0, 1)
    return qc

def e91_round(alice_basis, bob_basis, shots=1):
    """Simulate one E91 round: create Bell pair, measure in chosen bases."""
    qc = create_bell_pair()

    # Alice measures qubit 0 in her basis (angle from Z-axis)
    if alice_basis == 'Z':
        pass  # Standard basis
    elif alice_basis == 'X':
        qc.h(0)
    elif alice_basis == 'W':  # pi/4 basis
        qc.ry(-math.pi / 4, 0)

    # Bob measures qubit 1 in his basis
    if bob_basis == 'Z':
        pass
    elif bob_basis == 'X':
        qc.h(1)
    elif bob_basis == 'W':  # pi/8 basis
        qc.ry(-math.pi / 8, 1)

    qc.measure([0, 1], [0, 1])
    sim = AerSimulator()
    counts = sim.run(qc, shots=shots).result().get_counts()
    return counts

# E91 protocol: Alice uses {Z, X, W}, Bob uses {Z, X, W}
n_rounds = 200
alice_bases = [random.choice(['Z', 'X', 'W']) for _ in range(n_rounds)]
bob_bases = [random.choice(['Z', 'X', 'W']) for _ in range(n_rounds)]

key_alice = []
key_bob = []
same_basis_count = 0

for i in range(n_rounds):
    counts = e91_round(alice_bases[i], bob_bases[i])
    outcome = list(counts.keys())[0]
    a_bit = int(outcome[1])  # qubit 0
    b_bit = int(outcome[0])  # qubit 1

    if alice_bases[i] == bob_bases[i] and alice_bases[i] in ['Z', 'X']:
        # Same basis -> key generation
        key_alice.append(a_bit)
        key_bob.append(b_bit)
        same_basis_count += 1

print(f"Total rounds: {n_rounds}")
print(f"Same-basis rounds (key bits): {same_basis_count}")
print(f"Key (Alice): {key_alice[:12]}...")
print(f"Key (Bob):   {key_bob[:12]}...")
agreement = sum(a == b for a, b in zip(key_alice, key_bob))
print(f"Agreement: {agreement}/{len(key_alice)} = {agreement/len(key_alice):.1%}")`,
        framework: 'qiskit',
        description:
          'E91 protocol — distribute Bell pairs, measure in random bases, extract key from matching-basis rounds.',
        explorationPrompt:
          'Notice the near-perfect agreement when both parties use the same basis. The non-matching basis rounds would be used to compute the CHSH value and verify entanglement.',
      },
      {
        type: 'text',
        markdown: `## Device-Independent Security

E91 has a remarkable property: **device-independent security.** Even if your measurement devices are built by the adversary, as long as the CHSH value is close to 2√2, the key is secure. The Bell violation itself certifies that genuine quantum correlations exist.

This is a strictly stronger guarantee than BB84, which assumes honest devices. In practice, device-independent QKD is harder to implement (you need near-perfect Bell pair sources and efficient detectors), but the theoretical security is unmatched.

> **Bottom line:** BB84 security says "if you measured correctly, no one eavesdropped." E91 security says "regardless of how your device works internally, the correlations prove security."`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '8.2-q1',
            question: 'What quantum resource does E91 use instead of single qubits?',
            options: [
              'Quantum teleportation channels',
              'Entangled Bell pairs shared between Alice and Bob',
              'Quantum error-correcting codes',
              'GHZ states distributed to three parties',
            ],
            correctIndex: 1,
            explanation:
              'E91 distributes Bell pairs. Alice and Bob each receive one qubit from each pair, measure locally, and extract key bits from matching-basis rounds.',
          },
          {
            id: '8.2-q2',
            question: 'How does E91 detect an eavesdropper?',
            options: [
              'Error rate in the sifted key exceeds a threshold',
              'The CHSH inequality violation drops — broken entanglement means reduced correlations',
              'Alice receives Bob\'s measurement results via a quantum channel',
              'A third party verifies the key independently',
            ],
            correctIndex: 1,
            explanation:
              'If Eve intercepts and measures a qubit, entanglement is destroyed. The remaining correlations between Alice and Bob are weaker, reducing the CHSH S-value below the quantum maximum.',
          },
          {
            id: '8.2-q3',
            question: 'What does "device-independent security" mean in E91?',
            options: [
              'The protocol works on any quantum hardware',
              'No calibration is needed for the detectors',
              'Even untrusted measurement devices cannot undermine security, as long as the Bell inequality is violated',
              'The key is independent of the device used to generate it',
            ],
            correctIndex: 2,
            explanation:
              'Device-independent security means the Bell violation itself certifies that genuine quantum correlations exist — no assumptions about the internal workings of the devices are needed.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'BB84 vs E91 Security Models',
        visual: 'custom-svg',
        explanation:
          'BB84 assumes trusted devices and proves security from no-cloning and measurement disturbance. E91 proves security from Bell\'s theorem — even adversary-built devices cannot fake quantum correlations. Both achieve information-theoretic security, but E91\'s guarantee is device-independent.',
      },
    ],
  },

  // ── Lesson 8.3 ──
  {
    id: '8.3',
    title: 'Quantum Random Number Generation',
    description:
      'True randomness from quantum measurement — no pseudorandom algorithms, no hidden variables.',
    difficulty: 'beginner',
    estimatedMinutes: 15,
    prerequisites: ['1.2'],
    tags: ['QRNG', 'randomness', 'Hadamard', 'measurement', 'entropy', 'Born-rule'],
    diracContext:
      'This is a beginner-friendly lesson. Classical RNGs are deterministic (pseudorandom) — given the seed, every output is predictable. Quantum mechanics provides genuine, fundamental randomness through the Born rule. A qubit in |+⟩ measured in the Z-basis gives 0 or 1 with exactly 50% probability each — no hidden variable can predict which. This is the simplest useful quantum application.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Why Randomness Matters

Random numbers underpin all of modern security:

- **Encryption keys** — must be unpredictable
- **Nonces and IVs** — prevent replay attacks
- **Digital signatures** — require random padding
- **Monte Carlo simulations** — need statistical independence

Classical computers use **pseudorandom number generators** (PRNGs) — deterministic algorithms that produce "random-looking" sequences from a seed. But they are not truly random:

> Given the seed, every output is perfectly predictable.

## Quantum Randomness: Born-Rule Guarantee

Quantum mechanics offers something fundamentally different. When you prepare a qubit in superposition and measure:

**|+⟩ = (|0⟩ + |1⟩) / √2 → measure → { 0 with probability 1/2, 1 with probability 1/2 }**

This is not pseudo-anything. The Born rule states that the outcome is **intrinsically** random — no hidden variable, no algorithm, no seed. Bell inequality violations (Lesson 8.2) experimentally confirm this.

| Property | Classical PRNG | Quantum RNG |
|----------|---------------|-------------|
| Deterministic? | Yes — seed determines all outputs | No — each bit is fundamentally unpredictable |
| Certifiable? | No — you can't prove randomness | Yes — Bell tests certify quantum origin |
| Speed | Very fast (software) | Hardware-dependent (MHz–GHz) |
| Use case | General computation | High-security cryptography, certified randomness |`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

def generate_random_bits(n_bits):
    """Generate n truly random bits using quantum measurement."""
    qc = QuantumCircuit(1, 1)
    bits = []

    sim = AerSimulator()
    for _ in range(n_bits):
        qc_round = QuantumCircuit(1, 1)
        qc_round.h(0)        # Superposition: |0> -> |+>
        qc_round.measure(0, 0)

        result = sim.run(qc_round, shots=1).result()
        bit = int(list(result.get_counts().keys())[0])
        bits.append(bit)

    return bits

# Generate 32 random bits
random_bits = generate_random_bits(32)
print(f"Quantum random bits: {random_bits}")
print(f"As binary string:    {''.join(map(str, random_bits))}")

# Check distribution (should be ~50/50)
ones = sum(random_bits)
zeros = len(random_bits) - ones
print(f"\\nDistribution: {zeros} zeros, {ones} ones")
print(f"Ratio: {ones/len(random_bits):.1%} ones")

# Generate a random byte
byte_bits = generate_random_bits(8)
byte_val = int(''.join(map(str, byte_bits)), 2)
print(f"\\nRandom byte: {byte_bits} = {byte_val} (0x{byte_val:02x})")`,
        framework: 'qiskit',
        description:
          'Generate truly random bits with the simplest quantum circuit: Hadamard + measure.',
        explorationPrompt:
          'Run this multiple times — you get different bits each run. No seed controls the output. Try generating 1000 bits and checking the distribution.',
      },
      {
        type: 'concept-card',
        title: 'H Gate: The Randomness Machine',
        visual: 'bloch',
        explanation:
          'The Hadamard gate rotates |0⟩ to the equator of the Bloch sphere — the state |+⟩. Every point on the equator has exactly 50% probability of measuring 0 or 1. This geometric symmetry is why H + measure produces perfect coin flips.',
      },
      {
        type: 'exercise',
        id: '8.3-ex1',
        title: 'Quantum Random Byte Generator',
        description:
          'Build a circuit that generates 8 random bits in parallel using 8 qubits (one Hadamard per qubit, then measure all). Run 1000 shots and verify the distribution is roughly uniform across all 256 possible byte values.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

# TODO: Create a circuit with 8 qubits and 8 classical bits
qc = QuantumCircuit(8, 8)

# TODO: Apply H to every qubit (puts each in |+>)

# TODO: Measure all qubits

# Run 1000 shots
sim = AerSimulator()
result = sim.run(qc, shots=1000).result()
counts = result.get_counts()

# Verify: should see many distinct outcomes, roughly uniform
print(f"Distinct byte values: {len(counts)} / 256")
max_count = max(counts.values())
min_count = min(counts.values())
print(f"Count range: {min_count} - {max_count}")
print(f"Top 5 outcomes: {sorted(counts.items(), key=lambda x: -x[1])[:5]}")
`,
        framework: 'qiskit',
        tolerancePercent: 10,
        hints: [
          'Apply qc.h(i) for i in range(8) to put every qubit in superposition.',
          'qc.measure(range(8), range(8)) measures all 8 qubits.',
          'With 1000 shots across 256 outcomes, each outcome appears ~4 times on average — you will not see all 256.',
        ],
        successMessage:
          'You built a parallel quantum random number generator. Each shot produces a genuinely random byte — 8 independent coin flips in a single circuit execution. Commercial QRNGs use exactly this principle at GHz speeds.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '8.3-q1',
            question: 'Why is quantum randomness fundamentally different from pseudorandomness?',
            options: [
              'Quantum computers are faster',
              'The Born rule guarantees intrinsic randomness — no seed or algorithm determines the outcome',
              'Quantum bits have more entropy than classical bits',
              'Pseudorandom generators always produce the same sequence',
            ],
            correctIndex: 1,
            explanation:
              'Quantum measurement outcomes are not determined by any underlying hidden variable. The Born rule provides a probability distribution that cannot be derandomized — this is proven by Bell inequality violations.',
          },
          {
            id: '8.3-q2',
            question: 'What circuit generates a single random bit?',
            options: [
              'X gate followed by measurement',
              'H gate followed by measurement',
              'CNOT followed by measurement',
              'Two H gates followed by measurement',
            ],
            correctIndex: 1,
            explanation:
              'H|0⟩ = |+⟩, which has 50/50 probability of 0 or 1 when measured. X would always give 1, and HH = I gives back |0⟩.',
          },
        ],
      },
    ],
  },

  // ── Lesson 8.4 ──
  {
    id: '8.4',
    title: 'Post-Quantum Cryptography',
    description:
      'Shor\'s algorithm threatens RSA and ECC — here is what replaces them.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['3.6', '8.1'],
    tags: ['post-quantum', 'Shor', 'RSA', 'lattice', 'hash-based', 'NIST', 'CRYSTALS-Kyber', 'CRYSTALS-Dilithium'],
    diracContext:
      'This is a conceptual lesson — heavy on text and quizzes, light on circuits. Shor\'s algorithm breaks RSA and elliptic curve cryptography by efficiently factoring integers and computing discrete logarithms. Post-quantum cryptography (PQC) replaces these with problems quantum computers cannot solve efficiently: lattice problems (LWE, RLWE), hash-based signatures, code-based crypto. NIST standardized CRYSTALS-Kyber (key exchange) and CRYSTALS-Dilithium (signatures) in 2024. Emphasize: PQC runs on classical computers — it is not quantum cryptography.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Quantum Threat

Shor's algorithm (1994) factors N-bit integers in O(N³) time on a quantum computer. Classical factoring takes sub-exponential time. This breaks:

| Cryptosystem | Security Basis | Quantum Attack |
|-------------|---------------|----------------|
| **RSA** | Integer factoring | Shor's → polynomial time |
| **ECDSA / ECDH** | Elliptic curve discrete log | Shor's variant → polynomial time |
| **Diffie-Hellman** | Discrete logarithm | Shor's → polynomial time |
| **AES-256** | Symmetric key search | Grover's → 128-bit effective security (still strong) |

> **Critical distinction:** Shor's algorithm devastates **asymmetric** (public-key) cryptography. **Symmetric** cryptography (AES) only loses half its key length to Grover's search and remains safe with doubled key sizes.

## Timeline Concern: "Harvest Now, Decrypt Later"

Even before large quantum computers exist, adversaries can **record** encrypted communications today and decrypt them when a quantum computer becomes available. For data that must remain secret for decades (government, medical, financial), the migration to post-quantum cryptography is **urgent now**.`,
      },
      {
        type: 'concept-card',
        title: 'Shor\'s Algorithm Impact',
        visual: 'histogram',
        explanation:
          'Shor\'s algorithm reduces the hardness of factoring from sub-exponential (classical) to polynomial (quantum). An RSA-2048 key that would take classical computers billions of years to break could fall in hours on a sufficiently large quantum computer. The transition to quantum-safe cryptography is not a future concern — it is an active, ongoing migration.',
      },
      {
        type: 'text',
        markdown: `## Post-Quantum Cryptography Families

Post-quantum cryptography (PQC) replaces vulnerable algorithms with ones resistant to both classical and quantum attacks. These run on **classical computers** — no quantum hardware needed.

### 1. Lattice-Based Cryptography
- **Hard problem:** Learning With Errors (LWE), Ring-LWE
- **NIST standard:** CRYSTALS-Kyber (key encapsulation), CRYSTALS-Dilithium (signatures)
- **Why it works:** Finding short vectors in high-dimensional lattices is hard for both classical and quantum computers
- **Tradeoff:** Larger key sizes (~1 KB vs ~32 bytes for ECC)

### 2. Hash-Based Signatures
- **Hard problem:** Finding preimages / collisions in hash functions
- **NIST standard:** SPHINCS+ (stateless hash-based signatures)
- **Why it works:** Hash functions resist quantum attacks (Grover only provides √N speedup)
- **Tradeoff:** Large signatures (~8–50 KB)

### 3. Code-Based Cryptography
- **Hard problem:** Decoding random linear codes
- **Example:** Classic McEliece (NIST 4th-round finalist)
- **Why it works:** 40+ years of cryptanalysis, no quantum speedup found
- **Tradeoff:** Very large public keys (~1 MB)

### 4. Multivariate Cryptography
- **Hard problem:** Solving systems of multivariate polynomial equations
- **Status:** Some schemes broken; active research area
- **Tradeoff:** Fast, but key sizes and security margins are debated`,
      },
      {
        type: 'text',
        markdown: `## NIST Post-Quantum Standards (2024)

After an 8-year competition (started 2016), NIST standardized:

| Standard | Type | Replaces | Key Size | Performance |
|----------|------|----------|----------|-------------|
| **ML-KEM** (Kyber) | Key encapsulation | ECDH / RSA-KEM | ~1.5 KB public key | Very fast |
| **ML-DSA** (Dilithium) | Digital signature | ECDSA / RSA-PSS | ~2.5 KB public key | Fast |
| **SLH-DSA** (SPHINCS+) | Digital signature | ECDSA (conservative) | ~64 bytes public key | Slower, larger sigs |

**Migration is already underway:**
- Google Chrome uses ML-KEM for TLS key exchange (2024+)
- Signal Protocol added post-quantum key exchange (PQXDH)
- Apple iMessage adopted PQ3 protocol with Kyber
- NIST mandates federal agencies begin migration by 2025

> **Key takeaway:** Post-quantum cryptography is not speculative — it is being deployed in production systems right now.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '8.4-q1',
            question: 'Which type of cryptography does Shor\'s algorithm break?',
            options: [
              'Symmetric cryptography (AES)',
              'Hash functions (SHA-256)',
              'Asymmetric (public-key) cryptography based on factoring or discrete log',
              'All known cryptographic systems',
            ],
            correctIndex: 2,
            explanation:
              'Shor\'s algorithm efficiently solves integer factoring and discrete logarithm — the hard problems underlying RSA, ECDSA, and Diffie-Hellman. Symmetric crypto and hash functions are not significantly affected.',
          },
          {
            id: '8.4-q2',
            question: 'What is the "harvest now, decrypt later" threat?',
            options: [
              'Quantum computers stealing data in real time',
              'Recording encrypted data today to decrypt with future quantum computers',
              'Using Grover\'s algorithm to break AES keys',
              'Harvesting quantum random numbers for attacks',
            ],
            correctIndex: 1,
            explanation:
              'Adversaries can store encrypted traffic today. When a sufficiently powerful quantum computer exists, they can decrypt it retroactively. This makes long-lived secrets vulnerable right now.',
          },
          {
            id: '8.4-q3',
            question: 'What mathematical problem underlies CRYSTALS-Kyber (ML-KEM)?',
            options: [
              'Integer factoring',
              'Elliptic curve discrete logarithm',
              'Learning With Errors (LWE) on lattices',
              'Hash function collision resistance',
            ],
            correctIndex: 2,
            explanation:
              'Kyber (ML-KEM) is based on the Module Learning With Errors (MLWE) problem — a lattice problem believed hard for both classical and quantum computers.',
          },
          {
            id: '8.4-q4',
            question: 'Does post-quantum cryptography require quantum hardware?',
            options: [
              'Yes — it runs on quantum computers only',
              'No — PQC algorithms run on classical computers using quantum-resistant math',
              'Only for key generation',
              'Only for verification',
            ],
            correctIndex: 1,
            explanation:
              'Post-quantum cryptography is a set of classical algorithms that resist quantum attacks. They run on today\'s computers. Do not confuse PQC (classical algorithms, quantum-resistant) with QKD (quantum protocol).',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'QKD vs Post-Quantum Crypto',
        visual: 'custom-svg',
        explanation:
          'QKD (BB84, E91) uses quantum physics to distribute keys — requires quantum channels. Post-quantum crypto uses mathematics to resist quantum attacks — runs on classical hardware. In practice, both will coexist: PQC for the internet at scale, QKD for ultra-high-security links where physics-based guarantees justify the infrastructure cost.',
      },
    ],
  },

  // ── Lesson 8.5 ──
  {
    id: '8.5',
    title: 'Quantum Money & Tokens',
    description:
      'Wiesner\'s quantum money — unforgeable currency secured by the no-cloning theorem.',
    difficulty: 'advanced',
    estimatedMinutes: 20,
    prerequisites: ['1.5', '8.1'],
    tags: ['quantum-money', 'Wiesner', 'no-cloning', 'unforgeability', 'quantum-tokens', 'copy-protection'],
    diracContext:
      'Wiesner (1983, written ~1970) proposed quantum money: a banknote containing qubits in secret bases, with a serial number. The bank knows which basis each qubit is in. A counterfeiter cannot clone the qubits (no-cloning) and cannot determine the bases without the bank\'s record. This is the first application of quantum information — it actually predates BB84. Connect to modern ideas: quantum tokens, quantum copy protection, quantum software licensing.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Original Quantum Application

Before BB84, before quantum computing, Stephen Wiesner had an idea (circa 1970, published 1983): **quantum money.**

### The Classical Counterfeiting Problem

A classical banknote is just information — patterns, serial numbers, security features. In principle, any classical information can be copied. Banks fight counterfeiting with increasingly complex printing, but it is an arms race.

### Wiesner's Insight: Uncopyable Banknotes

A quantum banknote contains **qubits** whose states are known only to the bank:

| Component | Description |
|-----------|------------|
| **Serial number** | Classical — printed visibly |
| **Quantum state** | N qubits, each in one of four states: \|0⟩, \|1⟩, \|+⟩, \|−⟩ |
| **Bank's record** | For each serial number, the bank stores which basis (Z or X) and which bit each qubit encodes |

A counterfeiter who obtains the banknote:
1. **Cannot clone it** — the no-cloning theorem forbids copying an unknown quantum state
2. **Cannot determine the states** — without knowing the basis, measuring destroys the information
3. **Cannot forge a new one** — they do not know the bank's secret basis record

> **Verification:** The holder presents the banknote to the bank. The bank looks up the serial number, measures each qubit in the correct basis, and checks the results match. A forged note fails with overwhelming probability.`,
      },
      {
        type: 'concept-card',
        title: 'No-Cloning as Anti-Counterfeiting',
        visual: 'bloch',
        explanation:
          'A counterfeiter holding a qubit in an unknown state sees a single point on the Bloch sphere — but does not know which point. They cannot copy it (no-cloning theorem) and cannot measure it without collapsing the superposition. The bank\'s secret is which basis each qubit is in — without that, the counterfeiter is blind.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import random

random.seed(42)

def mint_banknote(n_qubits):
    """Bank creates a quantum banknote: random bits in random bases."""
    serial = random.randint(10000, 99999)
    bits = [random.randint(0, 1) for _ in range(n_qubits)]
    bases = [random.choice(['Z', 'X']) for _ in range(n_qubits)]
    return serial, bits, bases

def prepare_banknote(bits, bases):
    """Prepare the quantum state of the banknote."""
    n = len(bits)
    qc = QuantumCircuit(n, n)
    for i in range(n):
        if bits[i] == 1:
            qc.x(i)
        if bases[i] == 'X':
            qc.h(i)
    return qc

def verify_banknote(qc, bits, bases):
    """Bank verifies by measuring each qubit in the correct basis."""
    n = len(bits)
    for i in range(n):
        if bases[i] == 'X':
            qc.h(i)
    qc.measure(range(n), range(n))

    sim = AerSimulator()
    result = sim.run(qc, shots=1).result()
    measured = list(result.get_counts().keys())[0][::-1]

    matches = sum(int(measured[i]) == bits[i] for i in range(n))
    return matches, n, measured

# Mint a banknote
serial, bits, bases = mint_banknote(8)
print(f"Serial: {serial}")
print(f"Bank record — bits:  {bits}")
print(f"Bank record — bases: {bases}")

# Legitimate verification
qc = prepare_banknote(bits, bases)
matches, total, measured = verify_banknote(qc, bits, bases)
print(f"\\nLegitimate verification: {matches}/{total} match")
print(f"Result: {'VALID' if matches == total else 'INVALID'}")

# Counterfeiter guesses random states
print(f"\\n--- Counterfeiter attempts ---")
fake_bits = [random.randint(0, 1) for _ in range(8)]
fake_bases = [random.choice(['Z', 'X']) for _ in range(8)]
fake_qc = prepare_banknote(fake_bits, fake_bases)
matches, total, measured = verify_banknote(fake_qc, bits, bases)
print(f"Forgery verification: {matches}/{total} match")
print(f"Result: {'VALID' if matches == total else 'INVALID'}")
prob_pass = (0.75 ** total)
print(f"Probability of forgery passing: {prob_pass:.6f}")`,
        framework: 'qiskit',
        description:
          'Wiesner\'s quantum money — mint a banknote with secret basis qubits, verify legitimately, then show a counterfeiter failing.',
        explorationPrompt:
          'The counterfeiter guesses correctly for each qubit with probability 3/4 (correct basis 1/2 of the time, plus correct outcome 1/2 when wrong basis — 1/2 + 1/4 = 3/4). With 8 qubits, (3/4)^8 ≈ 10% chance of passing. Increase n_qubits to 20 and watch the probability plummet.',
      },
      {
        type: 'text',
        markdown: `## Beyond Banknotes: Quantum Tokens

Wiesner's idea has evolved into broader **quantum token** primitives:

### Quantum Copy Protection
Encode a classical program into a quantum state such that it can be **executed but not duplicated.** The user can run the software but cannot pirate it.

### Quantum Lightning
A stronger form of quantum money where **even the bank** cannot forge a second copy of a specific banknote. Security holds against everyone, including the issuer.

### Tokenized Computation
Issue a quantum token that authorizes exactly one execution of a specific computation. After use, the token is consumed — no replays, no double-spending.

### Practical Challenges

| Challenge | Status |
|-----------|--------|
| Qubit coherence time | Minutes at best — banknotes would "expire" |
| Quantum memory | Storing qubits long-term is an unsolved problem |
| Verification requires bank | Cannot verify offline (Wiesner's original scheme) |
| Quantum networks | Needed for remote verification |

> **The core insight remains powerful:** the no-cloning theorem provides a physical guarantee of uniqueness that no classical system can match. Whether practical quantum money arrives depends on quantum memory technology.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '8.5-q1',
            question: 'Why can\'t a counterfeiter copy a quantum banknote?',
            options: [
              'The banknote is encrypted with a classical key',
              'Quantum computers cannot process banknote data',
              'The no-cloning theorem forbids copying unknown quantum states',
              'The bank monitors all copy attempts in real time',
            ],
            correctIndex: 2,
            explanation:
              'The no-cloning theorem proves that no physical process can duplicate an arbitrary unknown quantum state. Since the counterfeiter does not know the basis of each qubit, the states are effectively unknown and uncopyable.',
          },
          {
            id: '8.5-q2',
            question: 'A counterfeiter guesses each qubit correctly with probability 3/4. For a banknote with 20 qubits, what is the forgery success probability?',
            options: [
              '(3/4)^20 ≈ 0.3%',
              '(1/2)^20 ≈ 0.0001%',
              '75%',
              '(3/4)^20 ≈ 3.2%',
            ],
            correctIndex: 0,
            explanation:
              '(3/4)^20 ≈ 0.00317 ≈ 0.3%. Each additional qubit multiplies the counterfeiter\'s difficulty by 4/3. With enough qubits, forgery becomes astronomically unlikely.',
          },
          {
            id: '8.5-q3',
            question: 'What is the main practical obstacle to quantum money?',
            options: [
              'No one knows how to encode quantum states',
              'Qubits cannot be stored for long periods — quantum memory is an unsolved problem',
              'Classical money is already perfectly secure',
              'The no-cloning theorem has been disproven',
            ],
            correctIndex: 1,
            explanation:
              'Current quantum memory technology can preserve qubit states for only minutes at best. A banknote that decoheres in minutes is not practical. Long-lived quantum memory is an active research frontier.',
          },
        ],
      },
    ],
  },

  // ── Lesson 8.6 ──
  {
    id: '8.6',
    title: 'Quantum-Safe Communication',
    description:
      'Putting it all together — QKD, post-quantum crypto, and the road to the quantum internet.',
    difficulty: 'intermediate',
    estimatedMinutes: 20,
    prerequisites: ['8.1', '8.2', '8.4'],
    tags: ['quantum-internet', 'QKD-network', 'quantum-repeater', 'hybrid-security', 'quantum-satellite'],
    diracContext:
      'This capstone lesson synthesizes the track. Real-world quantum communication combines QKD for key distribution and post-quantum cryptography for authentication and bulk encryption. Cover the Micius satellite (China, 2017), European quantum networks, and the architecture of a quantum internet. Discuss quantum repeaters, quantum memory requirements, and the hybrid security model where QKD handles key exchange and PQC handles everything else.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Full Stack: QKD + PQC

Neither QKD nor post-quantum cryptography alone is a complete solution:

| Layer | Technology | Role |
|-------|-----------|------|
| **Key exchange** | QKD (BB84 / E91) | Physics-based key distribution |
| **Authentication** | PQC (ML-DSA / SLH-DSA) | Verify identity, prevent man-in-the-middle |
| **Bulk encryption** | AES-256 | Encrypt data with the QKD-derived key |
| **Key management** | Classical + quantum | Key storage, rotation, distribution scheduling |

QKD provides information-theoretic key exchange but **cannot authenticate** — you need a pre-shared secret or PQC signatures to prevent a man-in-the-middle from impersonating Alice or Bob. In practice:

1. Alice and Bob authenticate using PQC digital signatures
2. They run QKD to derive a shared symmetric key
3. They encrypt bulk data with AES using the QKD key
4. Periodically refresh keys via new QKD rounds

> **Hybrid security:** The combination is stronger than either alone — QKD provides physics-based key exchange, PQC provides quantum-resistant authentication.`,
      },
      {
        type: 'concept-card',
        title: 'Hybrid Security Architecture',
        visual: 'custom-svg',
        explanation:
          'Layer 1 (authentication): PQC signatures verify identity. Layer 2 (key exchange): QKD generates a shared secret. Layer 3 (encryption): AES-256 encrypts data with the QKD key. Each layer addresses a different threat — together, they provide defense in depth against both classical and quantum adversaries.',
      },
      {
        type: 'text',
        markdown: `## Real-World Quantum Networks

Quantum communication has moved from theory to deployment:

### Micius Satellite (China, 2017)
- First quantum communication satellite
- BB84 key distribution between ground stations 2,600 km apart
- Demonstrated entanglement distribution over 1,200 km
- Intercontinental quantum-secured video call (Beijing–Vienna)

### European Quantum Communication Infrastructure (EuroQCI)
- EU initiative connecting all 27 member states with QKD
- Combines fiber-optic QKD (metro/regional) with satellite QKD (long-haul)
- Target: operational by 2027

### China's Beijing-Shanghai Backbone
- 2,000 km fiber-optic QKD network operational since 2017
- 32 trusted relay nodes
- Used by banks and government agencies

### Other Deployments
- **Toshiba:** QKD over 600 km of fiber (2021 record)
- **SK Telecom / Samsung:** QKD-secured 5G networks in South Korea
- **BT / Toshiba:** London commercial QKD network

## The Distance Problem

QKD over fiber is limited by **photon loss** — signal strength decays exponentially with distance. After ~100-300 km, the signal is too weak.

| Solution | How It Works | Status |
|----------|-------------|--------|
| **Trusted relay nodes** | Intermediate nodes decrypt and re-encrypt — breaks end-to-end security | Deployed (China backbone) |
| **Satellite QKD** | Free-space photon transmission — less loss than fiber | Demonstrated (Micius) |
| **Quantum repeaters** | Use entanglement swapping to extend range without trusting nodes | Experimental — requires quantum memory |

> **The holy grail:** Quantum repeaters would enable end-to-end QKD over arbitrary distances without trusted nodes. They require quantum memory (storing entanglement) and entanglement purification — both active research areas.`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import math

def entanglement_swap():
    """
    Quantum repeater building block: entanglement swapping.
    Start with two separate Bell pairs (A-B1 and B2-C).
    Perform Bell measurement on B1-B2 at the relay.
    Result: A and C become entangled, even though they never interacted.
    """
    # 4 qubits: A=0, B1=1, B2=2, C=3
    qc = QuantumCircuit(4, 4)

    # Create Bell pair 1: A-B1
    qc.h(0)
    qc.cx(0, 1)
    qc.barrier()

    # Create Bell pair 2: B2-C
    qc.h(2)
    qc.cx(2, 3)
    qc.barrier()

    # Bell measurement on B1-B2 at the relay node
    qc.cx(1, 2)
    qc.h(1)
    qc.measure(1, 0)  # B1 result
    qc.measure(2, 1)  # B2 result
    qc.barrier()

    # Corrections on C based on Bell measurement results
    # (In practice, relay sends classical bits to C's station)
    qc.x(3).c_if(1, 1)   # If B2 measured 1, apply X to C
    qc.z(3).c_if(0, 1)   # If B1 measured 1, apply Z to C

    # Now A and C should be entangled!
    # Verify by measuring both in the same basis
    qc.measure(0, 2)  # A
    qc.measure(3, 3)  # C

    return qc

qc = entanglement_swap()
print("Entanglement Swapping Circuit:")
print(qc)

# Run and check correlations
sim = AerSimulator()
result = sim.run(qc, shots=1000).result()
counts = result.get_counts()

# Extract A-C correlations (bits 2 and 3 in the output)
correlated = 0
total = 0
for bitstring, count in counts.items():
    a_bit = bitstring[-3]   # bit 2 = A
    c_bit = bitstring[-4]   # bit 3 = C
    if a_bit == c_bit:
        correlated += count
    total += count

print(f"\\nA-C correlation: {correlated}/{total} = {correlated/total:.1%}")
print("(Should be ~100% — A and C are now entangled)")`,
        framework: 'qiskit',
        description:
          'Entanglement swapping — the quantum repeater building block that extends QKD range without trusted relay nodes.',
        explorationPrompt:
          'Qubits A and C never directly interacted, yet they end up perfectly correlated. This is the essence of a quantum repeater: extend entanglement across relay nodes, then use the A-C entanglement for E91-style QKD.',
      },
      {
        type: 'text',
        markdown: `## The Quantum Internet

The ultimate vision is a **quantum internet** — a network where any two nodes can share entanglement on demand, enabling:

| Application | How It Uses Entanglement |
|------------|------------------------|
| **QKD** | Secure key distribution over any distance |
| **Distributed quantum computing** | Link quantum processors for larger computations |
| **Quantum sensing networks** | Correlated measurements for ultra-precise GPS, telescopes, clocks |
| **Secure voting and auctions** | Verifiable protocols without trusting a central authority |
| **Blind quantum computing** | Compute on a remote quantum computer without revealing your data |

### Network Architecture (Proposed)

1. **Physical layer:** Fiber-optic channels + satellite links carrying single photons
2. **Entanglement layer:** Quantum repeaters generate and distribute Bell pairs
3. **Network layer:** Routing protocols decide which path to establish entanglement
4. **Application layer:** QKD, distributed computing, sensing protocols

> **Timeline reality check:** Metro-scale QKD networks exist today. Continental trusted-node networks are operational. True quantum repeater networks (the breakthrough needed for a global quantum internet) are still 5-15 years away — limited by quantum memory technology.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '8.6-q1',
            question: 'Why is QKD alone insufficient for secure communication?',
            options: [
              'QKD keys are too short for AES',
              'QKD cannot authenticate — without PQC signatures, a man-in-the-middle can impersonate Alice or Bob',
              'QKD is too slow for real-time communication',
              'QKD requires quantum computers at both endpoints',
            ],
            correctIndex: 1,
            explanation:
              'QKD distributes keys securely but has no built-in authentication. Without verifying identity (via PQC or pre-shared secrets), an attacker can perform a man-in-the-middle attack, running separate QKD sessions with Alice and Bob.',
          },
          {
            id: '8.6-q2',
            question: 'What does entanglement swapping achieve in a quantum repeater?',
            options: [
              'Amplifies the quantum signal like a classical repeater',
              'Creates entanglement between distant nodes that never directly interacted',
              'Converts quantum signals to classical signals and back',
              'Compresses quantum information for faster transmission',
            ],
            correctIndex: 1,
            explanation:
              'Entanglement swapping takes two separate entangled pairs (A-B and B-C) and creates entanglement between A and C via a Bell measurement on B. This extends entanglement range without the qubits A and C ever meeting.',
          },
          {
            id: '8.6-q3',
            question: 'What is the main technical bottleneck for a global quantum internet?',
            options: [
              'Lack of quantum algorithms',
              'Insufficient classical computing power',
              'Quantum memory — storing entanglement long enough for repeater operation',
              'The speed of light is too slow for quantum communication',
            ],
            correctIndex: 2,
            explanation:
              'Quantum repeaters need to store entanglement while waiting for operations at distant nodes. Current quantum memories can hold states for only milliseconds to minutes — not enough for wide-area network coordination. This is the key bottleneck.',
          },
          {
            id: '8.6-q4',
            question: 'Which real-world deployment demonstrated intercontinental QKD?',
            options: [
              'European EuroQCI network',
              'China\'s Micius satellite — Beijing to Vienna quantum-secured video call',
              'Google\'s Sycamore processor',
              'IBM\'s Quantum Network',
            ],
            correctIndex: 1,
            explanation:
              'The Micius satellite (launched 2017) distributed quantum keys between ground stations in China and Austria, enabling the first intercontinental quantum-secured video conference between Beijing and Vienna.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Quantum Communication Timeline',
        visual: 'custom-svg',
        explanation:
          'Today: Metro QKD networks and trusted-node backbones. Near-term (2025-2030): Satellite QKD constellations and early quantum repeater demonstrations. Medium-term (2030-2040): Regional quantum repeater networks, hybrid QKD+PQC infrastructure everywhere. Long-term (2040+): Global quantum internet with on-demand entanglement distribution.',
      },
    ],
  },
];
