export interface Milestone {
  id: string;
  title: string;
  description: string;
  starterCode: string;
  hints: string[];
  diracPromptAddendum: string;
}

export interface CapstoneProject {
  id: string;
  title: string;
  description: string;
  difficulty: 'intermediate' | 'advanced';
  estimatedWeeks: number;
  prerequisites: string[];
  milestones: Milestone[];
  diracGuidancePrompt: string;
}

export const CAPSTONE_PROJECTS: CapstoneProject[] = [
  // ===== PROJECT 1: Quantum Random Number Generator =====
  {
    id: 'capstone-qrng',
    title: 'Quantum Random Number Generator',
    description: 'Build a true random number generator powered by quantum mechanics. Unlike classical pseudorandom generators that use deterministic algorithms, your QRNG exploits the fundamental randomness of quantum measurement to produce genuinely unpredictable numbers.',
    difficulty: 'intermediate',
    estimatedWeeks: 1,
    prerequisites: ['qubit', 'superposition', 'measurement', 'hadamard'],
    milestones: [
      {
        id: 'qrng-m1',
        title: 'Basic QRNG Circuit',
        description: 'Build a single-qubit circuit that generates a random bit by putting a qubit in superposition and measuring it. Run it multiple times and collect results.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

# TODO Step 1: Create a quantum circuit with 1 qubit and 1 classical bit
qc = QuantumCircuit(1, 1)

# TODO Step 2: Apply a Hadamard gate to put the qubit in equal superposition
# Hint: qc.h(0)

# TODO Step 3: Measure the qubit
# Hint: qc.measure(0, 0)

# Run the circuit to generate random bits
simulator = AerSimulator()
job = simulator.run(qc, shots=10)
result = job.result()
counts = result.get_counts()
print("Random bit results:", counts)
`,
        hints: [
          'The Hadamard gate creates an equal superposition |+⟩ = (|0⟩ + |1⟩)/√2, giving exactly 50/50 probability for 0 and 1.',
          'Each "shot" of the circuit produces one random bit. Use the shots parameter to control how many random bits you generate.',
          'The get_counts() method returns a dictionary like {"0": 5, "1": 5} showing how many times each outcome occurred.',
        ],
        diracPromptAddendum: 'The student is building their first QRNG circuit. Help them understand that H creates a perfect 50/50 superposition, and each measurement collapses to a truly random 0 or 1. Emphasize that this randomness is fundamental — not pseudorandom. If they ask about bias, explain that real hardware might have slight bias but the simulator is ideal.',
      },
      {
        id: 'qrng-m2',
        title: 'Statistical Testing',
        description: 'Generate a large number of random bits and perform statistical tests to verify the distribution is truly uniform. Compare the results to what you would expect from a fair coin.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import math

def generate_random_bits(n_bits: int) -> list[int]:
    """Generate n random bits using a quantum circuit."""
    qc = QuantumCircuit(1, 1)
    qc.h(0)
    qc.measure(0, 0)

    simulator = AerSimulator()
    job = simulator.run(qc, shots=n_bits)
    result = job.result()
    counts = result.get_counts()

    # Convert counts to a list of bits
    bits = []
    for outcome, count in counts.items():
        bits.extend([int(outcome)] * count)
    return bits

# Generate 1000 random bits
bits = generate_random_bits(1000)

# TODO Step 1: Count the number of 0s and 1s
count_0 = 0  # TODO: count zeros
count_1 = 0  # TODO: count ones
print(f"Zeros: {count_0}, Ones: {count_1}")

# TODO Step 2: Calculate the ratio — should be close to 0.5
ratio = 0  # TODO: calculate count_1 / total
print(f"Ratio of 1s: {ratio:.4f} (expected: 0.5000)")

# TODO Step 3: Chi-squared test for uniformity
# chi2 = (count_0 - expected)^2 / expected + (count_1 - expected)^2 / expected
# For p=0.05 significance with 1 degree of freedom, critical value is 3.841
expected = len(bits) / 2
chi2 = 0  # TODO: calculate chi-squared statistic
print(f"Chi-squared: {chi2:.4f} (should be < 3.841 for uniform)")
print(f"Distribution is {'uniform' if chi2 < 3.841 else 'NOT uniform'}")
`,
        hints: [
          'Use bits.count(0) and bits.count(1) to count occurrences of each value in the list.',
          'The ratio of 1s should be close to 0.5 for a large number of bits. With 1000 bits, expect it to be between roughly 0.47 and 0.53.',
          'The chi-squared formula is: chi2 = ((count_0 - expected)^2 / expected) + ((count_1 - expected)^2 / expected), where expected = n_bits / 2.',
        ],
        diracPromptAddendum: 'The student is doing statistical testing of their QRNG output. Help them understand the chi-squared test: it measures how far the observed distribution is from the expected uniform distribution. A value below 3.841 (the critical value at p=0.05 with 1 degree of freedom) means the data is consistent with a fair coin. Explain that statistical fluctuations are expected — 500 zeros and 500 ones exactly would actually be suspicious.',
      },
      {
        id: 'qrng-m3',
        title: 'Multi-Bit QRNG',
        description: 'Extend your QRNG to generate multi-bit random numbers (random bytes, random integers in a range). Compare the quantum distribution to Python\'s classical random module.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import random

def quantum_random_byte() -> int:
    """Generate a random byte (0-255) using 8 qubits."""
    # TODO Step 1: Create a circuit with 8 qubits and 8 classical bits
    qc = QuantumCircuit(8, 8)

    # TODO Step 2: Apply H to all 8 qubits to create superposition
    # Hint: qc.h(range(8))

    # TODO Step 3: Measure all qubits
    # Hint: qc.measure(range(8), range(8))

    simulator = AerSimulator()
    job = simulator.run(qc, shots=1)
    result = job.result()
    counts = result.get_counts()

    # Convert binary string to integer
    bitstring = list(counts.keys())[0]
    return int(bitstring, 2)

def quantum_random_int(low: int, high: int) -> int:
    """Generate a random integer in [low, high] using rejection sampling."""
    range_size = high - low + 1
    # TODO Step 4: Calculate how many bits we need
    # Hint: n_bits = math.ceil(math.log2(range_size)) if range_size > 1 else 1
    import math
    n_bits = math.ceil(math.log2(range_size)) if range_size > 1 else 1

    while True:
        # Generate n_bits random bits
        qc = QuantumCircuit(n_bits, n_bits)
        qc.h(range(n_bits))
        qc.measure(range(n_bits), range(n_bits))

        simulator = AerSimulator()
        job = simulator.run(qc, shots=1)
        result = job.result()
        bitstring = list(result.get_counts().keys())[0]
        value = int(bitstring, 2)

        # TODO Step 5: Rejection sampling — only accept if value < range_size
        # Then return low + value
        if value < range_size:
            return low + value

# Test: generate 10 random bytes
print("Quantum random bytes:")
for _ in range(10):
    print(f"  {quantum_random_byte()}")

# Test: generate random integers in [1, 6] (like a die)
print("\\nQuantum dice rolls:")
quantum_rolls = [quantum_random_int(1, 6) for _ in range(20)]
print(f"  {quantum_rolls}")

# Compare with classical random
print("\\nClassical dice rolls:")
classical_rolls = [random.randint(1, 6) for _ in range(20)]
print(f"  {classical_rolls}")

# TODO Step 6: Compare distributions
# Count frequency of each outcome for both quantum and classical
print("\\nFrequency comparison (100 rolls):")
q_rolls = [quantum_random_int(1, 6) for _ in range(100)]
c_rolls = [random.randint(1, 6) for _ in range(100)]
for face in range(1, 7):
    q_count = q_rolls.count(face)
    c_count = c_rolls.count(face)
    print(f"  Face {face}: Quantum={q_count}%, Classical={c_count}%")
`,
        hints: [
          'To generate a random byte, you need 8 qubits each in superposition. Measuring gives a random 8-bit string (0-255).',
          'Rejection sampling is needed when the range is not a power of 2. For example, to generate 1-6, use 3 bits (0-7) and reject values >= 6.',
          'The quantum and classical distributions should look similar statistically — both are uniform. The difference is that quantum randomness is fundamentally unpredictable, while classical pseudorandom generators are deterministic.',
        ],
        diracPromptAddendum: 'The student is building a multi-bit QRNG and comparing it to classical randomness. Help them understand rejection sampling: when the range is not a power of 2, some bit patterns are invalid and must be rejected to maintain uniformity. Explain that while both quantum and classical RNGs produce uniform distributions, the quantum version is provably random by the laws of physics, whereas classical PRNGs use deterministic algorithms with a seed.',
      },
    ],
    diracGuidancePrompt: 'You are guiding a student through building a Quantum Random Number Generator. This is their first capstone project. Keep things encouraging and concrete. Focus on the connection between superposition, measurement, and randomness. Remind them that quantum randomness is fundamentally different from classical pseudorandomness — it is guaranteed by physics, not algorithms.',
  },

  // ===== PROJECT 2: BB84 Quantum Key Distribution =====
  {
    id: 'capstone-bb84',
    title: 'BB84 Quantum Key Distribution',
    description: 'Implement the BB84 protocol for quantum key distribution — the first and most famous quantum cryptography protocol. You will simulate Alice and Bob securely sharing a secret key, and detect when an eavesdropper (Eve) intercepts the communication.',
    difficulty: 'intermediate',
    estimatedWeeks: 2,
    prerequisites: ['qubit', 'superposition', 'measurement', 'hadamard', 'pauli-x'],
    milestones: [
      {
        id: 'bb84-m1',
        title: 'Prepare Qubits in Random Bases',
        description: 'Alice generates random bits and random bases, then prepares qubits accordingly. In the Z-basis: 0 → |0⟩, 1 → |1⟩. In the X-basis: 0 → |+⟩, 1 → |−⟩.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import random

n_bits = 16  # Number of qubits to send

# Alice generates random bits and random bases
alice_bits = [random.randint(0, 1) for _ in range(n_bits)]
alice_bases = [random.choice(['Z', 'X']) for _ in range(n_bits)]

print(f"Alice's bits:  {alice_bits}")
print(f"Alice's bases: {alice_bases}")

def prepare_qubit(bit: int, basis: str) -> QuantumCircuit:
    """Prepare a qubit encoding 'bit' in the given basis."""
    qc = QuantumCircuit(1, 1)

    # TODO Step 1: If bit is 1, apply X gate to flip to |1⟩
    # Hint: if bit == 1: qc.x(0)

    # TODO Step 2: If basis is 'X', apply H to switch to X-basis
    # This maps |0⟩ → |+⟩ and |1⟩ → |−⟩
    # Hint: if basis == 'X': qc.h(0)

    return qc

# Prepare all qubits
circuits = []
for i in range(n_bits):
    qc = prepare_qubit(alice_bits[i], alice_bases[i])
    circuits.append(qc)

# Verify: print what each qubit state should be
for i in range(n_bits):
    bit, basis = alice_bits[i], alice_bases[i]
    if basis == 'Z':
        state = '|0⟩' if bit == 0 else '|1⟩'
    else:
        state = '|+⟩' if bit == 0 else '|−⟩'
    print(f"  Qubit {i}: bit={bit}, basis={basis} → {state}")
`,
        hints: [
          'In the Z-basis (standard basis): bit 0 is |0⟩ (do nothing) and bit 1 is |1⟩ (apply X gate).',
          'In the X-basis (Hadamard basis): bit 0 is |+⟩ (apply H to |0⟩) and bit 1 is |−⟩ (apply X then H, or equivalently H to |1⟩).',
          'The order matters: first encode the bit value (X gate if bit=1), then switch basis (H gate if X-basis).',
        ],
        diracPromptAddendum: 'The student is preparing qubits for BB84. Help them understand the two bases: Z-basis {|0⟩, |1⟩} and X-basis {|+⟩, |−⟩}. The key insight is that if you measure in the wrong basis, you get a random result. This is what makes BB84 secure. Make sure they understand the encoding: X gate for bit=1, then H gate for X-basis.',
      },
      {
        id: 'bb84-m2',
        title: 'Bob\'s Measurement',
        description: 'Bob independently chooses random measurement bases and measures each qubit. When his basis matches Alice\'s, he gets the correct bit. When it doesn\'t match, he gets a random result.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import random

n_bits = 16

# Alice's preparation (from Milestone 1)
alice_bits = [random.randint(0, 1) for _ in range(n_bits)]
alice_bases = [random.choice(['Z', 'X']) for _ in range(n_bits)]

def prepare_and_measure(bit: int, alice_basis: str, bob_basis: str) -> int:
    """Prepare Alice's qubit and have Bob measure it."""
    qc = QuantumCircuit(1, 1)

    # Alice prepares
    if bit == 1:
        qc.x(0)
    if alice_basis == 'X':
        qc.h(0)

    # TODO Step 1: Bob measures in his chosen basis
    # If Bob's basis is 'X', apply H before measuring (to measure in X-basis)
    # Hint: if bob_basis == 'X': qc.h(0)

    # TODO Step 2: Measure the qubit
    # Hint: qc.measure(0, 0)

    # Run and get result
    simulator = AerSimulator()
    job = simulator.run(qc, shots=1)
    result = job.result()
    counts = result.get_counts()
    measured_bit = int(list(counts.keys())[0])
    return measured_bit

# TODO Step 3: Bob chooses random bases and measures
bob_bases = [random.choice(['Z', 'X']) for _ in range(n_bits)]
bob_bits = []
for i in range(n_bits):
    measured = prepare_and_measure(alice_bits[i], alice_bases[i], bob_bases[i])
    bob_bits.append(measured)

# Display results
print(f"Alice's bits:  {alice_bits}")
print(f"Alice's bases: {alice_bases}")
print(f"Bob's bases:   {bob_bases}")
print(f"Bob's bits:    {bob_bits}")

# TODO Step 4: Check which bits match when bases agree
print("\\nComparison:")
for i in range(n_bits):
    match_bases = alice_bases[i] == bob_bases[i]
    match_bits = alice_bits[i] == bob_bits[i]
    marker = "✓" if match_bases else "✗"
    print(f"  Qubit {i}: Alice={alice_bits[i]}({alice_bases[i]}) Bob={bob_bits[i]}({bob_bases[i]}) bases {'match' if match_bases else 'differ'} {marker}")
`,
        hints: [
          'To measure in the X-basis, apply H before the standard measurement. This rotates |+⟩ to |0⟩ and |−⟩ to |1⟩ before measuring.',
          'When Alice and Bob use the same basis, Bob always gets Alice\'s bit correctly. When bases differ, Bob gets a random 0 or 1.',
          'On average, about half the bases will match, so about half the bits will form the shared key.',
        ],
        diracPromptAddendum: 'The student is implementing Bob\'s measurement in BB84. The key concept: measuring in the matching basis always gives the correct bit, but measuring in the wrong basis gives a random result. This is because |+⟩ and |−⟩ both have 50/50 probability in the Z-basis, and |0⟩ and |1⟩ both have 50/50 probability in the X-basis. Help them see why this randomness is the foundation of BB84\'s security.',
      },
      {
        id: 'bb84-m3',
        title: 'Basis Reconciliation (Sifting)',
        description: 'Alice and Bob publicly compare their basis choices (but NOT their bit values) and keep only the bits where they used the same basis. This creates their shared secret key.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import random

n_bits = 32  # More bits for a longer key

# Full BB84 preparation and measurement
alice_bits = [random.randint(0, 1) for _ in range(n_bits)]
alice_bases = [random.choice(['Z', 'X']) for _ in range(n_bits)]
bob_bases = [random.choice(['Z', 'X']) for _ in range(n_bits)]

def prepare_and_measure(bit, alice_basis, bob_basis):
    qc = QuantumCircuit(1, 1)
    if bit == 1:
        qc.x(0)
    if alice_basis == 'X':
        qc.h(0)
    if bob_basis == 'X':
        qc.h(0)
    qc.measure(0, 0)
    simulator = AerSimulator()
    job = simulator.run(qc, shots=1)
    counts = job.result().get_counts()
    return int(list(counts.keys())[0])

bob_bits = [prepare_and_measure(alice_bits[i], alice_bases[i], bob_bases[i]) for i in range(n_bits)]

# TODO Step 1: Sifting — keep only bits where bases match
# Create alice_key and bob_key containing only the bits where
# alice_bases[i] == bob_bases[i]
alice_key = []
bob_key = []
for i in range(n_bits):
    pass  # TODO: if bases match, append to both keys

print(f"Original bits: {n_bits}")
print(f"Matching bases: {len(alice_key)}")
print(f"Alice's sifted key: {alice_key}")
print(f"Bob's sifted key:   {bob_key}")

# TODO Step 2: Verify keys match perfectly (no eavesdropper)
keys_match = alice_key == bob_key
print(f"\\nKeys match: {keys_match}")

# TODO Step 3: Sacrifice some bits for verification
# In real BB84, Alice and Bob publicly compare a subset of their key
# to check for eavesdropping, then discard those bits
if len(alice_key) >= 4:
    check_bits = 4  # Sacrifice 4 bits for verification
    check_indices = random.sample(range(len(alice_key)), check_bits)
    errors = sum(1 for i in check_indices if alice_key[i] != bob_key[i])
    error_rate = errors / check_bits

    print(f"\\nVerification ({check_bits} bits checked):")
    print(f"  Errors found: {errors}")
    print(f"  Error rate: {error_rate:.2%}")
    print(f"  {'SECURE — no eavesdropper detected' if errors == 0 else 'WARNING — possible eavesdropper!'}")

    # TODO Step 4: Remove checked bits from the final key
    final_key = [alice_key[i] for i in range(len(alice_key)) if i not in check_indices]
    print(f"\\nFinal secret key ({len(final_key)} bits): {final_key}")
`,
        hints: [
          'Sifting is simple: loop through all positions, and when alice_bases[i] == bob_bases[i], add alice_bits[i] to alice_key and bob_bits[i] to bob_key.',
          'Without eavesdropping, the sifted keys should match perfectly because matching bases always give the correct bit.',
          'The verification step sacrifices some key bits for security: if those bits all match, there is likely no eavesdropper. The remaining bits form the final secret key.',
        ],
        diracPromptAddendum: 'The student is implementing the sifting phase of BB84. Explain that Alice and Bob can publicly share their basis choices without compromising security — knowing the basis without knowing the bit value tells you nothing. About half the bits survive sifting. Then some bits are sacrificed for eavesdropper detection. Help them understand why this is safe: an eavesdropper introduces detectable errors.',
      },
      {
        id: 'bb84-m4',
        title: 'Eavesdropper Detection',
        description: 'Simulate an eavesdropper (Eve) who intercepts qubits, measures them, and resends them. Show that Eve\'s interference introduces detectable errors in the sifted key.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import random

n_bits = 64  # More bits for better statistics

alice_bits = [random.randint(0, 1) for _ in range(n_bits)]
alice_bases = [random.choice(['Z', 'X']) for _ in range(n_bits)]
bob_bases = [random.choice(['Z', 'X']) for _ in range(n_bits)]

def bb84_with_eve(alice_bit, alice_basis, bob_basis, eve_present=False):
    """Simulate BB84 with optional eavesdropper."""
    qc = QuantumCircuit(1, 1)

    # Alice prepares
    if alice_bit == 1:
        qc.x(0)
    if alice_basis == 'X':
        qc.h(0)

    if eve_present:
        # TODO Step 1: Eve intercepts — she chooses a random basis and measures
        eve_basis = random.choice(['Z', 'X'])

        # Eve measures in her basis
        if eve_basis == 'X':
            qc.h(0)
        qc.measure(0, 0)

        # TODO Step 2: Eve must resend the qubit based on her measurement
        # She prepares a new qubit in the state she measured
        # We simulate this by running the circuit to get Eve's result,
        # then creating a new circuit with Eve's bit and basis
        simulator = AerSimulator()
        job = simulator.run(qc, shots=1)
        eve_bit = int(list(job.result().get_counts().keys())[0])

        # New circuit: Eve resends
        qc = QuantumCircuit(1, 1)
        if eve_bit == 1:
            qc.x(0)
        if eve_basis == 'X':
            qc.h(0)

    # Bob measures in his basis
    if bob_basis == 'X':
        qc.h(0)
    qc.measure(0, 0)

    simulator = AerSimulator()
    job = simulator.run(qc, shots=1)
    return int(list(job.result().get_counts().keys())[0])

# TODO Step 3: Run BB84 WITHOUT Eve
bob_bits_no_eve = [bb84_with_eve(alice_bits[i], alice_bases[i], bob_bases[i], eve_present=False) for i in range(n_bits)]

# Sift
key_no_eve_alice = [alice_bits[i] for i in range(n_bits) if alice_bases[i] == bob_bases[i]]
key_no_eve_bob = [bob_bits_no_eve[i] for i in range(n_bits) if alice_bases[i] == bob_bases[i]]

errors_no_eve = sum(1 for a, b in zip(key_no_eve_alice, key_no_eve_bob) if a != b)
print("=== WITHOUT Eve ===")
print(f"Sifted key length: {len(key_no_eve_alice)}")
print(f"Errors: {errors_no_eve}")
print(f"Error rate: {errors_no_eve / len(key_no_eve_alice):.2%}" if key_no_eve_alice else "N/A")

# TODO Step 4: Run BB84 WITH Eve
bob_bits_with_eve = [bb84_with_eve(alice_bits[i], alice_bases[i], bob_bases[i], eve_present=True) for i in range(n_bits)]

# Sift
key_eve_alice = [alice_bits[i] for i in range(n_bits) if alice_bases[i] == bob_bases[i]]
key_eve_bob = [bob_bits_with_eve[i] for i in range(n_bits) if alice_bases[i] == bob_bases[i]]

errors_with_eve = sum(1 for a, b in zip(key_eve_alice, key_eve_bob) if a != b)
print("\\n=== WITH Eve ===")
print(f"Sifted key length: {len(key_eve_alice)}")
print(f"Errors: {errors_with_eve}")
print(f"Error rate: {errors_with_eve / len(key_eve_alice):.2%}" if key_eve_alice else "N/A")
print(f"\\nExpected error rate with Eve: ~25%")
print(f"Eve's interference {'DETECTED!' if errors_with_eve > 0 else 'not detected (try more bits)'}")
`,
        hints: [
          'Eve must choose a random basis to measure in, because she does not know Alice\'s basis. When Eve guesses wrong, she disturbs the qubit state.',
          'Eve introduces errors roughly 25% of the time in the sifted key: she picks the wrong basis half the time, and when she does, there is a 50% chance of flipping the bit. So 1/2 * 1/2 = 1/4 = 25%.',
          'With 64 bits and ~32 surviving sifting, you should see roughly 8 errors when Eve is present versus 0 errors without Eve.',
        ],
        diracPromptAddendum: 'The student is simulating eavesdropping in BB84. This is the exciting part! Help them understand why Eve introduces a ~25% error rate: Eve guesses the wrong basis 50% of the time, and when she does, she has a 50% chance of flipping the bit. So the overall error rate is 0.5 * 0.5 = 0.25. This is the beauty of BB84 — the laws of quantum mechanics guarantee that any eavesdropping attempt is detectable. Relate this to the no-cloning theorem.',
      },
    ],
    diracGuidancePrompt: 'You are guiding a student through BB84 quantum key distribution. This is a beautiful protocol that demonstrates the power of quantum mechanics for security. Emphasize the key insight: measuring a quantum state disturbs it, so eavesdropping is always detectable. Relate concepts to the no-cloning theorem. Be encouraging about the cryptographic significance — BB84 is information-theoretically secure, unlike RSA.',
  },

  // ===== PROJECT 3: Variational Quantum Eigensolver (VQE) =====
  {
    id: 'capstone-vqe',
    title: 'Variational Quantum Eigensolver (VQE)',
    description: 'Implement VQE to find the ground state energy of a simple molecular Hamiltonian. This hybrid quantum-classical algorithm is one of the most promising applications for near-term quantum computers. You will build the quantum ansatz, measure the energy, and use a classical optimizer to find the minimum.',
    difficulty: 'advanced',
    estimatedWeeks: 3,
    prerequisites: ['qubit', 'superposition', 'measurement', 'rotation', 'entanglement', 'cnot'],
    milestones: [
      {
        id: 'vqe-m1',
        title: 'Parameterized Ansatz Circuit',
        description: 'Build a parameterized quantum circuit (ansatz) that explores different quantum states based on tunable rotation angles. This is the "trial wavefunction" that VQE optimizes.',
        starterCode: `from qiskit import QuantumCircuit
import numpy as np

def create_ansatz(params: list[float]) -> QuantumCircuit:
    """
    Create a parameterized ansatz circuit for 2 qubits.

    A simple ansatz with Ry rotations and CNOT entanglement.
    params: list of 4 rotation angles [theta0, theta1, theta2, theta3]
    """
    qc = QuantumCircuit(2)

    # TODO Step 1: First layer — Ry rotations on both qubits
    # Ry(theta) rotates the qubit on the Bloch sphere
    # Hint: qc.ry(params[0], 0) and qc.ry(params[1], 1)

    # TODO Step 2: Entangling layer — CNOT
    # Hint: qc.cx(0, 1)

    # TODO Step 3: Second layer — more Ry rotations
    # Hint: qc.ry(params[2], 0) and qc.ry(params[3], 1)

    return qc

# Test the ansatz with random parameters
test_params = [np.pi/4, np.pi/3, np.pi/6, np.pi/2]
ansatz = create_ansatz(test_params)
print(ansatz)

# Verify: different parameters give different circuits
print("\\n--- Different parameters ---")
ansatz2 = create_ansatz([0, 0, 0, 0])
print(ansatz2)
print("\\nWith all zeros, qubits stay in |00⟩")

ansatz3 = create_ansatz([np.pi, 0, 0, 0])
print(ansatz3)
print("\\nWith theta0=pi, qubit 0 rotates to |1⟩")
`,
        hints: [
          'The ansatz is a template circuit with adjustable parameters. Think of it as a function that maps parameter values to quantum states.',
          'Ry gates are used because they map real parameters to real-amplitude states, which is sufficient for many chemistry problems.',
          'The CNOT gate is crucial — without entanglement, the ansatz can only represent product states and will miss correlated quantum states like those in molecules.',
        ],
        diracPromptAddendum: 'The student is building their first variational ansatz. Explain that the ansatz is like a knob-tunable quantum state: each parameter adjusts a rotation angle, and together they define which quantum state the circuit prepares. The structure (Ry-CNOT-Ry) is called a hardware-efficient ansatz. Emphasize that the choice of ansatz matters — it must be expressive enough to represent the ground state but not so deep that noise destroys the result.',
      },
      {
        id: 'vqe-m2',
        title: 'Hamiltonian Expectation Value',
        description: 'Implement the cost function: measure the expectation value of a Hamiltonian (energy operator) for a given ansatz state. For H₂, the Hamiltonian can be decomposed into Pauli terms.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np

def create_ansatz(params):
    qc = QuantumCircuit(2)
    qc.ry(params[0], 0)
    qc.ry(params[1], 1)
    qc.cx(0, 1)
    qc.ry(params[2], 0)
    qc.ry(params[3], 1)
    return qc

# Simplified H2 Hamiltonian at equilibrium bond distance:
# H = c0*II + c1*ZI + c2*IZ + c3*ZZ + c4*XX
# These are the Pauli decomposition coefficients
h2_coefficients = {
    'II': -1.0523,
    'ZI':  0.3979,
    'IZ': -0.3979,
    'ZZ': -0.0112,
    'XX':  0.1809,
}

def measure_pauli_expectation(qc: QuantumCircuit, pauli_string: str, shots: int = 4096) -> float:
    """
    Measure the expectation value of a Pauli string (e.g., 'ZZ', 'XX').
    """
    meas_circuit = qc.copy()
    n_qubits = meas_circuit.num_qubits
    meas_circuit.add_register(qc._new_creg(n_qubits))  # Workaround

    # Use a cleaner approach
    meas_circuit = QuantumCircuit(n_qubits, n_qubits)
    # Rebuild the ansatz
    for instruction in qc.data:
        meas_circuit.append(instruction)

    # TODO Step 1: Add basis rotation for each qubit based on Pauli operator
    # For 'X': apply H before measuring (rotate X-basis to Z-basis)
    # For 'Y': apply Sdg then H before measuring
    # For 'Z': measure directly (no rotation needed)
    # For 'I': no measurement needed (contributes factor of 1)
    for i, pauli in enumerate(reversed(pauli_string)):
        if pauli == 'X':
            meas_circuit.h(i)
        elif pauli == 'Y':
            meas_circuit.sdg(i)
            meas_circuit.h(i)
        # Z and I need no rotation

    # TODO Step 2: Measure all qubits
    meas_circuit.measure(range(n_qubits), range(n_qubits))

    # Run
    simulator = AerSimulator()
    job = simulator.run(meas_circuit, shots=shots)
    counts = job.result().get_counts()

    # TODO Step 3: Calculate expectation value
    # For each bitstring, compute the eigenvalue:
    # eigenvalue = (-1)^(number of 1s in positions where Pauli is not I)
    expectation = 0.0
    for bitstring, count in counts.items():
        eigenvalue = 1.0
        for i, pauli in enumerate(reversed(pauli_string)):
            if pauli != 'I':
                bit = int(bitstring[-(i+1)])  # Get bit for qubit i
                eigenvalue *= (-1) ** bit
        expectation += eigenvalue * count / shots

    return expectation

def compute_energy(params: list[float]) -> float:
    """Compute the total energy for given ansatz parameters."""
    ansatz = create_ansatz(params)
    energy = 0.0
    for pauli_string, coefficient in h2_coefficients.items():
        if pauli_string == 'II':
            energy += coefficient  # Identity always has expectation 1
        else:
            exp_val = measure_pauli_expectation(ansatz, pauli_string)
            energy += coefficient * exp_val
    return energy

# Test with some parameters
test_params = [0.0, 0.0, 0.0, 0.0]
energy = compute_energy(test_params)
print(f"Energy at params {test_params}: {energy:.4f} Hartree")

test_params2 = [np.pi, 0.0, 0.0, 0.0]
energy2 = compute_energy(test_params2)
print(f"Energy at params {test_params2}: {energy2:.4f} Hartree")
print(f"\\nH2 exact ground state energy: -1.8573 Hartree")
`,
        hints: [
          'The Hamiltonian is decomposed into a sum of Pauli terms. Each term like ZZ means: apply Z to qubit 0 and Z to qubit 1, then multiply eigenvalues.',
          'To measure in the X-basis, apply H before measurement. To measure in the Y-basis, apply S-dagger then H. Z-basis needs no change.',
          'The eigenvalue of a Pauli string for a measured bitstring is the product of (-1)^bit for each non-identity Pauli term. For example, for ZZ and bitstring "01": (-1)^0 * (-1)^1 = -1.',
        ],
        diracPromptAddendum: 'The student is implementing Hamiltonian measurement for VQE. This is the most conceptually challenging part. Explain the Pauli decomposition: any Hamiltonian can be written as a sum of Pauli strings with coefficients. Each Pauli string is measured separately by rotating to the right basis. The expectation value is calculated from measurement statistics. Help them understand eigenvalues: for Z, |0⟩ has eigenvalue +1 and |1⟩ has eigenvalue -1.',
      },
      {
        id: 'vqe-m3',
        title: 'Classical Optimizer Loop',
        description: 'Connect the quantum energy measurement to a classical optimizer that tunes the ansatz parameters to minimize the energy. This is the heart of VQE — the quantum-classical hybrid loop.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np
from scipy.optimize import minimize

def create_ansatz(params):
    qc = QuantumCircuit(2)
    qc.ry(params[0], 0)
    qc.ry(params[1], 1)
    qc.cx(0, 1)
    qc.ry(params[2], 0)
    qc.ry(params[3], 1)
    return qc

h2_coefficients = {
    'II': -1.0523, 'ZI': 0.3979, 'IZ': -0.3979,
    'ZZ': -0.0112, 'XX': 0.1809,
}

def measure_pauli_expectation(qc, pauli_string, shots=4096):
    meas_circuit = QuantumCircuit(2, 2)
    for instruction in qc.data:
        meas_circuit.append(instruction)
    for i, pauli in enumerate(reversed(pauli_string)):
        if pauli == 'X':
            meas_circuit.h(i)
        elif pauli == 'Y':
            meas_circuit.sdg(i)
            meas_circuit.h(i)
    meas_circuit.measure(range(2), range(2))
    simulator = AerSimulator()
    counts = simulator.run(meas_circuit, shots=shots).result().get_counts()
    expectation = 0.0
    for bitstring, count in counts.items():
        eigenvalue = 1.0
        for i, pauli in enumerate(reversed(pauli_string)):
            if pauli != 'I':
                eigenvalue *= (-1) ** int(bitstring[-(i+1)])
        expectation += eigenvalue * count / shots
    return expectation

# Track optimization progress
energy_history = []

def cost_function(params):
    """Cost function for the optimizer."""
    ansatz = create_ansatz(params)
    energy = 0.0
    for pauli_string, coeff in h2_coefficients.items():
        if pauli_string == 'II':
            energy += coeff
        else:
            energy += coeff * measure_pauli_expectation(ansatz, pauli_string)
    energy_history.append(energy)
    return energy

# TODO Step 1: Choose initial parameters (random starting point)
initial_params = np.random.uniform(0, 2 * np.pi, 4)
print(f"Initial parameters: {initial_params}")
print(f"Initial energy: {cost_function(initial_params):.4f} Hartree")

# TODO Step 2: Run the classical optimizer
# Use scipy.optimize.minimize with the COBYLA method
# Hint: result = minimize(cost_function, initial_params, method='COBYLA', options={'maxiter': 100})
result = None  # TODO: replace with minimize call

# TODO Step 3: Print results
if result is not None:
    print(f"\\nOptimization complete!")
    print(f"Optimal parameters: {result.x}")
    print(f"Optimal energy: {result.fun:.4f} Hartree")
    print(f"Exact ground state: -1.8573 Hartree")
    print(f"Error: {abs(result.fun - (-1.8573)):.4f} Hartree")
    print(f"Iterations: {len(energy_history)}")

    # Print convergence
    print(f"\\nEnergy convergence:")
    for i in range(0, len(energy_history), max(1, len(energy_history) // 10)):
        print(f"  Step {i:3d}: {energy_history[i]:.4f}")
    print(f"  Final:   {energy_history[-1]:.4f}")
`,
        hints: [
          'Use scipy.optimize.minimize with method="COBYLA" — it is a gradient-free optimizer that works well with noisy quantum measurements.',
          'The initial parameters should be random (between 0 and 2*pi). Different starting points may converge to different results.',
          'VQE is noisy because each energy evaluation involves finite-shot measurements. Increasing shots reduces noise but increases runtime.',
        ],
        diracPromptAddendum: 'The student is connecting the quantum circuit to a classical optimizer. This is the VQE loop: (1) classical optimizer proposes parameters, (2) quantum circuit measures energy, (3) optimizer adjusts parameters, repeat. Explain that COBYLA is good here because it does not need gradients (which are noisy on quantum hardware). Discuss convergence: the energy should decrease over iterations, approaching the exact ground state energy.',
      },
      {
        id: 'vqe-m4',
        title: 'H₂ Ground State Energy',
        description: 'Put it all together to find the ground state energy of the hydrogen molecule (H₂) at different bond distances and plot the potential energy curve.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np
from scipy.optimize import minimize

def create_ansatz(params):
    qc = QuantumCircuit(2)
    qc.ry(params[0], 0)
    qc.ry(params[1], 1)
    qc.cx(0, 1)
    qc.ry(params[2], 0)
    qc.ry(params[3], 1)
    return qc

def measure_pauli_expectation(qc, pauli_string, shots=8192):
    meas_circuit = QuantumCircuit(2, 2)
    for instruction in qc.data:
        meas_circuit.append(instruction)
    for i, pauli in enumerate(reversed(pauli_string)):
        if pauli == 'X':
            meas_circuit.h(i)
        elif pauli == 'Y':
            meas_circuit.sdg(i)
            meas_circuit.h(i)
    meas_circuit.measure(range(2), range(2))
    simulator = AerSimulator()
    counts = simulator.run(meas_circuit, shots=shots).result().get_counts()
    expectation = 0.0
    for bitstring, count in counts.items():
        eigenvalue = 1.0
        for i, pauli in enumerate(reversed(pauli_string)):
            if pauli != 'I':
                eigenvalue *= (-1) ** int(bitstring[-(i+1)])
        expectation += eigenvalue * count / shots
    return expectation

# H2 Hamiltonian coefficients at different bond distances (Angstroms)
# These are pre-computed Pauli decompositions
h2_hamiltonians = {
    0.5: {'II': -0.4804, 'ZI': 0.3435, 'IZ': -0.4347, 'ZZ': 0.5716, 'XX': 0.0910},
    0.6: {'II': -0.6579, 'ZI': 0.3572, 'IZ': -0.4228, 'ZZ': 0.3662, 'XX': 0.1219},
    0.7: {'II': -0.8619, 'ZI': 0.3812, 'IZ': -0.3978, 'ZZ': 0.1714, 'XX': 0.1548},
    0.8: {'II': -0.9981, 'ZI': 0.3979, 'IZ': -0.3979, 'ZZ': 0.0112, 'XX': 0.1809},
    0.9: {'II': -1.0651, 'ZI': 0.4018, 'IZ': -0.3993, 'ZZ': -0.1193, 'XX': 0.1979},
    1.0: {'II': -1.0523, 'ZI': 0.3979, 'IZ': -0.3979, 'ZZ': -0.0112, 'XX': 0.1809},
    1.5: {'II': -0.8762, 'ZI': 0.3326, 'IZ': -0.3326, 'ZZ': -0.4138, 'XX': 0.0943},
    2.0: {'II': -0.7553, 'ZI': 0.2720, 'IZ': -0.2720, 'ZZ': -0.5106, 'XX': 0.0485},
    2.5: {'II': -0.6970, 'ZI': 0.2339, 'IZ': -0.2339, 'ZZ': -0.5445, 'XX': 0.0245},
}

def run_vqe(hamiltonian: dict) -> float:
    """Run VQE for a given Hamiltonian and return the ground state energy."""
    def cost_function(params):
        ansatz = create_ansatz(params)
        energy = 0.0
        for pauli_string, coeff in hamiltonian.items():
            if pauli_string == 'II':
                energy += coeff
            else:
                energy += coeff * measure_pauli_expectation(ansatz, pauli_string)
        return energy

    # Run optimizer with multiple random starts, keep best
    best_energy = float('inf')
    for trial in range(3):
        initial_params = np.random.uniform(0, 2 * np.pi, 4)
        result = minimize(cost_function, initial_params, method='COBYLA',
                         options={'maxiter': 80})
        if result.fun < best_energy:
            best_energy = result.fun
    return best_energy

# TODO Step 1: Compute energy at each bond distance
distances = sorted(h2_hamiltonians.keys())
vqe_energies = []

print("Computing H2 potential energy curve with VQE...")
print(f"{'Distance (A)':>12} | {'VQE Energy (Ha)':>16}")
print("-" * 33)

for d in distances:
    energy = run_vqe(h2_hamiltonians[d])
    vqe_energies.append(energy)
    print(f"{d:>12.1f} | {energy:>16.4f}")

# TODO Step 2: Find equilibrium bond distance (minimum energy)
min_idx = np.argmin(vqe_energies)
eq_distance = distances[min_idx]
eq_energy = vqe_energies[min_idx]

print(f"\\nEquilibrium bond distance: {eq_distance:.1f} Angstroms")
print(f"Ground state energy: {eq_energy:.4f} Hartree")
print(f"Expected: ~0.735 Angstroms, ~-1.137 Hartree")

# TODO Step 3: Print ASCII potential energy curve
print(f"\\nH2 Potential Energy Curve:")
min_e = min(vqe_energies)
max_e = max(vqe_energies)
for i, d in enumerate(distances):
    bar_len = int(40 * (vqe_energies[i] - min_e) / (max_e - min_e)) if max_e > min_e else 0
    marker = " <-- min" if i == min_idx else ""
    print(f"  {d:.1f}A | {'#' * bar_len}{' ' * (40 - bar_len)} | {vqe_energies[i]:.4f}{marker}")
`,
        hints: [
          'Running multiple trials with different random starting points helps avoid local minima. Keep the best (lowest energy) result.',
          'The equilibrium bond distance is where the energy is lowest — this is the most stable configuration of the H₂ molecule.',
          'The potential energy curve should show a minimum around 0.7-0.8 Angstroms. At very short distances, nuclear repulsion dominates. At very long distances, the atoms do not interact.',
        ],
        diracPromptAddendum: 'The student is computing the H₂ potential energy curve — the grand finale of the VQE project! This is real computational chemistry. The curve shows how the energy of H₂ changes with bond distance. The minimum is the equilibrium bond distance where the molecule is most stable. Help them interpret the results: compare to the exact value (-1.137 Hartree at ~0.735 A). Discuss sources of error: shot noise, ansatz expressibility, and optimizer convergence. Celebrate this achievement — they just simulated a real molecule on a quantum computer!',
      },
    ],
    diracGuidancePrompt: 'You are guiding a student through implementing VQE from scratch. This is an advanced project that bridges quantum computing and chemistry. Be patient with the math — explain Pauli decomposition, expectation values, and the variational principle in intuitive terms. The variational principle is key: the energy of any trial state is always >= the true ground state energy, so minimizing always approaches the right answer. Connect to real applications: drug discovery, materials science, catalyst design.',
  },

  // ===== PROJECT 4: Quantum Machine Learning Classifier =====
  {
    id: 'capstone-qml',
    title: 'Quantum Machine Learning Classifier',
    description: 'Build a variational quantum classifier that learns to classify data points using a quantum circuit. You will encode classical data into quantum states, build a trainable quantum circuit, and optimize it to classify the Iris dataset.',
    difficulty: 'advanced',
    estimatedWeeks: 2,
    prerequisites: ['qubit', 'superposition', 'rotation', 'cnot', 'entanglement', 'measurement'],
    milestones: [
      {
        id: 'qml-m1',
        title: 'Angle Encoding of Classical Data',
        description: 'Encode classical feature vectors into quantum states using rotation gates. Each feature value maps to a rotation angle on a qubit.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np

def angle_encode(features: list[float]) -> QuantumCircuit:
    """
    Encode classical features into a quantum state using angle encoding.
    Each feature is mapped to Ry and Rz rotations on a qubit.

    features: list of N values (normalized to [0, 1])
    Returns: QuantumCircuit with N qubits
    """
    n_qubits = len(features)
    qc = QuantumCircuit(n_qubits)

    for i, feature in enumerate(features):
        # TODO Step 1: Encode each feature as rotation angles
        # Map feature value [0, 1] to angle [0, pi]
        theta = feature * np.pi

        # Apply Ry rotation to encode the feature magnitude
        # Hint: qc.ry(theta, i)

        # Apply Rz rotation for additional expressiveness
        # Hint: qc.rz(theta, i)
        pass

    return qc

# Test with sample data
# Iris dataset features (normalized): sepal_length, sepal_width
sample_features = [0.72, 0.31]  # Normalized to [0, 1]

encoded_circuit = angle_encode(sample_features)
print("Encoded circuit:")
print(encoded_circuit)

# TODO Step 2: Verify encoding produces different states for different inputs
print("\\n--- Encoding different data points ---")
data_points = [
    [0.0, 0.0],   # All zeros
    [1.0, 1.0],   # All ones
    [0.5, 0.5],   # Middle
    [0.2, 0.8],   # Asymmetric
]

for features in data_points:
    qc = angle_encode(features)
    # Measure to see the probability distribution
    qc.measure_all()
    simulator = AerSimulator()
    counts = simulator.run(qc, shots=1024).result().get_counts()
    print(f"  Features {features}: {dict(sorted(counts.items()))}")

# TODO Step 3: Normalize raw Iris data for encoding
# Iris features: sepal_length, sepal_width, petal_length, petal_width
raw_data = [
    [5.1, 3.5, 1.4, 0.2],  # Setosa
    [7.0, 3.2, 4.7, 1.4],  # Versicolor
    [6.3, 3.3, 6.0, 2.5],  # Virginica
]

# Normalize each feature to [0, 1] using min-max scaling
all_features = np.array(raw_data)
mins = all_features.min(axis=0)
maxs = all_features.max(axis=0)
ranges = maxs - mins
ranges[ranges == 0] = 1  # Avoid division by zero

normalized = (all_features - mins) / ranges
print("\\nNormalized Iris samples:")
for i, (raw, norm) in enumerate(zip(raw_data, normalized)):
    print(f"  Raw: {raw} -> Normalized: {norm.tolist()}")
`,
        hints: [
          'Angle encoding maps each classical feature to a rotation angle. A feature value of 0 means no rotation (qubit stays in |0⟩), and 1 means maximum rotation (pi radians).',
          'Using both Ry and Rz rotations per qubit gives the encoding more expressiveness — Ry controls the |0⟩/|1⟩ probability ratio, while Rz adds a relative phase.',
          'Always normalize your data to [0, 1] before encoding. Use min-max normalization: (value - min) / (max - min).',
        ],
        diracPromptAddendum: 'The student is learning angle encoding for quantum machine learning. Explain that encoding classical data into quantum states is the first and crucial step. Angle encoding uses rotation gates to map feature values to qubit states on the Bloch sphere. Different data points produce different quantum states, and the classifier will learn to distinguish them. Compare to classical ML: this is analogous to the input layer of a neural network.',
      },
      {
        id: 'qml-m2',
        title: 'Variational Classifier Circuit',
        description: 'Build the variational (trainable) part of the quantum classifier. This parameterized circuit processes the encoded data and produces a classification decision.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np

def angle_encode(features, n_qubits):
    """Encode features into n_qubits using angle encoding."""
    qc = QuantumCircuit(n_qubits)
    for i in range(min(len(features), n_qubits)):
        theta = features[i] * np.pi
        qc.ry(theta, i)
        qc.rz(theta, i)
    return qc

def variational_layer(qc: QuantumCircuit, params: list[float], layer_idx: int):
    """
    Add one variational layer to the circuit.
    Each layer has: Ry rotations + entangling CNOTs + Rz rotations
    """
    n_qubits = qc.num_qubits
    offset = layer_idx * 2 * n_qubits

    # TODO Step 1: Ry rotation on each qubit (trainable)
    for i in range(n_qubits):
        qc.ry(params[offset + i], i)

    # TODO Step 2: Entangling layer — chain of CNOTs
    # Connect qubit 0→1, 1→2, ..., (n-1)→0 in a ring
    for i in range(n_qubits):
        qc.cx(i, (i + 1) % n_qubits)

    # TODO Step 3: Rz rotation on each qubit (trainable)
    for i in range(n_qubits):
        qc.rz(params[offset + n_qubits + i], i)

def build_classifier(features: list[float], params: list[float],
                     n_qubits: int = 2, n_layers: int = 2) -> QuantumCircuit:
    """
    Build the full classifier circuit: encoding + variational layers + measurement.
    """
    qc = QuantumCircuit(n_qubits, 1)

    # Encode data
    encoding = angle_encode(features, n_qubits)
    qc.compose(encoding, inplace=True)

    # Add variational layers
    for layer in range(n_layers):
        variational_layer(qc, params, layer)

    # Measure first qubit for classification
    qc.measure(0, 0)
    return qc

def classify(features: list[float], params: list[float],
             n_qubits: int = 2, n_layers: int = 2, shots: int = 1024) -> float:
    """
    Run the classifier and return P(class 1) = probability of measuring |1⟩.
    """
    qc = build_classifier(features, params, n_qubits, n_layers)
    simulator = AerSimulator()
    counts = simulator.run(qc, shots=shots).result().get_counts()
    p1 = counts.get('1', 0) / shots
    return p1

# TODO Step 4: Test the classifier
n_qubits = 2
n_layers = 2
n_params = n_layers * 2 * n_qubits  # Each layer: n_qubits Ry + n_qubits Rz

# Random initial parameters
params = np.random.uniform(0, 2 * np.pi, n_params)
print(f"Number of trainable parameters: {n_params}")

# Test on sample data points
test_data = [
    ([0.2, 0.1], "Setosa"),
    ([0.6, 0.5], "Versicolor"),
    ([0.9, 0.8], "Virginica"),
]

print("\\nClassification with random (untrained) parameters:")
for features, label in test_data:
    p1 = classify(features, params, n_qubits, n_layers)
    predicted = "Class 1" if p1 > 0.5 else "Class 0"
    print(f"  {label} {features}: P(1)={p1:.3f} -> {predicted}")
print("\\n(Results are random since parameters are untrained)")
`,
        hints: [
          'The variational layer structure (rotations + entangling + rotations) is like a layer in a neural network. Stacking multiple layers increases the model\'s expressive power.',
          'The ring of CNOTs (0→1, 1→2, ..., n-1→0) creates entanglement between all qubits, allowing the circuit to learn correlations between features.',
          'The classification decision is based on measuring qubit 0: P(|1⟩) > 0.5 means class 1, otherwise class 0. This is the "output neuron" of the quantum neural network.',
        ],
        diracPromptAddendum: 'The student is building the variational classifier circuit. Draw the analogy to classical neural networks: the encoding is the input layer, each variational layer is a hidden layer, and the measurement is the output layer. Rotations are like weights, and CNOTs are like connections between neurons. The key quantum advantage claim (still debated!) is that entanglement allows the circuit to learn correlations that are hard to represent classically.',
      },
      {
        id: 'qml-m3',
        title: 'Training on Iris Dataset',
        description: 'Train the quantum classifier on a subset of the Iris dataset. Implement the training loop with a cost function and optimizer, then evaluate accuracy.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np
from scipy.optimize import minimize

# ---- Circuit functions (from Milestone 2) ----
def angle_encode(features, n_qubits):
    qc = QuantumCircuit(n_qubits)
    for i in range(min(len(features), n_qubits)):
        theta = features[i] * np.pi
        qc.ry(theta, i)
        qc.rz(theta, i)
    return qc

def variational_layer(qc, params, layer_idx):
    n_qubits = qc.num_qubits
    offset = layer_idx * 2 * n_qubits
    for i in range(n_qubits):
        qc.ry(params[offset + i], i)
    for i in range(n_qubits):
        qc.cx(i, (i + 1) % n_qubits)
    for i in range(n_qubits):
        qc.rz(params[offset + n_qubits + i], i)

def classify(features, params, n_qubits=2, n_layers=2, shots=1024):
    qc = QuantumCircuit(n_qubits, 1)
    qc.compose(angle_encode(features, n_qubits), inplace=True)
    for layer in range(n_layers):
        variational_layer(qc, params, layer)
    qc.measure(0, 0)
    simulator = AerSimulator()
    counts = simulator.run(qc, shots=shots).result().get_counts()
    return counts.get('1', 0) / shots

# ---- Iris dataset (simplified: 2 features, 2 classes) ----
# Using petal_length and petal_width (most discriminative features)
# Class 0: Setosa, Class 1: Versicolor
train_data = [
    # Setosa (class 0) - normalized petal_length, petal_width
    ([0.07, 0.04], 0), ([0.07, 0.04], 0), ([0.10, 0.04], 0),
    ([0.05, 0.04], 0), ([0.07, 0.08], 0), ([0.17, 0.12], 0),
    ([0.10, 0.04], 0), ([0.12, 0.08], 0), ([0.03, 0.04], 0),
    ([0.05, 0.00], 0),
    # Versicolor (class 1) - normalized petal_length, petal_width
    ([0.63, 0.54], 1), ([0.58, 0.50], 1), ([0.68, 0.54], 1),
    ([0.51, 0.38], 1), ([0.56, 0.50], 1), ([0.66, 0.58], 1),
    ([0.58, 0.42], 1), ([0.49, 0.42], 1), ([0.61, 0.50], 1),
    ([0.53, 0.46], 1),
]

test_data = [
    ([0.08, 0.04], 0), ([0.12, 0.08], 0), ([0.05, 0.04], 0),
    ([0.59, 0.50], 1), ([0.63, 0.46], 1), ([0.54, 0.42], 1),
]

n_qubits = 2
n_layers = 2
n_params = n_layers * 2 * n_qubits

# TODO Step 1: Define the cost function (binary cross-entropy or MSE)
def cost_function(params):
    total_cost = 0.0
    for features, label in train_data:
        prediction = classify(features, params, n_qubits, n_layers, shots=512)
        # Mean squared error
        total_cost += (prediction - label) ** 2
    return total_cost / len(train_data)

# TODO Step 2: Train the classifier
print("Training quantum classifier...")
initial_params = np.random.uniform(0, 2 * np.pi, n_params)
print(f"Initial cost: {cost_function(initial_params):.4f}")

# Optimize
# Hint: result = minimize(cost_function, initial_params, method='COBYLA',
#                         options={'maxiter': 100, 'rhobeg': 0.5})
result = minimize(cost_function, initial_params, method='COBYLA',
                  options={'maxiter': 100, 'rhobeg': 0.5})

trained_params = result.x
print(f"Final cost: {result.fun:.4f}")

# TODO Step 3: Evaluate on test data
print("\\nTest set evaluation:")
correct = 0
for features, label in test_data:
    p1 = classify(features, trained_params, n_qubits, n_layers, shots=1024)
    predicted = 1 if p1 > 0.5 else 0
    is_correct = predicted == label
    correct += int(is_correct)
    print(f"  Features: {features}, True: {label}, P(1): {p1:.3f}, "
          f"Predicted: {predicted}, {'CORRECT' if is_correct else 'WRONG'}")

accuracy = correct / len(test_data) * 100
print(f"\\nTest accuracy: {accuracy:.1f}% ({correct}/{len(test_data)})")

# TODO Step 4: Print decision boundary exploration
print("\\nDecision boundary (P(class 1) for grid of points):")
print(f"{'petal_len':>10} | " + " ".join(f"{w:.1f}" for w in np.arange(0, 1.1, 0.2)))
print("-" * 55)
for pl in np.arange(0, 1.1, 0.2):
    row = f"{pl:>10.1f} | "
    for pw in np.arange(0, 1.1, 0.2):
        p = classify([pl, pw], trained_params, n_qubits, n_layers, shots=256)
        row += f" {p:.1f} "
    print(row)
`,
        hints: [
          'The cost function measures how wrong the predictions are. Mean squared error (MSE) works: sum of (prediction - label)^2 divided by number of samples.',
          'COBYLA optimizer with rhobeg=0.5 works well for quantum circuits. It does not need gradients, which is important because quantum measurements are noisy.',
          'If accuracy is low after training, try: (1) more optimizer iterations, (2) different random initial parameters, (3) more variational layers. The Iris classes Setosa vs Versicolor are well-separated, so >80% accuracy is achievable.',
        ],
        diracPromptAddendum: 'The student is training their quantum classifier on real data! This is exciting. Help them understand the training loop: it is just like classical ML — compute cost, adjust parameters, repeat. The quantum part is the model (parameterized circuit) that maps inputs to predictions. Discuss accuracy: for this well-separated dataset, good training should achieve >85% test accuracy. If results are poor, suggest trying different random seeds, more iterations, or checking that the encoding and variational layers are correctly implemented.',
      },
    ],
    diracGuidancePrompt: 'You are guiding a student through building a quantum machine learning classifier. This is at the frontier of quantum computing research. Be honest about the current state: quantum advantage for ML is not yet proven, but this is a great way to learn both quantum computing and machine learning concepts. Draw parallels to classical neural networks throughout. Emphasize the key components: data encoding (input layer), variational circuit (hidden layers), and measurement (output layer).',
  },

  // ===== PROJECT 5: Grover's Search =====
  {
    id: 'capstone-grover',
    title: 'Grover\'s Search Algorithm',
    description: 'Implement Grover\'s search algorithm from scratch. You will build the oracle, the diffusion operator, and the full algorithm, then demonstrate the quadratic speedup by running on multiple problem sizes.',
    difficulty: 'intermediate',
    estimatedWeeks: 2,
    prerequisites: ['qubit', 'superposition', 'hadamard', 'pauli-x', 'pauli-z', 'cnot', 'controlled-gates', 'measurement'],
    milestones: [
      {
        id: 'grover-m1',
        title: 'Build the Oracle',
        description: 'Build a phase oracle that marks a target state by flipping its phase. For a 2-qubit system searching for |11⟩, the oracle is simply a CZ gate.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np

def oracle_for_target(n_qubits: int, target: str) -> QuantumCircuit:
    """
    Build a phase oracle that flips the phase of the target state.

    The oracle applies a phase of -1 to |target⟩ and +1 to all other states.
    Strategy: Flip bits so target maps to |11...1⟩, apply multi-controlled Z, flip back.

    n_qubits: number of qubits
    target: binary string, e.g., '101' for |101⟩
    """
    oracle = QuantumCircuit(n_qubits)

    # TODO Step 1: Flip qubits where target bit is '0'
    # This maps |target⟩ to |11...1⟩
    # Hint: for i, bit in enumerate(reversed(target)):
    #          if bit == '0': oracle.x(i)
    for i, bit in enumerate(reversed(target)):
        if bit == '0':
            oracle.x(i)

    # TODO Step 2: Apply multi-controlled Z gate
    # Multi-controlled Z = H on last qubit, then multi-controlled X (Toffoli), then H
    # For 2 qubits: CZ gate
    # For 3+ qubits: use mcx (multi-controlled X) with H wrapper
    if n_qubits == 2:
        oracle.cz(0, 1)
    else:
        oracle.h(n_qubits - 1)
        oracle.mcx(list(range(n_qubits - 1)), n_qubits - 1)
        oracle.h(n_qubits - 1)

    # TODO Step 3: Undo the bit flips from Step 1
    for i, bit in enumerate(reversed(target)):
        if bit == '0':
            oracle.x(i)

    return oracle

# Test: oracle for |11⟩ on 2 qubits
print("Oracle for target |11⟩:")
oracle_11 = oracle_for_target(2, '11')
print(oracle_11)

# Verify: apply oracle to |11⟩ and check phase flip
# We can test by putting qubits in superposition and checking interference
qc = QuantumCircuit(2, 2)
qc.h([0, 1])                          # Equal superposition
qc.compose(oracle_for_target(2, '11'), inplace=True)  # Oracle marks |11⟩
qc.h([0, 1])                          # Convert phase to amplitude
qc.measure([0, 1], [0, 1])

simulator = AerSimulator()
counts = simulator.run(qc, shots=1024).result().get_counts()
print(f"\\nAfter H + oracle + H (should show bias toward 11): {counts}")

# Test with different targets
print("\\n--- Oracles for different targets ---")
for target in ['00', '01', '10', '11']:
    oracle = oracle_for_target(2, target)
    qc = QuantumCircuit(2, 2)
    qc.h([0, 1])
    qc.compose(oracle, inplace=True)
    qc.h([0, 1])
    qc.measure([0, 1], [0, 1])
    counts = simulator.run(qc, shots=1024).result().get_counts()
    print(f"  Target |{target}⟩: {counts}")

# 3-qubit oracle
print("\\nOracle for target |101⟩ (3 qubits):")
oracle_101 = oracle_for_target(3, '101')
print(oracle_101)
`,
        hints: [
          'The phase oracle flips the sign of the target state: |target⟩ → -|target⟩, all others unchanged. This is done using a multi-controlled Z gate.',
          'To apply multi-controlled Z to an arbitrary target (not just |11...1⟩): first apply X gates to flip the 0-bits of the target to 1s, apply multi-controlled Z, then undo the X gates.',
          'For 2 qubits, multi-controlled Z is just CZ. For 3+ qubits, use the trick: H on last qubit, multi-controlled X (Toffoli for 3 qubits), H on last qubit.',
        ],
        diracPromptAddendum: 'The student is building the Grover oracle. Explain that the oracle is a "black box" that marks the solution by flipping its phase. The implementation trick is: convert the target to all-1s using X gates, apply multi-controlled Z (which flips the phase of |11...1⟩), then undo the X gates. Emphasize that in a real application, the oracle would encode the problem structure (like checking if a number satisfies some condition).',
      },
      {
        id: 'grover-m2',
        title: 'Diffusion Operator',
        description: 'Build the Grover diffusion operator (also called the inversion about the mean). This amplifies the amplitude of the marked state.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np

def diffusion_operator(n_qubits: int) -> QuantumCircuit:
    """
    Build the Grover diffusion operator (inversion about the mean).

    The diffusion operator is: D = 2|s⟩⟨s| - I
    where |s⟩ is the uniform superposition state.

    Implementation: H on all, X on all, multi-controlled Z, X on all, H on all.
    """
    diff = QuantumCircuit(n_qubits)

    # TODO Step 1: Apply H to all qubits
    # This rotates from the Hadamard basis back to computational basis
    # Hint: diff.h(range(n_qubits))

    # TODO Step 2: Apply X to all qubits
    # Hint: diff.x(range(n_qubits))

    # TODO Step 3: Multi-controlled Z (phase flip |11...1⟩)
    if n_qubits == 2:
        diff.cz(0, 1)
    else:
        diff.h(n_qubits - 1)
        diff.mcx(list(range(n_qubits - 1)), n_qubits - 1)
        diff.h(n_qubits - 1)

    # TODO Step 4: Undo X on all qubits
    # Hint: diff.x(range(n_qubits))

    # TODO Step 5: Undo H on all qubits
    # Hint: diff.h(range(n_qubits))

    return diff

# Test: print the diffusion operator
print("Diffusion operator (2 qubits):")
diff_2 = diffusion_operator(2)
print(diff_2)

print("\\nDiffusion operator (3 qubits):")
diff_3 = diffusion_operator(3)
print(diff_3)

# Verify: diffusion + oracle should amplify the target
def oracle_for_target(n_qubits, target):
    oracle = QuantumCircuit(n_qubits)
    for i, bit in enumerate(reversed(target)):
        if bit == '0':
            oracle.x(i)
    if n_qubits == 2:
        oracle.cz(0, 1)
    else:
        oracle.h(n_qubits - 1)
        oracle.mcx(list(range(n_qubits - 1)), n_qubits - 1)
        oracle.h(n_qubits - 1)
    for i, bit in enumerate(reversed(target)):
        if bit == '0':
            oracle.x(i)
    return oracle

# One Grover iteration on 2 qubits
target = '10'
qc = QuantumCircuit(2, 2)
qc.h([0, 1])  # Uniform superposition
qc.compose(oracle_for_target(2, target), inplace=True)  # Oracle
qc.compose(diffusion_operator(2), inplace=True)  # Diffusion
qc.measure([0, 1], [0, 1])

simulator = AerSimulator()
counts = simulator.run(qc, shots=1024).result().get_counts()
print(f"\\nAfter 1 Grover iteration (target={target}):")
print(f"  {counts}")
print(f"  Target |{target}⟩ should have highest probability")
`,
        hints: [
          'The diffusion operator reflects all amplitudes about their mean. States below the mean get boosted, states above get reduced. Since the oracle made the target amplitude negative (below mean), diffusion amplifies it.',
          'The implementation is: H → X → multi-controlled Z → X → H. Think of it as: transform to computational basis, flip phase of |00...0⟩, transform back.',
          'For 2 qubits searching for 1 item, only 1 Grover iteration is needed (it gives the answer with certainty!).',
        ],
        diracPromptAddendum: 'The student is building the diffusion operator. This is the "amplitude amplification" step. Explain the geometric picture: all N amplitudes are equal initially (1/√N). The oracle flips the target to negative. The diffusion operator reflects all amplitudes about the mean, which boosts the target and reduces others. After √N iterations, the target amplitude approaches 1. Use the analogy of a mirror reflecting about the average height.',
      },
      {
        id: 'grover-m3',
        title: 'Full Grover Circuit',
        description: 'Combine the oracle and diffusion operator into the full Grover algorithm. Calculate the optimal number of iterations and run the search.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np
import math

def oracle_for_target(n_qubits, target):
    oracle = QuantumCircuit(n_qubits)
    for i, bit in enumerate(reversed(target)):
        if bit == '0':
            oracle.x(i)
    if n_qubits == 2:
        oracle.cz(0, 1)
    else:
        oracle.h(n_qubits - 1)
        oracle.mcx(list(range(n_qubits - 1)), n_qubits - 1)
        oracle.h(n_qubits - 1)
    for i, bit in enumerate(reversed(target)):
        if bit == '0':
            oracle.x(i)
    return oracle

def diffusion_operator(n_qubits):
    diff = QuantumCircuit(n_qubits)
    diff.h(range(n_qubits))
    diff.x(range(n_qubits))
    if n_qubits == 2:
        diff.cz(0, 1)
    else:
        diff.h(n_qubits - 1)
        diff.mcx(list(range(n_qubits - 1)), n_qubits - 1)
        diff.h(n_qubits - 1)
    diff.x(range(n_qubits))
    diff.h(range(n_qubits))
    return diff

def optimal_iterations(n_qubits: int, n_solutions: int = 1) -> int:
    """Calculate the optimal number of Grover iterations."""
    N = 2 ** n_qubits
    # TODO Step 1: Calculate optimal iterations
    # Formula: floor(pi/4 * sqrt(N/M)) where M is number of solutions
    # Hint: return max(1, math.floor(math.pi / 4 * math.sqrt(N / n_solutions)))
    return max(1, math.floor(math.pi / 4 * math.sqrt(N / n_solutions)))

def grover_search(n_qubits: int, target: str, shots: int = 1024) -> dict:
    """
    Run the full Grover search algorithm.

    Returns measurement counts.
    """
    n_iter = optimal_iterations(n_qubits)

    qc = QuantumCircuit(n_qubits, n_qubits)

    # TODO Step 2: Initialize uniform superposition
    # Hint: qc.h(range(n_qubits))
    qc.h(range(n_qubits))

    # TODO Step 3: Apply Grover iterations
    oracle = oracle_for_target(n_qubits, target)
    diffusion = diffusion_operator(n_qubits)

    for _ in range(n_iter):
        qc.compose(oracle, inplace=True)
        qc.compose(diffusion, inplace=True)

    # TODO Step 4: Measure all qubits
    qc.measure(range(n_qubits), range(n_qubits))

    simulator = AerSimulator()
    counts = simulator.run(qc, shots=shots).result().get_counts()
    return counts, n_iter

# Test on 2-qubit system (4 items)
print("=== 2-qubit Grover (4 items) ===")
target_2 = '11'
counts_2, iters_2 = grover_search(2, target_2)
print(f"Target: |{target_2}⟩, Iterations: {iters_2}")
print(f"Results: {dict(sorted(counts_2.items()))}")
success_prob = counts_2.get(target_2, 0) / sum(counts_2.values())
print(f"Success probability: {success_prob:.2%}")

# Test on 3-qubit system (8 items)
print("\\n=== 3-qubit Grover (8 items) ===")
target_3 = '101'
counts_3, iters_3 = grover_search(3, target_3)
print(f"Target: |{target_3}⟩, Iterations: {iters_3}")
print(f"Results: {dict(sorted(counts_3.items()))}")
success_prob = counts_3.get(target_3, 0) / sum(counts_3.values())
print(f"Success probability: {success_prob:.2%}")

# Test on 4-qubit system (16 items)
print("\\n=== 4-qubit Grover (16 items) ===")
target_4 = '1010'
counts_4, iters_4 = grover_search(4, target_4)
print(f"Target: |{target_4}⟩, Iterations: {iters_4}")
print(f"Results: {dict(sorted(counts_4.items()))}")
success_prob = counts_4.get(target_4, 0) / sum(counts_4.values())
print(f"Success probability: {success_prob:.2%}")
`,
        hints: [
          'The optimal number of Grover iterations is floor(pi/4 * sqrt(N)) where N = 2^n is the search space size. Too few iterations gives low probability; too many actually reduces it!',
          'For 2 qubits (N=4): 1 iteration gives 100% success. For 3 qubits (N=8): 2 iterations give ~94.5%. For 4 qubits (N=16): 3 iterations give ~96.1%.',
          'The algorithm structure is simple: H on all qubits, then repeat (oracle + diffusion) the optimal number of times, then measure.',
        ],
        diracPromptAddendum: 'The student is assembling the full Grover algorithm. Help them understand the iteration count formula: pi/4 * sqrt(N) comes from the geometry of amplitude amplification. Each iteration rotates the state vector closer to the target by a fixed angle. After about sqrt(N) iterations, the state is nearly aligned with the target. Going past the optimal point actually rotates too far, reducing success probability. This is unique to quantum search and is why timing matters.',
      },
      {
        id: 'grover-m4',
        title: 'Quadratic Speedup Analysis',
        description: 'Run Grover\'s algorithm on multiple problem sizes and verify the quadratic speedup compared to classical search. Plot the scaling.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np
import math
import time

def oracle_for_target(n_qubits, target):
    oracle = QuantumCircuit(n_qubits)
    for i, bit in enumerate(reversed(target)):
        if bit == '0':
            oracle.x(i)
    if n_qubits == 2:
        oracle.cz(0, 1)
    else:
        oracle.h(n_qubits - 1)
        oracle.mcx(list(range(n_qubits - 1)), n_qubits - 1)
        oracle.h(n_qubits - 1)
    for i, bit in enumerate(reversed(target)):
        if bit == '0':
            oracle.x(i)
    return oracle

def diffusion_operator(n_qubits):
    diff = QuantumCircuit(n_qubits)
    diff.h(range(n_qubits))
    diff.x(range(n_qubits))
    if n_qubits == 2:
        diff.cz(0, 1)
    else:
        diff.h(n_qubits - 1)
        diff.mcx(list(range(n_qubits - 1)), n_qubits - 1)
        diff.h(n_qubits - 1)
    diff.x(range(n_qubits))
    diff.h(range(n_qubits))
    return diff

def grover_search(n_qubits, target, shots=1024):
    N = 2 ** n_qubits
    n_iter = max(1, math.floor(math.pi / 4 * math.sqrt(N)))
    qc = QuantumCircuit(n_qubits, n_qubits)
    qc.h(range(n_qubits))
    oracle = oracle_for_target(n_qubits, target)
    diffusion = diffusion_operator(n_qubits)
    for _ in range(n_iter):
        qc.compose(oracle, inplace=True)
        qc.compose(diffusion, inplace=True)
    qc.measure(range(n_qubits), range(n_qubits))
    simulator = AerSimulator()
    counts = simulator.run(qc, shots=shots).result().get_counts()
    return counts, n_iter

# TODO Step 1: Run Grover on different problem sizes and collect statistics
results = []
print(f"{'Qubits':>6} | {'N (items)':>9} | {'Iterations':>10} | {'Classical':>10} | {'Speedup':>8} | {'P(success)':>10}")
print("-" * 70)

for n_qubits in range(2, 7):  # 2 to 6 qubits
    N = 2 ** n_qubits
    target = '1' * n_qubits  # Search for all-ones state

    # Quantum: Grover
    counts, n_iter = grover_search(n_qubits, target, shots=2048)
    success_prob = counts.get(target, 0) / 2048

    # Classical: expected queries = N/2 (on average)
    classical_queries = N / 2

    # Speedup
    speedup = classical_queries / n_iter

    results.append({
        'n_qubits': n_qubits,
        'N': N,
        'quantum_iter': n_iter,
        'classical_queries': classical_queries,
        'speedup': speedup,
        'success_prob': success_prob,
    })

    print(f"{n_qubits:>6} | {N:>9} | {n_iter:>10} | {classical_queries:>10.0f} | {speedup:>8.1f}x | {success_prob:>10.2%}")

# TODO Step 2: Verify the quadratic relationship
print("\\n=== Scaling Analysis ===")
print("If Grover gives quadratic speedup:")
print("  Classical queries ∝ N")
print("  Quantum iterations ∝ √N")
print("")

for r in results:
    sqrt_N = math.sqrt(r['N'])
    ratio = r['quantum_iter'] / sqrt_N
    print(f"  N={r['N']:>3}: quantum_iter / sqrt(N) = {r['quantum_iter']} / {sqrt_N:.1f} = {ratio:.3f}")

print(f"\\n  Ratio should be approximately pi/4 ≈ {math.pi/4:.3f} for all N")

# TODO Step 3: ASCII visualization of the scaling
print("\\n=== Scaling Visualization ===")
max_classical = max(r['classical_queries'] for r in results)
max_bar = 50

print("\\nClassical (linear):")
for r in results:
    bar_len = int(max_bar * r['classical_queries'] / max_classical)
    print(f"  N={r['N']:>3}: {'█' * bar_len} ({r['classical_queries']:.0f} queries)")

print("\\nQuantum (sqrt):")
for r in results:
    bar_len = int(max_bar * r['quantum_iter'] / max_classical)
    bar_len = max(1, bar_len)
    print(f"  N={r['N']:>3}: {'█' * bar_len} ({r['quantum_iter']} iterations)")

# TODO Step 4: Test with different targets to verify generality
print("\\n=== Verification: Different Targets (3 qubits) ===")
all_targets = [format(i, '03b') for i in range(8)]
for target in all_targets:
    counts, n_iter = grover_search(3, target, shots=1024)
    success = counts.get(target, 0) / 1024
    print(f"  Target |{target}⟩: P(success) = {success:.2%}")
`,
        hints: [
          'The key result: Grover needs ~sqrt(N) iterations while classical search needs ~N/2 queries on average. The ratio of quantum to sqrt(N) should be approximately pi/4 for all problem sizes.',
          'For 2 qubits (4 items): 1 quantum iteration vs 2 classical queries. For 6 qubits (64 items): ~6 quantum iterations vs 32 classical queries.',
          'The success probability should be high (>90%) for all problem sizes when using the optimal number of iterations. If it drops, double-check the oracle and diffusion operator implementations.',
        ],
        diracPromptAddendum: 'The student is verifying the quadratic speedup of Grover\'s algorithm! This is the big payoff. Help them interpret the results: the ratio quantum_iterations / sqrt(N) should be approximately pi/4 ≈ 0.785 for all N. This confirms the quadratic speedup. Discuss the significance: for a database of 1 million items, classical search needs ~500,000 queries, but Grover needs only ~785 queries. However, remind them that quadratic speedup is modest compared to the exponential speedup of Shor\'s algorithm.',
      },
    ],
    diracGuidancePrompt: 'You are guiding a student through implementing Grover\'s algorithm from scratch. This is one of the two most important quantum algorithms (along with Shor\'s). Focus on the beautiful geometry: amplitude amplification is a rotation in 2D space. The oracle reflects about the perpendicular to the target, and diffusion reflects about the initial state. Each pair of reflections is a rotation by a fixed angle, and after sqrt(N) rotations, you reach the target. Use visual analogies whenever possible.',
  },
];
