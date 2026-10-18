# PRD 14 — Quantum AI Lab: Trainability Lab ("Microscope") + Discovery Engine

**Status:** Spec v2 (revised 2026-10-18 for the compute strategy, §4.1) · implementation paused pending go-ahead · branch `feat/quantum-ai-lab`
**Date:** 2026-10-18
**Workspace:** Research mode only (Learn is byte-for-byte unchanged)
**Protocol:** Kernel Protocol v1.3 (additive-only)

This document is both the product requirements and the **binding technical
contract** for the parallel implementation. Any engineer (human or agent)
working on PRD 14 must treat the wire formats, file layouts, Python and
TypeScript signatures, and file-ownership rules below as fixed. If a contract
here is wrong, stop and raise it — do not silently diverge.

---

## 1. Why

"Quantum AI" has two halves:

1. **Quantum → AI (QML):** parameterized quantum circuits as models. The
   field's central open problems are *trainability* (barren plateaus) and the
   tension between trainability and classical simulability (Cerezo et al.,
   arXiv:2312.09121). Careful benchmarks show classical baselines usually win
   (Bowles, Ahmed & Schuld, arXiv:2403.07059).
2. **AI → quantum:** machine learning that designs quantum programs. LLM-guided
   evolutionary program search (FunSearch, Nature 2023; AlphaEvolve, 2025) has
   produced real discoveries in mathematics. Nobody ships it as a tool a
   quantum researcher can point at their own problem.

Nuclei already has the substrate: a multi-framework kernel, a reproducible
Experiment object, Stim/sinter/PyMatching, a sandboxed agent worker, Dirac on
the Claude API, and a culture of honest-by-default reporting
(`seed_honored: false`, never-silent truncation). PRD 14 builds two
instruments on it:

- **Trainability Lab ("the Microscope")** — makes the physics of training
  visible: gradient statistics, barren-plateau scaling fits, dynamical Lie
  algebra (DLA) analysis with a simulability verdict, expressibility,
  entangling capability, loss landscapes, a gradient heatmap painted onto the
  circuit, and live trainability diagnostics in the editor.
- **Discovery Engine ("AlphaEvolve for quantum")** — an LLM-guided
  evolutionary search over quantum programs with *trusted, anti-reward-hacking
  evaluators*, a MAP-Elites archive with islands, a Pareto front, full
  lineage, a no-LLM baseline mutator, and champion re-confirmation on fresh
  seeds.

### Honesty principles (non-negotiable)

1. **The evaluator is never in the candidate's process.** Candidate code runs
   in a sandboxed subprocess and may only emit an *artifact* (Stim text or IR
   JSON). A separate trusted scorer re-parses the artifact and computes every
   number. Candidates never see or touch the scorer.
2. **The evaluator applies the noise.** Candidates must emit noiseless
   circuits; any noise instruction is a rejection.
3. **Every guardrail result is shown,** including rejections. The Guardrails
   tab is the reward-hacking log.
4. **Uncertainty is first-class.** Monte-Carlo objectives carry 95% intervals.
   Fitness uses the *pessimistic* bound. The champion is re-evaluated on fresh
   seeds before it is reported (winner's-curse correction).
5. **Assumptions are stated.** Every theoretical prediction (e.g. the
   Lie-algebraic variance formula) lists its assumptions and is shown next to
   the empirical measurement.
6. **"Inconclusive" is a valid verdict.** A scaling fit with too few points,
   or a confidence interval that crosses zero, says so.
7. **Fingerprints.** Every evaluation records the evaluator kind, version,
   and a SHA-256 fingerprint of the evaluator source plus canonical config.

---

## 2. Users and jobs-to-be-done

- **QML researcher:** "Is my ansatz trainable at scale, or does it collapse
  into a barren plateau? Is it trainable only because it's classically
  simulable?" → Trainability Lab.
- **QEC researcher:** "Find me a syndrome-extraction circuit with lower
  logical error per round under *my* noise model, and prove it didn't cheat."
  → Discovery Engine, `qec_memory` evaluator.
- **Algorithms researcher:** "Find a shallower circuit preparing this state,"
  "Find an ansatz that reaches the ground state with fewer parameters, *and*
  is still trainable." → `state_synthesis`, `vqe_ground_state` evaluators
  (the latter uses the Microscope as a pre-filter).
- **Student in Research mode:** sees barren plateaus happen on the circuit.

---

## 3. Product surface

### 3.1 Trainability Lab (`'trainability'` rail view, lucide `Microscope`)

A main-area takeover (like the Transpiler). It analyzes the **active editor
file**.

- **Target bar:** file name, framework chip, `n` qubits, `m` parameters, the
  sweepable params detected from `params.get("...")`. Observable field
  (monospace, Pauli-sum syntax, §5.3) with presets (Local Z, Global Z, ZZ
  chain, TFIM). Samples and seed. Primary **Run analyses** button (⌘⇧↵ — ⌘↵ stays the global simulator run). Cancel.
  Streaming progress.
- **Circuit with gradient heatmap:** the circuit diagram with each
  parameterized gate tinted by gradient variance (log scale, sequential
  palette, legend). Gates with ~zero variance ("dead") get a hatched gray
  treatment. Hover shows the parameter name, Var[∂C/∂θ], and E|∂C/∂θ|.
- **Analysis tabs:**
  - *Gradients* — per-parameter variance strip chart (log y) with bootstrap
    CIs, mean |gradient|, sample count.
  - *Scaling* — Var[∂C] vs `n` on a semilog plot with CI whiskers, an
    exponential fit with a CI band, and a power-law alternative. Shows the
    annotation `Var ∝ 2^(−β n)` with a CI for β, the model comparison
    (ΔAIC), and a verdict: **barren plateau** / **polynomial** /
    **inconclusive**.
  - *Lie algebra* — dim 𝔤 vs 4ⁿ−1 on a log meter, a classification
    (su / so / sp / free-fermion so(2n) / other), status
    (complete / truncated / unsupported), g-purities, and the Ragone et al.
    predicted variance next to the empirical one, with its assumptions. The
    simulability verdict says "trainable *and* classically simulable via
    𝔤-sim" when the DLA is small.
  - *Expressibility* — fidelity histogram vs the Haar curve, KL divergence
    (Sim et al. 2019) with a CI. *Entangling capability* — Meyer–Wallach
    distribution vs the Haar mean.
  - *Landscape* — a 2D loss slice along two random orthonormal directions
    (canvas heatmap with a colorbar and a center marker).
- **Verdict rail (right):** a Trainability card (BP risk: high / medium /
  low / unknown, with the evidence chain), a Simulability card, and the lint
  diagnostics list (click to jump to the line), each with its citation.
- **Editor diagnostics:** in Research mode, when the active Python file has
  free circuit parameters, Monaco shows trainability markers (owner
  `trainability`) from the fast `trainability_lint`, debounced at 800 ms.

### 3.2 Discovery Engine (`'discovery'` rail view, lucide `Dna`)

Sidebar: the discovery definitions (`experiments/*.discovery.yaml`) with
their runs, plus **New discovery** (template gallery). Main-area takeover for
the selected run:

- **Run header:** name, evaluator chip, mutator chip, status pill, controls
  (Start / Pause / Resume / Stop), and budget meters (evaluations, LLM calls,
  wall time).
- **KPI strip:** best fitness (Δ vs seed), the champion's primary objective
  with its CI, evaluations (scored / rejected / failed), acceptance rate,
  improvement share by mutator (LLM vs AST), tokens used.
- **Tabs:**
  - *Overview* — fitness trajectory (best-so-far per island plus every
    candidate as a dot colored by mutator; rejected candidates as × on a
    baseline lane), the Pareto front, and the champion card (diff vs seed,
    Promote, Confirm on fresh seeds).
  - *Lineage* — a tidy tree (root = seed). Nodes are colored by fitness;
    improvements get a ring; rejected nodes are hollow with a danger stroke.
    Pan/zoom; click opens the detail drawer.
  - *Archive* — the MAP-Elites grid over two descriptors (cell color =
    fitness, empty cells hatched), with an island selector.
  - *Candidates* — a sortable, filterable table.
  - *Guardrails* — rejection reasons (bar chart plus list), each linking to
    the candidate, plus pass rates per guardrail.
- **Candidate drawer:** id, status, fitness, a parent link, the LLM rationale,
  a read-only Monaco diff vs the parent, objectives with CIs, the guardrail
  checklist, stdout/stderr, timings, and the evaluator fingerprint. Actions:
  Open as file, Promote (write to the project), Re-evaluate.
- **New discovery wizard:** three template cards (QEC memory schedule, W-state
  synthesis, TFIM ground-state ansatz), name, budgets, mutator. It writes the
  YAML plus the seed program.

### 3.3 Cross-cutting

- Status-bar chip while a discovery run or trainability job is active. The
  mode-switch guard (`modeSwitchStore`) is extended to cover running
  discovery.
- Dirac context: `buildTrainabilityContext` and `buildDiscoveryContext`
  (pure, capped, "N of M" disclosures), injected in Research mode only.
- Web build (Pyodide): both views render a friendly "needs the desktop
  kernel" empty state, unless the DEV override `?labKernel=ws://host:port`
  is present (used for e2e against a real kernel).

---

## 4. Architecture

```
Frontend (TS)                                 Kernel (Python)
─────────────                                 ───────────────
TrainabilityLab ──lab session (WS)──▶ server.py ─route "trainability_*"─▶ kernel/trainability/handlers.py
   lint/inspect (sync)                                                     ├─ in-process: inspect, lint (bounded)
   start/cancel (job) ◀─progress/partial/result─  TrainabilityJobManager ─┴─ subprocess job_worker.py (killable)

DiscoveryRunner (search loop, LLM calls,      server.py ─route "discovery_*"──▶ kernel/discovery/handlers.py
   archive, persistence) ──lab session──▶        DiscoveryManager (thread pool, per-owner queues)
                         ◀─evaluation──           ├─ sandbox subprocess: candidate_worker.py  (untrusted code → artifact)
Claude API (mutations) ◀─fetch─                   └─ scorer subprocess:  score_worker.py      (trusted; computes all numbers)
```

The frontend orchestrates and the kernel stays dumb, the same pattern as
experiments: the search loop, selection, archive, LLM calls and persistence
live in TypeScript. The kernel evaluates one candidate per
`discovery_evaluate`.

The kernel routing hook already exists in `kernel/server.py`
(`_route_lab_message`). It passes a `kernel.lab_context.LabContext`
(`executor`, async `send_json`, `loop`, `owner`, `emit_threadsafe`,
`on_release`, `forget`). `release_owner` fires on connection close. Each
package exposes `async def handle(msg: dict, ctx: LabContext) -> None`.

### 4.1 Compute strategy: the best tools, plus our own compiler where it pays

We do not hand-roll what a strong library already does well, and we *do*
build our own compiler and kernels where the Lab's workload is unusual.

The Lab's workload is not "simulate one circuit". It is "evaluate the same
parameterized circuit and its gradient at hundreds of random parameter
points, across a sweep of sizes". That shape rewards **compilation +
batching**, and for the central barren-plateau question it rewards
**exact classical math instead of sampling**.

**1. Lab Compiler (`kernel/trainability/compiler.py`).** This is a small
optimizing compiler from the IR (§5.1) to a *kernel program*: a flat list of
batched tensor ops. It is built once per circuit and run many times.

- **Passes, in order:**
  - Canonicalize (U → RZ·RY·RZ; controlled rotations to their generator
    form).
  - Merge adjacent same-axis rotations on the same qubit that have the same
    `ParamRef` or constant angles.
  - Fuse runs of fixed single-qubit gates into one 2×2 matrix per qubit.
  - **Diagonal-run fusion:** consecutive diagonal gates (Z, S, T, RZ, P,
    CZ, CP, RZZ, CRZ, …) on any qubits collapse into one phase op,
    `ψ ← ψ · exp(−i Σₖ θₖ gₖ − i φ_fixed)`. Here `gₖ ∈ ℝ^{2ⁿ}` are
    precomputed generator eigenvalue vectors, so a whole QAOA/HVA cost layer
    becomes **one** elementwise exponential.
  - Mark Clifford segments for the Pauli-propagation engine.
- **Lowering:**
  - Ops act on a state tensor of shape `(B, 2, …, 2)`, where the **batch
    axis B is the parameter-sample axis**. 200 gradient samples cost one
    pass of vectorized ops, not 200 Python loops.
  - Rotations broadcast per-batch `cos/sin`. Fixed gates use `tensordot` on
    one axis. Diagonal ops are elementwise.
  - The adjoint gradient is batched the same way.
- **Backends (Python array API):** the lowered program is written against
  an array namespace.
  - `numpy` is always present.
  - `cupy` (NVIDIA GPU) and `jax.numpy` (`jit` over the static op list, CPU
    or GPU) are used when installed.
  - The backend is chosen automatically, can be overridden in settings, and
    is reported in every result (`backend: "numpy" | "cupy" | "jax"`).
- **Reference oracle:** a deliberately naive, unfused, unbatched simulator
  (`reference.py`) is the correctness oracle. CI asserts
  compiled ≡ reference to 1e-10 on randomized circuits for every backend
  present. Qiskit Aer `Statevector` and Cirq's simulator are an independent
  cross-check in tests.

**2. Pauli Propagation Engine, PPE (`kernel/trainability/pauliprop.py`).**
This is the innovation that lets the Microscope answer the barren-plateau
question **exactly, at 100+ qubits**, where statevector sampling cannot
go.

- **Setting:** the circuit is Pauli rotations R(θ) = exp(−iθP/2) with
  **independent** parameters θₖ ~ U[0, 2π), Clifford fixed gates, an
  observable O = Σⱼ cⱼ Qⱼ (Pauli sum), and input |0…0⟩.
- **Heisenberg picture:** at an anticommuting rotation,
  Q → cos θ·Q + sin θ·(iPQ). Averaging over θ kills every cross term,
  because E[cos] = E[sin] = E[cos·sin] = 0 and E[cos²] = E[sin²] = ½.
- **The doubled chain:** E_θ[C²] is therefore the output of a **doubled
  Markov chain on pairs of Pauli strings** (Q, Q′):
  - both commute → the pair stays;
  - both anticommute → stay, or flip both, each with weight ½;
  - exactly one anticommutes → the pair dies.
  
  Then E[C²] = Σ over surviving pairs of w · ⟨0|Q|0⟩⟨0|Q′|0⟩, and only
  {I,Z}-type strings contribute. For a single-Pauli observable this
  reduces to a single chain whose total mass is conserved.
- **Gradients:** E[(∂ₖC)²] is the same chain, except that at gate k
  commuting pairs die (they don't depend on θₖ). E[∂ₖC] = 0 under uniform
  angles. This gives **Var[∂ₖC] in expectation, with no sampling noise**.
  The same construction underlies the tight variance bounds in the
  literature (e.g. Napp 2022; Letcher, Woerner & Zoufal 2023). It must be
  re-derived in the module docstring and verified against batched
  statevector sampling (agreement within the sampling CI) for n ≤ 12.
- **Representation:**
  - Pauli strings are bit-packed symplectic `uint64` arrays (x | z words;
    two words reach 128 qubits). Commutation of one string against the
    whole frontier is a single vectorized popcount of
    `(x₁ & z₂) ^ (z₁ & x₂)`.
  - Clifford conjugation uses vectorized tableau rules, delegating to
    Stim's C++ `stim.PauliString.after` / `stim.Tableau` when Stim is
    installed. Identical strings merge in a hash map.
- **Truncation with rigorous bounds:**
  - Truncate by max Pauli weight and min |weight|, and record the discarded
    absolute mass D. Single-chain masses are non-negative, so the true
    value lies in [kept, kept + D].
  - Pair chains use |w|, which gives a symmetric interval.
  - Results report `method: "pauli_propagation_exact" | "pauli_propagation_bounded"`,
    the interval, the frontier size and the discarded mass.
- **Fallback:** if parameters are shared or affine, the init is `small`,
  the fixed gates are non-Clifford, or the bound width exceeds 10% of the
  estimate, the analysis falls back to compiled statevector sampling and
  says why.
- **The simulability link, made computational:** when the PPE can estimate
  ⟨O⟩ itself with a tight bound at large n, that is direct evidence the
  cost is classically estimable for random parameters (Angrisani et al.,
  2024, on classically estimating noiseless circuit observables). The
  simulability card shows this alongside the DLA verdict.

**3. Lie closure at scale.** The same bit-packed representation means each
new element is tested against the whole basis in one vectorized pass, so
closures up to dim ≈ 10⁵ fit in seconds. PennyLane's `qml.lie_closure` is
a test-only cross-check when installed (never a runtime dependency).

**4. QEC evaluation uses Stim + PyMatching 2 natively.**
- Sampling is batched and run in the scorer subprocess. Concurrency comes
  from parallel scorer processes, never from threads in the kernel process.
- **The fault-distance search is budgeted** (measured here: full
  `search_for_undetectable_logical_errors` ≈ 0.8 s at d = 5 and ≈ 131 s at
  d = 7):
  - an exact search with a 10 s budget for d ≤ 5;
  - for larger d, `shortest_graphlike_error` (finds a real logical error,
    so it is an *upper* bound and catches cheaters whose distance is
    lower) plus a pruned search, with the guardrail marked
    `warn: "distance verified only up to the search bounds"`.
- Results are cached by the structural SHA-256 of the noisy circuit, so a
  circuit's distance is computed once per run no matter how many seeds
  evaluate it.

**5. Evaluation cascade + cache (from AlphaEvolve).**
- **Stage 0:** static guardrails (milliseconds).
- **Stage 1:** a cheap score (e.g. 2 000 shots; 1 restart × 50 steps).
- **Stage 2:** the full score, only if stage 1's *optimistic* bound beats
  the island's current median elite.
- **Stage 3 (champion only):** confirmation on fresh seeds.
- Every evaluation is cached by (normalized-program hash, evaluator
  fingerprint, seed, stage). Normalization is `ast.dump` of the module, so
  comment and whitespace edits are free. Rejected-at-stage-0 programs never
  reach the scorer.

**6. Canonical cost model.** Two-qubit cost and depth are measured after
canonical decomposition into {1q, CX}, using a fixed table: CX = CZ = CY =
1, ISWAP = 2, SWAP = 3, RXX = RYY = RZZ = RZX = 2, CRX = CRY = CRZ = CP =
CH = 2, CCX = CCZ = 6, CSWAP = 8. A composite gate can never look cheaper
than what it compiles to.

**7. Isolation, reported honestly.**
- The baseline is a subprocess, rlimits and the import blocker.
- Stronger OS isolation is used opportunistically when present:
  - Linux `bwrap --unshare-net --unshare-pid --die-with-parent` with
    read-only binds;
  - macOS `sandbox-exec` with a deny-network profile.
- Each evaluation records `isolation: "process" | "bwrap" | "sandbox-exec"`
  and never claims more than what actually ran.

**8. Deferred, deliberately.** A native Rust statevector kernel (PyO3,
rayon) is deferred. Batched array-API lowering removes the Python
per-sample overhead that dominates this workload. We revisit only if
profiling shows the remaining per-op dispatch dominates at n ≤ 14.

---

## 5. Kernel contract — `kernel/trainability/`

### 5.1 Parameterized circuit IR (`ir.py`)

```python
@dataclass(frozen=True)
class ParamRef:
    name: str            # parameter symbol name (Qiskit Parameter.name / sympy symbol name)
    coeff: float = 1.0   # gate angle = coeff * value[name] + offset
    offset: float = 0.0

Angle = Union[float, ParamRef]

@dataclass(frozen=True)
class IrGate:
    name: str                      # canonical name, see GATE_SPECS
    qubits: tuple[int, ...]        # controls first, then targets
    angles: tuple[Angle, ...] = ()
    source_index: int | None = None  # index into CircuitSnapshot.gates (overlay mapping)
    source_line: int | None = None   # 1-based user-code line when known

@dataclass
class ParamCircuit:
    n_qubits: int
    gates: list[IrGate]
    parameters: list[str]          # ordered unique names; the `values` vector follows this order
    framework: str                 # 'qiskit' | 'cirq' | 'native'
    notes: list[str]               # human-readable notes, e.g. "dropped 3 measurements"
    def to_json(self) -> dict: ...
    @staticmethod
    def from_json(data: dict) -> "ParamCircuit": ...   # strict validation; raises IrError
    def bind_vector(self, values: np.ndarray) -> list[tuple[IrGate, tuple[float, ...]]]: ...
```

- Bit order: **qubit q ↔ bit q of the basis index** (little-endian, the
  Qiskit convention). The Cirq converter maps sorted qubits to 0..n−1.
- `GATE_SPECS` (`gates.py`) covers H X Y Z S SDG T TDG SX SXDG I · RX RY RZ
  P U (U is decomposed by the converter into RZ·RY·RZ plus a global phase) ·
  CX CY CZ CH SWAP ISWAP CCX CCZ CSWAP · RXX RYY RZZ RZX · CRX CRY CRZ CP.
  Each entry gives the arity, the number of angles, `matrix(angles) ->
  np.ndarray`, and, for single-angle parametric gates, `generator(qubits) ->
  PauliSum` with the convention **U(θ) = exp(−i θ G)**. For RX,
  G = X/2. For CRZ, G = (I − Z_c)/2 ⊗ Z_t/2 = Z_t/4 − Z_c Z_t/4. For P,
  G = (Z − I)/2 (so that exp(−iθG) = diag(1, e^{iθ}) = P(θ)). For CP,
  G = −(I − Z_c − Z_t + Z_c Z_t)/4. (Corrected 2026-10-18: the earlier
  signs produced P(−θ).) Identity
  components are kept for simulation and ignored for the DLA.
- Errors are `IrError(code, message)` with codes `unsupported_gate`,
  `nonlinear_parameter`, `too_many_qubits`, `mid_circuit_measurement`,
  `invalid_ir`.

### 5.2 Converters (`convert.py`)

```python
def from_qiskit(circuit) -> ParamCircuit
def from_cirq(circuit) -> ParamCircuit
def from_object(obj) -> ParamCircuit          # dispatch; raises IrError("unsupported_object")
```

- Qiskit: `Parameter` and `ParameterVectorElement` become ParamRef with the
  Qiskit name (`θ[0]`). Linear `ParameterExpression` (`2*θ + 0.3`) is
  supported through its gradient/coefficient; nonlinear expressions or several
  parameters in one angle raise `nonlinear_parameter`. Parameter order follows
  `circuit.parameters` (Qiskit's sorted order).
- Cirq: `XPowGate/YPowGate/ZPowGate` with exponent `t` (number or linear
  sympy expression) become RX/RY/RZ with angle `π·t` (the global phase is
  dropped). `cirq.rx/ry/rz` are the same. `CZPowGate/CXPowGate` with symbolic
  exponents become CP-like controlled phase via an exact matrix (or raise
  `unsupported_gate` when non-Pauli-generated). Parameter order is sorted by
  symbol name.
- Measurements and barriers at the end are dropped and noted. Measurement
  followed by more gates on that qubit raises `mid_circuit_measurement`.
  Resets raise `unsupported_gate`.
- **`source_index` alignment:** the converter must assign `source_index`
  exactly as the framework adapter (`kernel/adapters/qiskit_adapter.py`,
  `cirq_adapter.py`) enumerates `CircuitSnapshot.gates`, so heatmap values map
  to the right drawn gate. A U gate decomposed into three IR gates shares one
  `source_index`. Tests must assert alignment on circuits that include
  barriers and measurements.

**Adapter change (same owner):** `qiskit_adapter.py` and `cirq_adapter.py`
must build a snapshot for circuits with **unbound parameters** instead of
failing with `adapter_error`. Numeric params are emitted when bound. For a
symbolic param, emit `0.0` in `params` and add the optional `Gate.symbols:
list[str | None]` (same length as `params`; `None` = numeric). `Gate.to_dict`
**omits `symbols` when it is None or all-None**, so existing fixtures and
snapshots are byte-identical. Simulating an unbound circuit keeps failing with
a clear `simulation_error`: "bind circuit parameters before simulating
(Trainability Lab analyzes free parameters)".

### 5.3 Observables (`pauli.py`)

```python
@dataclass(frozen=True)
class PauliTerm:
    coeff: float
    ops: tuple[tuple[int, str], ...]     # sorted by qubit; 'X'|'Y'|'Z'; identity omitted

@dataclass(frozen=True)
class PauliSum:
    terms: tuple[PauliTerm, ...]
    def max_qubit(self) -> int
    def weight(self) -> int               # max term weight
    def to_text(self) -> str              # canonical "0.5*Z0*Z1 + X2"

def parse_observable(spec: str, n_qubits: int) -> PauliSum     # raises ObservableError(message, column)
```

The text syntax: terms are joined by `+`/`-`. A term is an optional real
coefficient (`0.5`, `1e-3`, with an optional `*`) followed by factors such
as `Z0`, `X12` or `Y3`, written adjacent (`Z0Z1`), space-separated
(`Z0 Z1`) or `*`-separated. Like terms are merged, and duplicate qubits
within a term are multiplied out with the correct phase (a non-Hermitian
result raises). Presets: `preset:local_z` = (1/n)ΣZᵢ, `preset:global_z` =
Z⊗n, `preset:zz_chain` = Σ ZᵢZᵢ₊₁ (open chain), `preset:tfim` =
−Σ ZᵢZᵢ₊₁ − h Σ Xᵢ with an optional `preset:tfim(h=0.5)`. Qubit indices must
be < `n_qubits`.

There is also a fast Pauli application on statevectors
(`apply_pauli_term(state, term, n)` via bit masks), plus
`pauli_sum_matrix(ps, n)` for tests (n ≤ 10).

### 5.4 Compiler + simulator (`compiler.py`, `statevector.py`, `reference.py`, `backends.py`)

See §4.1.1 for the design. The public API is batch-first; the unbatched
names are thin B = 1 wrappers that other packages import.

```python
def compile_circuit(circuit: ParamCircuit, *, backend: str = "auto") -> KernelProgram   # cached by IR hash
class KernelProgram:
    n_qubits: int; n_params: int; backend: str; ops: tuple[Op, ...]; stats: dict   # fused-op counts for the UI
    def states(self, values: Array) -> Array                                   # (B, m) -> (B, 2**n) complex
    def expectations(self, values: Array, observable: PauliSum) -> Array       # (B,)
    def value_and_grad(self, values: Array, observable: PauliSum) -> tuple[Array, Array]  # (B,), (B, m) — batched adjoint
# Unbatched convenience (stable names used by kernel/discovery):
def simulate(circuit, values, initial=None) -> np.ndarray
def expectation(circuit, values, observable) -> float
def value_and_grad(circuit, values, observable) -> tuple[float, np.ndarray]
def parameter_shift_grad(circuit, values, observable) -> np.ndarray   # reference/tests (2-term & 4-term rules)
MAX_STATEVECTOR_QUBITS = 20
```

- Use complex128 throughout (complex64 is opt-in per backend for GPU
  memory, and results report the dtype). There are no per-amplitude Python
  loops. Memory guard: refuse a batch when B·2ⁿ·16 bytes > 1 GiB, and split
  it into chunks automatically.
- Adjoint method: dC/dθ_gate = 2·Im⟨λ|G|φ⟩, batched over B, using the chain
  rule through `ParamRef.coeff` and summed over gates that share a
  parameter. Fused diagonal ops differentiate analytically: ∂/∂θₖ of the
  phase op is −i·gₖ elementwise.
- `reference.py` is the unfused, unbatched oracle (§4.1.1).
- **Tests:**
  - compiled (every backend present) ≡ reference to 1e-10;
  - adjoint ≡ parameter-shift ≡ central finite differences to 1e-8, on
    random circuits with shared and affine parameters, controlled
    rotations, U gates and diagonal runs, for n up to 8;
  - cross-checks against Qiskit `Statevector` and the Cirq simulator.
- **Performance targets (numpy backend, this container):**
  - batched value_and_grad for n = 12, 72 params, B = 256 in < 2 s;
  - n = 16, B = 64 in < 10 s.
  
  The measured numbers go in the docs.

### 5.4b Pauli Propagation Engine (`pauliprop.py`)

The design is in §4.1.2.

```python
def ppe_applicable(circuit: ParamCircuit, observable: PauliSum, *, init: str) -> tuple[bool, str | None]   # (ok, reason-if-not)
def ppe_gradient_variances(circuit, observable, *, max_weight: int | None = None, min_weight_abs: float = 1e-12,
                           max_frontier: int = 2_000_000, time_budget_s: float = 20.0,
                           progress=None, cancel=None) -> dict
# -> {"method": "pauli_propagation_exact"|"pauli_propagation_bounded",
#     "per_parameter": [{"name", "variance", "interval": [lo, hi]}], "variance_mean", "variance_mean_interval",
#     "frontier_peak": int, "discarded_mass": float, "elapsed_ms": int}
def ppe_expectation_bounds(circuit, observable, values, **budget) -> dict   # ⟨O⟩ at fixed params with truncation interval
```

Required tests:
- agreement with batched statevector sampling (within the 95% CI) on
  random Clifford+Pauli-rotation circuits for n ≤ 12;
- exact closed forms for a single rotation (Var = ½ for an anticommuting
  Pauli);
- the global-Z hardware-efficient ansatz whose variance decays as known;
- bounds that always contain the exact value when truncation is forced;
- the n = 64 and n = 128 local-observable shallow circuits finish within
  the budget.

### 5.5 Analyses (`analyses.py`, `lie.py`, `expressibility.py`, `scaling.py`, `landscape.py`, `lint.py`)

Every analysis is a pure function returning a JSON-ready dict. It takes a
`progress: Callable[[float, str], None] | None` and a
`cancel: Callable[[], bool] | None`, checked at least every 50 ms of work. It
uses `numpy.random.default_rng(seed)` only, so the same seed gives the same
output.

`gradient_statistics(circuit, observable, *, samples=200, seed=0, init='uniform') ->`
```json
{"samples": 200, "init": "uniform",
 "per_parameter": [{"name": "θ[0]", "mean": 0.0012, "variance": 0.031, "abs_mean": 0.14,
                    "variance_ci95": [0.027, 0.036]}],
 "variance_mean": 0.029, "variance_mean_ci95": [0.026, 0.033],
 "gradient_norm_mean": 0.81,
 "gate_values": [{"source_index": 3, "parameter": "θ[0]", "variance": 0.031, "abs_mean": 0.14}],
 "elapsed_ms": 412}
```
`init`: `uniform` is θ ~ U[0, 2π). `small` is θ ~ N(0, 0.1²). CIs are
percentile bootstrap (1000 resamples, seeded).

The output also carries `"method"`, `"backend"` and, for the PPE,
`"interval"` fields. `method="auto"` (the default) uses the PPE when
`ppe_applicable` holds and its bound is tight, else compiled batched
sampling. `method` can be forced to `"sampling"` or `"ppe"`. When the PPE
is used, `per_parameter[].variance_ci95` is the rigorous truncation
interval, not a bootstrap CI, and the UI labels it as such.

`scaling_study(build: Callable[[int, int], ParamCircuit], *, qubits: list[int], layers: list[int], observable_spec: str, samples, seed, init) ->`
```json
{"points": [{"n_qubits": 2, "n_layers": 4, "n_params": 16, "variance": 0.05, "variance_ci95": [0.04, 0.06]}],
 "fits": [{"n_layers": 4,
           "exponential": {"beta": 0.93, "beta_ci95": [0.81, 1.05], "log2_intercept": -1.1, "r2": 0.995, "aic": -12.3},
           "power_law":   {"alpha": 2.7, "alpha_ci95": [2.1, 3.3], "r2": 0.94, "aic": -4.0},
           "preferred": "exponential", "delta_aic": 8.3,
           "verdict": "barren_plateau",
           "summary": "Var[∂C] ∝ 2^(−0.93 n) (95% CI 0.81–1.05); exponential preferred over power law (ΔAIC 8.3)."}]}
```
Qubit ranges go up to 128 when the PPE applies at every point, and up to
`MAX_STATEVECTOR_QUBITS` otherwise; each point records its `method`. Fit by
weighted least squares on log₂(Var), with weights from the CI/interval
width. β's CI comes from a bootstrap over points. Verdicts:
`barren_plateau` if exponential is preferred by ΔAIC ≥ 2 and β's lower CI is
> 0.1. `polynomial` if power-law is preferred by ΔAIC ≥ 2, or β's CI includes
≤ 0.1. Otherwise `inconclusive`, which is also forced when there are fewer
than 4 distinct n values.

`lie_algebra(circuit, *, observable=None, max_dimension=4096, time_budget_s=10.0) ->`
```json
{"status": "complete" | "truncated" | "unsupported",
 "reason": null, "n_qubits": 4,
 "dimension": 28, "dimension_lower_bound": 28, "max_dimension": 255,
 "classification": {"label": "so(8)", "family": "so", "confidence": "exact_dimension_match", "note": "..."},
 "generators": {"count": 12, "unique": 7, "examples": ["X0", "Z0Z1"]},
 "fixed_gates": {"clifford": true, "handled_by": "clifford_conjugation" | "dense" | "none"},
 "purity": {"initial_state": 0.25, "observable": 1.0, "observable_in_algebra": true, "state_in_algebra": false},
 "predicted_variance": 0.0089, "prediction_applicable": true,
 "assumptions": ["Deep-circuit (approximate 2-design over e^𝔤) regime.", "𝔤 treated as simple; for reductive 𝔤 this is the leading term."],
 "simulability": {"kind": "g_sim_feasible" | "exponential_dla" | "unknown",
                  "summary": "dim 𝔤 = 28 = n(2n−1): free-fermion algebra. Expectations are classically simulable in poly(dim 𝔤) time (𝔤-sim, Goh et al. 2023)."},
 "elapsed_ms": 93}
```
- **Effective generators:** fixed gates are pushed to the end of the circuit,
  so each rotation generator is conjugated by the fixed gates *before* it
  (G̃ₖ = Vₖ† Gₖ Vₖ) and the observable by the full fixed product. With
  Clifford-only fixed gates this is symbolic Pauli conjugation (scales to
  n = 20). With non-Clifford fixed gates use a dense fallback for n ≤ 6, else
  `unsupported`.
- **Closure:** use the pure-Pauli-string fast path when every effective
  generator is a single Pauli string (the commutator of anticommuting
  strings is a string). Otherwise use the general Pauli-sum path
  (sparse-dict vectors, modified Gram–Schmidt with tol 1e-9). Hitting the
  cap or the time budget gives `truncated`, with `dimension_lower_bound`
  reported.
- **Classification by exact dimension match:** su(2ⁿ) = 4ⁿ−1;
  so(2ⁿ) = 2ⁿ⁻¹(2ⁿ−1); sp(2ⁿ⁻¹) = 2ⁿ⁻¹(2ⁿ+1); free-fermion so(2n) = n(2n−1);
  u(1)-like small algebras give `other`. The output always says that this
  is a dimension match, not an isomorphism proof.
- **g-purities and prediction** (Ragone et al., Nat. Commun. 15, 7172
  (2024)): with the orthonormal basis Bⱼ = Pⱼ/√2ⁿ,
  P_𝔤(O) = 2ⁿ Σ_{P∈𝔤} |c_P|² and P_𝔤(|0⟩⟨0|) = #{P ∈ 𝔤 : P ∈ {I,Z}^⊗n} / 2ⁿ.
  The prediction Var = P_𝔤(ρ)P_𝔤(O)/dim 𝔤 is marked applicable only when the
  observable or the state lies in 𝔤 (Pauli-string path; general path: when
  the projection residual is < 1e-9).
- **Known-result tests are required:**
  - {Xᵢ} ∪ {ZᵢZᵢ₊₁} on an open chain: dim = n(2n−1) for n = 2..6.
  - A real hardware-efficient ansatz (RY + **brickwork** CZ, n = 3): dim = 28 (so(8)).
    (Corrected after review: a plain *repeated* CZ ladder squares to the identity, so
    only two effective-generator sets exist and dim = 12; both cases are tested.)
  - {Xᵢ, Yᵢ} ∪ {ZᵢZᵢ₊₁}, n = 3: dim = 63.
  - A single Z generator: dim = 1.
  - The QAOA ring with shared parameters (general path): a nontrivial value
    that matches a dense brute-force closure for n = 4.

`expressibility(circuit, *, pairs=2000, bins=75, seed=0) ->`
```json
{"kl": 0.012, "kl_ci95": [0.009, 0.016], "pairs": 2000, "bins": 75, "dimension": 16,
 "histogram": [{"lo": 0.0, "hi": 0.0133, "observed": 0.12, "haar": 0.114}],
 "reference": {"idle_kl": 4.97, "note": "KL of a circuit that always outputs the same state (upper reference) at this bin count."}}
```
The Haar bin mass is computed exactly: (1−a)^{N−1} − (1−b)^{N−1}. The KL
uses observed frequencies with ε = 1e-10 smoothing on the observed side only
in the log ratio. The CI is a bootstrap over pairs.

`entangling_capability(circuit, *, samples=1000, seed=0) ->`
`{"mean", "std", "ci95", "histogram": [{lo,hi,count}], "haar_mean": (2ⁿ−2)/(2ⁿ+1)}`
(Meyer–Wallach Q = 2(1 − (1/n)Σ Tr ρₖ²)). Tests: product state 0, GHZ 1, and
the Haar sample mean within 3σ of the formula.

`landscape(circuit, observable, *, resolution=41, span=π, seed=0, center='random') ->`
`{"resolution", "span", "axis": [...], "values": [[...]] (row-major, y outer), "center": [...], "min", "max", "center_value"}`.
The directions are two Gaussian vectors made orthonormal with Gram–Schmidt.

`lint(circuit, observable | None, *, source_lines: dict[int,int] | None, time_budget_s=0.35) -> {"diagnostics": [...], "summary": {...}}`

Diagnostic:
```json
{"code": "TRN001", "severity": "warning", "title": "Global cost function",
 "message": "The observable acts on all 6 qubits. Global costs exhibit barren plateaus even for shallow circuits.",
 "citation": {"label": "Cerezo et al., Nat. Commun. 12, 1791 (2021)", "url": "https://doi.org/10.1038/s41467-021-21728-w"},
 "line": 14, "source_indices": [3, 7]}
```

Rules (each must be unit-tested, with a positive and a negative case):

| Code | Severity | Fires when |
|---|---|---|
| TRN001 | warning | an observable term has weight ≥ max(3, ⌈n/2⌉+1) and n ≥ 4 |
| TRN002 | warning | the DLA status is complete and the dimension matches su/so/sp(2ⁿ) for n ≥ 4 (exponential concentration expected) |
| TRN003 | info | the DLA dimension ≤ 4n² (polynomial): trainable but likely 𝔤-sim simulable |
| TRN004 | info | a parameterized gate's generator commutes with the observable after conjugation, and nothing after it changes that (it cannot affect the cost): a dead parameter |
| TRN005 | info | two consecutive rotations about the same axis on the same qubit with independent parameters (redundant) |
| TRN006 | info | the number of parameters ≥ dim 𝔤 (the overparameterization regime; Larocca et al., Nat. Comput. Sci. 3, 542 (2023)) |
| TRN007 | info | the circuit has no free parameters (Lab inactive; reported once in the summary, never as a marker) |

`summary`: `{"n_qubits", "n_parameters", "dla": {"status", "dimension"} | null, "observable": "<canonical text>" | null, "elapsed_ms"}`

### 5.6 Wire protocol (v1.3, trainability)

All new responses are flat `{"type": ...}`, following server conventions.
Errors use `{"type":"error","phase":"trainability","code","message", "job_id"?}`.

| Request | Response(s) | Mode |
|---|---|---|
| `trainability_inspect {code, language?, params?}` | `trainability_inspected {framework, n_qubits, parameters: string[], gate_count, param_gates: [{source_index, parameter, gate}], sweepable_params: string[], observable_declared: string \| null, notes: string[]}` | sync (in-process exec, like parse) |
| `trainability_lint {code, language?, observable?, params?}` | `trainability_lint_result {diagnostics, summary}` | sync, ≤ 0.5 s compute budget |
| `trainability_start {job_id, code, language?, observable, analyses: string[], settings}` | `trainability_started {job_id}` → `trainability_progress {job_id, analysis, fraction, message}` (≤ 10/s) → `trainability_partial {job_id, analysis, result}` per completed analysis → `trainability_result {job_id, status: "complete"\|"cancelled"\|"failed", results: {analysis: result}, errors: {analysis: {code, message}}, elapsed_ms}` | job |
| `trainability_cancel {job_id}` | `trainability_cancelled {job_id, accepted}` | sync |

- `analyses` ⊆ `["gradients","scaling","lie","expressibility","entanglement","landscape"]`.
- `settings` (all optional, clamped):
  - `samples` 16–4096 (200)
  - `seed` (0)
  - `init` `uniform|small`
  - `scaling: {qubits: int[] (2–128, ≤ 12 values; values above 20 require the PPE path, and a point fails with `ppe_required` otherwise), layers: int[] (≤ 4 values), qubit_param: "n_qubits", layer_param: "n_layers"}`
  - `method: "auto" | "sampling" | "ppe"`
  - `backend: "auto" | "numpy" | "cupy" | "jax"`
  - `expressibility: {pairs 100–20000 (2000), bins 75}`
  - `entanglement: {samples (1000)}`
  - `landscape: {resolution 11–81 (41), span (π)}`
  - `lie: {max_dimension (4096), time_budget_s (10)}`
- Observable resolution order: the request's `observable`, else the
  module-level `nuclei_observable` (str, `SparsePauliOp` or `cirq.PauliSum`)
  in user code, else `preset:local_z`.
- Scaling re-executes the user code with `params = {qubit_param: n,
  layer_param: L, **request.params}` and converts the found circuit.
- Jobs run in a **subprocess** (`kernel/trainability/job_worker.py`, launched
  as `sys.executable -I` with the repo root on `sys.path` via the same
  bootstrap as `agent_worker.py`, and a minimal explicit `env`). The
  subprocess streams JSON lines on stdout and is killed by process group on
  cancel, owner release, or the 20-minute wall limit. Limits: at most 2
  running jobs per owner and 4 globally; extra starts get an `error` with code
  `trainability_busy`. Statevector paths (sampling, expressibility,
  entanglement, landscape) are capped at `MAX_STATEVECTOR_QUBITS = 20`, and
  the default UI caps them at 14. PPE gradient paths go to 128 qubits.
- User code is the user's own (same trust as `execute`). It runs inside the
  job subprocess, not in the kernel process.

---

## 6. Kernel contract — `kernel/discovery/`

### 6.1 Sandbox (`candidate_worker.py`, `sandbox.py`)

- `candidate_worker.py` is a standalone script, launched as
  `sys.executable -I candidate_worker.py` with
  `start_new_session=True` and a minimal `env` (PATH, LANG,
  PYTHONNOUSERSITE=1, thread pins = 1, PYTHONHASHSEED=0).
- It applies `kernel.agent_limits.apply_worker_limits` (cpu_seconds from the
  request, clamped 1–60, default 20) and installs an import blocker: the
  `agent_worker` list plus `socket`, `ssl`, `http`, `urllib`, `requests`,
  `subprocess`, `multiprocessing`, `ctypes`, `cffi`, `webbrowser`,
  `smtplib`, `ftplib`, and `os.system`/`os.exec*`/`os.spawn*`/`os.fork`
  replaced with raisers. It is defense in depth and cooperative; the real
  boundary is the process.
- Request (stdin, strict JSON, ≤ 512 KiB):
  `{protocol_version: 1, task: "stim_circuit"|"quantum_circuit", program, entry, calls: [{"args": [...], "kwargs": {...}}], cpu_seconds}`.
- The worker execs `program` in a fresh namespace (`__name__ = "nuclei_candidate"`),
  looks up `entry`, and calls it once per call.
  - `stim_circuit` requires a `stim.Circuit` and emits `{"circuit_text": str(c)}`.
  - `quantum_circuit` requires a Qiskit `QuantumCircuit` or `cirq.Circuit`
    and emits `{"ir": from_object(c).to_json(), "framework"}`.
- Response (one JSON line on stdout, ≤ 4 MiB):
  `{protocol_version:1, status:"ok"|"error", artifacts:[{call_index, artifact}], stdout, stderr (each ≤ 64 KiB, truncated with a marker), error: {code, message} | null}`.
  Codes: `compile_error`, `entry_missing`, `entry_raised`,
  `bad_return_type`, `conversion_failed`, `protocol_error`.
- Supervisor side (`sandbox.py`): `run_candidate(request: dict, *, wall_seconds) -> dict`.
  It never raises. It adds codes `worker_timeout`, `worker_killed` (signal,
  e.g. CPU limit), `worker_no_output`, `worker_bad_output` and
  `response_too_large`. It kills the process group on timeout or cancel and
  supports a `cancel_event: threading.Event`.

### 6.2 Trusted scorer (`score_worker.py`, `evaluators/`)

- A trusted subprocess (same launch hygiene and rlimits, cpu 1–600 s) reads
  `{protocol_version:1, evaluator: {kind, config}, artifacts, seed}` and
  writes the evaluation dict (§6.4).
- Evaluators are registered in `evaluators/__init__.py`:
  `EVALUATORS: dict[str, EvaluatorSpec]`.
- `EvaluatorSpec` = `kind, version, title, description, task ("stim_circuit"|"quantum_circuit"), entry_signature (str), objectives: [{key,label,direction,unit?}], descriptors: [{key,label,min,max,default_bins}], config_schema (JSON Schema dict), default_config, calls(config) -> list[call], score(config, artifacts, seed, progress, cancel) -> EvaluationCore`.
- `fingerprint(kind, config) = sha256(evaluator source bytes ‖ canonical_json(config))`.
  Here *evaluator source* is the bytes of that evaluator's module and every
  `kernel/discovery/*.py` module it imports. Use the full 64-char hex.

### 6.3 Evaluators

#### `qec_memory` — "QEC memory experiment"
- **Entry:** `build(distance: int, rounds: int) -> stim.Circuit`. It must be
  **noiseless**, with ≥ 1 `OBSERVABLE_INCLUDE` and DETECTORs.
- **Config:**
  - `distances` (int[], 2–15, ≤ 4; default `[3, 5]`)
  - `rounds` (`"d"` or int ≥ 1; default `"d"`)
  - `noise: {model: "uniform"|"si1000"|"biased_z", p: 1e-4..0.05 (default 1e-3), bias (η, biased_z only, default 10)}`
  - `decoder: "pymatching"`
  - `shots: {min: 1000, max: 200000, max_errors: 200}`
  - `max_qubits` (default 200)
  - `allowed_gates` (default `["H","S","S_DAG","SQRT_X","SQRT_X_DAG","X","Y","Z","CX","CY","CZ","SWAP","R","RX","RY","M","MX","MY","MR","MRX","MRY","TICK","DETECTOR","OBSERVABLE_INCLUDE","QUBIT_COORDS","SHIFT_COORDS","REPEAT"]`).
- **Noise insertion (`noise.py`), applied by the evaluator to the flattened circuit**:
  - `uniform(p)`: DEPOLARIZE1(p) after each 1q Clifford; DEPOLARIZE2(p) after each 2q gate; X_ERROR(p) before Z-basis measurements (Z_ERROR before MX, Y-type flip before MY); X_ERROR(p) after resets (Z_ERROR after RX); DEPOLARIZE1(p) on qubits idle during a TICK layer that contains gates.
  - `si1000(p)` (Gidney–Newman–McEwen 2021): 1q p/10, 2q p, measurement flip 5p, reset flip 2p, idle p/10, and 2p resonator idle on qubits not measured or reset during a measure/reset layer.
  - `biased_z(p, η)`: as uniform, but single-qubit channels become PAULI_CHANNEL_1(px, py, pz) with pz = p·η/(1+η), px = py = p/(2(1+η)). 2q gates get DEPOLARIZE2(p/10) plus biased single-qubit channels on both qubits.
  - The docstring states every formula; each one is unit-tested by counting
    inserted instructions on small circuits.
- **Guardrails (in order; the first `fail` rejects):**
  1. `parse` — `stim.Circuit(text)` succeeds.
  2. `noiseless` — no noise channels (DEPOLARIZE*, X/Y/Z_ERROR, PAULI_CHANNEL*, E, ELSE_CORRELATED_ERROR, HERALDED_*, and M with a probability argument).
  3. `gate_set` — every instruction is in `allowed_gates`.
  4. `qubit_budget` — `num_qubits ≤ max_qubits`.
  5. `has_observable` — `num_observables ≥ 1` and every observable has ≥ 1 measurement target.
  6. `deterministic` — the noiseless reference detector and observable sample is all zero, and the noisy DEM builds without a non-determinism error.
  7. `duration` — the number of TICK-delimited layers that contain measurements is ≥ rounds.
  8. `decodable` — `detector_error_model(decompose_errors=True)` succeeds (graphlike for matching).
  9. `nontrivial_observable` — at least one error mechanism flips an observable.
  10. `fault_distance` — uses the budget policy of §4.1.4:
      - d ≤ 5: an exact `circuit.search_for_undetectable_logical_errors(dont_explore_detection_event_sets_with_size_above=4, dont_explore_edges_with_degree_above=4, dont_explore_edges_increasing_symptom_degree=False, canonicalize_circuit_errors=True)` under a 10 s budget;
      - d > 5, or a budget overrun: `len(shortest_graphlike_error())`, plus a pruned search under the remaining budget.

      Any logical error found with weight < the requested distance is a
      `fail` (that is cheating caught). Passing only under bounded search
      is a `warn` with "distance verified only up to the search bounds".
      The result is cached by the structural hash of the noisy circuit.
      This guardrail runs only in the `full` and `confirm` stages; `screen`
      reports it as `skipped (deferred to full stage)`.
- **Sampling:** `compile_detector_sampler(seed=derived_seed)` plus
  `pymatching.Matching.from_detector_error_model`. Sample in batches until
  `errors ≥ max_errors` or `shots ≥ max`, never fewer than `min`. This is
  deterministic for a given seed.
- **Statistics:** the per-shot LER has a Wilson 95% CI. The per-round
  conversion ε = (1 − (1 − 2P)^{1/r})/2 is applied to the point and both
  bounds (monotone). When P ≥ 0.5, report "saturated" and set ε = 0.5.
- **Objectives:** `logical_error_per_round` (minimize, the value at the
  largest distance) and `qubits` (minimize, at the largest distance).
  **Descriptors:** `qubits` (0..max_qubits, 8 bins) and
  `two_qubit_gates_per_round` (0..2000, 8 bins).
- **Fitness:** mean over distances of −log₁₀(max(ε_upper95, 1e-15)).
  Metrics: per-distance `{d, rounds, shots, errors, ler_shot, ler_round,
  ci95, fault_distance, qubits, detectors, two_qubit_gates}`, and
  `lambda = ε(d_small)/ε(d_large)` per consecutive pair with a propagated CI.

#### `state_synthesis` — "State preparation"
- **Entry:** `build(n_qubits: int)` returning a Qiskit `QuantumCircuit` or
  `cirq.Circuit` (optionally with free parameters).
- **Config:**
  - `target: {kind: "ghz"|"w"|"dicke"|"haar", n_qubits 2–12, k (dicke), seed (haar)}`
  - `fidelity_threshold` (default 0.999)
  - `cost: "two_qubit_gates"|"depth"|"t_count"` (default two_qubit_gates). Costs are measured after the canonical decomposition of §4.1.6, so composite gates are charged what they compile to.
  - `cost_weight` (0.1)
  - `allowed_gates` (IR names; default `["H","X","Y","Z","S","SDG","T","TDG","SX","RX","RY","RZ","CX","CZ"]`)
  - `optimize_parameters: {restarts: 8, steps: 300, learning_rate: 0.05}`
- **Guardrails:**
  - `ir_conversion` — elementary gates only. Opaque `initialize`,
    `StatePreparation`, unitary or isometry gates fail.
  - `gate_set`
  - `qubit_count` — exactly n.
  - `no_measurement`
  - `parameter_budget` — ≤ 128 parameters.
- **Scoring:** if the circuit has parameters, the evaluator itself maximizes
  fidelity with Adam on adjoint gradients (seeded restarts). F = |⟨target|ψ⟩|².
- **Fitness** = 10·min(F/F_thr, 1) − cost_weight·cost.
- **Objectives:** `infidelity` (min) and the cost (min). **Descriptors:**
  `two_qubit_gates` (0..64, 8 bins) and `depth` (0..64, 8 bins).

#### `vqe_ground_state` — "Variational ground state"
- **Entry:** `build(n_qubits: int)` returning a parameterized circuit
  (Qiskit or Cirq).
- **Config:**
  - `hamiltonian: {kind: "tfim"|"heisenberg"|"xxz"|"pauli", n_qubits 2–12, h (1.0), delta (xxz, 0.5), periodic (false), pauli (string, kind=pauli)}`
  - `training: {steps 200, restarts 4, learning_rate 0.05, init "uniform"|"small"}`
  - `trainability_prefilter: {enabled true, samples 64, min_variance 1e-5}`
  - `max_parameters` (200)
  - `cost_weight` (0.002 per parameter)
- **Exact E₀:** dense `eigh` for n ≤ 10; `scipy.sparse.linalg.eigsh` for
  n ≤ 12 when scipy is present, else the config is rejected.
- **Guardrails:** `ir_conversion`, `qubit_count`, `parameter_budget`,
  `has_parameters`, and `trainability_prefilter`. The prefilter uses
  `kernel.trainability.analyses.gradient_statistics`; variance_mean below
  min_variance rejects with "barren plateau at initialization". It also
  checks `variational_bound`: E_best ≥ E₀ − 1e-8, and a violation is
  `failed` (an evaluator bug), never scored.
- **Fitness** = −log₁₀(max((E_best − E₀)/max(|E₀|, 1e-12), 1e-12)) − cost_weight·n_params.
- **Objectives:** `relative_energy_error` (min) and `parameters` (min).
  **Descriptors:** `parameters` (0..max_parameters, 8 bins) and
  `two_qubit_gates` (0..128, 8 bins).
- **Metrics:** E_best, E₀, the training curve of the best restart
  (≤ 50 points), and the prefilter variance.

### 6.4 Evaluation record (wire and disk)

```json
{
  "candidate_id": "c-0007", "run_id": "20261018-141530-a3f9",
  "status": "scored" | "rejected" | "failed",
  "fitness": 3.42,
  "objectives": {"logical_error_per_round": {"value": 3.1e-4, "ci95": [2.8e-4, 3.5e-4], "direction": "minimize", "label": "Logical error / round"}},
  "descriptors": {"qubits": 49, "two_qubit_gates_per_round": 48},
  "metrics": {"per_distance": [ ... ], "lambda": [ ... ]},
  "guardrails": [{"id": "noiseless", "label": "Candidate emits noiseless circuits", "status": "pass", "detail": null}],
  "rejection": {"guardrail": "fault_distance", "message": "Requested d=5 but an undetectable logical error of weight 3 exists."} | null,
  "failure": {"stage": "sandbox" | "score", "code": "worker_timeout", "message": "..."} | null,
  "stdout": "", "stderr": "",
  "timings_ms": {"sandbox": 812, "score": 2290, "total": 3120},
  "evaluator": {"kind": "qec_memory", "version": "1.0.0", "fingerprint": "<64 hex>"},
  "seed": 1234,
  "stage": "screen" | "full" | "confirm",
  "program_key": "<64 hex: sha256 of ast.dump(normalized module)>",
  "cache_hit": false,
  "isolation": "process" | "bwrap" | "sandbox-exec",
  "compute": {"backend": "numpy", "method": "statevector_sampling" | "pauli_propagation_exact" | null}
}
```
`fitness` is null unless the status is `scored`. Guardrails not reached are
listed with `status: "skipped"`.

### 6.5 AST mutation baseline (`mutate.py`)

`mutate(program: str, *, start_marker, end_marker, seed: int, count: int, max_ops=3) -> list[{"program", "operators": [str], "description"}]`.

- Operators, applied only to statements fully inside the marked region:
  `perturb_constant` (floats ×U[0.5, 1.5], ints ±1 within [0, 64]),
  `swap_statements` (adjacent), `duplicate_statement`, `delete_statement`
  (never empties a block; inserts `pass` if needed), `swap_gate_method`
  (attribute calls among compatible groups: {h,x,y,z,s,sdg,t,tdg,sx},
  {rx,ry,rz}, {cx,cz,cy}, {rxx,ryy,rzz}; and the Stim string-literal ops
  `"CX"`↔`"CZ"`, `"H"`↔`"SQRT_X"` in `.append("…", …)` calls), and
  `change_index` (an int literal in a subscript or call arg, ±1, ≥ 0).
- Output must `ast.parse`, keep the markers and keep everything outside the
  region **byte-identical**. It is deterministic per seed. Use `ast` plus
  `ast.get_source_segment` and line-level splicing; never `ast.unparse` the
  whole file.

### 6.6 Manager and wire protocol (v1.3, discovery)

- `DiscoveryManager` is a module singleton with a `ThreadPoolExecutor`
  (`max_workers = max(1, min(4, os.cpu_count() - 1))`) and per-owner
  bookkeeping. Each job runs the sandbox subprocess, then the scorer
  subprocess. Cancel kills both (process groups), and owner release cancels
  everything the owner holds. There are at most 64 queued per owner; beyond
  that, `discovery_busy`.

| Request | Response(s) |
|---|---|
| `discovery_evaluators {}` | `discovery_evaluators_result {evaluators: [EvaluatorSpec as JSON: kind, version, title, description, task, entry_signature, objectives, descriptors, config_schema, default_config]}` |
| `discovery_evaluate {run_id, candidate_id, evaluator: {kind, config}, program, entry?, seed, stage?: "screen"\|"full"\|"confirm" (default "full")}` | `discovery_evaluate_accepted {run_id, candidate_id, queue_position}` → later `discovery_evaluation {run_id, candidate_id, evaluation}` |
| `discovery_cancel {run_id, candidate_id?}` | `discovery_cancelled {run_id, candidate_id, cancelled: int}`. Cancelled jobs still emit `discovery_evaluation` with status `failed` and code `cancelled`. |
| `discovery_mutate {program, start_marker?, end_marker?, seed, count}` | `discovery_mutations {mutations: [...]}` |

- **Cascade (§4.1.5):** each `EvaluatorSpec` declares `stages: {screen: {...config overrides}, full: {}, confirm: {...}}`.
  - `qec_memory` screen: `shots {min: 1000, max: 5000, max_errors: 50}`, fault distance deferred.
  - `state_synthesis` screen: `optimize_parameters {restarts: 1, steps: 60}`.
  - `vqe_ground_state` screen: `training {restarts: 1, steps: 50}`, prefilter samples 32.
  
  The *runner* decides promotion. The kernel evaluates the stage it is
  asked for.
- **Cache:** an in-kernel LRU of 512 entries keyed by
  `(program_key, fingerprint, seed, stage)`. A hit returns the stored
  evaluation with `cache_hit: true` and new timings. The frontend also
  skips proposals whose `program_key` it has already evaluated in the run,
  recording a `duplicate` proposal.
- Errors: `{"type":"error","phase":"discovery","code","message","run_id"?,"candidate_id"?}`.
  Invalid evaluator config is answered with an `error` with code
  `invalid_config` (validated with `jsonschema` when available, else by
  hand).

---

## 7. Frontend contract

### 7.1 Shared plumbing (pre-wired by the lead; do not restructure)

- Rail views `'trainability'` (label "Trainability Lab", `Microscope`) and
  `'discovery'` (label "Discovery Engine", `Dna`). Both are Research-only and
  both are main-area takeovers. They are registered in
  `src/layout/panelRegistry.ts`, `ActivityBar.tsx`, `Sidebar.tsx` and
  `PanelLayout.tsx`.
- `src/services/lab/labSession.ts` exports
  `openLabSession(platform): Promise<LabSession>` (multi-subscriber,
  `send/subscribe/close`) and `labAvailability(platform)`.
- Protocol types live in `src/types/trainability.ts` and
  `src/types/discovery.ts`, and are added to the
  `KernelMessage`/`KernelResponse` unions in `src/types/quantum.ts`.
- The design system lives in `src/components/lab/` (`lab.css` plus React
  primitives) — **all PRD 14 UI must use it.**

### 7.2 Lab design system (`src/components/lab/`)

A precision-instrument aesthetic that themes correctly in light and dark
because it is built only on app tokens (`--color-*`, `--space-*`,
`--radius-*`, `--font-*`, `--duration-*`, `--ease-*`) plus Lab data-viz
tokens defined in `lab.css` for both themes:

- `--lab-seq-0..8`: a sequential heatmap ramp, perceptually ordered.
- `--lab-div-neg/mid/pos`: a diverging ramp.
- `--lab-cat-1..6`: categorical colors for islands and mutators.
- `--lab-grid`, `--lab-axis`: chart chrome.

Rules:
- No hard-coded hex colors in components.
- Numbers use `font-variant-numeric: tabular-nums` in mono.
- Section labels are 10–11 px, uppercase, letter-spacing 0.06em, tertiary
  text.
- Cards are a raised surface with a 1 px subtle border and `--radius-soft`.
- Focus rings are visible.
- `prefers-reduced-motion` is honored.
- Interactive targets are ≥ 28 px tall (≥ 32 for primary actions).
- Every chart has an accessible name and a text summary.
- Empty, loading (shimmer skeleton) and error states are designed; there is
  never a blank box.

Primitives (exports): `LabShell`, `LabToolbar`, `LabCard`, `LabSectionLabel`,
`LabKpi`, `LabKpiStrip`, `LabPill` (tones: neutral/quantum/success/warning/danger/dirac),
`LabButton` (variants: primary/secondary/ghost/danger; sizes sm/md),
`LabSegmented` (tabs), `LabMeter`, `LabEmptyState`, `LabSkeleton`,
`LabProgress`, `LabTooltip` (portal), `LabDrawer` (slide-over),
`LabField` (label, input, hint, error), `LabSelect`, `LabNumber`, `LabCode`
(mono block), `LabCitation`, and chart helpers in `charts.tsx`: `ChartFrame`
(axes, gridlines, ticks, log scales, crosshair, tooltip), `formatSci`,
`formatPct`, `seqColor(t)`, `catColor(i)`.

### 7.3 Trainability (owner: Frontend-Microscope)

- Files: `src/types/trainability.ts` (protocol types are pre-written; extend
  with UI types), `src/services/trainability/*` (client, observable presets,
  lint→marker mapper, context builder), `src/stores/trainabilityStore.ts`,
  `src/components/trainability/*`, and the Monaco marker effect in
  `QuantumEditor.tsx` (owner `'trainability'`, Research mode only,
  debounced 800 ms, only when the inspect step found parameters). Also the
  research branch in `useDirac.buildContextBlock` (Research only, guarded the
  same way as the experiments context).
- The heatmap circuit is a new component (fork `RunCircuitDiagram`). It must
  not mutate `circuitStore`.

### 7.4 Discovery (owner: Frontend-Engine)

- `*.discovery.yaml` (schema 1), validated with zod in `src/types/discovery.ts`:

```yaml
schema: 1
type: discovery
name: w-state-synthesis
description: Find a W-state preparation with fewer CNOTs.
program: discovery/w_state.py          # project-relative seed program
entry: build
evaluator:
  kind: state_synthesis
  config: { target: { kind: w, n_qubits: 5 }, fidelity_threshold: 0.999 }
search:
  islands: 3                     # 1–8
  generations: 25                # 1–500
  candidates_per_generation: 6   # 1–32
  archive: { descriptors: [two_qubit_gates, depth], bins: [8, 8] }   # descriptor keys from the evaluator
  migration_interval: 5          # generations; 0 disables
  exploration: 0.15              # probability of a random elite parent
  early_stop_patience: 10        # generations without best-fitness improvement; 0 disables
evaluation:
  cascade: true                  # screen → full only when promising (§4.1.5)
  promote_if: island_median      # island_median | island_best | always
mutator:
  kind: hybrid                   # llm | ast | hybrid
  llm_share: 0.75                # hybrid only
  models:                        # AlphaEvolve-style ensemble: many cheap broad edits + some deep ones
    breadth: haiku               # haiku | sonnet | opus → src/config/dirac.ts ids
    depth: opus
    depth_share: 0.2             # fraction of LLM proposals sent to the depth model
    depth_thinking: true         # extended thinking on depth calls
  batch_mode: false              # true → Message Batches API (async, cheaper); for unattended overnight runs
  inspirations: 2
budget:
  max_evaluations: 200
  max_llm_calls: 160
  max_wall_minutes: 90
  max_concurrent_evaluations: 3
confirm: { seeds: 3 }            # champion re-evaluation on fresh seeds at the end
seed: 7
notes: free text
```

- **Evolve region markers** in the program: `# EVOLVE-BLOCK-START` and
  `# EVOLVE-BLOCK-END`. If absent, the whole file is the region (with a
  warning in the UI).
- **On-disk layout (file-first, git-friendly):**
```
experiments/
├── w-state-synthesis.discovery.yaml
└── w-state-synthesis/discovery/<runId>/
    ├── run.json                 # config snapshot, evaluator fingerprint, status, budget usage, champion id, archive snapshot, rng state
    ├── candidates/<candidateId>.json   # {id, parent_id, island, generation, mutator, program, program_sha256, llm: {model, rationale, expected_effect, edits, usage, prompt_sha256} | null, ast_ops, evaluation, created_at}
    └── champion.py              # written when the run completes or on Promote
```
  `runId` = `timestampSlug(start)-<4hex>`; candidate ids are `c-0000`
  (seed), `c-0001`, and so on. Writes go through `PlatformBridge`, so they
  work on desktop, web, and the e2e fixture bridge. Resume loads `run.json`
  plus all candidate files and continues deterministically: the RNG state is
  persisted, and candidates without an evaluation are re-queued.
- **Search (pure, unit-tested, in `src/services/discovery/`):**
  - `rng.ts` — seeded xoshiro128** with a serializable state.
  - `archive.ts` — per-island MAP-Elites grids. A cell keeps the
    highest-fitness elite; ties go to fewer cost, then the earlier
    candidate. There is also a global Pareto front over the evaluator's
    objectives (non-dominated sort and crowding distance for display).
  - `selection.ts` — the parent is chosen with probability `exploration`
    from a uniform random elite on the island, else by a size-3 tournament
    on fitness. Inspirations are the top-k global elites from other cells,
    deduplicated by program hash. Migration happens every
    `migration_interval` generations: each island's best is copied to the
    next island (ring).
  - `diff.ts` — parses and applies the LLM's SEARCH/REPLACE edits. Each
    `search` must match exactly once and lie fully inside the region. It
    rejects edits that touch the markers or outside text, and it is
    idempotent-safe.
  - `prompt.ts` — builds the system and user prompts. The system prompt
    carries the research persona, the task, the evaluator description with
    objectives and descriptors, the guardrails list (so the model knows what
    is checked), and the rules: edit only inside the block; never add noise;
    never read or hardcode evaluator internals; small, testable hypotheses.
    The user prompt carries the parent program, its evaluation summary, 1–3
    inspirations with scores (truncated with explicit "N of M lines"), the
    top recent rejection reasons, and the generation/island context. It
    uses `cache_control: {type: "ephemeral"}` on the system block.
  - `llmMutator.ts` — calls the Claude Messages API (key from `useDiracStore`,
    the same headers as `compose.ts`) with the forced tool
    `propose_program_edit {rationale: string ≤ 800, expected_effect: string ≤ 300, edits: [{search, replace}] (1–8)}`.
    It records `usage` and never throws. No key means the hybrid falls back
    to AST with a visible notice, and `llm` mode refuses to start with a
    clear message.
    It routes each proposal to the breadth or depth model per
    `mutator.models` (deterministic from the run RNG) and enables extended
    thinking on depth calls when configured. In `batch_mode` it submits a
    generation's prompts through the Message Batches API and polls,
    persisting batch ids so that a resumed run reattaches.
  - `runner.ts` — `runDiscovery(spec, ctx, deps, opts)`, dependency-injected
    (`session`, `fs`, `llm`, `clock`, `hash`), with pause / resume / stop.
    Each generation proposes `candidates_per_generation` children across
    islands round-robin and evaluates them with
    `max_concurrent_evaluations` in flight. Budgets are enforced before
    every proposal. With `evaluation.cascade`, every child is evaluated at
    `stage: "screen"` first. It is promoted to `full` only when its
    optimistic screen bound beats `promote_if` (the island median by
    default), and only `full`/`confirm` evaluations can enter the archive.
    Screen-only candidates are kept in the lineage, marked "screened out".
    Early stop applies. At the end, the confirmation step
    re-evaluates the champion on `confirm.seeds` fresh seeds and reports the
    mean ± CI as the **confirmed** objective. Every state change is
    persisted; the runner survives the panel unmounting because it is owned
    by `discoveryStore`, not by a component.
- **Templates** (`src/services/discovery/templates.ts`) give three complete
  seed programs plus YAML, and each seed must pass its evaluator's
  guardrails:
  1. `qec-repetition-schedule` — a hand-written repetition-code memory
     builder `build(distance, rounds)` (bit-flip code, CX schedule in the
     region) under `si1000`.
  2. `w-state-synthesis` — a naive W-state builder (cascade of controlled
     rotations) for n = 5.
  3. `tfim-ansatz` — a hardware-efficient RY/CZ ansatz for the n = 6 TFIM
     (h = 1).

### 7.5 Tests (required)

- **Kernel:** every module in §5 and §6 has unit tests, including the
  known-result tests listed above and adversarial cheating candidates for
  every guardrail (each must be rejected *by that guardrail*). The sandbox
  tests cover a timeout, a CPU kill, a blocked import, a huge stdout, a
  non-JSON-serializable return, and an entry that raises. Handler tests use
  the `StreamingWS` pattern from `test_qec_campaign.py`. Deterministic
  outputs need docs fixtures where practical.
- **Frontend:** schema parsing (valid, invalid, defaults); archive,
  selection, Pareto, rng and diff (including the outside-region rejection
  and the multi-match rejection); prompt snapshot; runner end-to-end with a
  fake session, fake LLM and in-memory fs (full run, budget stop, early
  stop, pause/resume, resume from disk, cancel); stores; jsdom render tests
  for every panel with seeded state (empty, loading, populated, error); and
  the lint→marker mapper.
- **E2E:** a Playwright spec per view against a stubbed kernel (the
  WebSocket replacement pattern) for CI, plus a manual real-kernel run with
  screenshots at 1440 and 1024 in light and dark.

---

## 8. Docs

- `docs-site/src/content/docs/research/trainability-lab.mdx`
- `docs-site/src/content/docs/research/discovery-engine.mdx`
- `docs-site/src/content/docs/kernel-api/messages-lab.mdx`
- the protocol changelog entry for v1.3
- the CLAUDE.md sections "Trainability Lab", "Discovery Engine" and "Kernel
  Protocol v1.3"
- the navigating-the-workspace binding table update

## 9. Out of scope (v1)

- The Referee / advantage audit (classical baselines, dequantization
  surrogates).
- Hardware evaluation inside the engine.
- Distributed evaluation.
- Learned decoders.
- A Pyodide execution path for the Lab.
- A native Rust statevector kernel (deferred per §4.1.8).
- Evolving the prompts themselves (AlphaEvolve's meta-prompt evolution) —
  a v2 candidate once the run journal has enough data.

## 9b. Build order and verification gates

1. **Compute core:** IR, converters, adapter change, the reference oracle,
   the Lab Compiler (numpy backend first, then the cupy/jax lowering
   behind availability checks) and the PPE.
   *Gate:* compiled ≡ reference; adjoint ≡ parameter-shift; PPE ≡ sampling
   within CI; the §5.4 performance targets are met.
2. **Analyses + lint + jobs** (§5.5–5.6).
   *Gate:* the known-result tests; the barren-plateau scaling verdict test
   at n = 2..10 by sampling **and** to n = 64 by the PPE.
3. **Discovery kernel:** sandbox, scorer, the three evaluators with
   stages, the cache, canonical cost, the isolation probe and the AST
   mutator.
   *Gate:* every guardrail has a cheating candidate rejected by exactly
   that guardrail; sandbox abuse tests; surface code d = 3 → 5 shows Λ > 1.
4. **Frontend:** the Trainability Lab, then the Discovery Engine
   (schema, search, cascade orchestration, ensemble mutator, runner,
   UI).
   *Gate:* unit + jsdom suites; Playwright stubbed-kernel specs;
   real-kernel screenshots at 1440/1024 in light and dark, reviewed
   against the design-system rules.
5. **Integration + independent review:** Dirac context, the status chips,
   the mode-switch guard, docs. Then adversarial reviews: research
   correctness, red-teaming the evaluators, code review, UI review. Fix
   until clean.

## 10. File ownership for the parallel build

| Owner | Exclusive files |
|---|---|
| Kernel-Microscope | `kernel/trainability/**`, `kernel/tests/test_trainability_*.py`, `kernel/adapters/qiskit_adapter.py`, `kernel/adapters/cirq_adapter.py`, `kernel/models/snapshot.py` (+ their existing tests) |
| Kernel-Engine | `kernel/discovery/**`, `kernel/tests/test_discovery_*.py` |
| Frontend-Microscope | `src/components/trainability/**`, `src/services/trainability/**`, `src/stores/trainabilityStore.ts`, `src/types/trainability.ts` (extend only), the trainability effect in `QuantumEditor.tsx`, the trainability branch in `useDirac.ts` |
| Frontend-Engine | `src/components/discovery/**`, `src/services/discovery/**`, `src/stores/discoveryStore.ts`, `src/types/discovery.ts` (extend only), the discovery branch in `useDirac.ts`, the status-bar chip + mode-switch guard for discovery |
| Lead | `kernel/server.py`, `kernel/lab_context.py`, `src/layout/**`, `src/components/layout/**`, `src/components/lab/**`, `src/services/lab/**`, `src/types/quantum.ts`, docs, CLAUDE.md |

Anyone who needs a change in a file they don't own reports it to the lead
and does not edit it.
