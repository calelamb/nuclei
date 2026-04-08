import type { Lesson } from './types';

export const TRACK9_LESSONS: Lesson[] = [
  // ── Lesson 9.1 ──
  {
    id: '9.1',
    title: 'Portfolio Optimization with QAOA',
    description:
      'Modern portfolio theory meets quantum. Encode portfolio selection as QUBO and solve with QAOA.',
    difficulty: 'intermediate',
    estimatedMinutes: 30,
    prerequisites: ['3.10', '3.11'],
    tags: ['qaoa', 'qubo', 'portfolio', 'markowitz', 'combinatorial-optimization'],
    diracContext:
      'Connect Markowitz mean-variance optimization to QUBO formulation. Assets are binary variables (invest or not). The cost function balances return vs risk. QAOA encodes this cost Hamiltonian and searches for the optimal allocation. Keep it grounded — this is combinatorial portfolio selection, not continuous weight optimization.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## From Wall Street to Qubits

**Markowitz portfolio theory** (1952): select assets to maximize return for a given risk. With N assets, the optimization landscape has 2^N possible portfolios. Classical solvers hit a wall around N ~ 40-50.

**QUBO** (Quadratic Unconstrained Binary Optimization) encodes this naturally:

**min  x^T Q x**

where xᵢ ∈ {0, 1} (invest or not) and Q captures return, covariance, and constraints.

QAOA maps Q directly to a **cost Hamiltonian** — diagonal in the Z-basis. The mixer drives exploration. Each QAOA layer brings us closer to the optimal portfolio.

| Step | Classical | Quantum |
|------|-----------|---------|
| Formulate | Quadratic program | QUBO matrix Q |
| Encode | — | Cost Hamiltonian C = x^T Q x |
| Solve | Branch-and-bound | QAOA with p layers |
| Decode | Binary vector | Measurement outcomes |`,
      },
      {
        type: 'concept-card',
        title: 'QUBO for Finance',
        visual: 'custom-svg',
        explanation:
          'Each binary variable xᵢ represents whether asset i is in the portfolio. The QUBO matrix Q encodes: diagonal = expected returns (negative, since we minimize), off-diagonal = pairwise covariances (risk). A penalty term enforces budget constraints.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

# 3-asset portfolio: Tech, Energy, Bonds
returns = np.array([0.12, 0.08, 0.04])   # expected annual return
cov = np.array([                           # covariance matrix
    [0.04, 0.01, -0.005],
    [0.01, 0.03,  0.002],
    [-0.005, 0.002, 0.01],
])
risk_aversion = 0.5
budget_penalty = 2.0
budget = 2  # pick exactly 2 assets

# Build QUBO: minimize  risk_aversion * x^T cov x  -  x^T returns
#              + penalty * (sum(x) - budget)^2
n = len(returns)
Q = risk_aversion * cov - np.diag(returns)
# Budget penalty: penalty * (sum_i x_i - B)^2 expanded
for i in range(n):
    Q[i, i] += budget_penalty * (1 - 2 * budget)
    for j in range(n):
        Q[i, j] += budget_penalty

print("QUBO matrix Q:")
print(np.round(Q, 4))

# Brute-force check all 2^3 = 8 portfolios
print("\\nAll portfolios:")
best_cost, best_x = float('inf'), None
for k in range(2**n):
    x = np.array([(k >> i) & 1 for i in range(n)], dtype=float)
    cost = x @ Q @ x
    label = ''.join(str(int(xi)) for xi in x)
    marker = ""
    if cost < best_cost:
        best_cost, best_x = cost, label
    print(f"  |{label}> cost={cost:+.4f}  assets={[['Tech','Energy','Bonds'][i] for i in range(n) if x[i]]}")
print(f"\\nOptimal: |{best_x}> cost={best_cost:.4f}")`,
        framework: 'qiskit',
        description:
          'Build a QUBO for 3-asset portfolio selection. Brute-force finds the optimal — QAOA will do the same quantumly.',
        explorationPrompt:
          'Change risk_aversion to 0.1 (aggressive) vs 2.0 (conservative). How does the optimal portfolio shift?',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

# QAOA for 3-asset portfolio
# Cost Hamiltonian from QUBO diagonal terms
n_qubits = 3
returns = np.array([0.12, 0.08, 0.04])
cov = np.array([
    [0.04, 0.01, -0.005],
    [0.01, 0.03,  0.002],
    [-0.005, 0.002, 0.01],
])
risk_aversion = 0.5
budget_penalty = 2.0
budget = 2

Q = risk_aversion * cov - np.diag(returns)
for i in range(n_qubits):
    Q[i, i] += budget_penalty * (1 - 2 * budget)
    for j in range(n_qubits):
        Q[i, j] += budget_penalty

def qaoa_circuit(gamma, beta):
    qc = QuantumCircuit(n_qubits)
    # Initial superposition
    for i in range(n_qubits):
        qc.h(i)
    # Cost layer: ZZ interactions + Z rotations
    for i in range(n_qubits):
        for j in range(i + 1, n_qubits):
            qc.cx(i, j)
            qc.rz(2 * gamma * Q[i, j], j)
            qc.cx(i, j)
    for i in range(n_qubits):
        qc.rz(2 * gamma * Q[i, i], i)
    # Mixer layer
    for i in range(n_qubits):
        qc.rx(2 * beta, i)
    return qc

# Sweep gamma and beta
best_energy = float('inf')
best_params = (0, 0)
best_portfolio = ""
for gamma in np.linspace(0, np.pi, 20):
    for beta in np.linspace(0, np.pi, 20):
        sv = Statevector.from_instruction(qaoa_circuit(gamma, beta))
        probs = sv.probabilities_dict()
        # Evaluate expected cost
        cost = 0
        for bitstr, p in probs.items():
            x = np.array([int(b) for b in reversed(bitstr)], dtype=float)
            cost += p * (x @ Q @ x)
        if cost < best_energy:
            best_energy = cost
            best_params = (gamma, beta)
            best_portfolio = max(probs, key=probs.get)

print(f"Best QAOA params: gamma={best_params[0]:.3f}, beta={best_params[1]:.3f}")
print(f"Expected cost: {best_energy:.4f}")
print(f"Most likely portfolio: |{best_portfolio}>")
assets = ['Tech', 'Energy', 'Bonds']
selected = [assets[i] for i, b in enumerate(reversed(best_portfolio)) if b == '1']
print(f"Selected assets: {selected}")`,
        framework: 'qiskit',
        description:
          'Full QAOA loop for portfolio optimization. One layer of cost + mixer, then sweep parameters.',
        explorationPrompt:
          'This uses 1 QAOA layer. Add a second layer by repeating the cost + mixer blocks. Does the solution improve?',
      },
      {
        type: 'exercise',
        id: '9.1-ex1',
        title: 'Risk Tolerance Tuning',
        description:
          'Modify the QUBO to use risk_aversion=2.0 (very conservative). Find the optimal portfolio using brute force, then verify QAOA agrees. The conservative portfolio should prefer lower-volatility assets.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

returns = np.array([0.12, 0.08, 0.04])
cov = np.array([
    [0.04, 0.01, -0.005],
    [0.01, 0.03,  0.002],
    [-0.005, 0.002, 0.01],
])
# TODO: Set risk_aversion to 2.0 and budget to 2
risk_aversion = 0.5
budget_penalty = 2.0
budget = 2
n = len(returns)

# TODO: Build QUBO matrix Q
Q = np.zeros((n, n))

# TODO: Find optimal portfolio by brute force
print("Optimal conservative portfolio: ???")`,
        framework: 'qiskit',
        expectedProbabilities: {},
        tolerancePercent: 5,
        hints: [
          'Set risk_aversion = 2.0 to heavily penalize volatile assets.',
          'Build Q = risk_aversion * cov - diag(returns) + budget penalty terms.',
          'The conservative portfolio should pick Energy + Bonds (lower volatility).',
        ],
        successMessage:
          'With high risk aversion, the optimizer avoids Tech despite its higher return. Risk dominates the cost function.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '9.1-q1',
            question: 'What does each binary variable xᵢ represent in the portfolio QUBO?',
            options: [
              'The weight of asset i (continuous)',
              'Whether asset i is included in the portfolio (0 or 1)',
              'The return of asset i',
              'The risk of asset i',
            ],
            correctIndex: 1,
            explanation:
              'QUBO uses binary variables. xᵢ = 1 means asset i is selected, xᵢ = 0 means it is excluded. This makes it a combinatorial selection problem.',
          },
          {
            id: '9.1-q2',
            question: 'Why is portfolio optimization a natural fit for QAOA?',
            options: [
              'Portfolios always have exactly 2 assets',
              'The optimization landscape is convex',
              'Selecting from N assets creates 2^N combinations — exponential in the number of assets',
              'QAOA guarantees the global optimum',
            ],
            correctIndex: 2,
            explanation:
              'With N assets, there are 2^N possible portfolios. This combinatorial explosion is where quantum approaches may offer speedup through superposition-based search.',
          },
        ],
      },
    ],
  },

  // ── Lesson 9.2 ──
  {
    id: '9.2',
    title: 'Option Pricing with Quantum Monte Carlo',
    description:
      'Quantum amplitude estimation for Monte Carlo sampling — quadratic speedup over classical.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['3.5', '9.1'],
    tags: [
      'monte-carlo',
      'amplitude-estimation',
      'option-pricing',
      'black-scholes',
      'finance',
    ],
    diracContext:
      'Classical Monte Carlo converges as O(1/sqrt(N)). Quantum amplitude estimation converges as O(1/N) — quadratic speedup. For option pricing, encode the probability distribution of stock prices into a quantum state, then use amplitude estimation to compute expected payoff. Keep the demo simple: focus on expected value estimation, not full Black-Scholes.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Monte Carlo in Finance

Banks price derivatives using **Monte Carlo simulation**: sample thousands of random price paths, compute the payoff for each, average them. Convergence: O(1/√N) — doubling accuracy costs 4x more samples.

**Quantum Amplitude Estimation (QAE)** achieves O(1/N) convergence — a **quadratic speedup**. For 1 million classical samples, you need only ~1000 quantum queries.

The recipe:
1. **Load** the probability distribution into qubit amplitudes
2. **Apply** a payoff function as a rotation
3. **Estimate** the resulting amplitude (= expected payoff)

| | Classical MC | Quantum AE |
|--|-------------|------------|
| Convergence | O(1/√N) | O(1/N) |
| 1% precision | ~10,000 samples | ~100 queries |
| 0.1% precision | ~1,000,000 samples | ~1,000 queries |`,
      },
      {
        type: 'concept-card',
        title: 'Amplitude = Probability = Expected Value',
        visual: 'histogram',
        explanation:
          'A quantum state |ψ⟩ = √p|good⟩ + √(1-p)|bad⟩ encodes probability p in its amplitude. Amplitude estimation extracts p to high precision. If p represents the expected payoff normalized to [0,1], we recover the option price.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

# Simplified quantum Monte Carlo: estimate E[X] for a discrete distribution
# Encode a 3-outcome distribution: prices = [80, 100, 120] with probs [0.25, 0.50, 0.25]
# Strike = 100 -> payoff = max(price - strike, 0) = [0, 0, 20]

probs = np.array([0.25, 0.50, 0.25, 0.0])  # pad to 4 for 2 qubits
amps = np.sqrt(probs)

# Step 1: Load probability distribution
qc = QuantumCircuit(3)  # 2 price qubits + 1 payoff qubit
qc.initialize(amps, [0, 1])

# Step 2: Mark states with positive payoff
# Only |10> (price=120) has payoff > 0
# Controlled rotation on payoff qubit, conditioned on state |10>
qc.x(0)         # flip qubit 0 so |10> becomes |11>
qc.ccx(0, 1, 2) # Toffoli: mark payoff qubit when price = 120
qc.x(0)         # restore

sv = Statevector.from_instruction(qc)
probs_dict = sv.probabilities_dict()

# Payoff amplitude = probability that payoff qubit = |1>
p_payoff = sum(p for bitstr, p in probs_dict.items() if bitstr[0] == '1')
max_payoff = 20
expected_payoff = p_payoff * max_payoff

print("Probability distribution loaded into quantum state")
print(f"P(payoff qubit = 1) = {p_payoff:.4f}")
print(f"Expected payoff = {expected_payoff:.2f}")
print(f"Classical answer = 0.25 * 20 = {0.25 * 20:.2f}")
print("\\nAmplitude estimation would extract p_payoff to arbitrary precision")`,
        framework: 'qiskit',
        description:
          'Load a price distribution and mark profitable outcomes. Amplitude estimation would extract the expected payoff with quadratic speedup.',
        explorationPrompt:
          'This uses a coarse 3-price model. Real option pricing uses continuous distributions encoded in more qubits. How does qubit count affect precision?',
      },
      {
        type: 'text',
        markdown: `## The Quantum Advantage Window

Quantum Monte Carlo shines when:
- High-dimensional problems (basket options, CDOs)
- Tight precision requirements (regulatory capital)
- Repeated evaluation (real-time risk)

The catch: **loading distributions** into quantum states is expensive. Research focuses on efficient loading circuits — log-concave distributions, piecewise linear approximations, and qGAN-prepared states.

Goldman Sachs, JPMorgan, and BBVA have all published quantum Monte Carlo proof-of-concepts. The quadratic speedup is real in theory; the open question is when hardware catches up.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '9.2-q1',
            question: 'What is the convergence rate of quantum amplitude estimation?',
            options: [
              'O(1/√N) — same as classical',
              'O(1/N) — quadratic speedup',
              'O(1/N²) — quartic speedup',
              'O(log N) — exponential speedup',
            ],
            correctIndex: 1,
            explanation:
              'QAE converges as O(1/N) compared to classical Monte Carlo at O(1/√N). This quadratic speedup means 100x fewer queries for the same precision at large scale.',
          },
          {
            id: '9.2-q2',
            question:
              'What is the main practical challenge for quantum Monte Carlo in finance?',
            options: [
              'The math is too complex',
              'Efficiently loading probability distributions into quantum states',
              'Banks do not use Monte Carlo',
              'Quantum computers cannot represent money',
            ],
            correctIndex: 1,
            explanation:
              'State preparation — loading a probability distribution into qubit amplitudes — requires deep circuits. Efficient loading is an active research area.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Classical vs Quantum MC Pipeline',
        visual: 'custom-svg',
        explanation:
          'Classical: sample random paths -> compute payoffs -> average. Quantum: encode distribution -> mark payoff -> amplitude estimation. The quantum version replaces sampling with coherent amplitude extraction.',
      },
    ],
  },

  // ── Lesson 9.3 ──
  {
    id: '9.3',
    title: 'Credit Risk Analysis',
    description:
      'Default probability estimation and portfolio credit risk with quantum circuits.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['9.2'],
    tags: [
      'credit-risk',
      'default-probability',
      'correlated-defaults',
      'bernoulli',
      'finance',
    ],
    diracContext:
      'Credit risk models compute the probability of borrower defaults and aggregate portfolio losses. Classical approaches struggle with correlated defaults (Gaussian copula). Quantum circuits can encode joint default distributions directly in superposition. Focus on the encoding and a simple 2-borrower model.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Credit Risk Problem

A bank holds loans to N borrowers. Each may **default** with probability pᵢ. The challenge: defaults are **correlated** — economic downturns hit multiple borrowers simultaneously.

**Classical approach:** Simulate thousands of correlated default scenarios using Gaussian copulas. This is slow for large portfolios with complex correlation structures.

**Quantum approach:** Encode the joint default distribution directly in qubits. Each qubit represents one borrower (|1⟩ = default, |0⟩ = no default). Correlations become entanglement. Then use amplitude estimation for loss statistics.

| Portfolio | Borrowers | Classical MC | Quantum AE |
|-----------|-----------|-------------|------------|
| Small | 10 | Fast | No advantage |
| Medium | 100 | Minutes | Potential speedup |
| Large | 1000+ | Hours | Quadratic speedup |`,
      },
      {
        type: 'concept-card',
        title: 'Defaults as Qubits',
        visual: 'circuit',
        explanation:
          'Qubit i represents borrower i. RY rotation sets individual default probability. CNOT/CZ gates create correlations between borrowers. The resulting quantum state encodes the full joint default distribution — all 2^N scenarios in superposition.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

# 2-borrower credit model
# Borrower A: 10% default probability
# Borrower B: 15% default probability
# Correlation: if A defaults, B's probability increases to 30%

p_a = 0.10
p_b = 0.15
p_b_given_a = 0.30  # conditional probability

# Encode individual defaults via RY rotations
# P(|1>) = sin^2(theta/2) -> theta = 2 * arcsin(sqrt(p))
theta_a = 2 * np.arcsin(np.sqrt(p_a))
theta_b = 2 * np.arcsin(np.sqrt(p_b))
theta_b_corr = 2 * np.arcsin(np.sqrt(p_b_given_a))

qc = QuantumCircuit(2)

# Borrower A default probability
qc.ry(theta_a, 0)

# Borrower B: base probability if A is fine, correlated if A defaults
qc.ry(theta_b, 1)
# Add correlation: extra rotation on B conditioned on A defaulting
qc.cry(theta_b_corr - theta_b, 0, 1)

sv = Statevector.from_instruction(qc)
probs = sv.probabilities_dict()

print("Joint default distribution:")
labels = {'00': 'Neither defaults', '01': 'Only B defaults',
          '10': 'Only A defaults', '11': 'Both default'}
for state in ['00', '01', '10', '11']:
    p = probs.get(state, 0)
    print(f"  |{state}> P={p:.4f}  ({labels[state]})")

p_any = 1 - probs.get('00', 0)
print(f"\\nP(at least one default) = {p_any:.4f}")
print(f"P(both default) = {probs.get('11', 0):.4f}")

# Expected loss (A=$1M, B=$500K)
loss_a, loss_b = 1_000_000, 500_000
exp_loss = (probs.get('10', 0) * loss_a +
            probs.get('01', 0) * loss_b +
            probs.get('11', 0) * (loss_a + loss_b))
print(f"\\nExpected portfolio loss: \${exp_loss:,.0f}")`,
        framework: 'qiskit',
        description:
          'Encode a 2-borrower credit model with correlated defaults. RY sets default probabilities; CRY encodes the correlation.',
        explorationPrompt:
          'Try increasing p_b_given_a to 0.5 (strong correlation). How does the joint default probability change? What about expected loss?',
      },
      {
        type: 'text',
        markdown: `## Scaling to Real Portfolios

The 2-borrower model illustrates the encoding. Real portfolios need:

- **Gaussian copula loading:** Efficiently prepare correlated Bernoulli variables from a multivariate Gaussian. This maps to a circuit of RY + controlled rotations.
- **Loss aggregation:** Sum individual losses into an ancilla register (quantum adder circuits).
- **Tail risk estimation:** Use amplitude estimation to compute P(loss > threshold) — the **Value at Risk (VaR)**.

JPMorgan's research team demonstrated a 3-borrower model on real hardware in 2021. IBM's qiskit-finance library provides building blocks for these circuits.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '9.3-q1',
            question: 'How are correlated defaults encoded in a quantum circuit?',
            options: [
              'Each qubit stores the correlation coefficient',
              'Controlled rotations (e.g., CRY) increase one borrower\'s default probability conditioned on another',
              'Correlation is ignored in quantum models',
              'A classical random number generator feeds the circuit',
            ],
            correctIndex: 1,
            explanation:
              'Controlled rotations like CRY create conditional probabilities: if qubit A is in |1⟩ (default), qubit B receives additional rotation increasing its default probability. This is quantum-native correlation.',
          },
          {
            id: '9.3-q2',
            question: 'What financial metric can amplitude estimation compute for credit risk?',
            options: [
              'Stock price prediction',
              'Value at Risk (VaR) — P(loss exceeds threshold)',
              'Individual borrower credit scores',
              'Interest rates',
            ],
            correctIndex: 1,
            explanation:
              'Value at Risk measures the probability that portfolio losses exceed a threshold. Amplitude estimation can extract this probability with quadratic speedup over classical sampling.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Quantum Credit Risk Pipeline',
        visual: 'custom-svg',
        explanation:
          'Load default probabilities (RY) -> encode correlations (CRY, CNOT) -> aggregate losses (quantum adder) -> amplitude estimation for VaR. Each step maps to known quantum circuit building blocks.',
      },
    ],
  },

  // ── Lesson 9.4 ──
  {
    id: '9.4',
    title: 'Traveling Salesman & Vehicle Routing',
    description:
      'TSP as QUBO — encoding route constraints for QAOA on logistics problems.',
    difficulty: 'intermediate',
    estimatedMinutes: 30,
    prerequisites: ['9.1'],
    tags: [
      'tsp',
      'vehicle-routing',
      'qubo',
      'qaoa',
      'logistics',
      'combinatorial',
    ],
    diracContext:
      'TSP is NP-hard. Encoding it as QUBO requires N^2 binary variables (one per city-step pair). Constraint penalties enforce valid routes. For 4 cities this is tractable on simulators. Be clear: quantum does not solve NP-hard in polynomial time. The advantage is heuristic — better approximate solutions faster for real-world instances.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Traveling Salesman Problem

Visit N cities exactly once and return home — minimize total distance. With N cities: (N-1)!/2 possible routes. For 20 cities that is 60 billion routes.

**QUBO encoding:** Binary variable x_{i,t} = 1 if city i is visited at step t.

**Constraints** (enforced as penalty terms in Q):
1. **Each city visited exactly once:** Σ_t x_{i,t} = 1 for all i
2. **Each time step has exactly one city:** Σ_i x_{i,t} = 1 for all t
3. **Objective:** minimize Σ d(i,j) · x_{i,t} · x_{j,t+1}

This gives N² binary variables → N² qubits. A 4-city TSP needs 16 qubits.

| Cities | Variables | Classical | Quantum (QAOA) |
|--------|-----------|-----------|----------------|
| 4 | 16 | Trivial | Demo-scale |
| 10 | 100 | Seconds | Near-term target |
| 50 | 2500 | NP-hard | Heuristic speedup? |`,
      },
      {
        type: 'concept-card',
        title: 'TSP as a Matrix',
        visual: 'custom-svg',
        explanation:
          'The route is a permutation matrix: x_{i,t} = 1 means "visit city i at step t." Each row and column sums to 1. The QUBO penalty terms enforce this structure. The distance objective uses products of adjacent-step variables.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

# 4-city TSP: cities at coordinates
cities = {0: (0, 0), 1: (1, 0), 2: (1, 1), 3: (0, 1)}
n = len(cities)

# Distance matrix
dist = np.zeros((n, n))
for i in range(n):
    for j in range(n):
        dx = cities[i][0] - cities[j][0]
        dy = cities[i][1] - cities[j][1]
        dist[i][j] = np.sqrt(dx**2 + dy**2)

print("Distance matrix:")
print(np.round(dist, 3))

# Build QUBO for TSP (simplified: enumerate valid routes)
from itertools import permutations

print(f"\\nAll {n}-city routes (fixing start city=0):")
best_cost, best_route = float('inf'), None
for perm in permutations(range(1, n)):
    route = [0] + list(perm) + [0]
    cost = sum(dist[route[i]][route[i+1]] for i in range(len(route)-1))
    marker = ""
    if cost < best_cost:
        best_cost = cost
        best_route = route
        marker = " <-- best so far"
    print(f"  {route} distance={cost:.3f}{marker}")

print(f"\\nOptimal route: {best_route}")
print(f"Optimal distance: {best_cost:.3f}")
print(f"This is a unit square — optimal route is the perimeter = 4.0")`,
        framework: 'qiskit',
        description:
          'Set up a 4-city TSP with distance matrix. Classical brute force finds the optimal route — this is our target for QAOA.',
        explorationPrompt:
          'With 4 cities there are only 6 routes. At 10 cities there are 181,440. At 20 cities, 60 billion. This exponential growth is why we need quantum heuristics.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

# QAOA for a simplified TSP sub-problem:
# 2-city ordering (which city first?) as a 1-qubit problem
# |0> = city A first, |1> = city B first
# Generalize to multi-qubit for full TSP

# For a 3-city subset, encode pairwise ordering
# x01: is city 0 before city 1? (qubit 0)
# x02: is city 0 before city 2? (qubit 1)
# x12: is city 1 before city 2? (qubit 2)

n_qubits = 3
dist_pairs = {
    (0, 1): 1.0,   # distance city 0 <-> city 1
    (0, 2): 1.414,  # distance city 0 <-> city 2
    (1, 2): 1.0,   # distance city 1 <-> city 2
}

# QAOA cost: sum of distances weighted by ordering
def qaoa_tsp(gamma, beta):
    qc = QuantumCircuit(n_qubits)
    for i in range(n_qubits):
        qc.h(i)
    # Cost layer: Z rotations weighted by distances
    costs = [1.0, 1.414, 1.0]
    for i in range(n_qubits):
        qc.rz(2 * gamma * costs[i], i)
    # Consistency penalty: x01 + x12 must agree with x02
    qc.cx(0, 2)
    qc.cx(1, 2)
    qc.rz(2 * gamma * 2.0, 2)  # penalty weight
    qc.cx(1, 2)
    qc.cx(0, 2)
    # Mixer
    for i in range(n_qubits):
        qc.rx(2 * beta, i)
    return qc

# Parameter sweep
best_cost = float('inf')
best_state = ""
for gamma in np.linspace(0, np.pi, 15):
    for beta in np.linspace(0, np.pi, 15):
        sv = Statevector.from_instruction(qaoa_tsp(gamma, beta))
        probs = sv.probabilities_dict()
        top = max(probs, key=probs.get)
        if probs[top] > 0.3:
            cost = sum(float(top[i]) * c for i, c in enumerate([1.0, 1.414, 1.0]))
            if cost < best_cost:
                best_cost = cost
                best_state = top

print(f"Best QAOA state: |{best_state}>")
orderings = ['0 before 1', '0 before 2', '1 before 2']
for i, bit in enumerate(best_state):
    status = orderings[i] if bit == '1' else orderings[i].replace('before', 'after')
    print(f"  qubit {i}: {status}")`,
        framework: 'qiskit',
        description:
          'QAOA for a pairwise ordering formulation of a 3-city routing problem. Consistency penalties enforce valid routes.',
      },
      {
        type: 'exercise',
        id: '9.4-ex1',
        title: 'Solve a Small Routing Problem',
        description:
          'Given 3 cities with distances d(A,B)=2, d(A,C)=5, d(B,C)=3, find the shortest route visiting all cities (starting and ending at A) using brute force. Then encode the cost as Z-rotations in a simple QAOA circuit.',
        starterCode: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

# 3 cities: A=0, B=1, C=2
# d(A,B)=2, d(A,C)=5, d(B,C)=3
distances = {(0,1): 2, (0,2): 5, (1,2): 3}

# TODO: Find optimal route by brute force
# Routes from A: A->B->C->A and A->C->B->A
# Calculate both distances

# TODO: Build a 1-qubit QAOA circuit
# |0> = route A->B->C->A, |1> = route A->C->B->A
# Use RZ for cost encoding and RX for mixer

print("Route A->B->C->A distance = ???")
print("Route A->C->B->A distance = ???")`,
        framework: 'qiskit',
        expectedProbabilities: {},
        tolerancePercent: 5,
        hints: [
          'Route A->B->C->A = d(A,B) + d(B,C) + d(C,A) = 2 + 3 + 5 = 10.',
          'Route A->C->B->A = d(A,C) + d(C,B) + d(B,A) = 5 + 3 + 2 = 10.',
          'Both routes have the same cost (the triangle). For asymmetric distances, QAOA would distinguish them.',
        ],
        successMessage:
          'In this symmetric case both routes are equal. Real logistics problems have asymmetric travel times (one-way streets, traffic), where QAOA can find the better direction.',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '9.4-q1',
            question: 'How many qubits does the standard QUBO encoding of TSP with N cities require?',
            options: [
              'N qubits',
              'N log N qubits',
              'N² qubits',
              '2^N qubits',
            ],
            correctIndex: 2,
            explanation:
              'The standard encoding uses binary variable x_{i,t} for each city-step pair. With N cities and N time steps, that requires N² binary variables = N² qubits.',
          },
          {
            id: '9.4-q2',
            question: 'Does QAOA guarantee finding the optimal solution to TSP?',
            options: [
              'Yes — quantum computers solve NP-hard problems optimally',
              'No — QAOA is a heuristic that may find good approximate solutions',
              'Yes — with enough layers it always converges',
              'No — quantum computers cannot represent routes',
            ],
            correctIndex: 1,
            explanation:
              'TSP is NP-hard. QAOA is a variational heuristic — it finds approximate solutions. With infinite layers QAOA converges in theory, but in practice it is used as a heuristic optimizer.',
          },
        ],
      },
    ],
  },

  // ── Lesson 9.5 ──
  {
    id: '9.5',
    title: 'Supply Chain Optimization',
    description:
      'Inventory management and scheduling with quantum constraint satisfaction.',
    difficulty: 'intermediate',
    estimatedMinutes: 25,
    prerequisites: ['9.4'],
    tags: [
      'supply-chain',
      'scheduling',
      'constraint-satisfaction',
      'annealing',
      'logistics',
    ],
    diracContext:
      'Supply chain problems are constraint-heavy: inventory limits, delivery windows, facility capacities. These map to QUBO with penalty terms for each constraint. Quantum annealing (D-Wave style) and QAOA both attack these. Demo a small job scheduling problem. Be practical: explain where quantum might help and where classical is still dominant.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Supply Chain as Optimization

Global supply chains involve cascading decisions:
- **Which warehouse** ships each order? (assignment)
- **What route** do delivery trucks take? (routing)
- **How much inventory** to stock? (capacity planning)
- **When to schedule** production runs? (scheduling)

Each is a **constrained combinatorial optimization** problem. When they interact, the joint problem is exponentially harder.

**Quantum approach:** Encode decisions as binary variables, constraints as penalty terms, and objectives as QUBO cost functions. The same QAOA/annealing framework from portfolio optimization and TSP applies.

| Problem | Variables | Constraints | Quantum Fit |
|---------|-----------|-------------|-------------|
| Job scheduling | Jobs × machines | Capacity, deadlines | Strong |
| Warehouse assignment | Orders × warehouses | Inventory, distance | Strong |
| Production planning | Products × time slots | Materials, labor | Moderate |`,
      },
      {
        type: 'concept-card',
        title: 'Constraints as Penalties',
        visual: 'custom-svg',
        explanation:
          'Each constraint becomes a penalty in the QUBO: P * (constraint violation)². A valid solution has zero penalty. Invalid solutions are pushed to higher energy. The penalty weight P must be large enough that violations are never optimal.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

# Job scheduling: 3 jobs on 2 machines
# Each job assigned to exactly one machine
# Minimize total completion time (makespan)

# Job durations
jobs = {'J0': 3, 'J1': 5, 'J2': 2}
n_jobs = len(jobs)
n_machines = 2

# Binary variables: x_{j,m} = 1 if job j on machine m
# QUBO: minimize max load + penalty for job assignment
# Simplified: minimize sum of squared machine loads

durations = [3, 5, 2]
penalty = 10.0  # constraint weight

# Brute force: enumerate all assignments
print("All job assignments (3 jobs, 2 machines):")
best_makespan = float('inf')
best_assignment = None

for config in range(2**n_jobs):
    assignment = [(config >> j) & 1 for j in range(n_jobs)]
    load = [0, 0]
    for j in range(n_jobs):
        load[assignment[j]] += durations[j]
    makespan = max(load)
    balance = abs(load[0] - load[1])
    label = ', '.join(f"{list(jobs.keys())[j]}->M{assignment[j]}" for j in range(n_jobs))
    marker = ""
    if makespan < best_makespan:
        best_makespan = makespan
        best_assignment = label
        marker = " <-- best"
    print(f"  {label}  loads={load}  makespan={makespan}  imbalance={balance}{marker}")

print(f"\\nOptimal: {best_assignment}")
print(f"Best makespan: {best_makespan}")`,
        framework: 'qiskit',
        description:
          'A 3-job, 2-machine scheduling problem. Brute force finds the optimal assignment — QAOA would search this space quantumly.',
        explorationPrompt:
          'With 3 jobs and 2 machines there are only 8 assignments. With 10 jobs and 5 machines there are ~10 million. This is where quantum heuristics earn their keep.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

# QAOA for job scheduling
# 3 qubits: qubit j = 0 means job j on machine 0, 1 means machine 1
n_qubits = 3
durations = np.array([3, 5, 2])

def schedule_cost(bitstring):
    """Compute makespan for a given assignment."""
    assignment = [int(b) for b in reversed(bitstring)]
    load = [0, 0]
    for j, m in enumerate(assignment):
        load[m] += durations[j]
    return max(load)

def qaoa_schedule(gamma, beta):
    qc = QuantumCircuit(n_qubits)
    for i in range(n_qubits):
        qc.h(i)

    # Cost layer: penalize imbalanced loads
    # ZZ terms encode pairwise "same machine" penalty
    for i in range(n_qubits):
        for j in range(i + 1, n_qubits):
            w = gamma * durations[i] * durations[j] * 0.1
            qc.cx(i, j)
            qc.rz(2 * w, j)
            qc.cx(i, j)
    # Z terms: individual job weights
    for i in range(n_qubits):
        qc.rz(gamma * durations[i] * 0.2, i)

    # Mixer
    for i in range(n_qubits):
        qc.rx(2 * beta, i)
    return qc

# Sweep parameters
results = {}
for gamma in np.linspace(0, 2 * np.pi, 20):
    for beta in np.linspace(0, np.pi, 20):
        sv = Statevector.from_instruction(qaoa_schedule(gamma, beta))
        probs = sv.probabilities_dict()
        for bitstr, p in probs.items():
            if p > 0.01:
                cost = schedule_cost(bitstr)
                if bitstr not in results or p > results[bitstr]:
                    results[bitstr] = p

# Sort by makespan
ranked = sorted(results.items(), key=lambda x: schedule_cost(x[0]))
print("QAOA scheduling results:")
for bitstr, prob in ranked[:5]:
    assignment = [int(b) for b in reversed(bitstr)]
    load = [0, 0]
    for j, m in enumerate(assignment):
        load[m] += durations[j]
    jobs = ['J0(3)', 'J1(5)', 'J2(2)']
    desc = ', '.join(f"{jobs[j]}->M{m}" for j, m in enumerate(assignment))
    print(f"  |{bitstr}> makespan={max(load)}  {desc}")`,
        framework: 'qiskit',
        description:
          'QAOA for job scheduling. ZZ interactions penalize putting heavy jobs on the same machine.',
        explorationPrompt:
          'The ZZ penalty weight determines how strongly QAOA discourages co-location. Try increasing the 0.1 factor. Does the optimal assignment appear more often?',
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '9.5-q1',
            question: 'How are constraints encoded in a QUBO formulation?',
            options: [
              'They are ignored — QUBO has no constraints',
              'As hard limits that reject invalid solutions',
              'As penalty terms added to the cost function',
              'As separate qubits that enforce rules',
            ],
            correctIndex: 2,
            explanation:
              'QUBO is unconstrained by definition. Constraints are converted to penalty terms: P * (violation)². Valid solutions have zero penalty. The weight P must be large enough to prevent constraint-violating solutions from being optimal.',
          },
          {
            id: '9.5-q2',
            question: 'Which supply chain problems are the strongest candidates for quantum optimization?',
            options: [
              'Simple inventory counting',
              'Binary assignment and routing problems with many interacting constraints',
              'Single-variable linear decisions',
              'Problems that are already solved in real-time classically',
            ],
            correctIndex: 1,
            explanation:
              'Quantum optimization targets combinatorial problems where the number of possible configurations grows exponentially with problem size. Binary assignment, routing, and scheduling with interacting constraints fit this profile.',
          },
        ],
      },
    ],
  },

  // ── Lesson 9.6 ──
  {
    id: '9.6',
    title: 'Quantum Advantage — Realistic Assessment',
    description:
      'What is real, what is hype. NISQ limitations for finance and an honest industry outlook.',
    difficulty: 'beginner',
    estimatedMinutes: 20,
    prerequisites: ['9.1'],
    tags: [
      'nisq',
      'quantum-advantage',
      'industry',
      'limitations',
      'outlook',
      'finance',
    ],
    diracContext:
      'Be honest and grounded. Current quantum hardware cannot outperform classical for any finance problem. The theoretical speedups are real but require fault-tolerant hardware. Discuss: what has been demonstrated, what is plausible near-term, what requires error correction. Mention specific companies and research results. Avoid both hype and dismissiveness.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Honest State of Quantum Finance

Let us be direct: **no quantum computer has outperformed a classical one on any real financial problem.** The theoretical speedups are mathematically proven. The hardware is not there yet.

### What Has Been Demonstrated

- **Portfolio optimization:** 3-5 asset QAOA on real hardware (IBM, IonQ). Classical solver wins easily at this scale.
- **Monte Carlo:** Proof-of-concept amplitude estimation for option pricing. Noisy results, worse than classical.
- **Credit risk:** 2-3 borrower models simulated. Educational, not practical.

### The Bottlenecks

| Bottleneck | Status | Needed |
|------------|--------|--------|
| Qubit count | ~1000 (noisy) | 10,000+ (logical) |
| Error rates | ~0.1% per gate | ~0.001% per gate |
| Coherence time | Microseconds | Milliseconds |
| State preparation | Very expensive | Efficient loaders |`,
      },
      {
        type: 'concept-card',
        title: 'The NISQ Reality Check',
        visual: 'custom-svg',
        explanation:
          'NISQ (Noisy Intermediate-Scale Quantum) devices have 50-1000 noisy qubits. For finance applications, noise washes out the quantum advantage before problem sizes reach classical difficulty. Error correction is the bridge, but requires ~1000 physical qubits per logical qubit.',
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

# Demonstrate how noise destroys quantum advantage
# Clean QAOA for 3-asset portfolio
n = 3
Q = np.array([
    [1.5, 1.0, 1.0],
    [1.0, 1.3, 1.0],
    [1.0, 1.0, 0.9],
])

def clean_qaoa(gamma, beta):
    qc = QuantumCircuit(n)
    for i in range(n):
        qc.h(i)
    for i in range(n):
        for j in range(i+1, n):
            qc.cx(i, j)
            qc.rz(2 * gamma * Q[i, j], j)
            qc.cx(i, j)
    for i in range(n):
        qc.rz(2 * gamma * Q[i, i], i)
    for i in range(n):
        qc.rx(2 * beta, i)
    return qc

# Simulate clean vs "noisy" (random perturbation)
gamma, beta = 1.2, 0.8
clean_sv = Statevector.from_instruction(clean_qaoa(gamma, beta))
clean_probs = clean_sv.probabilities_dict()

# Simulate noise: add small random rotations (depolarizing-like)
np.random.seed(42)
noise_strength = 0.3
noisy_qc = clean_qaoa(gamma, beta)
for i in range(n):
    noisy_qc.rx(noise_strength * np.random.randn(), i)
    noisy_qc.rz(noise_strength * np.random.randn(), i)
noisy_sv = Statevector.from_instruction(noisy_qc)
noisy_probs = noisy_sv.probabilities_dict()

print("Clean vs Noisy QAOA probabilities:")
print(f"{'State':<6} {'Clean':>8} {'Noisy':>8} {'Diff':>8}")
print("-" * 34)
for state in sorted(set(list(clean_probs.keys()) + list(noisy_probs.keys()))):
    cp = clean_probs.get(state, 0)
    np_ = noisy_probs.get(state, 0)
    print(f"|{state}>  {cp:>8.4f} {np_:>8.4f} {abs(cp-np_):>8.4f}")

clean_best = max(clean_probs, key=clean_probs.get)
noisy_best = max(noisy_probs, key=noisy_probs.get)
print(f"\\nClean optimum: |{clean_best}> (p={clean_probs[clean_best]:.4f})")
print(f"Noisy optimum: |{noisy_best}> (p={noisy_probs[noisy_best]:.4f})")
if clean_best != noisy_best:
    print("Noise shifted the optimal solution!")`,
        framework: 'qiskit',
        description:
          'Compare clean vs noisy QAOA. Even small noise perturbations can shift the optimal solution — this is why current hardware struggles.',
        explorationPrompt:
          'Try increasing noise_strength from 0.3 to 1.0. At what point does the output become essentially random?',
      },
      {
        type: 'text',
        markdown: `## When Will Quantum Finance Be Practical?

**Conservative timeline:**

- **2025-2028:** Research demos. Error mitigation helps but does not overcome the fundamental noise problem. Classical still wins.
- **2028-2032:** Early fault tolerance. 100+ logical qubits. First problems where quantum matches classical performance (not yet faster).
- **2032-2038:** Quantum advantage for Monte Carlo on high-dimensional pricing. Portfolio optimization for 100+ assets with real constraints.
- **2038+:** Large-scale quantum simulation for credit risk, systemic risk modeling, and real-time derivatives pricing.

**What to do now:**
1. Learn the formulations (you are doing this)
2. Build hybrid classical-quantum pipelines
3. Identify problems in your domain that fit QUBO/QAE patterns
4. Stay skeptical of "quantum supremacy" claims for finance

The companies investing now — Goldman Sachs, JPMorgan, HSBC, BBVA — are building expertise, not production systems.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '9.6-q1',
            question: 'Has any quantum computer outperformed classical methods on a real financial problem?',
            options: [
              'Yes — portfolio optimization is already faster on quantum hardware',
              'Yes — Monte Carlo pricing is production-ready',
              'No — all demonstrations remain below the scale where classical struggles',
              'No — quantum computers cannot be used for finance',
            ],
            correctIndex: 2,
            explanation:
              'As of now, all quantum finance demonstrations run at scales (3-5 assets, 2-3 borrowers) that classical computers solve trivially. The theoretical speedups are real, but hardware must improve by orders of magnitude.',
          },
          {
            id: '9.6-q2',
            question: 'What is the most likely first area where quantum finance provides real advantage?',
            options: [
              'Simple portfolio selection',
              'Monte Carlo for high-dimensional derivative pricing',
              'Day trading algorithms',
              'Cryptocurrency mining',
            ],
            correctIndex: 1,
            explanation:
              'Quantum amplitude estimation provides a proven quadratic speedup for Monte Carlo. High-dimensional problems (basket options, multi-asset derivatives) are where classical MC is most expensive, making this the likeliest first win.',
          },
          {
            id: '9.6-q3',
            question: 'Why are banks investing in quantum computing research now if advantage is years away?',
            options: [
              'Marketing and hype',
              'Regulatory requirements',
              'Building expertise, identifying problems, and being ready when hardware matures',
              'Current quantum computers are already profitable for trading',
            ],
            correctIndex: 2,
            explanation:
              'The organizations investing now are building in-house expertise, identifying which of their problems map to quantum formulations, and developing hybrid pipelines. When hardware matures, they will be ready to deploy.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Your Quantum Finance Toolkit',
        visual: 'circuit',
        explanation:
          'Portfolio optimization (QAOA/QUBO), option pricing (amplitude estimation), credit risk (correlated qubit encoding), logistics (TSP/scheduling via QUBO). These four formulation patterns cover most quantum finance applications. Master the encodings now; hardware will catch up.',
      },
    ],
  },
];
