# PRD 15 — Spec 03: Symmetry Compiler and Train‑Quantum / Deploy‑Classical Export

Status: v2 for implementation (2026‑10‑19, revised after the physics and engineering review — see master §10). Branch `feat/prd15-quantumness-lab`, based on v0.14.1.
Depends on PRD 14 (`docs/research/PRD_14_QUANTUM_AI_LAB.md`, `PRD_14_ADDENDUM.md`). Protocol: Lab messages **v1.4** (additive to v1.3).

> **Master-plan resolution (2026-10-19).** This spec is governed by `docs/research/PRD_15_QUANTUMNESS_LAB.md` §4.3 and §7: the Fourier/RFF/shadow fitters and the frequency-lattice code live in `kernel/surrogates/` (owned by spec 01's unit Q3; `kernel/deploy/spectrum.py` and `kernel/deploy/surrogates/` are thin re-exports), the dataset loader is `kernel/trainability/dataset.py` and the declaration reader `kernel/trainability/declarations.py` (both F-1), `PROTOCOL_VERSION = "1.4"` and the lab message router (`kernel/lab_routes.py`) are owned by the Wave 1 foundations unit F-1, settings/analysis/handler/palette/Dirac/e2e-fixture extensions go through registries instead of shared-file edits, and the units below map onto the master waves as stated in §9. Learn mode is deprecated; nothing here touches it.

This spec covers two features:

- **Idea 5 — Symmetry compiler** (`kernel/symmetry/`, `src/components/symmetry/`): declare a symmetry, get an equivariant ansatz, an exact symbolic equivariance certificate, before/after DLA + trainability, and framework code back in the editor.
- **Idea 6 — Train quantum, deploy classical** (`kernel/deploy/`, `src/components/deploy/`): export a trained model as a QPU‑free classical surrogate (Fourier series, classical‑shadow “flipped” model, or data‑only regression) with an honest held‑out validation report and provenance linked to the training certificate.

Both reuse the PRD 14 IR (`kernel/trainability/ir.py`), Pauli algebra (`pauli.py`, `symplectic.py`, `_symplectic_frame.py`), statevector backend (`statevector.py`, `backends.py`), PPE (`pauliprop.py`), Lie closure (`lie.py`, `lie_core.py`), job plumbing (`kernel/lab_proc.py`, `trainability/jobs.py`), provenance (`provenance.py`) and the Lab design system (`src/components/lab/`). Nothing in this spec reinvents those.

Table of contents

1. Motivation and novelty
2. Idea 5 — math, algorithms, validity regimes
3. Idea 6 — math, algorithms, validity regimes
4. Kernel design (modules, data structures, limits)
5. Protocol v1.4 (messages, shapes, error codes)
6. Frontend / UX
7. Validation plan
8. Acceptance criteria
9. Implementation units and file ownership
10. Cross‑spec interfaces
11. Risks and open questions
12. References

---

## 1. Motivation and what is genuinely new

### 1.1 Why

PRD 14 made Nuclei the only IDE that *diagnoses* trainability (gradient variance with rigorous truncation intervals, DLA dimension and the Ragone prediction, scaling verdicts). It does not yet *fix* an untrainable ansatz, and it does not help after training is done. Two of the best‑supported remedies in the literature are:

- **Build the problem's symmetry into the ansatz.** Equivariant QNNs shrink the DLA (Nguyen et al. 2024; Schatzki et al. 2024 prove S_n‑equivariant QNNs have a polynomial DLA and no barren plateaus), improve generalisation (Meyer et al. 2023; Larocca et al. 2022) and reduce parameter count (Sauvage et al. 2024). Today a researcher does this by hand, with error‑prone twirling calculations, and never verifies the result.
- **Deploy without a QPU.** Jerbi et al. (2024) show “shadow models” that need quantum hardware only during training; Schreiber, Eisert and Meyer (2023) show many PQC models admit *classical surrogates* via their Fourier structure; Landman et al. (2023) and Sweke et al. (2025) characterise when random Fourier features dequantise variational QML. No tool turns a trained circuit into a validated classical artifact with an error report.

### 1.2 What is new (versus tools and literature)

| Capability | Prior art | New in Nuclei |
|---|---|---|
| Twirling a gate set | Done by hand or with dense `2^n×2^n` matrices (Meyer et al. supplementary code; PennyLane `qml.symmetry`‑style demos) | **Symbolic twirl in the Pauli algebra** (orbit enumeration for permutation/Pauli groups, Krylov‑subspace commutant projection for Lie generators). No `2^n` objects; works to the IR limit (256 qubits). |
| Verifying equivariance | Numerical, small n | **Exact symbolic equivariance certificate**: every compiled generator is conjugated through the existing `CliffordFrame` for each group generator and checked for **equality** (the centraliser condition `U R(g) U† = e^{iφ} R(g)`, never mere group membership); Lie brackets are computed exactly in the Pauli algebra. A dense n ≤ 5 operator check asserts every `exact` certificate; statevector is an independent cross‑check at n ≤ 20. |
| Effect of symmetry on trainability | Papers report it for specific ansätze | **Before/after DLA + gradient variance on the user's own circuit**, with the same honest intervals as PRD 14, plus the Cerezo‑et‑al. caveat surfaced in the UI: a polynomial DLA can mean classical simulability (handed to the Spec 01 Quantumness certificate), and a **symmetry-sector check** that refuses to "compile" into a 1-dimensional sector (where every equivariant circuit acts as a phase and all gradients vanish) and warns when the reachable sector is polynomial (Anschuetz, Bauer, Kiani & Lloyd 2023). |
| Round trip to the user's framework | None | Emitted Qiskit/Cirq is re‑executed in the job sandbox and converted back to IR; the UI shows “round‑trip verified” only when the IR matches gate‑for‑gate. PennyLane text is emitted but explicitly labelled unverified. |
| Classical surrogate export | Research code per paper | Three routes with **stated validity**: (a) exact‑spectrum Fourier surrogate (exact for statevector‑evaluable models, DFT on the Schuld–Sweke–Meyer frequency lattice), with **PPE truncation intervals propagated to every Fourier coefficient** when the model is too wide for statevector; (b) classical‑shadow surrogate of flipped models with median‑of‑means error bars from the Huang–Kueng–Preskill bound; (c) data‑only regression when the model cannot be evaluated here, labelled as regression, not certificate. |
| Provenance | Certificates per PRD 14 | The export's JSON carries the SHA‑256 of the training certificate, the model, and the exported weights; the emitted `.py` self‑tests against embedded held‑out vectors. |

### 1.3 Honesty principles (inherited from PRD 14, non‑negotiable)

- No midpoint‑of‑interval numbers. Intervals are shown as intervals.
- Every route states the regime in which it is valid, and says **not applicable** or **inconclusive** outside it.
- “Equivariant” is claimed only after an exact check passes. Trotterised non‑commuting twirls are reported with their measured residual and never labelled exact.
- A surrogate's accuracy is reported on held‑out data the fit never saw, with a bootstrap interval. A fit to the user's own QPU data is a regression, not a guarantee.

---

## 2. Idea 5 — Symmetry compiler: math and algorithms

### 2.1 Setting and definitions

Let the user's circuit be the IR object `U(θ) = Π_k exp(−i a_k θ_{j(k)} G_k) · (fixed gates)` with Pauli‑sum generators `G_k` (from `GateSpec.generator`), initial state `|0…0⟩`, observable `O` (a `PauliSum`), and cost `C(θ) = ⟨0|U(θ)† O U(θ)|0⟩`.

A **symmetry declaration** is a finite list of *symmetry components*; each component is one of:

| kind | representation `R(g)` | internal form |
|---|---|---|
| `permutation_group` | qubit permutation operators (SWAP networks) | generators as permutations of `range(n)`; presets `s_n`, `cyclic`, `dihedral`, `reflection`, `custom` |
| `pauli_group` | the finite group generated by Pauli strings (e.g. global spin flip `X_0X_1…X_{n−1}`, `Z_2` parity) | generators as Pauli strings |
| `lie` | the connected Lie group `exp(span{−iK_a})` generated by Hermitian Pauli sums `K_a` (e.g. `U(1)`: `K = Σ_i Z_i`; `SU(2)`: `K ∈ {ΣX_i, ΣY_i, ΣZ_i}`) | generators as `PauliSum` |

Presets: `s_n`, `cyclic` (translation on a ring), `dihedral` (translation + reflection), `reflection` (`i ↦ n−1−i`), `z2_flip` (`X^{⊗n}`), `u1_charge` (`Σ Z_i`), `su2_spin` (collective `ΣX, ΣY, ΣZ`). Custom components give explicit generators. A declaration with several components means the group generated by all of them.

**Equivariance** (Nguyen et al. 2024, Def. 1): a unitary `U` is `G`‑equivariant iff `[U, R(g)] = 0 ∀ g ∈ G`. For `U = exp(−iθH)`, this holds for all θ iff `[H, R(g)] = 0 ∀g`, i.e. `H` is in the **commutant** of the representation. A Lie group component with generators `K_a` gives the equivalent condition `[H, K_a] = 0 ∀a`.

**Invariance** of the cost requires in addition `R(g) O R(g)† = O` (observable invariant) and `R(g)|ψ_0⟩ = e^{iφ_g}|ψ_0⟩` (initial state invariant up to phase). Nuclei checks all three and reports them separately; it never claims a symmetric *cost* when only the ansatz is equivariant.

### 2.2 The twirl as a projector onto the commutant

For a finite group component, the **twirl** `T_G[H] = (1/|G|) Σ_g R(g) H R(g)†` is the orthogonal projector (in the Hilbert–Schmidt inner product) onto the commutant (Meyer et al. 2023, Eq. 9; Mele 2024 §4). For a connected Lie group component, Haar twirling equals the projector onto `∩_a ker(ad_{K_a})`; we compute that projector directly rather than integrating.

Nuclei works entirely in the Pauli basis. For a Pauli sum `H = Σ_P h_P P`:

**Permutation and Pauli groups — orbit averaging.** Conjugation by a permutation or Pauli operator maps a Pauli string to ± another Pauli string, so `T_G[P] = (1/|G|) Σ_g s_g(P) · g(P)`. Grouping by orbit, `T_G[P] = (1/|orb(P)|) Σ_{Q ∈ orb(P)} s̄_Q Q` where `s̄_Q` averages the signs of the group elements mapping `P ↦ Q` (sign averages to 0 when `P` is mapped to `−P` by some stabiliser element — the “killed” case). Orbits are enumerated by BFS over the generators (not over the group), which never materialises `|G|`:

- `s_n`: the orbit of a string is exactly the set of strings with the same multiset of letters; its size is the multinomial `n! / (n_I! n_X! n_Y! n_Z!)`. Nuclei enumerates it only when it is `≤ MAX_ORBIT` (65 536); otherwise it reports `symmetry_too_large` for that generator and suggests orbit‑sharing (§2.4) which only needs the orbit of the *gate*, i.e. the same size — so for `s_n` with high‑weight generators the honest answer is “use a low‑weight gate set”, which the UI says.
- `cyclic`/`dihedral`/custom permutations: BFS, orbit size `≤ |G|` (≤ `2n` for dihedral).
- Pauli groups: conjugation by a Pauli string only flips signs: `Q P Q† = ±P`. The twirl keeps `P` iff it commutes with every generator; otherwise it is killed. Closed form, O(|generators|·weight).

**Lie components — Krylov commutant projection.** `[H, K_a]` for Pauli sums is a Pauli sum (`_herm_bracket` in `lie_core.py`). Starting from the support `S_0 = {P : h_P ≠ 0}`, grow `S = S_0 ∪ ad_{K_a}(S) ∪ …` until closure (BFS with a cap `MAX_KRYLOV = 4096` strings). Within `span(S)` (an invariant subspace of every `ad_{K_a}`), build the real matrix `A = [M_1; M_2; …]` stacking the `ad_{K_a}` matrices in the Pauli basis of `S` (they are real and antisymmetric because `i[P,Q]` of Hermitian Paulis is Hermitian with real coefficients), and project `h` onto `ker A` by `h_⊥ = h − A⁺ A h` using an SVD of `A` (numpy `lstsq`/`svd`; `S` is small because collective generators preserve support and weight: for `Σ Z_i` the orbit of a weight‑w string has at most `2^w` strings; for `su(2)` at most `4^w`). The result is the exact HS‑orthogonal projection onto the commutant, equal to the Haar twirl.

Example (verified in tests): `su2_spin` on two qubits, `H = X_0X_1 ↦ (X_0X_1 + Y_0Y_1 + Z_0Z_1)/3`; `u1_charge`, `H = X_0X_1 ↦ (X_0X_1 + Y_0Y_1)/2`; `H = Z_0 ↦ Z_0`.

**Composite declarations.** Finite components commute with the Lie projection only when the two groups commute (e.g. `s_n` and `su2_spin` do, by Schur–Weyl). Nuclei applies finite twirls first, then Lie projections, then **re‑checks** every finite invariance; if a re‑check fails it iterates (alternating projections, ≤ 8 rounds) and reports `twirl_not_converged` if the residual (max |coefficient change|) stays above `1e‑10`. Alternating projections onto subspaces converge to the projection onto the intersection, so a non‑converged result is a budget failure, never a wrong answer.

### 2.3 Strategy A — generator twirl (`strategy: "twirl"`)

For each parametric IR gate with generator `G_k` on its qubits (identity components dropped):

1. `H_k = T[G_k]` (§2.2). If `‖H_k‖ < 1e‑12` the gate is **killed**: it is dropped and the parameter noted as removed (Meyer et al. observe this is common for single‑qubit gates under `s_n`; the UI explains why).
2. `H_k` is a Pauli sum `Σ c_P P`. Nuclei must realise `exp(−i a_k θ H_k)`:
   - **Commuting terms** (`[P, Q] = 0` for all pairs; checked symbolically): `exp(−iθ Σ c_P P) = Π_P exp(−iθ c_P P)` exactly. Each factor becomes an IR Pauli rotation with `ParamRef(name, coeff = 2·a_k·c_P)` (because `R_P(φ) = exp(−iφP/2)`). Weight‑1 and weight‑2 single‑letter strings map to `RX/RY/RZ/RXX/RYY/RZZ/RZX`; everything else is synthesised with the standard basis‑change + CX ladder + `RZ` + unladder (Clifford fixed gates — so the Lie closure keeps its exact `CliffordFrame` path). Exact; labelled **exact**.
   - **Non‑commuting terms**: `options.noncommuting` decides. `"reject"` → `noncommuting_twirl` error naming the gate and the offending pair. `"trotter"` → first‑order product with `r = options.trotter_steps` repetitions, angle `θ/r` each. The compiled circuit is then **not exactly equivariant**; the verifier measures the residual (§2.6) and the UI labels the result *approximately equivariant (Trotter r=…, residual …)*. `"dense"` is not offered: the IR has no arbitrary‑unitary gate, and PRD 14's exact Lie paths would be lost.
3. Shared parameters: gates that already share a `ParamRef` keep sharing it after twirling (their twirled generators are summed by the Lie analysis exactly as before).
4. Fixed (non‑parametric) gates are **not** twirled (twirling a unitary is not unitary). They are classified: a fixed gate that is itself equivariant — `U_fixed R(g) U_fixed† = e^{iφ} R(g)` for **every** group generator g, checked symbolically for Cliffords as an *equality* of the conjugated and original representations (§2.6; membership of the conjugate in the group is **not** sufficient — a single SWAP(0,1) under `s_n` maps every permutation to a permutation yet is not S_n‑equivariant), densely for non‑Cliffords with `n ≤ 12` — is kept; a non‑equivariant fixed gate (e.g. a single CX on a ring) breaks equivariance, and Nuclei offers **orbit expansion** (`options.fixed_gates: "expand_orbit" | "keep" | "drop"`): replace it by the product over its group orbit when that product is well defined (all orbit images commute). Otherwise the compile fails with `fixed_gate_breaks_symmetry` and the gate's source line.

### 2.4 Strategy B — orbit sharing (`strategy: "orbit_sharing"`, Sauvage et al. 2024)

Keep the user's gate types; make each parametric gate equivariant by replicating it over its orbit with a shared angle: `exp(−iθG) ↦ Π_{g ∈ G/Stab} exp(−iθ R(g) G R(g)†)`. This is exactly equivariant iff the orbit images commute pairwise (checked symbolically); e.g. a ring of `RZZ` under translations, or an `RY` layer under `s_n`. When they do not commute, Nuclei reports which pair and falls back to Strategy A for that gate (or `reject`). Orbit sharing never kills gates and never needs multi‑Pauli synthesis, so it is the default when the declaration is a permutation group; the twirl is the default otherwise.

### 2.5 Observable and initial state

- Observable: Nuclei reports `observable_invariant` (exact: `T[O] == O` symbolically). With `twirl_observable: true` it replaces `O` by `T[O]` for the after‑analysis and says so. It never silently changes the user's observable.
- Initial state `|0…0⟩`: invariant under permutations and `u1_charge`/`ΣZ`; **not** under `z2_flip` or `su2_spin`. Nuclei reports `initial_state_invariant` and, with `symmetric_initial_state: "auto"`, prepends a symmetric preparation when one exists in the gate set: `H^{⊗n}` (`|+⟩^n`) for `z2_flip`; nothing for `su2_spin` (a singlet preparation needs an even `n` and a specific layer — offered as an **explicit** option `singlet_pairs`, Schatzki et al. use this). If no symmetric preparation is available the compile proceeds and the UI states “equivariant ansatz, but the initial state breaks the symmetry; the cost is not invariant”.

**Reachable symmetry sector (binding check).** An equivariant U preserves the symmetry sector that contains ψ₀, so the compile also computes `sector_dimension`, the dimension of that sector: `binomial(n, k)` for `u1_charge` with ψ₀ of charge k (|0…0⟩ has k = 0 → dimension **1**); the multiplicity of the irrep containing ψ₀ for `su2_spin` (|0…0⟩ is the unique J = n/2 state → **1**); `n + 1` for `s_n` on a product state (the symmetric subspace); for a general product state and a finite group, the size of the orbit-spanned subspace (BFS over the generators, capped at `MAX_ORBIT`). Rules: `sector_dimension ≤ 1` → the compile is **refused** with `trivial_symmetry_sector` ("every U(1)-equivariant circuit acts on |0…0⟩ as a phase: the cost is constant and all gradients are exactly 0; prepare a state in a larger sector, e.g. half filling / a Néel string for U(1), singlet pairs for SU(2)") and the UI offers the matching `symmetric_initial_state` option; `sector_dimension` polynomial in n (≤ `4n²`, or `n + 1` for the S_n symmetric subspace) → `simulability_warning` is raised with the citation "the reachable sector is {dim}-dimensional and efficiently classically simulable (Anschuetz, Bauer, Kiani & Lloyd, Quantum 7, 1189 (2023); Schatzki et al. 2024)". Without this check the before/after card would show a `variance_ratio` of `[0, 0]` for `u1_charge` + |0…0⟩ and imply that symmetry destroyed trainability. Tests: `u1_charge` + |0…0⟩ → refused; `u1_charge` + Néel preparation → runs with `sector_dimension = binomial(n, n/2)`.

### 2.6 Verification

1. **Symbolic certificate (exact, any n ≤ 256).** For every compiled parametric gate and every finite group generator `g`: conjugate the gate's generator through a `CliffordFrame` built from `R(g)` (permutations are SWAP networks; Pauli strings are Pauli layers) and assert equality of Pauli sums (coefficient tolerance `1e‑10`). For every Lie generator `K_a`: assert `[H_k, K_a] = 0` via `_herm_bracket`. For fixed Clifford gates the check is the **centraliser condition, as an equality**: for every finite-group generator g, `U_fixed R(g) U_fixed† = e^{iφ} R(g)`. Concretely — for permutation generators, conjugate the SWAP-network frame of `R(g)` through the fixed gate and compare the resulting Pauli-string map with the original `R(g)` frame **as maps including signs** (equal on every generator string X_i, Z_i); for Pauli generators, require the conjugated string to equal **+R(g)** exactly (−R(g) means anticommutation and fails); for Lie generators keep `[U_fixed, K_a] = 0` symbolically. Testing that the conjugate merely lies *in the group* (the normaliser) is **wrong** and was the first draft's defect: SWAP(0,1) under `s_n` passes it although SWAP(0,1)·SWAP(1,2)·SWAP(0,1) = SWAP(0,2) ≠ SWAP(1,2). Gate‑level equivariance implies circuit‑level equivariance (products of unitaries commuting with `R(g)` commute with `R(g)`). Result: `certificate.status ∈ {"exact", "approximate", "failed"}` with the list of gates that fail. **Regression tests (binding):** SWAP(0,1) under `s_n` → `failed`; CZ(0,1) under `z2_flip` → `failed` (X⊗X maps to Y⊗Y, a different element); the ring of CX gates under `cyclic` → `failed`; the full-register SWAP network of a cyclic shift under `cyclic` → `exact`; plus a dense n ≤ 5 cross-check that asserts, for every certificate labelled `exact` in the corpus, `‖U_fixed R(g) − e^{iφ} R(g) U_fixed‖_F ≤ 1e‑10` for every generator.
2. **Numerical cross‑check (n ≤ 20, `MAX_STATEVECTOR_QUBITS`).** `K` random parameter vectors (default 8, seed from settings) × up to 64 group elements (all elements for `|G| ≤ 64`, else random words in the generators of length ≤ 2n) × 4 random product states `|φ⟩`: `ε = max ‖R(g)U(θ)|φ⟩ − U(θ)R(g)|φ⟩‖₂`. For Lie generators: `‖(U K_a − K_a U)|φ⟩‖₂ / ‖K_a‖`. Reported with the sample sizes. For Trotterised compiles this is the only equivariance evidence, and the UI says so. Above 20 qubits: `numerical: {"status": "not_applicable", "reason": "statevector limit"}`.
3. **Round trip of emitted code** (§2.7).

### 2.7 Code emission

`kernel/symmetry/emit.py` renders a `ParamCircuit` as source:

- **Qiskit**: `QuantumCircuit(n)`, one `Parameter`/`ParameterVector` per IR parameter, `coeff*p + offset` expressions for `ParamRef`s, gate calls from `GATE_SPECS` names (`RXX` → `qc.rxx`, synthesised ladders emitted as their constituent gates, with a comment naming the Pauli string they implement). `nuclei_observable = "<canonical text>"` is appended when an observable was in play, and `params.get(...)` lines are preserved when the source used them (`detect_sweepable_params`).
- **Cirq**: `cirq.LineQubit.range(n)`, `sympy.Symbol`s, `cirq.rx/ry/rz`, `cirq.XXPowGate(exponent=…)` etc. with the exponent conversion `φ/π`, consistent with `convert.from_cirq`.
- **PennyLane‑like**: a `qml.qnode`‑style function body (`qml.RX(…, wires=…)`, `qml.PauliRot(φ, "XYZ", wires=…)` for synthesised strings). PennyLane is not installed in the managed venv and the IR has no PennyLane converter, so this text is **unverified** and labelled as such in the response and UI.

**Emission safety (binding).** Emitted source embeds user-controlled strings (IR parameter names from Qiskit `Parameter`s or sympy symbols, the observable text, feature names, `artifact_stem`), and the emitted text is exec'd in the round trip, inserted into the editor, and — for `.surrogate.py` — run by users. Every embedded string is rendered as a Python literal through `repr()` / `json.dumps` and **never** interpolated as an identifier: parameters are mapped to generated safe identifiers (`p_0, p_1, …`) through a name table emitted as a comment and as `Parameter("<repr of original name>")`. `artifact_stem` and the sibling-file stem are validated kernel-side **and** client-side against `[A-Za-z0-9._-]{1,64}` (no path separators, no leading dot sequences). Fuzz tests feed adversarial names (quotes, newlines, `__import__`, `"); import os #`) and assert the emitted module parses with `ast.parse`, contains no `Call` to anything but the allow-listed framework API, and round-trips.

**Round trip**: the job runs the emitted Qiskit/Cirq source through `load_circuit` (same sandbox, same trust model as the user's code) and compares the resulting IR with the compiled IR: equal `n_qubits`, same gate sequence (name, qubits), angles equal as `ParamRef`s up to `1e‑9` after parameter renaming. `emitted[framework].roundtrip ∈ {"verified", "mismatch", "not_run"}` with a diff position on mismatch. The frontend shows the “Insert into editor” action for `verified` and `not_run` (PennyLane), and a warning for `mismatch` (the code is still shown; it is never silently dropped).

### 2.8 Before/after analyses

With the user's observable (or the twirled one, when requested), run the existing analyses on both circuits in the same job: `lie_algebra` (dimension, classification, ideals, Ragone cost‑variance prediction, simulability flags) and `gradient_statistics` (PPE with truncation intervals, or sampling with bootstrap CIs, per PRD 14's `method: auto`). Results reuse the `LieAlgebraResult` and `GradientStatistics` wire shapes unchanged. The comparison layer computes nothing new: it shows the two results side by side with the intervals, and derives:

- `dla_ratio = dim_after / dim_before` only when both closures completed; else `null` with reason.
- `variance_ratio`: the ratio of the interval endpoints (an interval `[lo_after/hi_before, hi_after/lo_before]`), never a point. For PPE truncation intervals this is rigorous. For sampled (bootstrap) variances the endpoint ratio of two 95 % intervals has **≥ 90 % joint coverage** (Bonferroni), and the UI labels it so; when `lo_before = 0` the ratio is reported as `≥ lo_after/hi_before` with `hi = null` ("unbounded above"), never as `∞`.
- `simulability_warning`: set when the after‑DLA is flagged `g_sim_feasible` or dimension `≤ 4n²` (lie.py's polynomial rule); the copy cites Cerezo et al. 2024 and links to the Spec 01 Quantumness certificate.

### 2.9 Complexity and limits

| Step | Cost | Cap |
|---|---|---|
| Orbit enumeration per generator | O(|orb| · n · |gens|) symbolic | `MAX_ORBIT = 65 536` strings |
| Lie Krylov projection per generator | O(|S|² + SVD(|S|·#K, |S|)) | `MAX_KRYLOV = 4 096` |
| Synthesis of a weight‑w Pauli rotation | 2(w−1) CX + ≤ 2w basis gates | — |
| Symbolic certificate | O(#gates · #group gens · n) | n ≤ 256 |
| Numerical check | O(K · |G_sample| · 2^n) | n ≤ 20; `K ≤ 32`; `|G_sample| ≤ 64` |
| Before/after Lie + gradients | as PRD 14 | PRD 14 caps and budgets |

Time budgets: `compile` 30 s, `verify` 30 s, `before`/`after` per PRD 14 `lie.time_budget_s` and `samples`; whole job under the 20‑minute wall limit and the `lab_proc` CPU limit. Every stage is cancellable between gates/orbits via the existing `check_cancel` pattern.

### 2.10 Symmetry detection (`symmetry_detect`)

A sync request that tests the **preset** symmetries against the user's observable and circuit structure (symbolic only, ≤ 0.5 s budget): for each preset, `observable_invariant`, `circuit_equivariant` (gate‑level symbolic check of the *existing* circuit; `"unknown"` when a non‑Clifford fixed gate would need the dense path), `initial_state_invariant`. The UI shows “Your observable is invariant under translations but your ansatz is not — compile?” It is a suggestion engine, not a proof of the absence of other symmetries (copy says so). It does not touch `lint.py`; a `TRN008` lint rule is a follow‑up (§11).

---

## 3. Idea 6 — Train quantum, deploy classical: math and algorithms

### 3.1 Model declaration

A **model** is a parameterised circuit whose IR parameters split into **features** `x ∈ R^d` and **weights** `w ∈ R^m`, with a readout observable `O`:

`f(x; w) = ⟨0| U(x, w)† O U(x, w) |0⟩`.

The user declares the split in code (module level, read by `_usercode.load_circuit`'s namespace exactly like `nuclei_observable`):

```python
nuclei_model = {
    "features": ["x0", "x1"],          # IR parameter names that carry data
    "weights": {"w0": 0.31, ...},       # trained values (or omit to train in Nuclei)
    "observable": "Z0",                 # optional; falls back to nuclei_observable / preset:local_z
    "kind": "regression" | "binary",   # readout interpretation
}
nuclei_dataset = (X, y)                # numpy arrays, or a callable returning them, or {"csv": "data/train.csv"}
```

Qiskit `Parameter`s/`ParameterVector`s and Cirq `sympy.Symbol`s already arrive in the IR by name; features are whatever names the user lists. If the declaration is missing, `deploy_inspect` returns `model: null` with the exact snippet to add (the editor “Insert model declaration” quick‑fix).

Flipped models (Jerbi et al. 2024) declare instead:

```python
nuclei_model = {
    "kind": "flipped",
    "weights": {...},                            # the trained state-preparation circuit's parameters
    "observable_of_x": "x0*Z0 + x1*X1 + 0.5*Z0 Z1",   # Pauli sum with affine-in-x coefficients
    "features": ["x0", "x1"],
}
```

### 3.2 Route A — exact‑spectrum Fourier surrogate

**Theorem used (Schuld, Sweke, Meyer 2021).** If feature `x_j` enters only through gates `exp(−i x_j c_{j,l} G_{j,l})` with generators whose eigenvalue differences are integers times a unit (true for every IR Pauli rotation: `R_P(cx)` has eigenvalues `±c/2`), then `f(x; w) = Σ_{ω ∈ Ω} c_ω(w) e^{i ω·x}` with a **finite** frequency lattice `Ω = Ω_1 × … × Ω_d`, where `Ω_j = { Σ_l s_l c_{j,l} : s_l ∈ {−1, 0, +1} }` (differences of eigenvalue sums; for `L_j` identical unit‑coefficient encodings `Ω_j = {−L_j, …, L_j}`). `c_{−ω} = c_ω*` because `f` is real.

Nuclei computes `Ω_j` exactly from the IR (`spectrum.py`), including controlled rotations — `CRX(x)` has generator `|1⟩⟨1| ⊗ X/2` with eigenvalues `{0, 0, +1/2, −1/2}`, so the frequency differences are `{0, ±1/2, ±1}` and the lattice is rescaled to the least common unit (here 1/2) before the grid size is computed — and `P(x)` (eigenvalues `{0, 1}` in the IR's generator convention).

**Coefficients.** Since `f` is a trigonometric polynomial on a known lattice, its coefficients are recovered **exactly** by sampling on the tensor grid `x_j ∈ {2πk/(N_j)}`, `N_j = 2 max Ω_j^+ + 1` (after rescaling non‑integer lattices to their least common unit), and taking a DFT — the standard aliasing‑free sampling for band‑limited trigonometric polynomials. Grid size `N = Π_j N_j`. For each grid point the model is evaluated with the trained weights:

- **Statevector** (n ≤ 20): exact to machine precision. The surrogate then **equals** the quantum model to `~1e‑12`; the validation report says exactly this and adds: *a model this size was classically simulable to begin with; the export's value is deployment convenience, not advantage.*
- **PPE** (20 < n ≤ 128, Clifford+Pauli‑rotation circuits as in PRD 14): each evaluation returns a **truncation interval** `[lo, hi]` with half-width `h_k` at grid point k. The DFT is linear, so each coefficient gets the rigorous interval `|ĉ_ω − c_ω| ≤ (1/N) Σ_k h_k`. The **prediction interval** at any `x` uses the trigonometric-interpolation (Lebesgue-constant) bound, which is also rigorous and far tighter than summing the coefficient bounds over the lattice: `|f̂(x) − f(x)| ≤ max_k h_k · Λ_N`, with `Λ_N = Π_j Λ_{N_j}` the product of the per-axis Lebesgue constants of trigonometric interpolation on `N_j` equispaced nodes, `Λ_{N_j} ≤ (2/π)·ln N_j + 1`. Both are reported (coefficient bounds as they are; the Lebesgue bound for predictions); the export JSON stores them; the generated `.py` returns `(value, half_width)`.
- **Too many frequencies** (`N > options.max_grid_points`, default 65 536): the exact route is **not applicable**. Nuclei offers the truncated‑lattice fit: choose `Ω' ⊂ Ω` by keeping the `M` lowest‑magnitude frequencies, and solve least squares on `S` random points (`S ≥ 4|Ω'|`, Landman et al. 2023). This is a regression: its accuracy is only what the held‑out report measures. (Sweke et al. 2025 give the conditions under which such approximations succeed; Nuclei cites them and does not claim them.)

Non‑Hamiltonian encodings (features in `U`‑gate angles via non‑linear expressions, amplitude encoding, features used as gate *selectors*) are rejected by the IR converter already (`nonlinear_parameter`) or detected in `spectrum.py` → `route.fourier.feasible = false` with the reason and the gate's source line.

### 3.3 Route B — classical‑shadow surrogate for flipped models

**Model.** `f(x; w) = Tr[ρ_w O(x)]` with `ρ_w = V(w)|0⟩⟨0|V(w)†` trained, and `O(x) = Σ_P α_P(x) P` a Pauli sum whose coefficients are affine in `x`, each term of weight `≤ k`.

**Shadow (Huang, Kueng, Preskill 2020).** `T` snapshots of `ρ_w` in random single‑qubit Pauli bases: snapshot `t` yields bases `b_t ∈ {X,Y,Z}^n` and outcomes `s_t ∈ {±1}^n`; the inverse‑channel estimator `ρ̂_t = ⊗_i (3 |s_{t,i}⟩⟨s_{t,i}|_{b_{t,i}} − I)`. For a weight‑`k` Pauli `P`, `Tr[ρ̂_t P] = 3^k Π_{i ∈ supp P} s_{t,i} [b_{t,i} = P_i]`, computable in `O(k)` from the stored `(b_t, s_t)`. So at deployment `f̂(x) = Σ_P α_P(x) · MoM_t(Tr[ρ̂_t P])`.

**Error bars (HKP Theorem 1, constants pinned).** The Pauli shadow norm of a weight‑k Pauli is `3^k` (HKP Lemma 3). Theorem 1 (arXiv:2002.08953, Supp. Eq. S13) estimates `M` observables to additive error `ε_term` with failure probability `δ` using **`K = 2·ln(2M/δ)`** median‑of‑means groups of **`N = (34/ε_term²)·max_i ‖O_i‖²_shadow`** snapshots each, total `T = N·K` (the proof uses `Pr ≤ 2e^{−K/2}` per estimate with natural logs and a union bound over `M`). The first draft dropped the factor 2 in `K` and let the user fix `K = 10` independently of `δ`, under which the true failure bound is `δ = 2M·e^{−5} ≈ 0.0135·M` — vacuous (≥ 1) for `M ≥ 74` terms. Nuclei therefore computes everything from the **actual** `(T, K, M, k)`:

- `shadow.plan(locality k, alpha_l1_max, n_terms M, eps, delta) -> {T, K, N}` picks `K = ⌈2·ln(2M/δ)⌉`, `N = ⌈34·3^k·alpha_l1_max²/ε²⌉`, `T = N·K`; `mom_groups` is **not** a user knob (it is shown read-only as `K`).
- `shadow.guarantee(T, K, M, k, alpha_l1_max) -> (eps, delta)` inverts it for a given snapshot set: `ε_term = sqrt(34·3^k / ⌊T/K⌋)`, `δ = min(1, 2M·e^{−K/2})`, `ε = alpha_l1_max · ε_term` (the `‖α‖₁` factor is the triangle inequality over the `M` terms).
- The guarantee is **for `x` in the declared input box only**: `α(x)` is affine, so `max_x ‖α(x)‖₁` is finite only over a bounded domain. `options.input_range` (per-feature `[lo, hi]`; default = the training data's range when a dataset exists, else required) is part of the request and the certificate says "for x ∈ {box}".
- When the configured `T` or `K` cannot deliver `δ < 1` at the target `ε` — or at all — the route's verdict is `empirical` / `inconclusive`, **never `certified`**, and the UI says why.
- For **imported** (QPU) snapshots the HKP guarantee assumes ideal Pauli measurements; readout error biases the inverse-channel estimator. The verdict is `certified_ideal_measurement` ("certified under an ideal-measurement assumption") unless a readout calibration (`options.shadow.readout: {p01, p10 per qubit}`) is supplied and used in the readout-mitigated inverse channel, in which case `certified` is allowed and the calibration is recorded in provenance.
- An **empirical** bootstrap interval over snapshot resampling is shown next to the guarantee for the mean error; `max |error|` on the held-out set is reported as an **observed value without a CI** (the bootstrap fails for extreme order statistics), or with a distribution-free order-statistic bound when `S_val ≥ 100`.

A unit test pins the constants to Theorem 1 (`K = 2 ln(2M/δ)`, `N = 34σ²/ε²`, Lemma 3's `3^k`), and REV‑P's checklist has the constant as an exit criterion. Both numbers are shown; the guaranteed one is the certificate.

**Where the snapshots come from.**
- In Nuclei (n ≤ 20): simulated by statevector: sample `b_t` uniformly, rotate, sample outcomes from the Born distribution (exact). The report says: *snapshots were simulated classically here; on hardware they come from the QPU and the same export code applies.*
- Imported: a `*.shadows.json` file `{n, format: "pauli", bases: [[…]], outcomes: [[…]]}` (e.g. from a QPU run the user did elsewhere). Nuclei validates shape and values only; it cannot verify the state they came from and the report says so.
- `n > 20` and no import: route B is **not applicable**.

**Feasibility conditions** (`deploy_inspect`): `kind == "flipped"`, every term weight `≤ options.shadow.max_locality` (default 6; the `3^k` factor is shown), `M ≤ 4096` terms, coefficients affine in `x` (symbolic check of the declaration string). Otherwise `feasible: false` with reason.

Route B is the only route that is *not* equivalent to classically simulating the model: the classical description is the shadow, not the circuit. Nuclei's copy makes this distinction explicit, because it is the point of Jerbi et al.

### 3.4 Route C — data‑only regression

When the model cannot be evaluated in Nuclei (too wide, unsupported gates) but the user has `(x, f(x))` pairs from their own QPU/simulator runs (`nuclei_dataset` with `y` being the *model's outputs*, declared with `"target": "model_output"`), Nuclei fits the truncated Fourier basis of §3.2 by least squares. The report is a regression report (held‑out MSE/MAE/R² with bootstrap CI) and is labelled **“regression on recorded outputs — not a certificate of the quantum model”**. If `Ω` cannot be computed (unsupported encoding), the basis is random Fourier features with a user‑chosen bandwidth, and the UI says the spectrum is a guess.

### 3.5 Validation report (all routes)

- Split: `holdout_fraction` (default 0.25) of the dataset (or, when no dataset is given, `S_val = 512` random points in `[−π, π]^d`) never used for fitting.
- Metrics: MSE, MAE, R² (regression); accuracy, agreement with the quantum model's sign (`binary`); each with a bootstrap 95 % interval (reuse `_bootstrap_*` helpers in `analyses.py`, 1000 resamples, seeded). `max |error|` is reported as an observed value **without** a bootstrap CI (invalid for an extreme order statistic); a distribution-free order-statistic bound is attached when `S_val ≥ 100`.
- Reference values: statevector/PPE evaluations of the quantum model where possible; otherwise the recorded `y` and the report says which.
- A **verdict** string from a fixed table: `exact` (Route A statevector, max error < 1e‑8), `certified` (Route A PPE intervals, or Route B with `δ < 1` at the target ε from the actual `(T, K, M, k)` and simulated or readout-mitigated snapshots), `certified_ideal_measurement` (Route B on imported snapshots without readout mitigation), `empirical` (truncated/least‑squares/Route C, or Route B whose `(T, K)` cannot deliver `δ < 1`), `inconclusive` (held‑out set < 32 points), with the sentence the UI shows for each.

### 3.6 In‑app training (`deploy_train`)

Most users will not arrive with trained weights. Nuclei ships a minimal, honest trainer: Adam (reuse `adam_minimize` from `kernel/discovery/evaluators/_circuit_common.py`) on statevector `value_and_grad` (parameter‑shift, n ≤ 20), MSE or BCE loss, minibatches, hold‑out split, seed, epoch/time budget, cancellable, streaming loss curves as `deploy_partial`. The result is a **training certificate** `provenance` block (PRD 14 addendum §D format plus `dataset_sha256`, `weights_sha256`, `loss_curve`) written by the frontend as `experiments/<stem>.training.json`. Training above 20 qubits is **not available** here (no gradients without statevector; PPE gives expectation intervals, not a training signal) and the UI says to train elsewhere and paste weights.

### 3.7 Export artifacts

- `<stem>.surrogate.py`: standalone, imports only `numpy` and `json`; `predict(X: np.ndarray) -> np.ndarray` (and `predict_with_interval` for PPE/shadow routes); loads weights **only via `json`** from the sibling JSON or an embedded JSON literal (`--embed`) — never `np.load(allow_pickle=True)` or `pickle`; every embedded string is a `repr()`/`json.dumps` literal (§2.7); ends with `if __name__ == "__main__":` **self‑check** that evaluates 8 embedded held‑out vectors and asserts agreement with embedded expected outputs to the report's tolerance. `stem` is validated against `[A-Za-z0-9._-]{1,64}` (`artifact_stem_invalid` otherwise).
- `<stem>.surrogate.json`: `{"version": 1, "route", "model": {features, n_qubits, observable, kind}, "spectrum": {...} | "shadow": {bases, outcomes, locality, mom_groups} | "rff": {...}, "weights": {...}, "validation": {...}, "provenance": {...}}`.
- ONNX (optional): built lazily with `onnx` (`onnx.helper`, opset 17) as `Sin/Cos/Mul/ReduceSum` graphs for Fourier routes only; absent package → `availability.onnx = {available: false, message: "Install 'onnx' in Environment setup to export ONNX."}` and the other formats still succeed. Not in `requirements.txt`; justified because it is pure convenience for ML pipelines.

**Provenance** (`kernel/deploy/provenance.py`, extends `build_provenance`): `code_sha256`, `weights_sha256` (canonical JSON of weights), `dataset_sha256` (or `null`), `training_certificate_sha256` (the SHA‑256 of the `*.training.json` or `*.trainability.json` the user links; `null` if none, and the report says *unlinked*), `surrogate_sha256` (of the JSON without this field), `kernel` versions, `analyses_fingerprint` of `kernel/deploy/*.py`, `created_at`.

---

## 4. Kernel design

### 4.1 Module layout

```
kernel/symmetry/
  __init__.py
  spec.py            SymmetrySpec parsing/validation (wire -> dataclasses), presets
  groups.py          permutation/Pauli group generators, orbit BFS, SWAP-network frames, R(g) helpers
  twirl.py           symbolic twirl: orbit averaging, Lie Krylov projection, alternating composite
  synth.py           Pauli-sum exponentials -> IR gates (commuting check, ladders, Trotter)
  compile.py         strategies (twirl, orbit_sharing), fixed-gate policy, observable/state handling
  verify.py          symbolic certificate + statevector cross-check
  detect.py          preset symmetry detection (sync)
  emit.py            IR -> Qiskit / Cirq / PennyLane-like source
  roundtrip.py       emitted source -> load_circuit -> IR comparison
  compare.py         before/after assembly (ratios as intervals, simulability warning)
  _settings.py       normalize_options (clamps), analyses subset
  handlers.py        symmetry_* dispatch (mirrors trainability/handlers.py)
  jobs.py            SymmetryJobManager(LabJobManager)
  job_worker.py      subprocess: stages compile -> verify -> before -> after -> emit

kernel/deploy/
  __init__.py
  model.py           nuclei_model / nuclei_dataset declarations -> ModelSpec, DatasetSpec (validation)
  dataset.py         re-export of kernel/trainability/dataset.py (the single loader, master F-1) + holdout splits
  spectrum.py        re-export of kernel/surrogates/spectrum.py (feature frequency lattices; grid sizes; feasibility)
  evaluate.py        model evaluation adapters: statevector exact, PPE interval, recorded
  surrogates/
    __init__.py      re-exports kernel.surrogates.{fourier, shadow, rff} (DFT-exact / LS fits with interval propagation; snapshot simulation, import validation, MoM estimator, HKP budget; RFF fallback) — implemented once by spec 01's Q3
  validate.py        held-out metrics with bootstrap intervals; verdict table
  train.py           Adam trainer on statevector value_and_grad (reuses adam_minimize)
  export_numpy.py    .surrogate.py renderer (+ self-check block)
  export_json.py     .surrogate.json builder
  export_onnx.py     lazy ONNX graph builder
  provenance.py      deploy provenance (extends trainability.provenance)
  _settings.py       normalize_options
  handlers.py        deploy_* dispatch
  jobs.py            DeployJobManager(LabJobManager)
  job_worker.py      subprocess: inspect/train/export stages

kernel/lab_routes.py   prefix -> handler registry used by server._route_lab_message (created by master F-1 in Wave 1; S3 and D3 each add one entry)
```

All modules are numpy‑only. `scipy` is imported lazily and only as an optional accelerator (`scipy.linalg.null_space` for large Krylov matrices) with a numpy SVD fallback; `onnx` is lazy via `kernel.discovery._optional.lazy_module`. No new entry in `kernel/requirements.txt`.

### 4.2 Core data structures (pure, frozen)

```python
# kernel/symmetry/spec.py
@dataclass(frozen=True)
class PermutationGroup:  generators: tuple[tuple[int, ...], ...]; name: str  # "s_n" | "cyclic" | ...
@dataclass(frozen=True)
class PauliGroup:        generators: tuple[PauliSum, ...]
@dataclass(frozen=True)
class LieComponent:      generators: tuple[PauliSum, ...]; name: str          # "u1_charge" | "su2_spin" | "custom"
SymmetryComponent = PermutationGroup | PauliGroup | LieComponent
@dataclass(frozen=True)
class SymmetryDeclaration: components: tuple[SymmetryComponent, ...]; n_qubits: int

# kernel/symmetry/twirl.py
@dataclass(frozen=True)
class TwirlResult: operator: PauliSum; killed: bool; orbit_size: int | None; krylov_dim: int | None; converged: bool

# kernel/symmetry/compile.py
# CompileResult also carries: sector_dimension: int | None; sector_note: str | None
@dataclass(frozen=True)
class GateRewrite: source_index: int | None; source_line: int | None; parameter: str | None;
                   action: str  # "twirled_exact" | "twirled_trotter" | "orbit_shared" | "killed" | "kept" | "expanded"
                   original: str; result: str; n_terms: int; exact: bool; note: str
@dataclass(frozen=True)
class CompileResult: circuit: ParamCircuit; rewrites: tuple[GateRewrite, ...]; observable: PauliSum;
                     observable_invariant: bool; observable_twirled: bool; initial_state_invariant: bool;
                     initial_state_prep: str | None; removed_parameters: tuple[str, ...]; notes: tuple[str, ...]

# kernel/symmetry/verify.py
@dataclass(frozen=True)
class Certificate: status: str  # "exact" | "approximate" | "failed"
                   checked_gates: int; failing: tuple[dict, ...]; lie_brackets_checked: int
@dataclass(frozen=True)
class NumericalCheck: status: str  # "ok" | "not_applicable"; max_residual: float | None; samples: dict; reason: str | None

# kernel/deploy/model.py
@dataclass(frozen=True)
class ModelSpec: kind: str; features: tuple[str, ...]; weights: dict[str, float] | None; observable: PauliSum;
                 observable_of_x: AffinePauliSum | None; circuit: ParamCircuit
@dataclass(frozen=True)
class DatasetSpec: X: np.ndarray; y: np.ndarray; source: str; target: str; sha256: str

# kernel/deploy/spectrum.py
@dataclass(frozen=True)
class FeatureSpectrum: name: str; frequencies: tuple[float, ...]; unit: float; grid_points: int; gates: tuple[int, ...]
@dataclass(frozen=True)
class Spectrum: per_feature: tuple[FeatureSpectrum, ...]; grid_total: int; lattice_size: int

# kernel/surrogates/fourier.py (implemented by spec 01 unit Q3; re-exported from kernel/deploy/surrogates)
@dataclass(frozen=True)
class FourierSurrogate: frequencies: np.ndarray  # (L, d)
                        coefficients: np.ndarray  # complex (L,)
                        half_widths: np.ndarray | None   # per-coefficient interval half-widths (PPE route)
                        fit: str  # "dft_exact" | "least_squares"
```

Everything above is immutable; functions return new objects (`CompileResult` is built once; the IR is rebuilt rather than mutated).

### 4.3 Pure function signatures (the contracts other units code against)

```python
# symmetry
spec.parse_declaration(raw: list[dict], n_qubits: int) -> SymmetryDeclaration          # raises SymmetryError("invalid_symmetry")
groups.orbit(op: PauliSum, comp: PermutationGroup | PauliGroup, *, max_orbit: int) -> list[tuple[float, PauliSum]]
twirl.twirl(op: PauliSum, decl: SymmetryDeclaration, *, max_orbit, max_krylov, cancel) -> TwirlResult
synth.commuting(terms: PauliSum) -> bool
synth.exponential_gates(op: PauliSum, ref: ParamRef, *, trotter_steps: int) -> tuple[list[IrGate], bool]  # (gates, exact)
compile.compile_circuit(circuit, observable, decl, options, *, progress, cancel) -> CompileResult
verify.symbolic_certificate(circuit, decl, *, cancel) -> Certificate
verify.numerical_check(circuit, decl, *, samples, seed, cancel) -> NumericalCheck
detect.detect_presets(circuit, observable, *, time_budget_s) -> list[dict]
emit.to_qiskit(circuit, observable_text, *, sweepable: dict) -> str; emit.to_cirq(...); emit.to_pennylane(...)
roundtrip.verify(source: str, framework: str, expected: ParamCircuit) -> dict  # {"status", "position"?, "message"?}
compare.assemble(before: dict, after: dict, n: int, *, variance_method: str) -> dict   # labels sampled ratios "≥ 90 % joint coverage"
compile.sector_dimension(decl: SymmetryDeclaration, initial_state: str, n: int) -> int | None   # §2.5; None when not computable (reported)

# deploy
model.load_model(code, params, language) -> tuple[ModelSpec, DatasetSpec | None, LoadedCircuit]
spectrum.feature_spectra(circuit, features) -> Spectrum                 # raises DeployError("unsupported_encoding", gate line)
evaluate.evaluator(model, *, method, backend) -> Callable[[np.ndarray], tuple[np.ndarray, np.ndarray | None]]  # values, half-widths
fourier.fit_dft(model, spectrum, evaluator, *, progress, cancel) -> FourierSurrogate
fourier.fit_least_squares(model, spectrum, evaluator, *, max_frequencies, n_points, seed, progress, cancel) -> FourierSurrogate
fourier.predict(s: FourierSurrogate, X) -> tuple[np.ndarray, np.ndarray | None]
shadow.simulate_snapshots(model, *, snapshots, seed, progress, cancel) -> Snapshots
shadow.load_snapshots(obj: dict, n_qubits: int) -> Snapshots
shadow.plan(locality, alpha_l1_max, n_terms, eps, delta) -> dict        # {T, K, N} per HKP Thm. 1 (K = ceil(2 ln(2M/δ)))
shadow.guarantee(T, K, n_terms, locality, alpha_l1_max) -> tuple[float, float]   # (eps, delta) from the actual snapshot set; delta = min(1, 2M e^{-K/2})
shadow.predict(snaps, observable_of_x, X, *, K, readout=None) -> tuple[np.ndarray, np.ndarray]   # K from plan/guarantee, never user-set
validate.report(reference, predicted, *, kind, seed) -> dict
train.train(model, dataset, options, *, progress, cancel) -> dict           # weights, curves, holdout metrics
export_numpy.render(surrogate_json: dict, self_check: dict) -> str
export_json.build(...) -> dict; export_onnx.build(...) -> bytes | None (+ availability)
```

### 4.4 Cancellation, budgets, resource limits

- Jobs subclass `kernel/lab_proc.LabJobManager` exactly like `TrainabilityJobManager`: subprocess per job, `-I`, minimal env, process‑group kill on cancel/owner release/wall limit (20 min), CPU limit via `apply_cpu_limit`, parent watch. `MAX_JOBS_PER_OWNER = 2`, `MAX_JOBS_GLOBAL = 4` **shared** with trainability (one global counter in `lab_proc`, so the four Lab managers cannot together exceed 4 — see §10 for the counter interface).
- Stage budgets (clamped in `_settings.py`): symmetry `compile_budget_s` 5–120 (30), `verify_budget_s` 5–120 (30), `numerical_samples` 1–32 (8); deploy `max_grid_points` 256–262 144 (65 536) **subject to a feasibility check** — `deploy_inspect` measures one evaluation (statevector or PPE) and the export refuses the DFT route with `route_not_applicable: "grid of {N} points × {t} s per evaluation exceeds the budget"` and the estimate when `N × t > time_budget_s` (the old default would take hours near n = 20); `max_frequencies` 8–4096 (256), `shadow.snapshots` 100–200 000 (10 000), `shadow.max_locality` 1–8 (6), `shadow.delta` 1e-4–0.5 (0.05), `train.epochs` 1–500 (50), `train.time_budget_s` 5–900 (120); `shadow.mom_groups` is derived (read-only).
- Memory: Fourier grid evaluations stream (no `N × 2^n` arrays); shadow snapshots stored as `int8` arrays (`T × n` × 2).

---

## 5. Protocol v1.4

Additive to v1.3. `PROTOCOL_VERSION` in `kernel/trainability/provenance.py` becomes `"1.4"` (one‑line edit, owned by the master plan's foundations unit F-1). Every sync reply echoes `request_id` per `kernel/lab_protocol.py`. Errors are `{"type": "error", "phase": "symmetry" | "deploy", "code", "message", "job_id"?, "request_id"?, "column"?}`.

Routing: `server._lab_phase` currently maps `trainability_*` → trainability and everything else → discovery. v1.4 replaces that with `kernel/lab_routes.py`, **fully populated by F-1 in Wave 1** with all five prefixes and lazy handler imports (a prefix whose module does not exist yet answers `{"type": "error", "phase": <prefix>, "code": "family_unavailable"}`), so **no later unit edits `lab_routes.py`** — S2+S3 and D3 only create their handler modules. The binding content is the master's §4.1 table (`trainability_`, `discovery_`, `symmetry_`, `deploy_`, `qec_learned_`; `discovery_conjecture_*` and `discovery_audit*` stay under `discovery_`; there is no `conjecture_` prefix and no default phase — an unmatched type is `unknown_message` echoing `request_id`).

### 5.1 `symmetry_detect` (sync, ≤ 0.5 s)

Request `{"type": "symmetry_detect", "request_id"?, "code", "language"?, "params"?, "observable"?}`
Reply:

```json
{"type": "symmetry_detected", "n_qubits": 8, "observable": "Z0 Z1 + Z1 Z2 + ...",
 "candidates": [
   {"preset": "cyclic", "observable_invariant": true, "circuit_equivariant": false,
    "initial_state_invariant": true, "note": "Observable is translation-invariant; 7 gates break it."},
   {"preset": "z2_flip", "observable_invariant": false, "circuit_equivariant": "unknown",
    "initial_state_invariant": false, "note": "A non-Clifford fixed gate (line 14) needs the dense check."}
 ],
 "notes": ["Only preset symmetries are tested; absence here is not evidence of no symmetry."]}
```

### 5.1b `symmetry_propose` (sync, ≤ 2 s) — the deterministic proposer for spec 04's verified suggestions

Request `{"type": "symmetry_propose", "request_id"?, "code", "language"?, "params"?, "observable"?, "max_proposals"?: 4}`
Reply `{"type": "symmetry_proposals", "proposals": [{"preset": "cyclic", "code_edits": [{"search": "...", "replace": "..."}], "rationale": "Observable is translation-invariant; orbit-share the RZZ layer."}], "notes": [...]}`.
Implemented by `kernel/symmetry/propose.py: propose_rewrites(circuit, observable, *, max_proposals) -> list[dict]` (unit S1): runs `detect_presets`, compiles with `strategy: auto` for each candidate preset whose observable is invariant, emits Qiskit/Cirq source through `emit.py` and expresses the change as SEARCH/REPLACE edits against the user's source (whole-circuit-block replacement when a finer diff is not possible, flagged `region: "whole_circuit"`). Spec 04 consumes the list with `origin: "symmetry"` and verifies it like any other proposal.

### 5.2 `symmetry_compile` (job)

Request:

```json
{"type": "symmetry_compile", "job_id": "sym-…", "code": "...", "language": "python"?, "params": {}?, "observable": "..."?,
 "symmetry": [ {"kind": "preset", "name": "cyclic"},
               {"kind": "permutation_group", "name": "custom", "generators": [[1,2,3,0]]},
               {"kind": "pauli_group", "generators": ["X0 X1 X2 X3"]},
               {"kind": "lie", "name": "u1_charge", "generators": ["Z0 + Z1 + Z2 + Z3"]} ],
 "options": {"strategy": "twirl" | "orbit_sharing" | "auto", "noncommuting": "trotter" | "reject", "trotter_steps": 2,
             "fixed_gates": "expand_orbit" | "keep" | "drop", "twirl_observable": false,
             "symmetric_initial_state": "keep" | "auto" | "plus" | "singlet_pairs",
             "emit": ["qiskit", "cirq", "pennylane"], "analyses": ["lie", "gradients"],
             "settings": { ...TrainabilitySettings subset: samples, seed, init, method, backend, lie... },
             "compile_budget_s": 30, "verify_budget_s": 30, "numerical_samples": 8}}
```

Stream: `symmetry_started {job_id}` → `symmetry_progress {job_id, stage, fraction, message}` (≤ 10/s; `stage ∈ compile|verify|before|after|emit`) → `symmetry_partial {job_id, stage, result}` per finished stage → terminal `symmetry_result`:

```json
{"type": "symmetry_result", "job_id": "…", "status": "complete" | "cancelled" | "failed",
 "results": {
   "compile": {"ir": {...ParamCircuit JSON...}, "n_parameters_before": 24, "n_parameters_after": 6,
               "gate_count_before": 40, "gate_count_after": 52,
               "rewrites": [{"source_index": 3, "source_line": 12, "parameter": "θ[3]", "action": "twirled_exact",
                             "original": "X3", "result": "(X0+X1+X2+X3)/4", "n_terms": 4, "exact": true, "note": ""}],
               "removed_parameters": ["θ[5]"], "observable_invariant": true, "observable_twirled": false,
               "initial_state_invariant": true, "initial_state_prep": null, "sector_dimension": 70, "sector_note": null, "strategy": "twirl", "notes": []},
   "verify": {"certificate": {"status": "exact", "checked_gates": 52, "failing": [], "lie_brackets_checked": 0},
              "numerical": {"status": "ok", "max_residual": 3.1e-15, "samples": {"theta": 8, "group_elements": 8, "states": 4}, "reason": null}},
   "before": {"lie": {...LieAlgebraResult...}, "gradients": {...GradientStatistics...}},
   "after":  {"lie": {...}, "gradients": {...}},
   "comparison": {"dla_before": 255, "dla_after": 21, "dla_ratio": 0.082, "dla_note": null,
                  "variance_before": [1.1e-3, 1.4e-3], "variance_after": [2.0e-2, 2.3e-2], "variance_ratio": [14.3, 20.9], "variance_ratio_coverage": "rigorous" | ">= 90 % joint",
                  "method": "ppe", "simulability_warning": {"flag": true, "message": "...", "citation": "Cerezo et al. 2025; Anschuetz et al. 2023", "sector_dimension": 70, "certificate_cheap": {...spec 01 shape incl. brute_force...} | null}},
   "emitted": {"qiskit": {"source": "...", "roundtrip": "verified"}, "cirq": {"source": "...", "roundtrip": "verified"},
               "pennylane": {"source": "...", "roundtrip": "not_run"}}
 },
 "errors": {"after": {"code": "...", "message": "..."}},
 "elapsed_ms": 4120,
 "provenance": {...build_provenance... , "symmetry": [...declaration as sent...], "options": {...clamped...}, "compiled_ir_sha256": "…"}}
```

`symmetry_cancel {job_id}` → `symmetry_cancelled {job_id, accepted}`.

Error codes (phase `symmetry`): `invalid_request`, `invalid_symmetry` (bad generator/permutation/qubit index, with `column`‑style `position`), `symmetry_too_large` (orbit or Krylov cap), `noncommuting_twirl` (with `"gate"` and `"pair"` fields), `trivial_twirl` (every parametric gate killed), `trivial_symmetry_sector` (§2.5, with `sector_dimension` and the suggested preparation), `artifact_stem_invalid`, `fixed_gate_breaks_symmetry` (with `source_line`), `twirl_not_converged`, `unsupported_gate_for_twirl` (3‑angle `U` gates: not a single generator), `emission_failed`, `roundtrip_mismatch` (reported inside `emitted`, not fatal), `symmetry_busy`, `symmetry_internal`, plus inherited `no_circuit`, `unsupported_language`, `too_many_qubits`, `no_parameters`, `wall_limit`, `cpu_limit`, `worker_crashed`, `analysis_unavailable`.

### 5.3 `deploy_inspect` (sync)

Request `{"type": "deploy_inspect", "request_id"?, "code", "language"?, "params"?}`
Reply:

```json
{"type": "deploy_inspected",
 "model": {"kind": "regression", "features": ["x0","x1"], "weights": ["w0","w1","w2"], "trained": true,
           "n_qubits": 4, "observable": "Z0", "declaration_snippet": null} | null,
 "declaration_snippet": "nuclei_model = {...}"   // present when model is null
 "dataset": {"source": "nuclei_dataset", "n_samples": 400, "n_features": 2, "target": "label"} | null,
 "spectrum": {"per_feature": [{"name": "x0", "frequencies": [-2,-1,0,1,2], "grid_points": 5, "gates": [2, 9]}], "lattice_size": 25, "grid_total": 25} | null,
 "routes": {
   "fourier":   {"feasible": true,  "mode": "dft_exact" | "least_squares", "evaluation": "statevector" | "ppe" | "none",
                 "reason": null, "estimate": {"grid_points": 25, "seconds": 0.2}},
   "shadow":    {"feasible": false, "reason": "Model is not declared as kind 'flipped'.", "locality": null, "snapshots_for": null},
   "data_only": {"feasible": false, "reason": "nuclei_dataset target is 'label', not 'model_output'."}},
 "training": {"available": true, "reason": null},
 "notes": []}
```

### 5.4 `deploy_train` (job)

Request `{"type": "deploy_train", "job_id", "code", "language"?, "params"?, "options": {"epochs": 50, "lr": 0.05, "batch_size": 32, "loss": "mse" | "bce", "holdout_fraction": 0.25, "seed": 0, "time_budget_s": 120, "backend": "auto"}}`
Stream: `deploy_started` → `deploy_progress {job_id, stage: "train", fraction, message}` → `deploy_partial {job_id, stage: "train", result: {"epoch", "train_loss", "holdout_loss"}}` (≤ 10/s) → `deploy_result`:

```json
{"type": "deploy_result", "job_id", "status", "kind": "train",
 "results": {"train": {"weights": {"w0": 0.31}, "epochs_run": 50, "stopped": "epochs" | "time_budget" | "cancelled",
             "curve": [[0, 0.41, 0.44], ...], "holdout": {"mse": 0.012, "mse_ci95": [0.009, 0.016], "n": 100},
             "dataset_sha256": "…"}},
 "errors": {}, "elapsed_ms": 9000,
 "provenance": {...trainability provenance..., "weights_sha256": "…", "dataset_sha256": "…", "training_options": {...}}}
```

### 5.5 `deploy_export` (job)

Request:

```json
{"type": "deploy_export", "job_id", "code", "language"?, "params"?, "weights"?: {"w0": 0.31},
 "route": "fourier" | "shadow" | "data_only" | "auto",
 "options": {"max_grid_points": 65536, "max_frequencies": 256, "holdout_fraction": 0.25, "validation_points": 512, "seed": 0,
             "method": "auto" | "statevector" | "ppe",
             "shadow": {"snapshots": 10000, "max_locality": 6, "delta": 0.05, "input_range": [[-3.14, 3.14], [-3.14, 3.14]], "snapshots_path"?: "experiments/run.shadows.json", "readout"?: {"p01": [...], "p10": [...]}},   // mom_groups is derived (K = ceil(2 ln(2M/δ))); snapshot files are read by the kernel from project_root (never shipped over the socket)
             "formats": ["numpy_py", "json", "onnx"], "embed_weights": false,
             "training_certificate_sha256"?: "…", "artifact_stem": "my_model"}}
```

Stream: `deploy_started` → `deploy_progress {stage ∈ evaluate|fit|validate|export}` → `deploy_partial` per stage → `deploy_result` with `kind: "export"`:

```json
{"results": {
   "fit": {"route": "fourier", "mode": "dft_exact", "evaluation": "statevector", "n_frequencies": 25, "grid_points": 25,
           "intervals": null | {"max_coefficient_half_width": 1.2e-3}},
   "validation": {"n_holdout": 512, "reference": "statevector" | "ppe" | "recorded",
                  "mse": 1.1e-24, "mse_ci95": [...], "mae": ..., "max_abs_error": ..., "r2": ...,
                  "verdict": "exact", "verdict_text": "The surrogate reproduces the quantum model to machine precision...",
                  "honesty": ["A 4-qubit model was classically simulable to begin with; this export is a convenience, not an advantage."]},
   "artifacts": {"files": {"my_model.surrogate.py": "<source>", "my_model.surrogate.json": {...}},
                 "onnx_base64": null,
                 "availability": {"onnx": {"available": false, "message": "Install 'onnx' in Environment setup to export ONNX."}}}},
 "provenance": {..., "surrogate_sha256": "…", "training_certificate_sha256": null, "linked": false}}
```

`deploy_cancel {job_id}` → `deploy_cancelled {job_id, accepted}`.

Error codes (phase `deploy`): `invalid_request`, `no_model_declaration`, `invalid_model_declaration` (with `field`), `invalid_dataset`, `unsupported_encoding` (with `source_line`), `route_not_applicable` (with `route`, `reason`, and the time estimate for the grid-feasibility case), `spectrum_too_large`, `weights_missing`, `untrained_model`, `shadow_locality_too_high`, `shadow_import_invalid`, `shadow_input_range_missing`, `artifact_stem_invalid`, `training_unavailable` (n > 20), `export_failed`, `deploy_busy`, `deploy_internal`, plus inherited trainability codes.

### 5.6 Frontend type additions

`src/types/symmetry.ts` and `src/types/deploy.ts` mirror the shapes above (`SymmetryRequest`/`SymmetryResponse`, `DeployRequest`/`DeployResponse` discriminated unions) and are added to the `KernelMessage`/`KernelResponse` unions in `src/types/quantum.ts` — all written by **F-2 in Wave 1**; no feature unit edits a shared type file.

---

## 6. Frontend / UX

### 6.1 Where it lives

Both features are **modes of the Trainability Lab** (`'trainability'` rail view, Research only). `TrainabilityLab.tsx` gets a `LabSegmented` mode switch at the top of the main area: **Analyze** (today's tabs) · **Symmetry** · **Deploy**. The `TargetBar` (editor file + observable + settings) is shared, so all three modes act on the same editor target. Each mode is its own component tree:

```
src/components/symmetry/   SymmetryPanel.tsx, DeclarationEditor.tsx, DetectionChips.tsx, RewriteTable.tsx,
                           CertificateCard.tsx, BeforeAfter.tsx, EmittedCode.tsx, symmetryState.ts, symmetry.css (tokens only)
src/components/deploy/     DeployPanel.tsx, ModelCard.tsx, RoutePicker.tsx, TrainCard.tsx, ValidationReport.tsx,
                           ExportCard.tsx, deployState.ts, deploy.css
src/stores/symmetryStore.ts, src/stores/deployStore.ts
src/services/symmetry/{client.ts, declarations.ts, fixtures.ts, insertCode.ts, context.ts, contextFromStores.ts}
src/services/deploy/{client.ts, modelSnippet.ts, artifactsIo.ts, fixtures.ts, context.ts, contextFromStores.ts}
```

Clients follow `src/services/trainability/client.ts` (`createTrainabilityClient(session)` → `createSymmetryClient`, `createDeployClient`), sharing one `LabSession` via `openLabSession` so there is one kernel socket.

### 6.2 User paths

**Symmetry (end to end)**
1. User opens any Python file with a Qiskit/Cirq parameterised circuit (e.g. `ansatz/tfim_ring.py`), Research mode, Trainability Lab → Symmetry.
2. On target change the panel runs `symmetry_detect` (debounced 800 ms, like inspect) and shows **Detection chips**: “translation: observable ✓ ansatz ✗”, with one‑click “Use”.
3. **Declaration editor**: preset chips (S_n, Cyclic, Dihedral, Reflection, Z₂ flip, U(1) charge, SU(2) spin) + “Custom…” (`LabField`s for permutation generators as `[1,2,3,0]`, Pauli strings, Pauli sums; validated client‑side with the same grammar as `pauli.parse_observable`, server‑side authoritative). Options drawer: strategy, non‑commuting policy, Trotter steps, fixed‑gate policy, observable twirl, initial state, emit targets, analyses.
4. **Compile** (primary `LabButton`, also ⌘‑palette “Symmetry: compile equivariant ansatz”). Progress bar with stage names; Cancel.
5. Results: Rewrite table (per gate, source line clickable → editor reveal via `requestReveal` pattern), Certificate card (exact / approximate / failed, with failing gates), Before/After card (two `LabKpi` columns: DLA dimension + classification, cost‑variance prediction, gradient variance as interval bars, simulability warning with link to Quantumness certificate), Emitted code (`LabCode` tabs Qiskit/Cirq/PennyLane with round‑trip badge).
6. **Insert into editor**: writes `ansatz/<stem>.symmetric.py` next to the source through `PlatformBridge.createFileExclusive` (stem validated against `[A-Za-z0-9._-]{1,64}`; an existing `<stem>.symmetric.py` triggers an explicit overwrite confirmation, never a silent overwrite), then opens it as the editor target — never overwrites the user's file; a secondary “Replace current file” asks for confirmation. The inserted file is immediately a valid Lab target, so the user can run Analyze on it (this is the acceptance e2e path).
7. **Export certificate** adds `experiments/<stem>.symmetry.json` (full result + provenance) using `certificateIo.ts`'s writer.

**Deploy (end to end)**
1. Same Lab, Deploy mode. On target change: `deploy_inspect`. Without a declaration: **Model card** shows the snippet and “Insert model declaration” (appends to the editor file, confirmation first).
2. Model card shows features/weights/observable/dataset and the **Route picker** with each route's feasibility and reason (greyed with the reason when not applicable); the Train card is enabled when weights are absent (or “Retrain”).
3. **Train** (optional): options, Run, live loss curve (`ChartFrame`), Cancel; result writes `experiments/<stem>.training.json` and fills the weights into the store (and offers “Write weights into file” which rewrites only the `"weights"` literal via a text patch with confirmation).
4. **Export**: pick route, formats, link training certificate (auto‑linked when trained here; otherwise a file picker over `experiments/*.training.json|*.trainability.json`), Run. Progress stages. Result: **Validation report** (metrics with intervals, verdict pill with the fixed sentence, honesty notes list, reference used), **Export card** with the files written to `experiments/deploy/<stem>.surrogate.{py,json}` (+ `.onnx` when available) and an “Open folder” action; ONNX unavailable shows the install message, never an error state.
5. Command palette: “Deploy: inspect model”, “Deploy: train model”, “Deploy: export classical surrogate”.

### 6.3 States (every component)

| State | Symmetry | Deploy |
|---|---|---|
| Unavailable (web build / no kernel) | reuse `LabDesktopRequired` / `unavailable` copy from trainability store | same |
| Idle, no target | `LabEmptyState`: “Open a Python file with a parameterised circuit.” | same |
| Idle, no parameters | detection still runs; Compile disabled with reason “no free parameters” | Model card with snippet |
| Detecting / inspecting | shimmer chips | shimmer card |
| Running | `LabProgress` with stage; Cancel (`cancelling` status until `*_cancelled`) | same, plus live curve for train |
| Partial | stages render as they arrive (`symmetry_partial`) | same |
| Result | as §6.2 | as §6.2 |
| Stage error | the stage card shows `errors[stage]` with code copy from `diagnosticCopy.ts` style map; other stages still render | same |
| Fatal error | `LabCard` danger tone with code + message + “Show details”; the kernel's `source_line`/`column` becomes an editor marker | same |
| Dependency unavailable | n/a (no optional deps) | ONNX: inline message with Environment‑setup link; never blocks |
| Not applicable | certificate `numerical.status = not_applicable` renders as a neutral pill with reason | route cards greyed with reason; verdict `inconclusive` |

### 6.4 Honesty copy (verbatim strings live in `src/services/{symmetry,deploy}/honesty.ts`)

- “Exact: every compiled gate commutes with every declared symmetry generator (checked symbolically).”
- “Approximate: non‑commuting twirl terms were Trotterised (r = {r}); measured residual {ε} over {K} parameter draws. This is evidence, not a proof of equivariance.”
- “A smaller DLA can mean the circuit is classically simulable. See the Quantumness certificate before claiming a quantum advantage.”
- “Intervals are shown as intervals. Ratios of intervals are intervals.”
- “Surrogate reproduces the quantum model to machine precision on {n} held‑out points. A {n_qubits}‑qubit model was classically simulable to begin with; this export is a deployment convenience.”
- “Fit on recorded outputs. This is a regression report, not a statement about the quantum model.”
- “Shadows were simulated classically here. On hardware they come from the QPU; the exported code is unchanged.”
- “Guaranteed: |error| ≤ {ε} for x in {box} with probability ≥ {1−δ}, from T = {T} snapshots in K = {K} median-of-means groups over M = {M} terms of locality ≤ {k} (Huang–Kueng–Preskill, Theorem 1 and Lemma 3). Empirical: bootstrap 95 % interval of the mean error {…}; max |error| observed {…}.”
- “Certified under an ideal-measurement assumption: these snapshots were imported and no readout calibration was supplied; readout error biases the estimator.”
- “Ratio of sampled intervals: ≥ 90 % joint coverage.”
- “Refused: every {group}-equivariant circuit acts on this initial state as a phase ({sector} = 1-dimensional sector). Prepare a state in a larger sector.”
- “The reachable symmetry sector is {dim}-dimensional, which is efficiently classically simulable (Anschuetz et al. 2023; Schatzki et al. 2024). See the Quantumness certificate.”

### 6.5 Dirac context

`src/services/symmetry/context.ts` and `src/services/deploy/context.ts` each register a compact context block (declaration, certificate status, sector dimension, DLA before/after; or route, verdict, metrics) with F-3's `src/services/dirac/contextProviders.ts` registry (Research only); nobody edits `useDirac.ts`.

---

## 7. Validation plan

### 7.1 Unit tests (kernel, `kernel/tests/`)

- `test_symmetry_spec.py`: parsing every kind; bad permutation (not a bijection, wrong length), bad Pauli text, qubit out of range → `invalid_symmetry` with position.
- `test_symmetry_groups.py`: orbit sizes (`s_n` multinomial formula; cyclic ≤ n), BFS termination at cap, SWAP‑network frames reproduce permutations (compare `CliffordFrame.map_string` with explicit relabelling on random strings, n ≤ 16).
- `test_symmetry_twirl.py`: closed‑form cases (§2.2 examples); killed generators under `z2_flip`; idempotence `T[T[H]] = T[H]`; linearity; HS‑orthogonality `⟨H − T[H], T[H]⟩ = 0`; alternating composite converges for `s_n + su2_spin`.
- `test_symmetry_synth.py`: commuting detection; synthesised Pauli rotation unitary equals `expm(−iφP/2)` (dense, n ≤ 4, `1e‑12`); Trotter flag; `ParamRef` coefficients.
- `test_symmetry_verify.py`: certificate passes on compiled circuits, fails on hand‑broken ones (one gate replaced), Lie bracket checks; **centraliser regressions**: SWAP(0,1) under `s_n` → `failed`, CZ(0,1) under `z2_flip` → `failed`, the ring CX under `cyclic` → `failed`, a full cyclic-shift SWAP network under `cyclic` → `exact`; a Pauli generator mapped to −R(g) → `failed`; dense n ≤ 5 operator cross-check of every `exact` certificate in the corpus.
- `test_symmetry_compile.py` (sector): `u1_charge` + |0…0⟩ → `trivial_symmetry_sector`; `u1_charge` + Néel → `sector_dimension = binomial(n, n/2)`; `su2_spin` + |0…0⟩ → refused; `s_n` on a product state → `sector_dimension = n + 1` and `simulability_warning` set with the Anschuetz et al. citation.
- `test_symmetry_emit.py` + `test_symmetry_roundtrip.py`: emitted Qiskit/Cirq re‑converts to identical IR for a corpus of 20 circuits (every gate name, shared params, offsets); PennyLane text is syntactically valid Python (`ast.parse`); **injection fuzz**: adversarial parameter names, observable texts and stems (quotes, newlines, `__import__`, `"); import os #`) produce modules that parse, contain only allow-listed calls and round-trip; invalid stems → `artifact_stem_invalid`.
- `test_deploy_model.py`: declaration validation matrix; dataset loading (arrays, callable, CSV with header, bad shapes); hashing determinism.
- `test_deploy_spectrum.py`: `Ω` for repeated `RX(x)` is `{−L..L}`; mixed coefficients; controlled rotations; unsupported encodings raise with the source line.
- `test_deploy_fourier.py`: DFT‑exact recovery on random circuits (n ≤ 6, d ≤ 3) — surrogate vs statevector at 200 random points `< 1e‑9`; least‑squares mode error decreases with `max_frequencies`; interval propagation: a synthetic evaluator with known half‑widths yields the predicted coefficient bounds and the Lebesgue-constant prediction bound contains the true error at 500 random x (0 violations) and is tighter than Σ_k h_k; CRX spectrum `{0, ±1/2, ±1}` with the least-common-unit rescaling; grid-feasibility refusal with the estimate.
- `test_deploy_shadow.py`: estimator unbiasedness (20 000 snapshots on a random 4‑qubit state, every weight‑≤3 Pauli within 4σ of the exact value); **constants pinned to HKP Theorem 1**: `plan()` returns `K = ⌈2 ln(2M/δ)⌉` and `N = ⌈34·3^k·α²/ε²⌉`, `guarantee()` returns `δ = min(1, 2M e^{−K/2})` and `ε = α·sqrt(34·3^k/N)` (table-driven), and `guarantee()` of the first draft's `K = 10` at `M = 100` is `δ = 1` → verdict never `certified`; `plan()` monotonicity; MoM coverage: over 200 seeds the guaranteed `(ε, δ=0.1)` bound is violated in ≤ 10 % + 3σ of runs; `input_range` required for the guarantee; imported snapshots without readout → `certified_ideal_measurement`; with readout calibration the mitigated estimator is unbiased under a simulated readout channel; import validation rejects bad shapes/values.
- `test_deploy_validate.py`: metrics against hand‑computed values; bootstrap CIs contain the point estimate; `max_abs_error` carries no bootstrap CI (order-statistic bound only when S_val ≥ 100); verdict table incl. `certified_ideal_measurement` and the `δ ≥ 1 → empirical` rule.
- `test_deploy_train.py`: loss decreases on a 2‑qubit linearly separable toy; determinism across two runs with the same seed; time budget stops cleanly; cancellation.
- `test_deploy_export.py`: generated `.py` runs in a fresh `python -I` subprocess with only numpy and passes its self‑check; the module contains no `pickle`/`np.load` call (AST assertion); JSON round‑trips; ONNX builder is skipped when `onnx` is absent (`pytest.importorskip`) and, when present, `onnxruntime`‑free structural validation via `onnx.checker`.
- `test_deploy_provenance.py`: hashes stable; `linked` flag semantics.

### 7.2 Physics validation (brute force, small n)

- **Twirl = dense projector**: for n ≤ 5 and random Pauli sums, build `R(g)` densely (permutation matrices, Pauli strings), compute `(1/|G|) Σ R H R†` and compare with `pauli_sum_matrix(T[H])` to `1e‑10`; for Lie components compare with the dense projection onto `∩ ker(ad_K)` via SVD of the stacked commutator superoperators.
- **Equivariance**: for every compiled circuit in the corpus whose certificate is `exact`, `‖R(g) U(θ) − U(θ) R(g)‖_F ≤ 1e‑9` for all `g` (dense, n ≤ 5), 16 random θ — and for every fixed Clifford gate kept as equivariant, `‖U_fixed R(g) − e^{iφ} R(g) U_fixed‖_F ≤ 1e‑10` (the centraliser check, densely).
- **Sector check**: `u1_charge` + |0…0⟩ gives exactly zero gradients densely (confirming why it is refused); the Néel preparation gives non-zero variance.
- **DLA shrinkage sanity**: HEA `RY`+`CZ` ring (n = 4, 6) under `cyclic`: after‑DLA ≤ before‑DLA; S_n‑twirled `RY/RZZ` ansatz on n = 4..6 has polynomial DLA growth consistent with Schatzki et al. (assert dimension ≤ `C·n³` for the tested n, with the constant recorded in the test, and the exact dims for n = 4, 5, 6 pinned once computed).
- **Fourier spectrum**: Schuld‑Sweke‑Meyer example (single qubit, `L` re‑uploads of `RX(x)`): numerically recovered coefficients vanish outside `{−L..L}` (`< 1e‑12`).
- **PPE interval honesty**: for circuits where PPE truncation is loose (deep ring, n = 10, low budget), assert the exact statevector Fourier coefficients lie inside the PPE‑propagated intervals in 100 % of 50 seeds.
- **Shadow bound**: as in §7.1 (coverage test with the Theorem 1 constants), plus agreement between simulated snapshots and exact expectation of a flipped model at 20 random `x` inside the declared input box.

### 7.3 Property tests (seeded loops; `hypothesis` via `importorskip` when present)

- Twirl idempotence and linearity on random Pauli sums (200 cases).
- IR → emit → load → IR identity on random IR circuits from a generator over `GATE_SPECS` (both frameworks).
- `validate.report` is invariant to permutation of samples; bootstrap seeded determinism.
- `spectrum` lattice is symmetric (`Ω = −Ω`).

### 7.4 Kernel integration tests (real subprocess jobs)

- `test_symmetry_handlers.py`: `symmetry_detect` echo `request_id`, malformed id; `symmetry_compile` on the fixture ring ansatz streams `started → progress → partial(compile, verify, before, after, emit) → result(complete)`; cancel mid‑`after` yields `cancelled` with earlier partials; busy limit shared with trainability (start 2 trainability + 1 symmetry for one owner → `symmetry_busy`); owner release kills the worker.
- `test_deploy_handlers.py`: inspect without declaration returns snippet; train job on the toy dataset completes with weights; export job writes artifacts in the reply; ONNX requested without `onnx` → `availability.onnx.available = false` and `status = complete`.
- Determinism: same request twice → identical `results` except `elapsed_ms` (compare after deleting that key), for `symmetry_compile` (lie + ppe) and `deploy_export` (fourier dft_exact; shadow with fixed seed).
- Minimal‑venv job (`pytest-minimal-venv` in `.github/workflows/kernel-tests.yml`): add `kernel/tests/test_symmetry_*.py kernel/tests/test_deploy_*.py` to its run list; these suites must pass with numpy + qiskit + cirq only (no scipy guarantee: the tests must not import scipy; `onnx` tests skip).

### 7.5 Frontend tests (Vitest)

- Stores: lifecycle reducers for every message (started/progress/partial/result/error/cancelled), stale‑reply dropping by `request_id`, `unavailable` handling, insert‑code path builds the correct sibling path and refuses path traversal.
- Components: every state in §6.3 renders without a blank box (snapshot + role queries); honesty strings present; interval rendering never collapses to a midpoint (assert `formatInterval` is used; a lint test greps components for `(lo + hi) / 2`).
- `certificate.ts`‑style renderers for `*.symmetry.json` and `*.training.json` have snapshot tests.

### 7.6 Playwright e2e (`tests/e2e/symmetry.spec.ts`, `tests/e2e/deploy.spec.ts`)

Stub‑kernel pattern from `trainability.spec.ts` (`?e2eProject=lab-project&workspace=research&labKernel=…`), with fixtures `src/services/symmetry/fixtures.ts` / `src/services/deploy/fixtures.ts` answering every v1.4 message. Fixture files added to `tests/e2e/fixtures/lab-project/`: `ansatz/tfim_ring.py` (translation‑symmetric observable, HEA ansatz), `models/fourier_2d.py` (declared model + `nuclei_dataset`), `models/flipped_demo.py`, `experiments/fourier_2d.training.json`. Scenarios:

1. Symmetry: open `tfim_ring.py` → detection chip “cyclic” appears → Use → Compile → progress → certificate “Exact” → before/after shows two DLA numbers → Qiskit tab shows “Round‑trip verified” → Insert into editor → the editor target becomes `ansatz/tfim_ring.symmetric.py` and Analyze mode's TargetBar shows it (acceptance of “usable on their own code”).
2. Symmetry errors: stub returns `noncommuting_twirl` → the error card names the gate and the option to switch to Trotter; switching and re‑running completes.
3. Symmetry cancel: cancel during `after` → status cancelled, compile/verify cards still rendered.
4. Deploy: open `models/fourier_2d.py` without weights → Train → curve updates → weights populate → Export (fourier) → validation report verdict “Exact” → files listed; ONNX unavailable message visible when the stub reports it.
5. Deploy no declaration: open `hardware_efficient.py` → Model card with snippet → Insert declaration → confirmation → file content contains `nuclei_model`.
6. Deploy not applicable: `flipped_demo.py` with locality 9 stub → shadow route greyed with the reason; verdict area shows nothing misleading; a stub `certified_ideal_measurement` export renders the ideal-measurement sentence; a stub `trivial_symmetry_sector` compile error renders the refusal with the suggested preparation.
7. Web build: `labAvailability = web_build` → both modes show the desktop‑required state, no console errors.

### 7.7 Desktop smoke (manual, release checklist)

`scripts/smoke_prd15.md`: start the packaged app with a fresh managed venv, run scenarios 1 and 4 against the real kernel on the fixture files, confirm no `analysis_unavailable`/`ImportError` appears, confirm the generated `.surrogate.py` self‑check passes from a terminal with the venv's Python.

---

## 8. Acceptance criteria

Symmetry
- [ ] All seven presets and all three custom kinds parse, validate and compile on the fixture corpus; invalid input yields `invalid_symmetry` with a position, never a crash.
- [ ] Twirl matches the dense projector to `1e‑10` on n ≤ 5 (finite and Lie components, and composites).
- [ ] Every circuit whose certificate says `exact` passes the dense equivariance check at n ≤ 5 and the statevector check at n ≤ 12 in CI; the centraliser regressions (SWAP under `s_n`, CZ under `z2_flip`, ring CX under `cyclic`) are `failed`.
- [ ] Compiles into a 1-dimensional symmetry sector are refused with `trivial_symmetry_sector`; polynomial sectors raise the simulability warning with the Anschuetz et al. 2023 citation.
- [ ] Trotterised compiles are never labelled `exact`; the residual is shown.
- [ ] Before/after Lie + gradients run on the compiled circuit with intervals; ratios are intervals; simulability warning appears when lie.py flags polynomial/g‑sim.
- [ ] Emitted Qiskit and Cirq round‑trip to identical IR on the corpus; PennyLane output is labelled unverified in the UI.
- [ ] “Insert into editor” creates a sibling file that the Analyze mode immediately accepts as a target (e2e scenario 1).
- [ ] Cancel, busy, owner‑release and wall‑limit behave exactly as trainability jobs (integration tests).
- [ ] Works in the minimal venv (numpy/qiskit/cirq only).

Deploy
- [ ] `deploy_inspect` returns a usable snippet when the declaration is missing; inserting it makes the file inspectable.
- [ ] Route feasibility is reported with a reason for every route on every fixture; no route is ever silently chosen.
- [ ] Fourier DFT‑exact surrogate agrees with statevector to `< 1e‑9` on held‑out points; its verdict is `exact` and the honesty note about classical simulability is present.
- [ ] PPE‑route coefficients carry intervals that contain the exact values on the interval test corpus.
- [ ] Shadow route: `(ε, δ)` computed from the actual `(T, K, M, k, ‖α‖₁)` with HKP Theorem 1's constants (`K = 2 ln(2M/δ)`), over a declared input box; `certified` never printed when `δ ≥ 1`; imported snapshots without readout calibration are `certified_ideal_measurement`; empirical coverage test passes; snapshot files are read from `project_root` and validated.
- [ ] Emitted code and `.surrogate.py` render every user string as a literal; fuzz tests with adversarial names pass; stems are validated; Insert uses exclusive creation with overwrite confirmation.
- [ ] Route C output is labelled as a regression everywhere it is shown.
- [ ] The generated `.surrogate.py` runs in `python -I` with numpy only and passes its self‑check; JSON carries all provenance hashes and the `linked` flag.
- [ ] ONNX absence is a message, not an error; presence produces a file that `onnx.checker` accepts.
- [ ] In‑app training is deterministic per seed, cancellable, and refuses n > 20 with `training_unavailable`.
- [ ] e2e scenarios 1–7 pass; Vitest coverage ≥ 80 % for the new `src/` directories; kernel coverage ≥ 80 % for `kernel/symmetry` and `kernel/deploy`.

Cross‑cutting
- [ ] Protocol version `1.4` in provenance; docs pages published; no new required dependency.

---

## 9. Implementation units and file ownership

**The master plan's §7 tables are the only ownership record.** This section maps the spec's logical units onto master units and names exactly the master's files. There are **no shared edits and no `# PRD15-03` marked blocks**: `server.py`, `provenance.py`, `lab_proc.py`, `lab_routes.py`, `quantum.ts`, `TrainabilityLab.tsx`, `CommandPalette.tsx`, `useDirac.ts` and `e2eFixtureBridge.ts` are owned by F-1/F-2/F-3/G2 in Wave 1 and are never touched by the units below (`scripts/check-wave-ownership.py` enforces it).

| Spec unit | Master unit (wave) | Scope | Files (verbatim from master §7) |
|---|---|---|---|
| S1 Symmetry core (+ `detect.py`) | **S1** (Wave 2b) | spec, groups, twirl, synth, compile (incl. `sector_dimension`), verify (centraliser equality), detect, compare | `kernel/symmetry/{__init__,spec,groups,twirl,synth,compile,verify,detect,compare}.py`, `kernel/tests/test_symmetry_{spec,groups,twirl,synth,compile,verify,detect,compare,physics}.py`, `kernel/tests/_symmetry_helpers.py` |
| S2 Emission + round trip, S3 Symmetry protocol, **and `propose.py`** (it emits source through `emit.py`, so it cannot land before S2) | **S2+S3** (Wave 3a) | emit (literal-safe), roundtrip, `propose_rewrites` + the `symmetry_propose` sync handler, settings, handlers, jobs, worker, docs fixtures | `kernel/symmetry/{emit,roundtrip,propose,_settings,handlers,jobs,job_worker}.py`, `kernel/tests/test_symmetry_{emit,roundtrip,propose,handlers}.py`, `docs-site/fixtures/lab_symmetry_*.json`, `docs-site/fixtures/lab/symmetry_compile.stream.json` |
| D1 Deploy core (minus the fitters, which are spec 01's Q3) + D2 Trainer | **D1+D2** (Wave 3a) | model/dataset declarations (through F-1's `declarations.py`/`dataset.py`), `spectrum`/`surrogates` re-exports, evaluate (incl. per-eval timing for the grid-feasibility check), validate (verdict table incl. `certified_ideal_measurement`), train | `kernel/deploy/{__init__,model,dataset,spectrum,evaluate,validate,train}.py`, `kernel/deploy/surrogates/__init__.py` (re-exports), `kernel/tests/test_deploy_{model,routes,fourier_intervals,validate,train,physics}.py`, `kernel/tests/_deploy_helpers.py` |
| D3 Export + protocol | **D3** (Wave 4a) | exporters (json-only weight loading, literal-safe), provenance, settings, handlers, jobs, worker, `from_surrogate.py` (Fourier only in v1), docs fixtures | `kernel/deploy/{export_numpy,export_json,export_onnx,provenance,_settings,handlers,jobs,job_worker,from_surrogate}.py`, `kernel/tests/test_deploy_{export,provenance,handlers,from_surrogate}.py`, `docs-site/fixtures/lab_deploy_*.json`, `docs-site/fixtures/lab/deploy_{train,export}.stream.json` |
| S4 Symmetry frontend plumbing + S5 Symmetry UI | **FE-S** (Wave 4b) | client, store, fixtures, panel, `labModes.ts` registration, palette commands file, Dirac context provider, e2e | `src/components/symmetry/**`, `src/services/symmetry/**`, `src/stores/symmetryStore.ts`, `src/components/trainability/features/symmetryCommands.ts`, `tests/e2e/symmetry.spec.ts`, `tests/e2e/real/symmetry.real.spec.ts`, `tests/e2e/fixtures/lab-project/ansatz/tfim_ring.py` |
| D4 Deploy frontend plumbing + D5 Deploy UI | **FE-D** (Wave 5a) | client, store, fixtures, panel, `labModes.ts` registration, palette commands file, Dirac context provider, e2e | `src/components/deploy/**`, `src/services/deploy/**`, `src/stores/deployStore.ts`, `src/components/trainability/features/deployCommands.ts`, `tests/e2e/deploy.spec.ts`, `tests/e2e/real/deploy.real.spec.ts`, `tests/e2e/fixtures/lab-project/{models/fourier_2d.py,models/flipped_demo.py,experiments/fourier_2d.training.json}` |
| X1 Docs + CI | **X** (Wave 5b) | docs-site pages, `messages-lab.mdx` v1.4 sections, changelog, CI job lists, smoke script | per master §7 |

Types (`src/types/{symmetry,deploy}.ts`, the `quantum.ts` unions) are written by F-2 in Wave 1 from §5; the pure fitters (`kernel/surrogates/{spectrum,fourier,rff,shadow}.py`) by Q3 in Wave 2a. S2+S3 depend on S1; D1+D2 depend on Q3; D3 depends on D1+D2; FE-S/FE-D build against `src/services/{symmetry,deploy}/fixtures.ts` (F-2) first.

Estimated size: S1 ≈ 1 900 LOC kernel + tests; S2+S3 ≈ 1 500; D1+D2 ≈ 1 600; D3 ≈ 1 100; FE-S ≈ 2 100; FE-D ≈ 2 100; X ≈ 400. Files stay under 800 lines (split `twirl.py` into `twirl.py` + `_twirl_lie.py` if needed; same for `fourier.py` + `_fourier_dft.py`).

---

## 10. Cross‑spec interfaces

Named here so no spec designs them twice. If the other spec is not landed when a unit here needs the interface, the unit here codes against the signature below and the lead reconciles.

**From Spec 01 (Quantumness certificate / surrogate suite / goldilocks)**
- `kernel.surrogates.quick.certificate_cheap(circuit: ParamCircuit, observable: PauliSum, *, time_budget_s: float, seed: int, cancel) -> dict` (spec 01 §3.6 shape with `evidence: "cheap"`) and `kernel.surrogates.quick.is_available() -> bool`. Used by `symmetry/compare.py` **only** to enrich `simulability_warning` when available (import guarded; absent → warning is based on lie.py flags alone). The UI link target is the Trainability Lab's `quantumness` tab.
- The pure fitters are implemented once in `kernel/surrogates/` (spec 01 unit Q3): `kernel.surrogates.fourier.{fit_dft, fit_least_squares, predict}`, `kernel.surrogates.shadow.{simulate_snapshots, load_snapshots, budget, predict}`, `kernel.surrogates.rff`, `kernel.surrogates.spectrum.feature_spectra`. They are pure functions over IR + `PauliSum` with no protocol dependencies; `kernel/deploy/spectrum.py` and `kernel/deploy/surrogates/__init__.py` re-export them, and D1 adds only the deploy-specific evaluation adapters and validation.
- A winning suite surrogate carries `exportable: {"kind": "fourier", "ref"}` — `EXPORTABLE_KINDS = {"fourier"}` in v1 (master §2.3): only the Fourier route has validated accuracy semantics here; `kernel/deploy/from_surrogate.py` (D3) turns that reference into a pre-selected Fourier export ("Export winning surrogate" in the Quantumness tab), and 𝔤-sim/MPS/light-cone wins show "no export route in v1". Widening the set requires this spec to define a self-checking export with per-call rigorous bounds for that kind first.
- `certificate_cheap` results carry spec 01's `brute_force` status; `compare.py` never quotes a brute-force result as "simulable" (it renders "brute-force simulable at n = N").

**From Spec 02 (Noisy trainability and kernels)**
- No hard dependency. If Spec 02 exposes `kernel.noise.lab.apply_noise_model(circuit, model) -> ParamCircuit`‑style transforms, the Symmetry before/after could run under noise in a later version; not in scope here.

**To Spec 04 (Learned decoders / verified suggestions)**
- `symmetry_detect` candidates and the `GateRewrite` table are the inputs a “verified suggestion” could present; Spec 04 may call `kernel.symmetry.detect.detect_presets` directly (pure, sync).

**Shared infrastructure touched by several specs**
- `kernel/lab_routes.py` (prefix registry) — created **and fully populated** by master F-1 (Wave 1) with lazy imports; S2+S3 and D3 add nothing to it.
- `kernel/lab_proc.py` global job counter — created by F-1: `lab_proc.register_manager(manager)`; managers call `lab_proc.total_running()` in `_start_job`, so the Lab‑wide cap of 4 holds across trainability/discovery/symmetry/deploy/qec_learned.
- `src/types/quantum.ts` unions and the new type files are written by F-2 (Wave 1); `labModes.ts`, the palette feature-command registry, the Dirac context-provider registry and the e2e fixture registry are created by F-3/G2 (Wave 1) — S4/S5/D4/D5 add their own registration files and never edit the shared ones.

---

## 11. Risks and open questions

Risks
- **Non‑commuting twirls are common for generic gates under `su2_spin`.** Mitigation: default `strategy: auto` picks orbit‑sharing for permutation groups and twirl otherwise; the UI explains Trotter trade‑offs; the exact‑synthesis path covers all commuting cases. Open: whether to add an `expm`‑based dense gate to the IR for n ≤ 10 (breaks the Clifford‑only Lie path; not planned).
- **Multi‑angle `U`/`U3` gates** have no single generator; they are rejected for twirling (`unsupported_gate_for_twirl`) with the suggestion to decompose into `RZ·RY·RZ` (which `convert.py` already does for Qiskit `u` when angles are linear).
- **Orbit size under `s_n`** explodes for weight ≥ 3 generators at n ≥ 12. Mitigation: cap + message; for S_n the literature's gate sets are weight ≤ 2 (Schatzki et al.), which stay small.
- **PPE‑route Fourier intervals may be very loose** for deep circuits (sum over the grid). The report shows them; it never hides looseness behind a point estimate. Open: adaptive grid refinement is out of scope.
- **Shadow route's `3^k` blow‑up**: `k = 6` already costs `729×` variance; the UI shows the `T` needed before the user runs. Open: biased‑shadow / derandomised schemes (HKP 2021 derandomisation) are a follow‑up.
- **In‑app training is slow** for n ≈ 16–20 with parameter‑shift gradients (2m statevector runs per sample). Mitigation: minibatches, time budget, progress; the copy says “for larger models, train elsewhere and paste weights”.
- **Shared file edits** across four specs are removed by the master's Wave 1 registries; this spec has none.
- **Symmetry sectors.** The natural presets (`u1_charge`, `su2_spin`) from |0…0⟩ land in 1-dimensional sectors; without the §2.5 check the feature would report "symmetry destroyed trainability". Mitigation: the refusal and the preparation options; `singlet_pairs` ships in v1 for this reason.
- **`scipy` presence** is not guaranteed by `requirements.txt` even though Qiskit depends on it; every use is lazy with a numpy fallback, and the minimal‑venv CI job proves it.

Open questions
1. ~~Should `symmetric_initial_state: singlet_pairs` ship in v1?~~ **Decided:** yes — it is the only way to leave the 1-dimensional `su2_spin` sector from a product state (§2.5).
2. ~~Does Spec 01 want the Fourier/shadow fitters in `kernel/deploy/surrogates/` (this spec) or `kernel/quantumness/`?~~ **Decided:** `kernel/surrogates/` (master §2.3); this spec re-exports.
3. Should the Deploy mode also accept weights pasted as JSON in the UI (no file edit)? (Recommend yes, v1: a `LabField` textarea that becomes `weights` on the request.)
4. A `TRN008 symmetry_mismatch` lint rule (observable invariant, ansatz not): wanted, but it edits `lint.py`, which PRD 14 owns; propose as a follow‑up PR after PRD 15 merges.
5. Hardware shadows: should Nuclei run the random‑Pauli measurement circuits on a configured provider (Hardware panel) and build the snapshot file itself? Natural follow‑up; v1 only imports.
6. Claude model use: none required. Optional later: Dirac explains the rewrite table (`claude-sonnet-5-5`) using the context block; no new endpoint.

---

## 12. References

Verified (arXiv id and venue checked 2026‑10‑19 unless marked):

1. J. J. Meyer, M. Mularski, E. Gil‑Fuster, A. A. Mele, F. Arzani, A. Wilms, J. Eisert, “Exploiting symmetry in variational quantum machine learning”, PRX Quantum 4, 010328 (2023); arXiv:2205.06217.
2. M. Larocca, F. Sauvage, F. M. Sbahi, G. Verdon, P. J. Coles, M. Cerezo, “Group‑invariant quantum machine learning”, PRX Quantum 3, 030341 (2022); arXiv:2205.02261.
3. Q. T. Nguyen, L. Schatzki, P. Braccia, M. Ragone, P. J. Coles, F. Sauvage, M. Larocca, M. Cerezo, “Theory for equivariant quantum neural networks”, PRX Quantum 5, 020328 (2024); arXiv:2210.08566.
4. L. Schatzki, M. Larocca, Q. T. Nguyen, F. Sauvage, M. Cerezo, “Theoretical guarantees for permutation‑equivariant quantum neural networks”, npj Quantum Information 10, 12 (2024); arXiv:2210.09974.
5. F. Sauvage, M. Larocca, P. J. Coles, M. Cerezo, “Building spatial symmetries into parameterized quantum circuits for faster training”, Quantum Sci. Technol. 9, 015029 (2024); arXiv:2207.14413.
6. S. Jerbi, C. Gyurik, S. C. Marshall, R. Molteni, V. Dunjko, “Shadows of quantum machine learning”, Nature Communications 15, 5676 (2024); arXiv:2306.00061.
7. H.‑Y. Huang, R. Kueng, J. Preskill, “Predicting many properties of a quantum system from very few measurements”, Nature Physics 16, 1050–1057 (2020); arXiv:2002.08953 — Theorem 1 (K = 2 ln(2M/δ) groups of N = 34‖O‖²_shadow/ε² snapshots; Supp. Eq. S13) and Lemma 3 (Pauli shadow norm 3^k).
8. M. Schuld, R. Sweke, J. J. Meyer, “Effect of data encoding on the expressive power of variational quantum‑machine‑learning models”, Phys. Rev. A 103, 032430 (2021); arXiv:2008.08605.
9. F. J. Schreiber, J. Eisert, J. J. Meyer, “Classical surrogates for quantum learning models”, Phys. Rev. Lett. 131, 100803 (2023); arXiv:2206.11740.
10. J. Landman, S. Thabet, C. Dalyac, H. Mhiri, E. Kashefi, “Classically approximating variational quantum machine learning with random Fourier features”, ICLR 2023; arXiv:2210.13200.
11. R. Sweke, E. Recio‑Armengol, S. Jerbi, E. Gil‑Fuster, B. Fuller, J. Eisert, J. J. Meyer, “Potential and limitations of random Fourier features for dequantizing quantum machine learning”, Quantum 9, 1640 (2025); arXiv:2309.11647.
12. M. Ragone, B. N. Bakalov, F. Sauvage, A. F. Kemper, C. Ortiz Marrero, M. Larocca, M. Cerezo, “A Lie algebraic theory of barren plateaus for deep parameterized quantum circuits”, Nature Communications 15, 7172 (2024); arXiv:2309.09342.
13. M. Cerezo, M. Larocca, D. García‑Martín, N. L. Diaz, P. Braccia, E. Fontana, M. S. Rudolph, P. Bermejo, A. Ijaz, S. Thanasilp, E. R. Anschuetz, Z. Holmes, “Does provable absence of barren plateaus imply classical simulability? Or, why we need to rethink variational quantum computing”, Nature Communications 16, 7907 (2025), doi:10.1038/s41467-025-63099-6; arXiv:2312.09121.
14. M. L. Goh, M. Larocca, L. Cincio, M. Cerezo, F. Sauvage, “Lie‑algebraic classical simulations for variational quantum computing”, arXiv:2308.01432 (2023) — already cited by `lie.py`.
15. A. A. Mele, “Introduction to Haar measure tools in quantum information: a beginner's tutorial”, Quantum 8, 1340 (2024); arXiv:2307.08956.
16. E. Gil‑Fuster, J. Eisert, C. Bravo‑Prieto, “Understanding quantum machine learning also requires rethinking generalization”, Nature Communications 15, 2277 (2024); arXiv:2306.13461.
17. M. C. Caro, H.‑Y. Huang, M. Cerezo, K. Sharma, A. Sornborger, L. Cincio, P. J. Coles, “Generalization in quantum machine learning from few training data”, Nature Communications 13, 4919 (2022); arXiv:2111.05292.
18. A. Pérez‑Salinas, A. Cervera‑Lierta, E. Gil‑Fuster, J. I. Latorre, “Data re‑uploading for a universal quantum classifier”, Quantum 4, 226 (2020); arXiv:1907.02085.
19. H.‑Y. Huang, R. Kueng, J. Preskill, “Efficient estimation of Pauli observables by derandomization”, Phys. Rev. Lett. 127, 030503 (2021); arXiv:2103.07510 [verify].
20. E. R. Anschuetz, A. Bauer, B. T. Kiani, S. Lloyd, “Efficient classical algorithms for simulating symmetric quantum systems”, Quantum 7, 1189 (2023); arXiv:2211.16998 — the simulability-warning citation for polynomial symmetry sectors.
21. E. R. Anschuetz, B. T. Kiani, “Quantum variational algorithms are swamped with traps”, Nature Communications 13, 7760 (2022); arXiv:2205.05786.
