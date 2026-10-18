# PRD 14 Addendum — shared contracts and three inventions

**Status:** binding, alongside `PRD_14_QUANTUM_AI_LAB.md` (spec v2).
**Date:** 2026-10-18

This addendum does two things:

- It fixes the one internal contract the spec leaves open, the bit-packed Pauli module that the PPE and the Lie closure share, so those two can be built in parallel.
- It adds three features beyond the spec. Each one keeps the spec's honesty principles (§1).

If anything here conflicts with the spec, the spec wins, except where this document explicitly extends it.

---

## A. Shared contract — `kernel/trainability/symplectic.py`

This module holds bit-packed Pauli strings and has no dependency on `ir.py`. It is used by `pauliprop.py`, `lie.py` and `lint.py`.

**Convention:** a Pauli string is `i^phase · P_0 ⊗ … ⊗ P_{n−1}`, where qubit `q` is bit `q % 64` of word `q // 64`, and the single-qubit factor is fixed by the `(x, z)` bits:

| (x, z) | factor |
|---|---|
| (0, 0) | I |
| (1, 0) | X |
| (0, 1) | Z |
| (1, 1) | Y |

`Y` is the Hermitian Y, **not** `XZ`. `phase ∈ {0,1,2,3}`, so a Hermitian string has phase 0 or 2 (sign ±1).

```python
WORD_BITS = 64
def n_words(n_qubits: int) -> int                                   # ceil(n/64), ≥ 1

@dataclass
class PauliArray:                      # a batch of N strings on n qubits
    n_qubits: int
    x: np.ndarray                      # (N, W) uint64
    z: np.ndarray                      # (N, W) uint64
    phase: np.ndarray                  # (N,) uint8, power of i
    @staticmethod
    def from_labels(labels: Sequence[str], n_qubits: int | None = None) -> "PauliArray"   # "XIZY", "-XZ", "iY"; leftmost char = qubit 0
    @staticmethod
    def from_sparse(terms: Sequence[tuple[tuple[int, str], ...]], n_qubits: int) -> "PauliArray"  # PauliTerm.ops shape
    def to_labels(self) -> list[str]
    def to_sparse(self) -> list[tuple[int, tuple[tuple[int, str], ...]]]          # (phase, ops)
    def __len__(self) -> int
    def take(self, idx) -> "PauliArray"

def popcount(words: np.ndarray) -> np.ndarray                        # per-row popcount summed over the last axis
def weight(p: PauliArray) -> np.ndarray                              # (N,) number of non-identity sites
def anticommutes(p: PauliArray, i: int, q: PauliArray) -> np.ndarray # (N,) bool: does p[i] anticommute with each q[j]
def anticommute_matrix(a: PauliArray, b: PauliArray) -> np.ndarray   # (Na, Nb) bool (small batches / tests)
def multiply(a: PauliArray, b: PauliArray) -> PauliArray             # elementwise a[j]·b[j] (broadcast if len(a)==1), exact phase
def commutator_string(a: PauliArray, b: PauliArray) -> PauliArray    # for anticommuting pairs: [a,b]/2 = a·b, phase tracked; caller filters
def is_z_type(p: PauliArray) -> np.ndarray                           # (N,) bool: no X/Y factors (⟨0…0|P|0…0⟩ ≠ 0)
def expectation_zero_state(p: PauliArray) -> np.ndarray              # (N,) complex: i^phase if z-type else 0

class CliffordConjugator:
    """Heisenberg conjugation P -> U† P U for a sequence of Clifford gates, vectorized over the batch."""
    SUPPORTED: frozenset[str]          # at least H S SDG X Y Z SX SXDG I CX CY CZ SWAP ISWAP
    def __init__(self, gates: Sequence[tuple[str, tuple[int, ...]]], n_qubits: int, *, use_stim: bool | None = None)
    def conjugate(self, p: PauliArray) -> PauliArray                 # applies U = g_k…g_1, i.e. returns U† P U
    backend: str                       # "native" | "stim"

def is_clifford_gate(name: str, angles: tuple[float, ...] = ()) -> bool   # includes RZ/RX/RY/P at multiples of π/2

class PauliFrontier:
    """Hash map from (x‖z) keys to accumulated weights. Used by the PPE and for dedup in Lie closure."""
    def __init__(self, n_qubits: int, dtype=np.float64)
    @staticmethod
    def from_array(p: PauliArray, weights: np.ndarray) -> "PauliFrontier"  # merges duplicates; phase folded into weight sign (Hermitian only)
    def to_array(self) -> tuple[PauliArray, np.ndarray]
    def __len__(self) -> int
    def prune(self, *, max_weight: int | None, min_abs: float) -> float    # drops entries; returns discarded Σ|w|
```

**Tests** (`kernel/tests/test_trainability_symplectic.py`):

- Round trips through labels and sparse form at n = 1, 63, 64, 65 and 128.
- `multiply` and phases checked against dense 2ⁿ matrices for random strings at n ≤ 5.
- `anticommutes` checked against the dense commutator.
- `CliffordConjugator` checked against dense `U† P U` for random Clifford circuits at n ≤ 4.
- Native ≡ Stim (`stim.PauliString.after` / `stim.Tableau`) on random circuits at n = 70.
- `PauliFrontier` merge and prune discarded-mass accounting.
- A vectorized speed check: commutation of one string against 10⁶ strings at n = 128 in < 0.5 s.

---

## B. Invention 1 — the Frontier evaluator (`trainability_frontier`)

**The question it serves:** Cerezo et al. (arXiv:2312.09121) conjecture that every provably barren-plateau-free ansatz is also classically simulable. Nobody has a tool that searches for counterexamples. Nuclei can be that tool. The Discovery Engine evolves ansatzes, and the PPE scores them **exactly at 8 to 64 qubits**.

- **Entry:** `build(n_qubits: int, n_layers: int)` returns a parameterized Qiskit or Cirq circuit.
- **Config:**
  - `qubits` (int[], default `[8, 16, 32, 64]`, each 4–128, ≤ 6 values)
  - `n_layers` (default 4)
  - `observable` (default `preset:local_z`)
  - `estimation: {target_width: 0.02, max_frontier: 200000, time_budget_s: 8}`
  - `dla_probe_qubits` (default 4)
  - `max_parameters_per_qubit` (default 24)
  - `weights: {trainability: 1.0, hardness: 0.5}`
- **Stages:**
  - `screen` uses `qubits[:2]`, with `max_frontier` reduced 10×.
  - `full` uses every qubit size.
  - `confirm` re-runs `full` with an independent parameter seed for the estimation probe.
- **Guardrails, in order:**
  1. `ir_conversion` — the circuit converts for every n.
  2. `ppe_class` — every rotation is a single-Pauli rotation with its own independent parameter (no shared or affine parameters), and every fixed gate is Clifford. `ppe_applicable` must be true for each n.
  3. `qubit_count` — the circuit has exactly n qubits for each n.
  4. `parameter_budget` — at most `max_parameters_per_qubit · n` parameters.
  5. `nontrivial_variance` — the PPE `variance_mean` at the smallest n is ≥ 1e-6. This stops "β = 0 because nothing depends on θ".
  6. `nontrivial_algebra` — at `dla_probe_qubits`, the DLA dimension is > 2n. Product and near-free ansatzes are rejected, because a constant-variance product circuit is trivially trainable and trivially simulable.
  7. `exactness` — every PPE variance point has interval width ≤ 10% of the estimate. Otherwise the result is a `warn` and the point is down-weighted.
- **Scoring:**
  - **Trainability:** compute the exact PPE gradient variance at each n and fit `Var ∝ 2^(−β n)` with the spec's §5.5 fitter (`scaling.py`). Lower β is better, and fitness uses β's **upper** 95% bound.
  - **Estimation hardness probe:** at the largest n, run `ppe_expectation_bounds` at 3 seeded random parameter points. The probe asks for the smallest frontier at which the bound width reaches `target_width`. If the budget runs out first, record `≥ max_frontier` and mark the value censored.
    - `hardness = log10(frontier_needed)`.
    - Fitness uses the **lower** (pessimistic) value across the 3 points.
- **Fitness** = `weights.trainability · (−β_upper95) + weights.hardness · hardness_lower`.
- **Objectives:**
  - `beta` (minimize; value plus CI)
  - `estimation_hardness` (maximize; censored flag in metrics)
- **Descriptors:**
  - `log2_dla_dimension` (0..2·probe_n, 8 bins)
  - `two_qubit_gates_per_layer` (0..64, 8 bins)
- **Honesty (mandatory UI and metrics text):** "Hardness is resistance to *this* Pauli-propagation estimator under *this* budget. It is not a proof of classical hardness. A high score is a lead to investigate, not a counterexample."
  - `metrics` carries the per-n variances with intervals, the β fit, the per-point frontier curve (width vs frontier size), and the DLA dimension and classification at the probe size.
- **Template:** `trainability-frontier` is a seed program for a hardware-efficient RY/RZ + CZ-brick ansatz on the open chain, with `build(n_qubits, n_layers)` in the evolve block.

## C. Invention 2 — Microscope-in-the-loop mutation

Evaluators that see a parameterized circuit (`vqe_ground_state`, `trainability_frontier`, and `state_synthesis` when it has parameters) add an optional field `metrics.gradient_map`:

```json
{"method": "pauli_propagation_exact" | "statevector_sampling", "n_qubits": 6,
 "lines": [{"line": 14, "parameters": ["θ[3]"], "variance": 1.2e-9, "dead": true}],
 "dead_fraction": 0.25}
```

- Line numbers are 1-based lines of the **candidate program**, recovered from the converter's `source_line`. When a line cannot be recovered, the entry is omitted; the evaluator never guesses.
- `dead` means variance < 1e-8 or the TRN004 dead-parameter rule fires.
- `prompt.ts` renders a "Gradient map (from the trusted evaluator)" section in the user prompt, capped at 12 lines with an "N of M" disclosure. It names the dead lines and suggests the model prune, reorder or re-axis them.
- The LLM sees the *physics* of its parent's failure, not just a scalar. As far as we know, no LLM-guided program-search system feeds trained-model gradient diagnostics back into the mutation prompt.
- The run journal records whether each improving child touched a flagged line (`candidate.llm.touched_dead_lines: number`), so the claim "gradient maps help" is measurable from run data.

## D. Invention 3 — Trainability Certificate

`trainability_result` gains `provenance`:

```json
{"code_sha256": "<64 hex>", "observable": "<canonical text>", "settings": {...clamped settings actually used...},
 "kernel": {"nuclei_protocol": "1.3", "python": "3.12.4", "numpy": "2.1.0", "stim": "1.14.0" | null, "qiskit": "...", "cirq": "..."},
 "analyses_fingerprint": "<64 hex: sha256 of kernel/trainability/*.py bytes in sorted order>",
 "backend": "numpy", "created_at": "<ISO-8601 UTC>"}
```

- The Microscope's verdict rail has **Export certificate**. It writes `experiments/<file-stem>.trainability.json`: the full results, provenance and verdicts.
- It also writes `experiments/<file-stem>.trainability.md`, a human-readable report. That report has the verdicts with their evidence chains, every number with its interval and method label, the stated assumptions, citations, and a "Reproduce" block (code hash, settings, seed).
- Writes go through `PlatformBridge`. The pure renderer lives in `src/services/trainability/certificate.ts` and has a snapshot test.
- Re-running with the same code, settings and seed must reproduce every number bit-for-bit on the same backend. A kernel test asserts this for `gradients` (sampling and PPE) and `lie`.

---

## E. Protocol additions (additive to v1.3)

- `DiscoveryEvaluatorKind` adds `'trainability_frontier'`.
- `TrainabilityRunResult` adds `provenance` (§D).
- `GradientStatistics` and `ScalingStudy` points add `method`, `backend` and optional `interval` (spec §5.5 already requires these).
- `DiscoveryEvaluation` adds `stage`, `program_key`, `cache_hit`, `isolation` and `compute` (spec §6.4). `metrics.gradient_map` is optional (§C).
