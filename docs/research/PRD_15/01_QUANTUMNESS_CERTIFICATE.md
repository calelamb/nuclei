# PRD 15 · Spec 01 — Quantumness Certificate and the Goldilocks Discovery evaluator

**Status:** Spec v1 (2026-10-19) · binding technical contract for the parallel build · branch `feat/prd15-quantumness-lab` (based on v0.14.1)
**Workspace:** Research mode only (Learn is byte-for-byte unchanged)
**Protocol:** Kernel lab messages **v1.4** (additive-only on v1.3; `kernel/trainability/provenance.py: PROTOCOL_VERSION = "1.4"`)
**Depends on:** PRD 14 (`docs/research/PRD_14_QUANTUM_AI_LAB.md`, `PRD_14_ADDENDUM.md`) — the IR, Lab Compiler, PPE, Lie closure, scaling verdicts, provenance, job system, Discovery evaluators/audits/conjectures. Everything below **reuses** those modules; nothing is reinvented.

This document is both the product requirement and the implementation contract. Wire shapes, file layouts, signatures and ownership are fixed. If a contract here is wrong, raise it; do not silently diverge.

---

## 0. One-paragraph summary

**Idea 1 — Quantumness Certificate.** A new Trainability Lab analysis, `surrogates`, runs a *suite of classical simulation attacks* on the user's parameterized circuit + observable and combines it with the Lab's existing trainability evidence into a **joint verdict**: `untrainable`, `trainable_simulable` (which surrogate wins, at what cost and accuracy), `trainable_resists_implemented_surrogates`, or `inconclusive`. Every surrogate has a declared applicability condition, a cost model, an accuracy target and a rigorous or labelled-heuristic error bound. The verdict is exported into the existing PRD 14 §D certificate with full provenance.

**Idea 2 — Goldilocks evaluator.** A Discovery Engine evaluator, `goldilocks`, whose objective rewards *certified* trainability **and** resistance to the surrogate suite — searching the "just right" zone the Cerezo et al. conjecture (arXiv:2312.09121) says may be empty. It ships with a screen → full → confirm cascade, MAP-Elites descriptors, anti-gaming guardrails, a Red Queen audit in which the surrogate suite (with larger budgets and adversarial variants) is the attacker, and a Conjecture Engine hook.

**The honest frame, stated once and repeated in the UI:** "Resists all implemented surrogates" is a statement about *these implementations at these budgets*. It is **not** a proof of classical hardness and **not** a claim of quantum advantage. It is a lead.

---

## 1. Motivation and novelty

### 1.1 Why

PRD 14 made the trainability half of the question visible (gradient variances, scaling laws, DLA). The other half — *is this trainable only because it is classically simulable?* — is answered today by one instrument (the DLA / 𝔤-sim card) plus the PPE's bound. That is one surrogate. The literature now lists several distinct classical routes to a variational cost:

| Route | Representative reference | What it exploits |
|---|---|---|
| Pauli propagation (Heisenberg picture, truncated) | Angrisani et al., arXiv:2409.01706 (v2 narrows the guarantee to random unstructured circuits); Rudolph et al., LOWESA, arXiv:2308.09109 | Small effective Pauli weight / average-case concentration |
| Lie-algebraic simulation (𝔤-sim) | Goh et al., arXiv:2308.01432; Ragone et al., Nat. Commun. 15, 7172 (2024) | Polynomial-dimension dynamical Lie algebra |
| Stabilizer-rank / sum-over-Cliffords | Bravyi & Gosset, PRL 116, 250501 (2016); Bravyi et al., Quantum 3, 181 (2019) | Few non-Clifford gates |
| Tensor networks (MPS) | Vidal, PRL 91, 147902 (2003); Schollwöck, Ann. Phys. 326, 96 (2011); Zhou, Stoudenmire & Waintal, PRX 10, 041038 (2020) | Low entanglement across a 1D cut |
| Light-cone / locality | Bravyi, Gosset & Movassagh, Nat. Phys. 17, 337 (2021) | Shallow depth + local observable |
| Fourier-series surrogate of a learning model | Schreiber, Eisert & Meyer, PRL 131, 100803 (2023); Schuld, Sweke & Meyer, PRA 103, 032430 (2021); Nemkov, Kiktenko & Fedorov, PRA 108, 032406 (2023) | Small frequency spectrum of data re-uploading |
| Random Fourier features dequantization | Landman et al., arXiv:2210.13200 (ICLR 2023); Sweke et al., Quantum 9, 1640 (2025) | Spectrum sampling + linear regression |
| The conjecture tying the halves together | Cerezo et al., arXiv:2312.09121 | Absence of BPs ⇒ a polynomial subspace ⇒ simulability (conjectured) |

No shipping tool runs these **as a suite on the user's own circuit**, with a shared accuracy target, per-route cost accounting, cross-validation between routes, and a reproducible certificate. That is the product.

### 1.2 What is genuinely new

1. **A joint, quantitative verdict map.** Trainability evidence (PRD 14) × simulability evidence (this suite), with per-cell semantics and an explicit evidence level, rather than two separate cards.
2. **Cross-validated surrogate suite.** Every surrogate that claims a win must agree with every other winner (and with statevector when n ≤ 20) within the accuracy target, or its win is revoked and the suite reports `suite_inconsistent`. The suite catches its own bugs.
3. **Rigorous-interval MPS.** A numpy-only MPS circuit simulator whose truncation error is accumulated into a *rigorous* bound on ⟨O⟩ (§2.5), not only a convergence heuristic. Both numbers are reported, labelled.
4. **𝔤-sim as an actual simulator, not only a dimension check.** PRD 14 says "g-sim feasible"; this spec computes ⟨O⟩ by 𝔤-sim (adjoint representation on the DLA basis) and verifies it.
5. **Claim classes.** Surrogates are split into *dequantization of the cost* (PPE, 𝔤-sim, stabilizer, MPS, light cone) and *surrogates of a trained learning model* (Fourier, RFF). The verdict never conflates "the cost is classically computable for random θ" with "a trained model's input-output map has a classical twin".
6. **Goldilocks search with the suite as the adversary.** Red Queen mode (PRD 14 §F) is turned on the surrogate suite itself: the audit attacks a "resistant" elite with bigger budgets and adversarial variants (qubit-order permutations for MPS, Clifford pre-conjugation for the light cone, fresh parameter points).
7. **Machine-checkable conjectures about simulability**, through new whitelisted conjecture features (`weakest_surrogate`, `mps_chi_needed`, `resistance`).

What is **not** claimed: hardness proofs, advantage, or completeness of the suite. §2.9 states the claim exactly.

---

## 2. Math and physics

### 2.1 Setting and notation

- A `ParamCircuit` (PRD 14 §5.1): n qubits, gates `IrGate`, parameters θ ∈ ℝᵐ; input |0ⁿ⟩.
- Observable O = Σⱼ cⱼ Qⱼ (`PauliSum`, §5.3), ‖O‖₁ := Σⱼ |cⱼ| ≥ ‖O‖_op.
- Cost C(θ) = ⟨0|U(θ)† O U(θ)|0⟩.
- Parameter distribution 𝒟: `uniform` (U[0,2π)ᵐ) or `small` (N(0, 0.1²)ᵐ), as PRD 14. The suite draws K evaluation points θ⁽¹⁾…θ⁽ᴷ⁾ ~ 𝒟 from `default_rng(seed)`, **shared by every surrogate** so results are comparable.
- Accuracy target ε (absolute, on C). Default ε = 0.01 · max(1, ‖O‖₁) — scaled so that an observable with many terms is not held to an unattainable absolute error. The UI shows ε in both absolute and relative (ε/‖O‖₁) form.
- A surrogate S **wins** at point k when it returns an estimate Ĉ with a bound |Ĉ − C(θ⁽ᵏ⁾)| ≤ ε that is *rigorous* (R) or *heuristic* (H, labelled), inside its budget. S **wins overall** when it wins at every point. Any other outcome is one of `fails` (ran, bound > ε), `budget_exhausted`, `not_applicable` (precondition false, reason given), `unavailable` (optional dependency missing — none are required in v1), `error`.

### 2.2 Surrogate S1 — Pauli propagation (reuse)

- Uses `pauliprop.ppe_expectation_bounds(circuit, O, values, max_frontier, time_budget_s, min_weight_abs)` (PRD 14 §5.4b; `ppe_core.expectation_bounds`). Shared/affine parameters are allowed here (expectation mode).
- **Applicability:** every parameterized gate is a single-Pauli rotation and every fixed gate is Clifford (`ppe_applicable` with `init` ignored for expectations); otherwise `not_applicable: "non-Pauli rotation or non-Clifford fixed gate"`.
- **Estimator:** the Heisenberg Pauli-path sum with truncation by min |weight| and max Pauli weight; the returned interval `[kept − D, kept + D]` is rigorous (D = discarded ℓ1 mass). Win ⇔ D ≤ ε at every point (bound kind R).
- **Cost model:** predicted = `2^{t_eff}` worst case (t_eff = number of rotations in the backward light cone of O, §2.6); measured = `frontier_peak` (strings) and elapsed. Reported cost = `log10(frontier_peak)`, censored at `max_frontier` as in addendum §B.
- **Schedule:** a doubling sweep of `max_frontier` ∈ {2⁵…2^{⌈log₂ max⌉}} with `min_weight_abs = 0`; stop at the first frontier whose D ≤ ε. `chi_needed`-style metric: `frontier_needed` = first winning frontier size (or null).
- **Validity notes:** for `uniform` 𝒟 the *average-case* guarantee of Angrisani et al. applies only to the unstructured-random-circuit setting their v2 states; the certificate reports only what the rigorous interval says at the sampled points and never invokes the average-case theorem as a guarantee for structured circuits.

### 2.3 Surrogate S2 — 𝔤-sim (Lie-algebraic simulation), new simulator

**Theory** (Goh et al., arXiv:2308.01432). Let 𝔤 = span_ℝ⟨iG̃₁,…,iG̃ₘ⟩_Lie with effective generators G̃ₖ (fixed gates pushed to the end, PRD 14 §5.5), basis {Bₐ}_{a=1..d}, d = dim 𝔤. Write O = Σₐ oₐ Bₐ + O_⊥ with O_⊥ ⊥ 𝔤 (Hilbert–Schmidt). For a product of exponentials U = ∏ₖ e^{−iθₖG̃ₖ} and any A ∈ 𝔤, U† A U ∈ 𝔤, and the adjoint action is linear on the coefficient vector: `ad(θₖ) = exp(θₖ · ad_{G̃ₖ})` with (ad_{G̃ₖ})_{ab} the structure constants from [G̃ₖ, B_b] = Σₐ f_{ab}^{(k)} Bₐ (real after the usual Hermitian/anti-Hermitian bookkeeping). Then

  C(θ) = Σₐ (U† O U)ₐ ⟨0|Bₐ|0⟩ + ⟨0|U† O_⊥ U|0⟩.

The second term is **not** computable by 𝔤-sim. Therefore:

- **Applicability:** `lie_algebra` status `complete`, d ≤ `max_dimension` (default 2048), and **O ∈ 𝔤** (purity `observable_in_algebra` with residual ‖O_⊥‖₂/‖O‖₂ ≤ 1e-9). The alternative route (ρ ∈ 𝔤, evolve the state's coefficients instead) is also implemented: applicability is `O ∈ 𝔤 or ρ₀ ∈ 𝔤` (ρ₀ = |0⟩⟨0| ∈ 𝔤 iff 𝔤 contains all of {I,Z}ⁿ projector components — rarely true; implemented because it is cheap and the lint already computes purities). Otherwise `not_applicable: "neither the observable nor the initial state lies in 𝔤"` — this is exactly the PRD 14 "g_sim_not_applicable" case (`verdict.ts: G_SIM_NOT_APPLICABLE_TEXT`), now made quantitative.
- **Estimator:** build the d×d real matrices ad_{G̃ₖ} from Pauli-string commutators (reuse `symplectic.multiply`/`commutator_string`; for the Pauli-sum closure path use `lie_core`'s sparse vectors). Evaluate `v ← expm(θₖ ad_k) v` right-to-left over the gates. Use `scipy.linalg.expm` when scipy is present, else a numpy Padé(13) with scaling-and-squaring (`kernel/trainability/_expm.py`, ~60 lines, tested against scipy when available). Rotations by the same generator share one eigendecomposition: ad_k is real antisymmetric in an orthonormal basis, so `expm(θ ad) = V diag(e^{iθλ}) V†` once per distinct generator (O(d³) once, O(d²) per gate). ⟨0|Bₐ|0⟩ via `expectation_zero_state`.
- **Accuracy:** exact to floating point; bound kind R with declared tolerance 1e-8·‖O‖₁ (unit tests enforce 1e-8 against statevector for n ≤ 8).
- **Cost model:** predicted = d³ (setup) + gates·d² ; measured elapsed. Reported cost = `log10(d)`. 𝔤-sim "wins" iff applicable and the evaluation completes in budget.
- **Validity:** none of this assumes a 2-design; the Ragone variance *prediction* keeps its PRD 14 assumptions and is not used here.

### 2.4 Surrogate S3 — Clifford dominance / stabilizer-rank cost

- **Observation:** a Pauli rotation e^{−iθP/2} = cos(θ/2) I − i sin(θ/2) P is a sum of two Cliffords; a circuit with t non-Clifford gates has stabilizer rank ≤ 2ᵗ, and the Heisenberg Pauli-path sum over all 2ᵗ branches *is* the untruncated PPE (S1 with `min_weight_abs = 0`, no weight cap). Exact simulation cost is therefore bounded by `min(2^{t_eff}, frontier_peak)`.
- **t_eff:** count the parameterized gates in the backward light cone of O (§2.6) whose angle at θ⁽ᵏ⁾ is not within 1e-9 of a multiple of π/2 (`is_clifford_gate(name, angles)` from `symplectic`), plus non-Clifford fixed gates (T, TDG, U/P/RZ at generic angles, CCX/CCZ/CSWAP…). Because θ ~ 𝒟 is continuous, parameterized gates are generically non-Clifford; the detector is therefore mainly a **structural** classifier: "this circuit is Clifford with t_eff dressing gates".
- **Applicability:** always (it is a count). It **wins** only when t_eff ≤ `t_max` (default 24) **and** the exact PPE run (S1 with `min_weight_abs = 0`, `max_frontier = 2^{t_eff}`) completes with D = 0. Otherwise `fails` with the cost report. Bound kind R (exact).
- **Non-Pauli non-Clifford fixed gates** (e.g. CCX) are decomposed by `GATE_SPECS` to a `{Clifford, T}` count via a fixed table (CCX = CCZ = 7 T, CSWAP = 7 T, U/P generic = 1 non-Clifford); the count is an upper bound and the exact run is attempted only when the circuit is PPE-applicable; otherwise S3 reports the count and `not_applicable: "exact branch simulation needs Pauli rotations + Clifford fixed gates"`.
- **Cost model:** predicted = 2^{t_eff}; reported cost = `t_eff · log10 2` (log10 branches).

### 2.5 Surrogate S4 — MPS with bond-dimension sweep and rigorous truncation accounting (new, numpy-only)

**Representation.** |ψ⟩ = Σ A₁^{s₁} A₂^{s₂} … Aₙ^{sₙ}, site q ↔ qubit q (IR little-endian order; qubit 0 is the left end). Left-canonical form maintained by SVD after every two-site gate. Tensors `A[q]` of shape (χ_{q−1}, 2, χ_q), complex128.

**Gates.** 1q gates contract directly. A 2q gate on neighbours (q, q+1): contract the bond, apply the 4×4, SVD, truncate to χ_max, renormalize. A 2q gate on (q, r), |q−r| > 1: route with a SWAP chain (r−q−1 swaps in, the same out), each counted as a two-site gate. 3q gates (CCX, CCZ, CSWAP) are decomposed by `GATE_SPECS` to 2q+1q gates first (their canonical decomposition, PRD 14 §4.1.6). Measurements are already dropped by the converter.

**Truncation accounting (rigorous).** At a truncation step with normalized Schmidt spectrum {λᵢ²}, dropping weight εₖ = Σ_{i>χ} λᵢ² and renormalizing gives ‖ψ − ψ′‖₂² = 2 − 2√(1 − εₖ) ≤ 2 εₖ, so ‖ψ − ψ′‖₂ ≤ √(2 εₖ). Unitaries preserve norms, so by the triangle inequality the final state obeys ‖ψ_exact − ψ_MPS‖₂ ≤ δ := Σₖ √(2 εₖ). For a normalized ψ_MPS and Hermitian O,

  |⟨ψ_exact|O|ψ_exact⟩ − ⟨ψ_MPS|O|ψ_MPS⟩| ≤ 2 ‖O‖_op δ + ‖O‖_op δ² ≤ (2δ + δ²) ‖O‖₁.

This is the **rigorous interval** `[Ĉ − B, Ĉ + B]`, B = (2δ + δ²)·‖O‖₁, clipped to ±‖O‖₁. It is often loose; the suite therefore also reports the **heuristic convergence estimate** `H_χ = |Ĉ_χ − Ĉ_{χ/2}|` across the sweep, labelled `bound_kind: "heuristic"`. **Only the rigorous bound can produce a win.** The UI shows both and says which one the verdict used.

**Sweep.** χ ∈ {2, 4, 8, …, χ_max} (default χ_max = 128; hard cap 1024). For each χ run every point; stop at the first χ whose rigorous bound ≤ ε at every point. `chi_needed` = that χ (or null, censored at χ_max). When the *exact* χ for the circuit (bounded by 2^{min(q+1, n−q−1)} across cuts and by the gate structure) is below χ_max, the final sweep step is exact (δ = 0, bound kind R, reported `exact: true`).

**Expectation.** ⟨O⟩ for a Pauli sum: per term, contract the MPS with the term's single-site operators (O(n χ²·2) per term, no 2ⁿ objects). Terms are batched by shared prefix where cheap; this is an optimization, not a contract.

**Cost model.** predicted time ∝ n_2q · χ³ (SWAP-routed gates included); memory 2·n·χ²·16 B. Reported cost = `log2(chi_needed)` (censored). Resource guard: refuse χ when 2·n·χ²·16 B > 512 MiB (`mps_memory`), and when the predicted time at the next χ exceeds the remaining budget stop the sweep as `budget_exhausted` (never start a step it cannot finish).

**Qubit ordering.** Default: IR order. Option `ordering: "ir" | "reverse" | "bandwidth"` (bandwidth = reverse Cuthill–McKee on the interaction graph, numpy-only, ≤ 50 lines). The Goldilocks audit tries all three (§6.6).

**Applicability:** always for n ≤ 1024 (dense state never formed). Validity: the rigorous bound is valid for any circuit; only the heuristic is "MPS folklore".

### 2.6 Surrogate S5 — Light-cone / locality simulation (reuse + extension)

- **Backward light cone.** For each term Qⱼ of O, walk the circuit in reverse, growing the support set from supp(Qⱼ) through every gate that touches it. Reuse `kernel/discovery/evaluators/_frontier_structure.light_cone_width` **moved** to `kernel/trainability/lightcone.py` (`_frontier_structure` keeps a re-export so the frontier evaluator is unchanged). Extension in the move: diagonal gates do not spread a Z-only string (already there) and, new, **Clifford pre-conjugation**: a trailing block of Clifford gates is first absorbed into the observable with `CliffordConjugator` (which can shrink or grow the support); the cone is computed on whichever of {raw, conjugated} gives the smaller max width, and the choice is recorded.
- **Estimator:** when the widest cone w_max ≤ `max_width` (default 20 = `MAX_STATEVECTOR_QUBITS`), compute each term exactly on its cone with the Lab Compiler (`compile_circuit` on the restricted sub-circuit, B = K points) and sum. Bound kind R (exact, tolerance 1e-10·‖O‖₁).
- **Cost model:** predicted = Σⱼ 2^{wⱼ}·(gates in cone j); reported cost = `w_max · log10 2`. Win ⇔ w_max ≤ max_width and the evaluation finishes in budget.
- This is the Bravyi–Gosset–Movassagh "mean value" light-cone method for constant-depth circuits; at large depth w_max = n and S5 is `fails` with cost n·log10 2 (statevector).

### 2.7 Surrogate S6 — Fourier-series surrogate of a learning model (claim class B)

Only meaningful when the circuit is a **learning model**: some parameters are *data* inputs x (re-uploading encodings) and the rest are trainable θ. The user declares the data parameters (§5: `settings.surrogates.fourier.data_params`, or the module-level `nuclei_data_params = ["x[0]", "x[1]"]`). Without a declaration S6 and S7 are `not_applicable: "no data parameters declared"` — the UI says how to declare them.

**Theory** (Schuld, Sweke & Meyer, PRA 103, 032430 (2021); Schreiber, Eisert & Meyer, PRL 131, 100803 (2023)). With each data parameter xᵢ entering only through Pauli rotations e^{−i(aₖxᵢ)Pₖ/2} with rational coefficients aₖ (`ParamRef.coeff`; the IR already restricts angles to affine maps), the model is a multivariate trigonometric polynomial

  f_θ(x) = Σ_{ω∈Ω} c_ω(θ) e^{iω·x}, Ω = { Σₖ sₖ aₖ eᵢ(ₖ) : sₖ ∈ {−½, 0, +½}·(eigenvalue gaps) } ⊂ ℝᵈ,

with |Ω| ≤ ∏ᵢ (2Lᵢ + 1) for Lᵢ the number of encoding gates of xᵢ with unit coefficient (Pauli generators have eigenvalues ±1, so the spectrum per gate is {−1, 0, 1} in units of aₖ). The spectrum is enumerated exactly from the IR (sum-set of per-gate frequency sets, deduplicated with a rational key; coefficients are rounded to 1e-9 rationals or S6 is `not_applicable: "irrational encoding coefficient"`).

**Surrogate.** Given a *fixed* θ* (the user's current values, or the sampled θ⁽ᵏ⁾), the surrogate is the coefficient vector c(θ*) ∈ ℂ^{|Ω|}, obtained by solving the linear system f_θ*(x⁽ʲ⁾) = Σ_ω c_ω e^{iω·x⁽ʲ⁾} on |Ω| + oversampling (default 1.5·|Ω|) random inputs x⁽ʲ⁾ ~ U[0,2π)ᵈ (least squares, `numpy.linalg.lstsq`; condition number recorded). The oracle for f_θ*(x⁽ʲ⁾) is the **trusted oracle hierarchy** (§3.4): statevector for n ≤ 20, else any class-A surrogate that already won. If no oracle exists S6 is `not_applicable: "no trusted oracle at this width"` — exactly the Schreiber et al. situation where the surrogate must be *extracted from the trained quantum model*, which the suite cannot do classically. The report says so.

**Accuracy.** Held-out test: 64 fresh x; `max_j |f̂(x_j) − f(x_j)|` ≤ ε ⇒ win (bound kind **H**: a held-out empirical check, never rigorous; the UI label says "empirical, 64 held-out inputs"). Reported cost = `log10 |Ω|`. Applicability cap: |Ω| ≤ `max_spectrum` (default 4096) else `fails` ("spectrum too large for the budget").

**Claim** on win: "At the evaluated θ*, the model's input–output map is reproduced by a classical trigonometric polynomial with |Ω| coefficients. This removes any *inference-time* advantage of the trained model (Schreiber et al.); it says nothing about training."

### 2.8 Surrogate S7 — Random Fourier features dequantization (claim class C)

**Theory** (Landman et al., arXiv:2210.13200; Sweke et al., Quantum 9, 1640 (2025) for the necessary-and-sufficient conditions). Sample D frequencies ω₁…ω_D from a distribution over Ω (uniform over the enumerated spectrum, or the Landman "tree sampling" over the sum-set which the IR makes exact), build features φ(x) = [cos(ωᵢ·x), sin(ωᵢ·x)]ᵢ ∈ ℝ^{2D}, and fit a ridge regression to the **model's own outputs** f_θ*(x) on N training inputs (the model is the target function; this is the "classically approximating a VQC" experiment of Landman et al.). Report the held-out error with D and N; sweep D ∈ {16, 32, …, D_max} (default D_max = 512) and record `features_needed` = the first D whose held-out max error ≤ ε (or null).

- **Applicability:** same as S6 (declared data params, trusted oracle).
- **Bound kind H.** Reported cost = `log10(features_needed)`.
- **Claim** on win: "A classical RFF model with D features reproduces the quantum model's function on held-out inputs at this θ*." The spec deliberately does **not** claim training dequantization on the user's dataset unless the user supplies one (`nuclei_dataset = {"x": ..., "y": ...}` module hook, v1.1 — open question §8).

### 2.9 The joint verdict map — exact semantics

**Trainability axis** T ∈ {`untrainable`, `trainable`, `unknown`} with evidence level:
- `scaling` (strongest): the job's `scaling` fit verdict (PRD 14 §5.5 rules): `barren_plateau` → `untrainable`; `polynomial` → `trainable`; `inconclusive` → `unknown`.
- `single_size` (weak): no scaling study; `gradients.variance_mean` (value, not interval midpoint) ≥ 1e-4 → `trainable` at *this* n **only**; < 1e-8 → `untrainable` at this n; else `unknown`. The verdict text always carries "(at n = N only; no scaling evidence)".
- `lie`: `simulability.kind == exponential_dla` with `status == complete` and the observable in 𝔤 → prediction `untrainable` *in the deep-circuit regime* (Ragone assumptions); recorded as supporting evidence, never as the sole basis for `untrainable`.
The kernel picks the strongest available level and records `trainability_evidence: {level, basis, text}`.

**Simulability axis** S ∈ {`simulable`, `resists_implemented`, `inconclusive`}:
- `simulable` iff ≥ 1 surrogate wins **and** the consistency check passes (§3.4). `winners` lists every winner with cost; `cheapest_winner` is the winner with the smallest reported cost (ties → the lower surrogate index).
- `resists_implemented` iff every surrogate is `fails` or `not_applicable`, **no surrogate is `budget_exhausted`, `unavailable` or `error`**, and at least 3 class-A surrogates actually *ran* (`fails`). Fewer than 3 runs is `inconclusive: "too few surrogates ran"`.
- `inconclusive` otherwise (budget exhaustion, errors, consistency failure), with the reasons listed.

**Joint verdict** `quantumness.verdict`:
| T \ S | simulable | resists_implemented | inconclusive |
|---|---|---|---|
| untrainable | `untrainable` (note: also simulable by S) | `untrainable` | `untrainable` |
| trainable | `trainable_simulable` | `trainable_resists_implemented_surrogates` | `trainable_simulability_inconclusive` |
| unknown | `simulable_trainability_unknown` | `resists_implemented_trainability_unknown` | `inconclusive` |

**The exact claim for `trainable_resists_implemented_surrogates`** (this text ships verbatim in the kernel result, the UI and the certificate):

> For this circuit (n = {n}, m = {m} parameters), observable {O}, parameter distribution {𝒟}, at {K} sampled parameter points with accuracy target ε = {ε}: every implemented classical surrogate in suite version {v} either did not apply (reasons listed) or failed to reach ε within its budget ({budgets}). Trainability evidence: {level}: {text}. This is a statement about **these implementations and these budgets**. It is not a proof that the cost is classically hard, not a claim of quantum advantage, and not evidence about surrogates that are not implemented (listed: {not_implemented}). Larger budgets, better orderings, or other methods may succeed. Treat it as a lead.

`not_implemented` is a fixed list in `surrogates/registry.py`: `{"tensor network (PEPS/TTN)", "belief propagation / BP-TN", "Clifford perturbation theory", "noise-induced classical simulation", "sparse Pauli dynamics / Heisenberg with Hermite truncation", "neural quantum states"}` — honest scoping shown in the UI.

### 2.10 Error-bar and confidence semantics (summary table)

| Surrogate | Bound kind | What the interval means | Can it win? |
|---|---|---|---|
| S1 PPE | R | truncation ℓ1 mass | yes |
| S2 𝔤-sim | R (exact, tol 1e-8‖O‖₁) | floating point | yes |
| S3 stabilizer | R (exact) | none (D = 0 required) | yes |
| S4 MPS | R (triangle bound) + H (convergence) | rigorous: (2δ+δ²)‖O‖₁; heuristic: |Ĉ_χ − Ĉ_{χ/2}| | rigorous only |
| S5 light cone | R (exact) | floating point | yes |
| S6 Fourier | H (held-out max error) | empirical, 64 inputs | yes, labelled empirical |
| S7 RFF | H (held-out max error) | empirical | yes, labelled empirical |

Numbers are never interval midpoints; a surrogate that stops early returns `estimate: null` with the interval it reached (PRD 14 PH-C1 standard).

---

## 3. Kernel design

### 3.1 Module layout (new files in bold; everything else is reuse)

```
kernel/trainability/
├── lightcone.py                      # moved from discovery/evaluators/_frontier_structure (light_cone_width + Clifford pre-conjugation)
├── mps.py                            # numpy-only MPS circuit simulator (state, gates, SWAP routing, truncation ledger, Pauli-sum expectation)
├── gsim.py                           # 𝔤-sim: structure constants from a Lie basis, adjoint propagation, expectation
├── _expm.py                          # expm fallback (Padé 13 + scaling/squaring) when scipy is absent
├── fourier.py                        # spectrum enumeration from the IR (rational frequencies), trig-poly fit, RFF features
├── surrogates/
│   ├── __init__.py                   # SUITE registry, SUITE_VERSION, NOT_IMPLEMENTED list
│   ├── base.py                       # SurrogateReport dataclass, statuses, bound kinds, SurrogateContext, budget helpers
│   ├── ppe.py                        # S1
│   ├── gsim.py                       # S2 (thin: lie_algebra → gsim.py)
│   ├── stabilizer.py                 # S3
│   ├── mps.py                        # S4 (sweep driver over kernel/trainability/mps.py)
│   ├── lightcone.py                  # S5
│   ├── fourier.py                    # S6
│   ├── rff.py                        # S7
│   ├── oracle.py                     # trusted oracle hierarchy (§3.4)
│   ├── suite.py                      # run_surrogate_suite(...) orchestrator, consistency check, cost table
│   └── quantumness.py                # joint verdict (§2.9) from {gradients, scaling, lie, surrogates}
├── _settings.py                      # + "surrogates" section, ANALYSES += "surrogates"
├── job_worker.py                     # + "surrogates" dispatch; quantumness assembled at job end
├── handlers.py                       # + trainability_surrogate_catalog (sync)
├── provenance.py                     # PROTOCOL_VERSION = "1.4"; + suite_version in provenance
└── jobs.py                           # unchanged except the result assembly hook (quantumness)
```

### 3.2 Data structures (binding)

```python
# kernel/trainability/surrogates/base.py
SurrogateStatus = Literal["wins", "fails", "budget_exhausted", "not_applicable", "unavailable", "error"]
BoundKind = Literal["rigorous", "heuristic", "exact"]
ClaimClass = Literal["A", "B", "C"]      # A: cost dequantization; B: trained-model surrogate; C: RFF dequantization

@dataclass(frozen=True)
class PointResult:
    index: int                          # 0..K-1
    estimate: float | None              # None when the surrogate stopped before an informative result
    interval: tuple[float, float] | None
    bound_kind: BoundKind | None
    within_target: bool
    cost: dict[str, Any]                # surrogate-specific measured cost (frontier_peak, chi, features, ...)
    elapsed_ms: int

@dataclass(frozen=True)
class SurrogateReport:
    id: str                             # "ppe" | "gsim" | "stabilizer" | "mps" | "light_cone" | "fourier" | "rff"
    version: str
    claim_class: ClaimClass
    status: SurrogateStatus
    reason: str | None                  # for not_applicable / unavailable / error / budget_exhausted
    points: tuple[PointResult, ...]
    cost: dict[str, Any]                # {"predicted": {"model": str, "value": float|None}, "reported": float|None,
                                        #  "reported_label": str, "censored": bool, "elapsed_ms": int, ...}
    accuracy: dict[str, Any]            # {"target": eps, "achieved_max_bound": float|None, "bound_kind": BoundKind|None}
    claim: str | None                   # the human sentence on a win (§2.7/2.8 wording for B/C)
    notes: tuple[str, ...]
    def to_json(self) -> dict: ...

@dataclass
class SurrogateContext:
    circuit: ParamCircuit
    observable: PauliSum
    values: np.ndarray                  # (K, m) shared evaluation points
    epsilon: float
    settings: dict                      # clamped surrogates settings
    backend: str
    seed: int
    deadline: float                     # perf_counter deadline for this surrogate
    progress: Callable[[float, str], None]
    cancel: Callable[[], bool]
    oracle: "Oracle | None"             # §3.4, set by the suite before class B/C surrogates run

class Surrogate(Protocol):
    id: str; version: str; claim_class: ClaimClass; order: int
    def applicable(self, ctx: SurrogateContext) -> tuple[bool, str | None]: ...
    def predicted_cost(self, ctx: SurrogateContext) -> dict[str, Any]: ...
    def run(self, ctx: SurrogateContext) -> SurrogateReport: ...   # never raises; errors -> status "error"
```

Registry: `SUITE: tuple[Surrogate, ...]` in `order` = (light_cone, stabilizer, gsim, ppe, mps, fourier, rff) — cheap structural checks first, so predicted costs are known before expensive runs. `SUITE_VERSION = "1.0.0"`; `suite_fingerprint()` = sha256 of `kernel/trainability/surrogates/*.py` + `mps.py` + `gsim.py` + `fourier.py` + `lightcone.py` bytes in sorted order (goes into provenance next to `analyses_fingerprint`).

### 3.3 Orchestrator — `suite.py`

```python
def run_surrogate_suite(circuit, observable, *, settings: dict, seed: int, init: str, backend: str,
                        progress=None, cancel=None) -> dict
```
Steps:
1. Draw K points from `default_rng(seed)` (reuse `analyses._draw_values`); K = `settings["points"]` (1–64, default 8).
2. Budget split: `time_budget_s` total (default 60; range 5–600). Each surrogate gets `per_surrogate_budget_s` (default 15) **or** the remaining total, whichever is smaller; unspent time rolls forward. A surrogate that cannot start within budget is `budget_exhausted: "no time left"`.
3. Run in registry order, honouring `settings["suite"]` (subset of ids). Progress: `fraction = done/len(suite)` plus the surrogate's inner progress, message `"{id}: {detail}"` (≤ 10/s, as PRD 14).
4. After class A, build the oracle (§3.4) and run class B/C.
5. Consistency check (§3.4). 6. Cost table + the result dict:

```json
{"suite_version": "1.0.0", "epsilon": 0.0123, "epsilon_relative": 0.01, "points": 8, "init": "uniform",
 "observable_l1": 1.23, "values_sha256": "<64 hex>",
 "reports": [ SurrogateReport.to_json(), ... ],
 "winners": ["light_cone", "mps"], "cheapest_winner": "light_cone",
 "simulability": {"kind": "simulable"|"resists_implemented"|"inconclusive", "reasons": [..]},
 "consistency": {"status": "pass"|"fail"|"skipped", "pairs": [{"a": "mps", "b": "ppe", "max_gap": 1e-4, "allowed": 0.0246}], "statevector_checked": true},
 "not_implemented": ["tensor network (PEPS/TTN)", ...],
 "budget": {"total_s": 60, "used_s": 41.2, "per_surrogate_s": 15},
 "elapsed_ms": 41231}
```

### 3.4 Trusted oracle hierarchy and the consistency check (`oracle.py`)

- `Oracle.evaluate(values: (B, m)) -> (B,)` returns C at arbitrary θ. Sources in priority order: (1) compiled statevector when n ≤ `MAX_STATEVECTOR_QUBITS` (20) and the batch fits the memory guard; (2) a class-A surrogate that **won** at every point, cheapest first, re-run at the requested θ with the same budget per call; (3) none.
- Consistency: for every pair of winners (plus the statevector when available) the estimates at each point must satisfy |Ĉ_a − Ĉ_b| ≤ B_a + B_b (bound sum; exact methods contribute 1e-8·‖O‖₁). A violation marks both reports `notes += ["consistency violation vs {other}"]`, sets `simulability.kind = "inconclusive"` with reason `suite_inconsistent`, and the job logs the pair at WARNING (this is a bug signal, by design loud).

### 3.5 Resource limits and cancellation

- All numpy; no threads inside the job (the job is already a killable subprocess, PRD 14 §5.6). `cancel()` is polled at least every 50 ms of work: per gate in MPS, per rotation in 𝔤-sim, per PPE step (already), per lstsq chunk.
- Memory: MPS 512 MiB guard; 𝔤-sim d ≤ 2048 (d³·8 B = 64 GiB is impossible — hard cap d ≤ 2048 gives 32 MiB per ad matrix, with ≤ 64 distinct generators cached → ≤ 2 GiB worst case; so the cache is bounded to 16 eigendecompositions and recomputed beyond that), light cone 2^{20}·K·16 B.
- Width caps: statevector 20; light cone 20 per cone; MPS n ≤ 1024; PPE 128 (existing); 𝔤-sim n ≤ 20 for the Clifford closure path (existing lie caps); Fourier/RFF follow the oracle.
- Determinism: everything from `default_rng(seed)`; same seed, code, settings ⇒ bit-identical JSON on the same backend (test in §6).

### 3.6 Quantumness assembly (`quantumness.py`)

```python
def quantumness_verdict(results: dict[str, dict], *, n_qubits: int, n_params: int, observable_text: str,
                        init: str) -> dict
```
Pure. Reads `results.get("scaling")`, `results.get("gradients")`, `results.get("lie")`, `results["surrogates"]` and returns:

```json
{"verdict": "trainable_resists_implemented_surrogates",
 "trainability": {"axis": "trainable", "evidence": {"level": "scaling", "basis": "aic_power_law", "text": "Var[∂C] ∝ n^(−1.9) …"}},
 "simulability": {"axis": "resists_implemented", "winners": [], "cheapest_winner": null, "reasons": []},
 "claim": "<exact §2.9 text, filled>",
 "suite_version": "1.0.0", "epsilon": 0.0123, "points": 8,
 "caveats": ["Not a proof of classical hardness.", "Not a claim of quantum advantage.", "..."]}
```
It is attached as the **top-level `quantumness` field of `trainability_result`** whenever `surrogates` is among the job's analyses (null otherwise), and copied into the certificate.

---

## 4. Protocol — lab messages v1.4 (additive)

### 4.1 `trainability_start` extensions

- `analyses` may include `"surrogates"` (new member of `ANALYSES`).
- `settings.surrogates` (all optional, clamped by `_settings.py`):

```json
{"suite": ["light_cone","stabilizer","gsim","ppe","mps","fourier","rff"],
 "epsilon_relative": 0.01,              // 1e-4 .. 0.5; absolute eps = epsilon_relative * max(1, ||O||_1)
 "points": 8,                            // 1 .. 64
 "time_budget_s": 60, "per_surrogate_budget_s": 15,   // 5..600, 1..300
 "mps": {"chi_max": 128, "ordering": "ir"},            // chi 2..1024 (power of two), ordering ir|reverse|bandwidth
 "gsim": {"max_dimension": 2048},                      // 1..4096
 "stabilizer": {"t_max": 24},                          // 1..32
 "light_cone": {"max_width": 20},                      // 1..20
 "ppe": {"max_frontier": 2000000},                     // 1e3..5e6
 "fourier": {"data_params": [], "max_spectrum": 4096, "oversampling": 1.5},
 "rff": {"features_max": 512, "train_inputs": 256}}
```
- `settings.surrogates.fourier.data_params` resolution order: request → module-level `nuclei_data_params: list[str]` in user code (read by `inspect`, reported in `trainability_inspected.data_params: string[]`, new optional field) → none.

### 4.2 Streaming

- `trainability_progress {job_id, analysis: "surrogates", fraction, message: "mps: χ=16, point 3/8"}`.
- `trainability_partial {job_id, analysis: "surrogates", result: <§3.3 dict>}`.
- `trainability_result` gains `quantumness: <§3.6 dict> | null` and `provenance.suite_version`, `provenance.suite_fingerprint`, `provenance.kernel.nuclei_protocol = "1.4"`, `provenance.kernel.scipy: string | null`.

### 4.3 New sync message

| Request | Response |
|---|---|
| `trainability_surrogate_catalog {request_id?}` | `trainability_surrogate_catalog_result {request_id?, suite_version, surrogates: [{id, version, claim_class, title, summary, bound_kinds: string[], cost_label, requires: string[], available: bool, unavailable_reason: string|null, citation: {label, url}}], not_implemented: string[]}` |

The frontend calls this once per Lab session to render the surrogate list (including which are unavailable, e.g. a future optional backend) **before** the user runs anything. An old kernel answers with the existing `error` (`unknown_message`), which the client maps to "kernel too old for the Quantumness Certificate (needs lab protocol ≥ 1.4) — update the kernel from Settings".

### 4.4 Errors (phase `trainability`, existing envelope)

| code | when |
|---|---|
| `surrogate_unknown` | `settings.surrogates.suite` names an id not in the registry |
| `surrogates_need_parameters` | the circuit has no free parameters (same as TRN007 path) |
| `surrogates_width` | n exceeds every surrogate's cap (n > 1024) |
| `invalid_settings` (existing) | clamping failure with the path, as today |
Per-surrogate failures never fail the analysis; they appear as `status: "error"` reports with `reason`. The analysis-level `errors.surrogates` entry is used only when the orchestrator itself fails.

### 4.5 Discovery additions (Goldilocks, §6)

- `DiscoveryEvaluatorKind` += `"goldilocks"`; `discovery_evaluators_result` lists it with `objectives`, `descriptors`, `config_schema`, `stages`, availability.
- `discovery_audit` works for `goldilocks` via `audits/goldilocks.py` (naming-convention discovery, no registry edit).
- `discovery_conjecture_schema` exposes the new features (§6.7).

Documented in `docs-site/src/content/docs/kernel-api/messages-lab.mdx` under a "v1.4" heading, and in the protocol changelog.

---

## 5. Frontend / UX

### 5.1 Where it lives

- **Trainability Lab** (`'trainability'` rail view): a new analysis tab **Quantumness** (`TrainabilityTabId += 'quantumness'`, lucide `ShieldQuestion`), a new **Quantumness** card in the `VerdictRail` between "Simulability" and "Lint", and the `surrogates` checkbox in the analysis picker (`TargetBar`), **off by default** (it is the slowest analysis), with the hint "runs classical simulation attacks (≈ 1 min)".
- **Command palette** (`src/components/commandPalette/CommandPalette.tsx`, `buildCommands` — static app commands section, with `CommandActions` extended): `Trainability: Run quantumness certificate` (opens the Lab on the active file, enables `surrogates`, starts the job) and `Trainability: Export certificate`.
- **Editor:** no new markers. The existing TRN003 info diagnostic gains the action link "Check with the surrogate suite →" (opens the Lab with `surrogates` on).
- **Dirac context:** `buildTrainabilityContext` adds a capped "Quantumness" block (verdict, cheapest winner, the claim text, "N of M surrogates shown").
- **Discovery Engine:** the `goldilocks` template in the New discovery wizard, the evaluator chip, a candidate-drawer section "Surrogate suite" (per-surrogate rows, weakest surrogate), the Archive descriptors, and the Red Queen lane showing suite-audit exploits (§6.6).

### 5.2 User path (the end-to-end story that must work)

1. User opens a Python file with a parameterized Qiskit/Cirq circuit in Research mode (the `lab-project` e2e fixture has `ansatz.py`).
2. Opens the Trainability Lab (rail or ⌘K → "Trainability Lab"). The target bar shows n, m, observable; the Quantumness checkbox is visible with its hint. The surrogate catalog has loaded (list with availability) — or the "kernel too old" banner is shown with a Settings link.
3. Ticks **Quantumness** (optionally also Gradients/Scaling/Lie for the trainability axis — the tab explains that without Scaling the trainability axis is single-size evidence only), presses **Run analyses** (⌘⇧↵).
4. Progress streams per surrogate (“mps: χ=32, point 5/8”), with Cancel.
5. The Quantumness tab fills: the **verdict cell** (big pill + one sentence), the **surrogate table** (status, bound kind, achieved bound vs ε, reported cost, predicted cost, time), the **cost bars** (log scale, censored bars hatched), the **consistency row**, the **claim text** in a quoted block, the **not-implemented list**, and the **evidence chain** (what trainability evidence was used).
6. Verdict rail → **Export certificate**: `experiments/<stem>.trainability.json/.md` now include `quantumness` and the suite table (renderer in `certificate.ts`).

### 5.3 States (every one designed; never a blank box)

| State | Quantumness tab | Verdict card |
|---|---|---|
| idle, analysis not selected | `LabEmptyState` "Quantumness not run" + "Enable Quantumness in the analysis picker" button (ticks it) | "Not run" pill |
| idle, no parameters in file | `LabEmptyState` "No free parameters" (same copy as TRN007) | hidden |
| catalog loading | skeleton rows | — |
| catalog unavailable (old kernel) | `LabCallout tone=warning` "Kernel lab protocol 1.3 < 1.4" + link | "Unavailable" pill |
| web build | existing "needs the desktop kernel" empty state | — |
| running | per-surrogate rows with `LabProgress`, rows not yet started dimmed, Cancel in toolbar | "Running" |
| cancelled | partial rows kept, banner "Cancelled after {k} of {N} surrogates; verdict: inconclusive" | "Inconclusive" |
| result | full tab (§5.2.5) | verdict pill (tones: untrainable → danger, simulable → neutral, resists → quantum, inconclusive → warning) |
| error (orchestrator) | `LabCallout tone=danger` with `code` and message; Retry | "Failed" |
| surrogate `not_applicable` | row with grey pill and the reason; for Fourier/RFF a "Declare data parameters" hint with the `nuclei_data_params = [...]` snippet (copy button) | — |
| surrogate `unavailable` | row with the dependency name + "Install from Settings → Research catalog" (future; v1 has none) | — |
| consistency failure | red row "Surrogates disagree: {a} vs {b}" + "This is a kernel bug; please report with the certificate" | "Inconclusive" |

### 5.4 Honesty copy (verbatim strings in `src/services/trainability/quantumnessCopy.ts`)

- `RESISTS_CAVEAT`: "Resists all implemented surrogates means: these implementations, at these budgets, did not reach the accuracy target. It is not a proof of classical hardness and not a claim of quantum advantage."
- `SIMULABLE_NOTE`: "A classical method reproduced the cost within ε at every sampled parameter point. Any quantum advantage for this cost would have to come from somewhere this suite did not measure."
- `HEURISTIC_LABEL`: "empirical (held-out inputs) — not a rigorous bound".
- `MPS_TWO_NUMBERS`: "Rigorous bound (used for the verdict) vs convergence estimate (heuristic)."
- `SINGLE_SIZE_EVIDENCE`: "Trainability evidence is from this qubit count only. Run Scaling for a verdict about the family."
- `NOT_IMPLEMENTED_TITLE`: "Not in this suite (results say nothing about these):".

### 5.5 TS types, stores, components (binding names)

- `src/types/trainability.ts` (extend only): `TrainabilityAnalysis += 'surrogates'`, `TRAINABILITY_ANALYSES` updated; `SurrogateId`, `SurrogateStatus`, `BoundKind`, `ClaimClass`, `SurrogatePointResult`, `SurrogateReport`, `SurrogateSuiteResult`, `QuantumnessVerdict`, `SurrogateCatalogEntry`, `TrainabilityResults.surrogates?`, `trainability_result.quantumness?: QuantumnessVerdict | null`, `TrainabilityProvenance.suite_version?`, `suite_fingerprint?`; request/response members for the catalog; `TrainabilitySettings.surrogates?`; `TrainabilityTabId += 'quantumness'`; `TrainabilityInspection.data_params?: string[]`.
- `src/services/trainability/client.ts`: `surrogateCatalog(): Promise<ClientResult<SurrogateCatalog>>` (request_id-correlated, 5 s timeout → "kernel too old" mapping).
- `src/services/trainability/quantumness.ts` (pure): `deriveQuantumnessView(results, quantumness)`, cost-bar math, status tones; `quantumnessCopy.ts`; `certificate.ts` gains the Quantumness section (snapshot test updated).
- `src/stores/trainabilityStore.ts`: `catalog: AsyncState<SurrogateCatalog>`, `loadCatalog()`, settings for `surrogates`, `activeTab: 'quantumness'`.
- `src/components/trainability/tabs/QuantumnessTab.tsx`, `SurrogateTable.tsx`, `SurrogateCostBars.tsx`, `VerdictCell.tsx`; `VerdictRail.tsx` gains the Quantumness `LabCard`; `AnalysisTabs.tsx` registers the tab; `TargetBar.tsx` the checkbox. All built on `src/components/lab/` primitives; no hex colors; tabular-nums; chart accessible names.
- Palette commands added to `buildCommands` in `src/components/commandPalette/CommandPalette.tsx` (lead-owned; U6 hands the lead the two `Command` entries and the two `CommandActions` members, and the palette↔registry parity test is updated by the lead).

---

## 6. Goldilocks evaluator (Idea 2)

### 6.1 Purpose and entry

- **Kind:** `goldilocks`, version `1.0.0`, task `quantum_circuit`, entry `build(n_qubits: int, n_layers: int)` returning a parameterized Qiskit/Cirq circuit (same entry as `trainability_frontier`, so the frontier template and seeds reuse).
- **Question:** "Find an ansatz family that the Lab certifies trainable **and** that resists the surrogate suite." The honest baseline must score poorly (the HEA seed is light-cone-simulable).

### 6.2 Config (JSON Schema in `_goldilocks_config.py`; defaults)

```json
{"qubits": [8, 16, 32],                 // 4..128, 2..6 values; PPE path needed above 20
 "n_layers": 4,
 "observable": "preset:local_z",        // rescaled so max |c_j| = 1 (as frontier)
 "require_ppe_class": true,             // false allows non-PPE circuits at n <= 14 (sampling trainability; lower evidence)
 "surrogates": {"suite": ["light_cone","stabilizer","gsim","ppe","mps"],   // class A only; B/C need data params → excluded by default
                "epsilon_relative": 0.01, "points": 4, "time_budget_s": 90, "per_surrogate_budget_s": 20,
                "mps": {"chi_max": 64}, "light_cone": {"max_width": 20}, "stabilizer": {"t_max": 24}, "gsim": {"max_dimension": 1024}},
 "dla_probe_qubits": [4, 5, 6],
 "max_parameters_per_qubit": 24,
 "max_two_qubit_gates_per_layer_per_qubit": 3.0,
 "min_cost_variance": 1e-4,
 "weights": {"trainability": 1.0, "resistance": 1.0, "budget_fragility": 0.5}}
```

### 6.3 Guardrails (first-fail, in order; each has a cheating candidate in tests)

1. `ir_conversion`, 2. `ppe_class` (when `require_ppe_class`; additionally every `ParamRef.coeff == 1.0, offset == 0` — affine tricks that pin angles are refused), 3. `qubit_count`, 4. `parameter_budget` — all reused from `_circuit_common` / frontier.
5. `nontrivial_variance` (frontier rule: exact PPE at the smallest n, `variance_mean ≥ 1e-6`).
6. `nontrivial_algebra` (frontier rule: trivial-prefix stripping, blocks at every size, structural consistency ratio ≤ 1.6, DLA > 4n² at every probe) — reused verbatim.
7. **`observable_sensitivity`** (new): `cost_variance` from the exact PPE at the smallest n ≥ `min_cost_variance`. Kills circuits whose cost is constant over 𝒟 (a constant cost is trivially "simulable" by one number, and a candidate could try to make the suite *fail* on noise-level values: with ε relative to ‖O‖₁ a constant cost at 0 is reproduced by every surrogate, so this is also anti-gaming in the other direction).
8. **`depth_padding`** (new): two-qubit gates per layer per qubit ≤ `max_two_qubit_gates_per_layer_per_qubit`, and the stripped circuit's *two-qubit depth* per layer ≤ 4·(pattern-class nominal depth) — defeats "add 50 CZ layers to inflate χ" (which the trainability term would also punish, but only after the expensive suite ran).
9. **`no_noise_or_nonunitary`**: IR has no noise, resets or mid-circuit measurements (converter already raises; this makes the rejection a visible guardrail).
10. **`exactness`** (frontier WARN rule) for the trainability points.

Stage `screen` runs 1–7 on `qubits[:1]` with the suite limited to `light_cone, stabilizer, gsim` (seconds); `full` runs everything at every n; `confirm` repeats `full` with a fresh seed **and doubled budgets** (`chi_max ×2`, `time ×2`, `max_frontier ×2`, `t_max + 4`).

### 6.4 Scoring

- **Trainability term** = frontier's `fit_trainability` (bits lost per doubling, `−min(D, 6)`, secant rules, exactness penalty) — reused as-is.
- **Resistance** r ∈ [0, 1]: per surrogate S a resistance score h_S:
  - wins → 0;
  - `not_applicable` → excluded (**not** 1: a surrogate that does not apply says nothing);
  - `fails` / `budget_exhausted` → how far the surrogate got relative to its cap, clipped: light cone h = min(1, w_max/n); stabilizer h = min(1, t_eff/(t_max+8)); 𝔤-sim h = 1 when `fails` because d > cap at `complete`, 0.5 when the closure was truncated (unknown); PPE h = min(1, log10(frontier_peak)/log10(max_frontier)) when censored, 1 when the run completed but D > ε at the cap; MPS h = min(1, log2(χ_max)/log2(χ_max_cap)) with `chi_needed` null (censored); if the rigorous bound at χ_max is within 10ε it is **0.5** (nearly simulable).
  - r = **min** over applicable surrogates (the weakest link decides simulability). If fewer than 3 class-A surrogates ran, r is capped at 0.5 and `metrics.resistance.note` says "too few surrogates ran".
- **Budget fragility** f = max(0, r_full − r_confirm) at the confirm stage (0 at other stages) — a candidate whose resistance evaporates with doubled budgets is penalized; the honesty text explains it.
- **Fitness** = `w_t · trainability_term + w_r · 6·r − w_f · 6·f − inexact_penalty`. (6 is the trainability cap, so both axes have the same range.) 
- **Objectives:** `beta` (minimize; CI, `fit_method`), `resistance` (maximize; r, weakest surrogate, per-surrogate h), `cheapest_surrogate_cost` (maximize; the reported cost of the weakest surrogate, censored flag).
- **Descriptors:** `weakest_surrogate` (categorical 0..6 in registry order, 7 bins), `light_cone_qubits` (0..64, 8 bins), `two_qubit_gates_per_layer` (0..64, 8 bins), `dla_fill_fraction` (0..1, 8 bins; frontier rule at the largest probe), `mps_chi_needed_log2` (0..10, 11 bins; censored → top bin, flagged).
- **Metrics:** the full suite result at every n, `resistance` breakdown, trainability fit, `gradient_map` (addendum §C, via `gradient_map.ppe_gradient_map`), `dla_probes`, structure signatures, and the mandatory honesty text:

> "Resistance is the weakest implemented classical surrogate's inability to reach ε within budget. It is not classical hardness. A high score is a lead to investigate, not a counterexample to Cerezo et al."

### 6.5 Anti-gaming rules (and the guardrail/term that enforces each)

| Attack | Defence |
|---|---|
| Pad depth with entanglers to beat MPS / light cone | `depth_padding` guard; trainability term (deep ⇒ BP); `two_qubit_gates_per_layer` descriptor shows it |
| Add noise/resets to confuse surrogates | `no_noise_or_nonunitary` (IR refuses) |
| Trivial observable sensitivity (cost ≈ const) | `observable_sensitivity` |
| Observable is fixed by config, but candidate rotates its support away at |0⟩ | `nontrivial_variance` + `nontrivial_algebra` stripping |
| Rich at the smallest n only | frontier structural-consistency rule at every scored and probe size |
| Pin angles via affine coefficients (e.g. 4θ so angles are effectively Clifford-ish) | `ppe_class` coeff == 1 rule; 𝒟 is continuous anyway |
| Exploit MPS qubit ordering with long-range gates | audit tries `ir`, `reverse`, `bandwidth` orderings; fitness uses the **min** over orderings at `confirm` |
| Exploit budgets (resistance only because time ran out) | `budget_exhausted` ⇒ h ≤ cap fraction, never 1; confirm doubles budgets; fragility penalty |
| Exploit "too few surrogates ran" | r capped at 0.5 |
| Huge n to make everything time out | n fixed by config; candidate cannot change it |
| Parameter explosion | `parameter_budget` |

### 6.6 Red Queen audit — `audits/goldilocks.py`

Interface per `audits/__init__.py` (binding). Checks:
- `reparse`, `structure_recheck`, `dla_recheck`, `ppe_reproducible`, `ppe_vs_sampling` (reused from the frontier audit through shared helpers in `audits/_common.py` / `audits/_frontier_shared.py` — the frontier audit's private helpers are promoted, not copied).
- **`suite_attack`**: re-run the surrogate suite with a different seed, **4× budgets** (`chi_max ×4` up to 1024, time ×4, `max_frontier ×4`, `t_max + 8`, `light_cone.max_width` 20), all three MPS orderings, Clifford pre-conjugation for the light cone, and `points` doubled. If any surrogate now **wins** where the evaluator recorded `resists`, the check is `fail` with the winning surrogate and cost; the audit fitness recomputes r with the new reports.
- `resistance_recheck`: |r_audit − r_eval| ≤ 0.1 pass, ≤ 0.3 warn, else fail.
- `fitness_gap` (existing semantics).
Exploit definition (addendum §F): evaluator fitness ≥ seed fitness and the audit fails. Exploits export as pytest fixtures under `kernel/tests/fixtures/exploits/goldilocks-*.json`, replayed by `test_discovery_exploits.py`.

Red Queen prompt (`redQueenPrompt.ts`) gets a Goldilocks-specific paragraph listing the suite and the audit's extra budgets, so the model attacks the right thing.

### 6.7 Conjecture Engine hook

- `conjecture/predicate.FEATURES` += `weakest_surrogate` (string; values = registry ids ∪ "none"), `resistance` (number), `mps_chi_needed_log2` (number; null → predicate false), `light_cone_qubits` (integer), `gsim_dimension` (integer), `stabilizer_t_eff` (integer).
- `conjecture/spec.py` predictions += `resistance >= x`, `weakest_surrogate == "..."`; `tester.py` runs the suite (class A, screen budgets) on each held-out grammar circuit when a prediction references a suite feature, with its own time budget (`DEFAULT_PER_CIRCUIT_S` applies; suite capped at 30 s per circuit).
- The archive digest sent to the depth model includes the per-elite `weakest_surrogate` and `resistance`.

### 6.8 Template and seed

`kernel/discovery/seeds/goldilocks.py` + `src/services/discovery/templates.ts` entry `goldilocks`: the frontier HEA seed (RY/RZ + CZ brick, open chain) with `build(n_qubits, n_layers)` in the evolve block. Expected at defaults: light cone wins at n = 8 (w ≤ 12) ⇒ r = 0, fitness ≈ trainability term alone (≈ −0.1): an honest "not a counterexample" baseline, and the first thing the mutator must escape.

---

## 7. Validation plan

### 7.1 Unit tests (kernel; files are owned per §9)

- `test_trainability_mps.py`: (a) χ = 2^{⌊n/2⌋} exact ≡ statevector (`compile_circuit`) to 1e-10 on random circuits n ≤ 10 incl. long-range gates and 3q gates; (b) forced truncation (χ = 2, 4) — **the rigorous interval always contains the statevector value** (1000 seeded random circuits, property-style loop); (c) truncation ledger sums; (d) memory guard; (e) cancellation mid-sweep returns `budget_exhausted` with the partial sweep; (f) orderings produce identical results when exact; (g) GHZ needs χ = 2, product state χ = 1; (h) a 4-qubit brick circuit's `chi_needed` matches the Schmidt rank computed densely.
- `test_trainability_gsim.py`: (a) free-fermion chain ({Xᵢ}∪{ZᵢZᵢ₊₁}, n = 2..6) 𝔤-sim ≡ statevector to 1e-8 for 50 random θ; (b) so(8) HEA (n = 3) likewise; (c) O ∉ 𝔤 → `not_applicable` with residual reported; (d) `_expm` ≡ `scipy.linalg.expm` to 1e-12 when scipy is present (importorskip) and against the eigendecomposition path always; (e) cost model fields.
- `test_trainability_fourier.py`: (a) spectrum enumeration vs the Schuld–Sweke–Meyer count for single-qubit re-uploading with L encodings (|Ω| = 2L+1) and the 2-D product case; (b) the trig-poly fit reproduces the model to 1e-8 on fresh inputs when |Ω| is enumerated fully (n ≤ 6); (c) RFF held-out error decreases with D and the reported `features_needed` is monotone in ε; (d) irrational coefficient → `not_applicable`; (e) no data params → `not_applicable` with the hint.
- `test_trainability_lightcone.py`: moved tests + Clifford pre-conjugation shrinks the cone for `H…H`-dressed global-Z; exact cone evaluation ≡ statevector 1e-10; the frontier evaluator still imports `light_cone_width` (re-export).
- `test_trainability_surrogates.py`: registry order and ids; stabilizer t_eff counts (Clifford circuit t = 0; one T adds 1; rotations at π/2 multiples excluded); PPE sweep stops at the first winning frontier; suite consistency check pass/fail (inject a lying surrogate via a test seam and assert `suite_inconsistent`); budget rollover; cancel; determinism (bit-identical JSON over two runs); every status reachable; `not_implemented` list present.
- `test_trainability_quantumness.py`: every cell of the §2.9 table reached by synthetic inputs; `single_size` text carries the n-only caveat; `resists` requires ≥ 3 class-A runs and no budget exhaustion; claim text snapshot.
- `test_trainability_settings.py` (extend): clamping of every surrogates field, unknown id → `surrogate_unknown`.
- `test_trainability_handlers.py` (extend): the catalog message with/without `request_id`; `test_trainability_jobs_integration.py` (extend): a job with `["gradients","lie","surrogates"]` streams `surrogates` progress/partial and a `quantumness` field; cancel mid-suite yields `cancelled` with partial reports.
- `test_trainability_provenance.py` (extend): `1.4`, `suite_version`, `suite_fingerprint` stable across runs and changing when a suite file changes (tmp copy test).
- Discovery: `test_discovery_goldilocks.py` (config schema, stages, each guardrail with a cheating candidate rejected *by that guardrail*, scoring formulas on synthetic suite reports incl. the "too few ran" cap and the min-over-surrogates rule, descriptors, seed scores as stated in §6.8 within tolerance), `test_discovery_goldilocks_audit.py` (suite_attack flips a fake "resists" record whose MPS win appears at 4× budget; orderings; resistance_recheck thresholds; exploit fixture replay), `test_discovery_conjecture_*` extensions for the new features and predictions, `test_discovery_evaluators.py` registry listing, `test_discovery_optional_deps.py` (goldilocks imports without any optional package).

### 7.2 Physics validation (explicit tolerances; `_trainability_physics_helpers.py` extended)

| Check | n | Tolerance |
|---|---|---|
| Every surrogate's estimate vs statevector at K = 8 points on 200 seeded random circuits (mixed gate set) | 2–10 | within its own stated bound; exact kinds 1e-8·‖O‖₁ |
| MPS rigorous bound contains the truth under forced truncation | 4–12 | always (0 violations) |
| MPS heuristic estimate vs truth | 4–12 | reported only; a table in the docs showing how often the heuristic under-estimates (expected: sometimes) |
| 𝔤-sim vs statevector on so(2n), free-fermion and QAOA-ring (shared params) circuits | 2–8 | 1e-8 |
| Light cone exact vs statevector for brick depth 1–3 with local Z | 6–16 | 1e-10 |
| Fourier fit vs model on fresh x | 1–6 | 1e-8 (full spectrum) |
| Suite on the HEA seed: light cone wins at n = 8, MPS wins with χ_needed ≤ 16 at depth 2 | 8 | as stated |
| Suite on a depth-20 all-to-all RZZ/RX circuit at n = 10: light cone w = 10 (statevector cap), MPS χ_needed censored at 64, PPE censored | 10 | statuses as stated (statevector still decides consistency) |

### 7.3 Frontend tests

- Vitest: `quantumness.test.ts` (view derivation for every verdict/status), `quantumnessCopy` snapshot, `certificate.test.ts` snapshot with quantumness, `client.test.ts` catalog + "kernel too old" mapping, store tests (catalog lifecycle, tab, settings), jsdom render tests for `QuantumnessTab` in every §5.3 state (seeded fixtures in `fixtures.ts`: `surrogateSuiteFixture`, `quantumnessFixture`, `surrogateCatalogFixture`), `VerdictRail` with the new card, `TargetBar` checkbox + hint; discovery: evaluator chip/template/drawer section render, `redQueenPrompt` snapshot with the Goldilocks paragraph, archive with the categorical descriptor.
- **Playwright** `tests/e2e/quantumness.spec.ts` (stub kernel pattern of `trainability.spec.ts`, fixture project `lab-project`): (1) catalog renders with 7 surrogates and the not-implemented list; (2) tick Quantumness → Run → progress rows → result: verdict pill text `Trainable · resists implemented surrogates`, the claim block, 7 rows with the expected statuses, consistency "pass"; (3) `not_applicable` Fourier row shows the data-params hint with the snippet; (4) cancel mid-run → "Cancelled after 3 of 7" + inconclusive; (5) old-kernel stub (error on catalog) → the banner, Run still works for other analyses; (6) Export certificate → the fixture bridge receives `.trainability.json` containing `quantumness` and `.md` containing the claim; (7) palette command "Run quantumness certificate" from the editor lands on the running Lab. `tests/e2e/discovery.spec.ts` gains: wizard shows the Goldilocks template; a stubbed evaluation with `goldilocks` metrics renders the drawer's suite section and the Red Queen exploit lane. Screenshots at 1440/1024 light/dark for the Quantumness tab.
- Manual real-kernel run (release gate): the HEA seed and the depth-20 circuit, screenshots attached to the PR.

### 7.4 CI

- `kernel-tests.yml`: the `pytest-minimal-venv` job already globs `test_trainability_*.py`; add `kernel/tests/test_discovery_goldilocks*.py` and assert in `test_discovery_optional_deps.py` that `kernel.trainability.surrogates` imports with scipy **absent** (monkeypatched `sys.modules["scipy"] = None`) and the `_expm` fallback is used (test marks which path ran).
- A `physics` marker for the §7.2 loops (≤ 90 s total) runs in the main job; the 1000-circuit MPS property loop is capped at 20 s via a seeded subset in CI and the full loop runs under `NUCLEI_SLOW_TESTS=1`.
- Playwright job: `quantumness.spec.ts` added to the lab project list.

---

## 8. Acceptance criteria

- [ ] `trainability_start` with `analyses: ["surrogates"]` on the `lab-project/ansatz.py` fixture returns a `surrogates` partial with 7 reports and a non-null `quantumness` in ≤ 60 s on the dev container; every report has a status from the enum and a reason when not `wins`/`fails`.
- [ ] No new required dependency: `kernel/requirements.txt` unchanged; every new module imports without scipy/stim; scipy is used opportunistically and reported in provenance.
- [ ] Every surrogate's win is checked against statevector (n ≤ 20) or against another winner; a seeded injected disagreement yields `suite_inconsistent` and `inconclusive`.
- [ ] The MPS rigorous bound has zero violations over the §7.2 property loop; the heuristic is labelled heuristic everywhere it appears (kernel JSON, UI, certificate).
- [ ] 𝔤-sim computes expectations (not only dimensions) and matches statevector to 1e-8 on the listed algebras; `not_applicable` when neither O nor ρ₀ lies in 𝔤, with the residual.
- [ ] Fourier/RFF are `not_applicable` without declared data params, with an actionable hint; with `nuclei_data_params` they run and are labelled empirical.
- [ ] The `resists` verdict is only emitted when ≥ 3 class-A surrogates ran to `fails` with no budget exhaustion, and its claim text matches §2.9 verbatim (snapshot).
- [ ] Trainability evidence level is always shown; single-size evidence carries the n-only caveat.
- [ ] Certificate JSON/MD include `quantumness`, the suite table, `suite_version` and `suite_fingerprint`; bit-for-bit reproducibility test passes for `surrogates`.
- [ ] Catalog message works; an old kernel yields the "kernel too old" banner, not a blank tab.
- [ ] Every §5.3 state has a jsdom test and the Playwright path (§7.3) passes against the stub kernel; palette commands exist and work.
- [ ] `goldilocks` is listed by `discovery_evaluators`, has a template, every guardrail has a cheating-candidate test, the seed scores as §6.8 states, and the Red Queen audit's `suite_attack` flips a seeded fake-resistant record.
- [ ] Conjecture features/predictions validate and a conjecture with `resistance >= 0.5` runs the suite on held-out circuits.
- [ ] Docs: `trainability-lab.mdx` (Quantumness section), `discovery-engine.mdx` (Goldilocks), `messages-lab.mdx` (v1.4), protocol changelog, CLAUDE.md "Kernel Protocol v1.4".
- [ ] Minimal-venv CI job green with the new tests.

---

## 9. Implementation breakdown — units of work and file ownership

Agents work in parallel worktrees; **each file has exactly one owner.** Shared files that several units need are owned by one unit (listed) and other units send that owner the exact lines they need.

| Unit | Scope | Exclusive files | Depends on |
|---|---|---|---|
| **U1 Surrogate base + cheap surrogates** | `base.py`, registry, `oracle.py` skeleton, S1 `ppe.py`, S3 `stabilizer.py`, S5 `lightcone.py` (+ the move of `light_cone_width` into `kernel/trainability/lightcone.py` with Clifford pre-conjugation and the re-export in `_frontier_structure.py`) | `kernel/trainability/surrogates/{__init__,base,ppe,stabilizer,lightcone,oracle}.py`, `kernel/trainability/lightcone.py`, `kernel/discovery/evaluators/_frontier_structure.py` (re-export line only), `kernel/tests/test_trainability_surrogates.py`, `kernel/tests/test_trainability_lightcone.py` | — |
| **U2 MPS simulator** | `kernel/trainability/mps.py`, S4 driver | `kernel/trainability/mps.py`, `kernel/trainability/surrogates/mps.py`, `kernel/tests/test_trainability_mps.py` | U1 `base.py` (interface frozen in this spec; U2 may start against it immediately) |
| **U3 𝔤-sim** | `gsim.py`, `_expm.py`, S2 | `kernel/trainability/gsim.py`, `kernel/trainability/_expm.py`, `kernel/trainability/surrogates/gsim.py`, `kernel/tests/test_trainability_gsim.py` | U1 interface |
| **U4 Fourier + RFF** | spectrum enumeration, trig fit, RFF, S6/S7, `inspect` `data_params` | `kernel/trainability/fourier.py`, `kernel/trainability/surrogates/{fourier,rff}.py`, `kernel/trainability/inspect.py` (data_params field), `kernel/tests/test_trainability_fourier.py`, `kernel/tests/test_trainability_inspect.py` (extend) | U1 interface |
| **U5 Suite + verdict + protocol** | `suite.py`, `quantumness.py`, settings, job worker dispatch, result assembly, catalog handler, provenance 1.4, lab protocol docs fixtures | `kernel/trainability/surrogates/{suite,quantumness}.py`, `kernel/trainability/_settings.py`, `kernel/trainability/job_worker.py`, `kernel/trainability/jobs.py`, `kernel/trainability/handlers.py`, `kernel/trainability/provenance.py`, `kernel/tests/test_trainability_{quantumness,settings,handlers,jobs,jobs_integration,provenance}.py`, `kernel/tests/test_docs_lab_fixtures.py` | U1–U4 (integrates; can be built with stub surrogates behind the registry and swapped) |
| **U6 Lab frontend** | types, client catalog, store, Quantumness tab/table/bars/cell, verdict card, target-bar checkbox, copy, certificate renderer, Dirac block, palette commands, e2e | `src/types/trainability.ts` (extend), `src/services/trainability/{client,quantumness,quantumnessCopy,certificate,certificateIo,context,fixtures,settings}.ts` (+ tests/snapshots), `src/stores/trainabilityStore.ts`, `src/components/trainability/**`, `tests/e2e/quantumness.spec.ts`, `tests/e2e/fixtures/lab-project/**` (add `data_model.py`), the trainability block in `src/hooks/useDirac*` (trainability branch only) | U5 protocol (shapes frozen here; build against fixtures first) |
| **U7 Goldilocks evaluator** | evaluator + helpers + seed + registry entry | `kernel/discovery/evaluators/goldilocks.py`, `kernel/discovery/evaluators/_goldilocks_{config,resistance,fitness}.py`, `kernel/discovery/evaluators/__init__.py` (one import + dict entry), `kernel/discovery/evaluators/availability.py` (entry), `kernel/discovery/seeds/goldilocks.py`, `kernel/discovery/seeds/__init__.py`, `kernel/tests/test_discovery_goldilocks.py`, `kernel/tests/test_discovery_seeds.py` (extend), `kernel/tests/test_discovery_evaluators.py` (extend), `kernel/tests/test_discovery_optional_deps.py` (extend) | U5 (`run_surrogate_suite`) |
| **U8 Goldilocks audit + conjecture hook** | audit, shared frontier helpers promotion, exploit fixtures, conjecture features/predictions/tester | `kernel/discovery/audits/goldilocks.py`, `kernel/discovery/audits/_frontier_shared.py` (new; `audits/trainability_frontier.py` switched to import from it — same owner), `kernel/discovery/conjecture/{predicate,spec,tester,semantics}.py`, `kernel/tests/test_discovery_goldilocks_audit.py`, `kernel/tests/test_discovery_conjecture_*.py` (extend), `kernel/tests/fixtures/exploits/goldilocks-*.json`, `kernel/tests/test_discovery_exploits.py` (extend) | U7 |
| **U9 Discovery frontend** | evaluator kind, template, wizard card, drawer "Surrogate suite" section, honesty copy, Red Queen prompt paragraph, archive categorical descriptor, e2e | `src/types/discovery.ts` (extend), `src/types/conjecture.ts` (extend), `src/services/discovery/{templates,honesty,redQueenPrompt,format,prompt,fixtures}.ts` (+ tests/snapshots), `src/components/discovery/**`, `tests/e2e/discovery.spec.ts` | U7 shapes (frozen here) |
| **U10 Lead: docs, CI, wiring** | docs-site pages, protocol changelog, CLAUDE.md, `kernel-tests.yml`, `playwright.config.ts`, palette entries in `src/components/commandPalette/CommandPalette.tsx` (from U6's list) and their wiring in `src/App.tsx`, `src/types/quantum.ts` if a union needs the catalog message, final integration review | `docs-site/**`, `CLAUDE.md`, `.github/workflows/**`, `playwright.config.ts`, `src/components/commandPalette/**`, `src/App.tsx`, `src/stores/navigationStore.ts`, `src/types/quantum.ts`, `src/layout/**`, `src/components/lab/**` | U5–U9 |

Build order and gates: U1 → {U2, U3, U4} in parallel → U5 (gate: §7.1 kernel suites + §7.2 physics green, `pytest-minimal-venv` green) → {U6, U7} in parallel → {U8, U9} → U10 (gate: Playwright + screenshots + adversarial review of the verdict copy and the resistance formula).

Anyone needing a change in a file they do not own reports the exact diff to the owner (or the lead) and does not edit it.

---

## 10. Cross-spec interfaces (what this spec provides / needs)

**Provides**
- `kernel.trainability.surrogates.suite.run_surrogate_suite(circuit, observable, *, settings, seed, init, backend, progress, cancel) -> dict` (§3.3) and `kernel.trainability.surrogates.base.SurrogateReport` — for **Spec 02** (noisy trainability may want the suite on noiseless proxies; noise-aware surrogates are *not* in this suite — Spec 02 owns them and may register additional `Surrogate` implementations via `SUITE_EXTENSIONS` in `surrogates/__init__.py`, a tuple appended after the core suite, with their own `claim_class`).
- `kernel.trainability.gsim.GSim` (basis, structure constants, `evaluate(values)`) and `kernel.trainability.mps.MpsState` — for **Spec 03** (symmetry compiler / classical deploy): a winning surrogate can be *exported* as a classical program. This spec adds to every report `exportable: {"kind": "gsim"|"mps"|"fourier"|"light_cone", "ref": "<job_id>/<surrogate_id>"} | null`; Spec 03 defines the export format and the deploy path and must not re-implement the simulators.
- `quantumness` verdict dict (§3.6) in `trainability_result` and in the certificate — for **Spec 04** (verified suggestions), which may cite `verdict`, `cheapest_winner` and the claim text, and must not restate the claim in stronger words.
- `kernel.trainability.lightcone.light_cone_width` (moved; `_frontier_structure` re-exports).

**Needs**
- From Spec 02: nothing in v1. If Spec 02 introduces a noisy IR, the suite's applicability functions must be given a `noise: None` guarantee (the suite refuses noisy circuits with `not_applicable: "noisy circuit"` — a one-line check against the IR `notes`/a future `noise` field; the interface is `ParamCircuit` as today).
- From Spec 03: none; the `exportable` field is additive and may be null.
- From Spec 04: none.

---

## 11. Risks and open questions

**Risks**
1. **MPS rigorous bound is loose** on circuits where the heuristic converges early; the verdict will say "fails" while the heuristic says "converged". This is by design (honesty) but users may find it conservative. Mitigation: both numbers shown; a one-liner explains why the heuristic cannot win. Open: a tighter bound using the actual truncated-overlap product ∏(1 − εₖ)^{1/2} is also rigorous for the *state* fidelity and slightly tighter — adopt it if the property test still passes (U2 decides, documents the formula used).
2. **𝔤-sim at d ≈ 2048** costs d³ ≈ 8.6e9 flops for the eigendecomposition per distinct generator; with many distinct generators it may exhaust its budget on circuits that *are* 𝔤-sim simulable. Mitigation: budget-aware (reports `budget_exhausted`, never `fails`); the Krylov/`expm_multiply` path when scipy is present (v1.1).
3. **Fourier/RFF require an oracle**; at n > 20 without a winning class-A surrogate they are `not_applicable`, which users may read as "resists". The UI sentence for that case is explicit ("needs a trusted oracle; this says nothing about simulability").
4. **Suite time.** Default 60 s may be too long for the habitual "run everything" click. Mitigation: `surrogates` off by default; the checkbox shows the budget; progress per surrogate; cancel keeps partial results.
5. **Goldilocks reward hacking** beyond §6.5: the resistance formula's clip fractions are a judgment call; the Red Queen audit and the exploit-fixture loop are the standing defence. Red-team before release (adversarial review gate in U10).
6. **Ownership friction:** `_settings.py`, `job_worker.py`, `handlers.py` are U5-owned but U1–U4 need nothing in them before U5 — confirmed by the registry design.

**Open questions (decide before U5 ships)**
1. Should `resists_implemented` require the **statevector** cross-check at n ≤ 20 to have run (it always does when n ≤ 20) and, above 20, require ≥ 2 winners agreeing for `simulable`? Current rule: one winner suffices for `simulable`; consistency is a bug detector, not a quorum.
2. Default ε: 0.01·max(1, ‖O‖₁) vs a per-term normalization (as the frontier evaluator rescales max |cⱼ| = 1). The Lab keeps the user's observable; Goldilocks rescales. Confirm with the owner.
3. Training dequantization on a **user dataset** (`nuclei_dataset` hook) — v1.1; the model-as-target RFF experiment ships in v1.
4. Should the Goldilocks `confirm` stage's min-over-orderings MPS also apply at `full` (cost ×3)? Current: `confirm` and audit only.
5. Conjecture Engine: should `resistance` conjectures use `full` budgets (slow) or `screen` (fast, weaker)? Current: screen budgets with the caveat in the ledger.
6. Citation to verify at docs time: Cerezo et al. arXiv:2312.09121 journal version (believed Nature Communications 2025) [verify]; Larocca et al. BP review, Nat. Rev. Phys. (2025) [verify] — used only in the docs page, not in the kernel strings.

---

## 12. References (verified unless marked)

- Cerezo, Larocca, García-Martín, Diaz, Braccia, Fontana, Rudolph, Bermejo, Ijaz, Thanasilp, Anschuetz, Holmes, "Does provable absence of barren plateaus imply classical simulability? Or, why we need to rethink variational quantum computing", arXiv:2312.09121.
- Schreiber, Eisert, Meyer, "Classical surrogates for quantum learning models", Phys. Rev. Lett. 131, 100803 (2023); arXiv:2206.11740.
- Landman, Thabet, Dalyac, Mhiri, Kashefi, "Classically approximating variational quantum machine learning with random Fourier features", ICLR 2023; arXiv:2210.13200.
- Sweke, Recio-Armengol, Jerbi, Gil-Fuster, Fuller, Eisert, Meyer, "Potential and limitations of random Fourier features for dequantizing quantum machine learning", Quantum 9, 1640 (2025); arXiv:2309.11647.
- Schuld, Sweke, Meyer, "Effect of data encoding on the expressive power of variational quantum-machine-learning models", Phys. Rev. A 103, 032430 (2021).
- Nemkov, Kiktenko, Fedorov, "Fourier expansion in variational quantum algorithms", Phys. Rev. A 108, 032406 (2023); arXiv:2304.03787.
- Angrisani, Schmidhuber, Rudolph, Cerezo, Holmes, Huang, "Classically estimating observables of noiseless quantum circuits", arXiv:2409.01706 (v2 scope: random unstructured circuits).
- Rudolph, Fontana, Holmes, Cincio et al., "Classical surrogate simulation of quantum systems with LOWESA", arXiv:2308.09109 [verify author list].
- Goh, Larocca, Cincio, Cerezo, Sauvage, "Lie-algebraic classical simulations for variational quantum computing", arXiv:2308.01432.
- Ragone, Bakalov, Sauvage, Kemper, Ortiz Marrero, Larocca, Cerezo, "A Lie algebraic theory of barren plateaus for deep parameterized quantum circuits", Nat. Commun. 15, 7172 (2024).
- Bravyi, Gosset, "Improved classical simulation of quantum circuits dominated by Clifford gates", Phys. Rev. Lett. 116, 250501 (2016).
- Bravyi, Browne, Calpin, Campbell, Gosset, Howard, "Simulation of quantum circuits by low-rank stabilizer decompositions", Quantum 3, 181 (2019).
- Vidal, "Efficient classical simulation of slightly entangled quantum computations", Phys. Rev. Lett. 91, 147902 (2003).
- Schollwöck, "The density-matrix renormalization group in the age of matrix product states", Ann. Phys. 326, 96 (2011).
- Zhou, Stoudenmire, Waintal, "What limits the simulation of quantum computers?", Phys. Rev. X 10, 041038 (2020).
- Bravyi, Gosset, Movassagh, "Classical algorithms for quantum mean values", Nat. Phys. 17, 337 (2021).
- Larocca et al., "Barren plateaus in variational quantum computing", Nat. Rev. Phys. (2025); arXiv:2405.00781 [verify volume/pages].
