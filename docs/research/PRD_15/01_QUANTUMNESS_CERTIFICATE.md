# PRD 15 · Spec 01 — Quantumness Certificate and the Goldilocks Discovery evaluator

**Status:** Spec v2 (2026-10-19, revised after the physics and engineering review — see master §10) · binding technical contract for the parallel build · branch `feat/prd15-quantumness-lab` (based on v0.14.1)
**Workspace:** Research workspace only (Learn mode is deprecated; no Learn surface is touched)
**Protocol:** Kernel lab messages **v1.4** (additive-only on v1.3; `kernel/trainability/provenance.py: PROTOCOL_VERSION = "1.4"` is set once by the master plan's foundations unit F-1, not by this spec)
**Depends on:** PRD 14 (`docs/research/PRD_14_QUANTUM_AI_LAB.md`, `PRD_14_ADDENDUM.md`) — the IR, Lab Compiler, PPE, Lie closure, scaling verdicts, provenance, job system, Discovery evaluators/audits/conjectures. Everything below **reuses** those modules; nothing is reinvented.

This document is both the product requirement and the implementation contract. Wire shapes, file layouts, signatures and ownership are fixed. If a contract here is wrong, raise it; do not silently diverge.

> **Master-plan resolution (2026-10-19).** This spec is governed by `docs/research/PRD_15_QUANTUMNESS_LAB.md` §4.3 and §7: the surrogate code lives in `kernel/surrogates/` (one registry shared by ideas 1, 2 and 6), `PROTOCOL_VERSION = "1.4"` and the lab message router (`kernel/lab_routes.py`) are owned by the Wave 1 foundations unit F-1, settings/analysis/handler/palette/Dirac/e2e-fixture extensions go through registries instead of shared-file edits, and the units below map onto the master waves as stated in §9. Learn mode is deprecated; nothing here touches it.

---

## 0. One-paragraph summary

**Idea 1 — Quantumness Certificate.** A new Trainability Lab analysis, `surrogates`, runs a *suite of classical simulation attacks* on the user's parameterized circuit + observable and combines it with the Lab's existing trainability evidence into a **joint verdict**: `bp_detected`, `no_bp_detected_simulable` (which class-A surrogate wins, at what cost **below brute force**, at what accuracy), `no_bp_detected_resists_implemented_surrogates`, or `inconclusive`. The trainability axis is named for what is measured — gradient-variance scaling — never "trainable": absence of a barren plateau does not guarantee trainability (local minima: Anschuetz & Kiani, Nat. Commun. 13, 7760 (2022)). Every surrogate has a declared applicability condition, a cost model, an accuracy target and a rigorous or labelled-heuristic error bound, and a surrogate that only reproduces the cost at brute-force cost is reported as `brute_force`, never as a win. The verdict is exported into the existing PRD 14 §D certificate with full provenance.

**Idea 2 — Goldilocks evaluator.** A Discovery Engine evaluator, `goldilocks`, whose objective rewards *certified* trainability **and** resistance to the surrogate suite — searching for ansätze that resist every *fully classical* surrogate we implement. Cerezo et al. (Nat. Commun. 16, 7907 (2025), doi:10.1038/s41467-025-63099-6) argue that BP-free models admit classical simulation that may need *quantum-enhanced* data acquisition (classical shadows of the initial state); the suite contains no such surrogate, so "resists" says nothing about them, and the evaluator never describes its zone as "empty by conjecture". It ships with a screen → full → confirm cascade, MAP-Elites descriptors, anti-gaming guardrails, a Red Queen audit in which the surrogate suite (with larger budgets and adversarial variants) is the attacker, and a Conjecture Engine hook.

**The honest frame, stated once and repeated in the UI:** "Resists all implemented surrogates" is a statement about *these implementations at these budgets*. It is **not** a proof of classical hardness and **not** a claim of quantum advantage. It is a lead.

---

## 1. Motivation and novelty

### 1.1 Why

PRD 14 made the trainability half of the question visible (gradient variances, scaling laws, DLA). The other half — *is this trainable only because it is classically simulable?* — is answered today by one instrument (the DLA / 𝔤-sim card) plus the PPE's bound. That is one surrogate. The literature now lists several distinct classical routes to a variational cost:

| Route | Representative reference | What it exploits |
|---|---|---|
| Pauli propagation (Heisenberg picture, truncated) | Angrisani et al., Phys. Rev. Lett. 135, 170602 (2025) (guarantee scoped to random circuits whose layer distributions are invariant under single-qubit rotations); Rudolph, Fontana, Holmes, Cincio, LOWESA, arXiv:2308.09109 | Small effective Pauli weight / average-case concentration |
| Lie-algebraic simulation (𝔤-sim) | Goh et al., arXiv:2308.01432; Ragone et al., Nat. Commun. 15, 7172 (2024) | Polynomial-dimension dynamical Lie algebra |
| Clifford-dominated exact Pauli-path enumeration (2^t upper bound; **not** stabilizer rank — Bravyi & Gosset's low-rank decompositions are listed under NOT_IMPLEMENTED) | the untruncated Heisenberg path sum (same engine as S1) | Few non-Clifford gates in the light cone |
| Tensor networks (MPS) | Vidal, PRL 91, 147902 (2003); Schollwöck, Ann. Phys. 326, 96 (2011); Zhou, Stoudenmire & Waintal, PRX 10, 041038 (2020) | Low entanglement across a 1D cut |
| Light-cone / locality | standard backward-light-cone restriction + statevector on the cone (BGM's mean-value algorithms — Barvinok interpolation, MC+MPS — are NOT_IMPLEMENTED) | Shallow depth + local observable |
| Fourier-series surrogate of a learning model | Schreiber, Eisert & Meyer, PRL 131, 100803 (2023); Schuld, Sweke & Meyer, PRA 103, 032430 (2021); Nemkov, Kiktenko & Fedorov, PRA 108, 032406 (2023) | Small frequency spectrum of data re-uploading |
| Random Fourier features dequantization | Landman et al., arXiv:2210.13200 (ICLR 2023); Sweke et al., Quantum 9, 1640 (2025) | Spectrum sampling + linear regression |
| The conjecture tying the halves together | Cerezo et al., Nat. Commun. 16, 7907 (2025) | Absence of BPs ⇒ a polynomial subspace ⇒ simulability, possibly with quantum-enhanced data acquisition (conjectured) |
| Absence of BPs is not trainability | Anschuetz & Kiani, Nat. Commun. 13, 7760 (2022) | BP-free shallow models can be swamped with local minima |

No shipping tool runs these **as a suite on the user's own circuit**, with a shared accuracy target, per-route cost accounting, cross-validation between routes, and a reproducible certificate. That is the product.

### 1.2 What is genuinely new

1. **A joint, quantitative verdict map.** Trainability evidence (PRD 14) × simulability evidence (this suite), with per-cell semantics and an explicit evidence level, rather than two separate cards.
2. **Cross-validated surrogate suite.** Every surrogate that claims a win must agree with every other winner (and with statevector when n ≤ 20) within the accuracy target, or its win is revoked and the suite reports `suite_inconsistent`. The suite catches its own bugs.
3. **Rigorous-interval MPS.** A numpy-only MPS circuit simulator whose truncation error is accumulated into a *rigorous* bound on ⟨O⟩ (§2.5), not only a convergence heuristic. Both numbers are reported, labelled.
4. **𝔤-sim as an actual simulator, not only a dimension check.** PRD 14 says "g-sim feasible"; this spec computes ⟨O⟩ by 𝔤-sim (adjoint representation on the DLA basis) and verifies it.
5. **Claim classes.** Surrogates are split into *dequantization of the cost* (class A: PPE, 𝔤-sim, Clifford-path enumeration, MPS, light cone) and *surrogates of a trained learning model* (class B Fourier, class C RFF). **Only class-A reports with `bound_kind ∈ {rigorous, exact}` can set the simulability axis**; class B/C results are reported on a separate `model_surrogate` line and never enter `winners`, `cheapest_winner`, the resists count or the joint-verdict table (test: a Fourier-only win cannot produce `simulable`).
5b. **Brute force is not a win.** Every surrogate reports `brute_force` (status distinct from `wins`) when its resource use reaches the brute-force bound for the circuit (§2.1). At n ≤ 20 statevector simulation is feasible by definition, so the claim text always says "at n = N" and states that; `resists_implemented` is only possible for n > `MAX_STATEVECTOR_QUBITS`. An optional multi-n `surrogate_scaling` mode (§2.9) is the only way to say anything about a *family*.
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
- Accuracy target ε (absolute, on C). Default ε = 0.01 · max(1, ‖O‖₁) — scaled so that an observable with many terms is not held to an unattainable absolute error. The UI shows ε in absolute form, relative to ‖O‖₁, **and relative to the cost's spread** `ε / std_𝒟(C)` (std over the K sampled points, from the trusted oracle when available, else from the winners' estimates). The suite also evaluates a **constant-predictor baseline** (the mean of C over the K points): if the constant predictor is within ε at every point, the target is marked `target_trivial: true` and neither `simulable` nor `resists_implemented` is issued (`inconclusive: "accuracy target is trivial at this ε: a constant reproduces the cost"`).
- A surrogate S **wins** at point k when it returns an estimate Ĉ with a bound |Ĉ − C(θ⁽ᵏ⁾)| ≤ ε that is *rigorous* (R) or *exact*, inside its budget, **at a cost strictly below the brute-force bound** (next item). S **wins overall** when it wins at every point. Any other outcome is one of `brute_force` (reproduced the cost within ε but only at brute-force cost — see below), `fails` (ran, bound > ε), `budget_exhausted`, `not_applicable` (precondition false, reason given), `unavailable` (optional dependency missing — none are required in v1), `error`. Class B/C surrogates use the same statuses but their "win" is labelled empirical and never reaches the verdict (§2.9).
- **Brute-force bound (binding per surrogate).** A surrogate's status is `brute_force` instead of `wins` whenever its resource use reaches the brute-force bound for *this* circuit: light cone `w_max ≥ n`; MPS `chi_needed ≥ 2^{⌊n/2⌋}` or `chi_needed` equal to the exact Schmidt rank across the worst cut; PPE / Clifford-path `frontier_needed ≥ 4^n` or every string enumerated; Clifford-path `t_eff` = every rotation in the cone (no Clifford dressing at all); 𝔤-sim `d ≥ 4^n − 1`. The cost copy for a genuine win always reads "reproduced with cost X < brute-force cost Y (2^n amplitudes)". `brute_force` reports keep their interval and estimate (they still feed the consistency check and the oracle) but **never** set `simulable` and never count toward `winners`.

### 2.2 Surrogate S1 — Pauli propagation (reuse)

- Uses `pauliprop.ppe_expectation_bounds(circuit, O, values, max_frontier, time_budget_s, min_weight_abs)` (PRD 14 §5.4b; `ppe_core.expectation_bounds`). Shared/affine parameters are allowed here (expectation mode).
- **Applicability:** every parameterized gate is a single-Pauli rotation and every fixed gate is Clifford (`ppe_applicable` with `init` ignored for expectations); otherwise `not_applicable: "non-Pauli rotation or non-Clifford fixed gate"`.
- **Estimator:** the Heisenberg Pauli-path sum with truncation by min |weight| and max Pauli weight; the returned interval `[kept − D, kept + D]` is rigorous (D = discarded ℓ1 mass). Win ⇔ D ≤ ε at every point (bound kind R).
- **Cost model:** predicted = `2^{t_eff}` worst case (t_eff = number of rotations in the backward light cone of O, §2.6); measured = `frontier_peak` (strings) and elapsed. Reported cost = `log10(frontier_peak)`, censored at `max_frontier` as in addendum §B.
- **Schedule:** a doubling sweep of `max_frontier` ∈ {2⁵…2^{⌈log₂ max⌉}} with `min_weight_abs = 0`; stop at the first frontier whose D ≤ ε. `chi_needed`-style metric: `frontier_needed` = first winning frontier size (or null).
- **Brute-force rule:** `brute_force` when `frontier_needed ≥ 4^n` or the sweep enumerated every Pauli string (all 4^n) before reaching ε.
- **Validity notes:** for `uniform` 𝒟 the *average-case* guarantee of Angrisani et al. (PRL 135, 170602 (2025)) applies only to random circuits whose layer distributions are invariant under single-qubit rotations; the certificate reports only what the rigorous interval says at the sampled points and never invokes the average-case theorem as a guarantee for structured circuits.

### 2.3 Surrogate S2 — 𝔤-sim (Lie-algebraic simulation), new simulator

**Theory** (Goh et al., arXiv:2308.01432). Let 𝔤 = span_ℝ⟨iG̃₁,…,iG̃ₘ⟩_Lie with effective generators G̃ₖ (fixed gates pushed to the end, PRD 14 §5.5), basis {Bₐ}_{a=1..d}, d = dim 𝔤. Write O = Σₐ oₐ Bₐ + O_⊥ with O_⊥ ⊥ 𝔤 (Hilbert–Schmidt). For a product of exponentials U = ∏ₖ e^{−iθₖG̃ₖ} and any A ∈ 𝔤, U† A U ∈ 𝔤, and the adjoint action is linear on the coefficient vector: `ad(θₖ) = exp(θₖ · ad_{G̃ₖ})` with (ad_{G̃ₖ})_{ab} the structure constants from [G̃ₖ, B_b] = Σₐ f_{ab}^{(k)} Bₐ (real after the usual Hermitian/anti-Hermitian bookkeeping). Then

  C(θ) = Σₐ (U† O U)ₐ ⟨0|Bₐ|0⟩ + ⟨0|U† O_⊥ U|0⟩.

The second term is **not** computable by 𝔤-sim. Therefore:

- **Applicability:** `lie_algebra` status `complete`, d ≤ `max_dimension` (default 2048), and **O ∈ 𝔤** (purity `observable_in_algebra` with residual ‖O_⊥‖₂/‖O‖₂ ≤ 1e-9). The alternative route (ρ ∈ 𝔤, evolve the state's coefficients instead) is also implemented: applicability is `O ∈ 𝔤 or ρ₀ ∈ 𝔤` (ρ₀ = |0⟩⟨0| ∈ 𝔤 iff 𝔤 contains all of {I,Z}ⁿ projector components — rarely true; implemented because it is cheap and the lint already computes purities). Otherwise `not_applicable: "neither the observable nor the initial state lies in 𝔤"` — this is exactly the PRD 14 "g_sim_not_applicable" case (`verdict.ts: G_SIM_NOT_APPLICABLE_TEXT`), now made quantitative.
- **Estimator:** build the d×d real matrices ad_{G̃ₖ} from Pauli-string commutators (reuse `symplectic.multiply`/`commutator_string`; for the Pauli-sum closure path use `lie_core`'s sparse vectors). Evaluate `v ← expm(θₖ ad_k) v` right-to-left over the gates. Use `scipy.linalg.expm` when scipy is present, else a numpy Padé(13) with scaling-and-squaring (`kernel/surrogates/_expm.py`, ~60 lines, tested against scipy when available). Rotations by the same generator share one eigendecomposition: ad_k is real antisymmetric in an orthonormal basis, so `expm(θ ad) = V diag(e^{iθλ}) V†` once per distinct generator (O(d³) once, O(d²) per gate). ⟨0|Bₐ|0⟩ via `expectation_zero_state`.
- **Accuracy:** exact to floating point; bound kind R with declared tolerance 1e-8·‖O‖₁ (unit tests enforce 1e-8 against statevector for n ≤ 8).
- **Cost model:** predicted = d³ (setup) + gates·d² ; measured elapsed. Reported cost = `log10(d)`. 𝔤-sim "wins" iff applicable and the evaluation completes in budget.
- **Validity:** none of this assumes a 2-design; the Ragone variance *prediction* keeps its PRD 14 assumptions and is not used here.

### 2.4 Surrogate S3 — Clifford-dominated exact Pauli-path enumeration (2^t upper bound)

- **Observation:** a Pauli rotation e^{−iθP/2} = cos(θ/2) I − i sin(θ/2) P branches a Heisenberg string into at most two; the Pauli-path sum over all ≤ 2ᵗ branches *is* the untruncated PPE (S1 with `min_weight_abs = 0`, no weight cap). Exact simulation cost by this route is therefore bounded by `min(2^{t_eff}, frontier_peak)`. **This is not stabilizer-rank simulation**: the Schrödinger-picture low-rank stabilizer decompositions of Bravyi & Gosset (PRL 116, 250501) and Bravyi et al. (Quantum 3, 181) scale as ~2^{0.23t} for T gates and by stabilizer extent for arbitrary rotations, far below 2^t, and handle 40–50 T gates. They are **not implemented**; "stabilizer-rank / sum-over-Cliffords (Bravyi–Gosset; Bravyi et al. 2019)" is listed in `NOT_IMPLEMENTED`, and S3's `fails` must never be read as "resists stabilizer methods". S1 and S3 are the **same algorithm family** (`family: "pauli_path"`) for every quorum rule.
- **t_eff:** count the parameterized gates in the backward light cone of O (§2.6) whose angle at θ⁽ᵏ⁾ is not within 1e-9 of a multiple of π/2 (`is_clifford_gate(name, angles)` from `symplectic`), plus non-Clifford fixed gates (T, TDG, U/P/RZ at generic angles, CCX/CCZ/CSWAP…). Because θ ~ 𝒟 is continuous, parameterized gates are generically non-Clifford; the detector is therefore mainly a **structural** classifier: "this circuit is Clifford with t_eff dressing gates".
- **Applicability:** always (it is a count). It **wins** only when t_eff ≤ `t_max` (default 24) **and** the exact PPE run (S1 with `min_weight_abs = 0`, `max_frontier = 2^{t_eff}`) completes with D = 0 **and** t_eff is strictly smaller than the number of rotations in the cone (there is Clifford dressing to exploit). If every rotation in the cone is non-Clifford, or the run enumerated all 4^n strings, the status is `brute_force`. Otherwise `fails` with the cost report. Bound kind R (exact).
- **Non-Pauli non-Clifford fixed gates** (e.g. CCX) are decomposed by `GATE_SPECS` to a `{Clifford, T}` count via a fixed table (CCX = CCZ = 7 T, CSWAP = 7 T, U/P generic = 1 non-Clifford); the count is an upper bound and the exact run is attempted only when the circuit is PPE-applicable; otherwise S3 reports the count and `not_applicable: "exact branch simulation needs Pauli rotations + Clifford fixed gates"`.
- **Cost model:** predicted = 2^{t_eff}; reported cost = `t_eff · log10 2` (log10 branches).

### 2.5 Surrogate S4 — MPS with bond-dimension sweep and rigorous truncation accounting (new, numpy-only)

**Representation.** |ψ⟩ = Σ A₁^{s₁} A₂^{s₂} … Aₙ^{sₙ}, site q ↔ qubit q (IR little-endian order; qubit 0 is the left end). Tensors `A[q]` of shape (χ_{q−1}, 2, χ_q), complex128. **Mixed-canonical contract (binding for U2/Q2):** before every two-site update on bond (q, q+1) the orthogonality centre is moved to that bond by QR sweeps (left-canonical to the left of q, right-canonical to the right of q+1), so that the singular values of the two-site SVD are the state's Schmidt coefficients across that cut. Truncating anywhere else does **not** give Schmidt coefficients and the ledger below would under-report the error; the implementation asserts the centre position before every SVD.

**Gates.** 1q gates contract directly. A 2q gate on neighbours (q, q+1): contract the bond, apply the 4×4, SVD, truncate to χ_max, renormalize. A 2q gate on (q, r), |q−r| > 1: route with a SWAP chain (r−q−1 swaps in, the same out), each counted as a two-site gate. 3q gates (CCX, CCZ, CSWAP) are decomposed by `GATE_SPECS` to 2q+1q gates first (their canonical decomposition, PRD 14 §4.1.6). Measurements are already dropped by the converter.

**Truncation accounting (rigorous).** At a truncation step at the orthogonality centre with normalized Schmidt spectrum {λᵢ²} (normalized *before* the cut; the renormalization after the cut is part of the accounting), dropping weight εₖ = Σ_{i>χ} λᵢ² and renormalizing gives ‖ψ − ψ′‖₂² = 2 − 2√(1 − εₖ) ≤ 2 εₖ, so ‖ψ − ψ′‖₂ ≤ √(2 εₖ). Unitaries preserve norms, so by the triangle inequality the final state obeys ‖ψ_exact − ψ_MPS‖₂ ≤ δ := Σₖ √(2 εₖ). For a normalized ψ_MPS and Hermitian O,

  |⟨ψ_exact|O|ψ_exact⟩ − ⟨ψ_MPS|O|ψ_MPS⟩| ≤ 2 ‖O‖_op δ + ‖O‖_op δ² ≤ (2δ + δ²) ‖O‖₁.

This is the **rigorous interval** `[Ĉ − B, Ĉ + B]`, B = (2δ + δ²)·‖O‖₁, clipped to ±‖O‖₁. It is often loose; the suite therefore also reports the **heuristic convergence estimate** `H_χ = |Ĉ_χ − Ĉ_{χ/2}|` across the sweep, labelled `bound_kind: "heuristic"`. **Only the rigorous bound can produce a win.** The UI shows both and says which one the verdict used.

**Sweep.** χ ∈ {2, 4, 8, …, χ_max} (default χ_max = 128; hard cap 1024). For each χ run every point; stop at the first χ whose rigorous bound ≤ ε at every point. `chi_needed` = that χ (or null, censored at χ_max). When the *exact* χ for the circuit (bounded by 2^{min(q+1, n−q−1)} across cuts and by the gate structure) is below χ_max, the final sweep step is exact (δ = 0, bound kind R, reported `exact: true`). **Brute-force rule:** the status is `brute_force` when `chi_needed ≥ 2^{⌊n/2⌋}` or `chi_needed` equals the exact Schmidt rank across the worst cut (the MPS is then a relabelled statevector; at χ_max = 128 this covers every n ≤ 14), and the copy says so.

**Expectation.** ⟨O⟩ for a Pauli sum: per term, contract the MPS with the term's single-site operators (O(n χ²·2) per term, no 2ⁿ objects). Terms are batched by shared prefix where cheap; this is an optimization, not a contract.

**Cost model.** predicted time ∝ n_2q · χ³ (SWAP-routed gates included); memory 2·n·χ²·16 B. Reported cost = `log2(chi_needed)` (censored). Resource guard: refuse χ when 2·n·χ²·16 B > 512 MiB (`mps_memory`), and when the predicted time at the next χ exceeds the remaining budget stop the sweep as `budget_exhausted` (never start a step it cannot finish).

**Qubit ordering.** Default: IR order. Option `ordering: "ir" | "reverse" | "bandwidth"` (bandwidth = reverse Cuthill–McKee on the interaction graph, numpy-only, ≤ 50 lines). The Goldilocks audit tries all three (§6.6).

**Applicability:** always for n ≤ 1024 (dense state never formed). Validity: the rigorous bound is valid for any circuit; only the heuristic is "MPS folklore".

### 2.6 Surrogate S5 — Light-cone / locality simulation (reuse + extension)

- **Backward light cone.** For each term Qⱼ of O, walk the circuit in reverse, growing the support set from supp(Qⱼ) through every gate that touches it. `light_cone_width` **and** `strip()` move together from `kernel/discovery/evaluators/_frontier_structure.py` into `kernel/trainability/lightcone.py` (`_frontier_structure` keeps re-exports so the frontier evaluator is unchanged; `light_cone_width` takes a `Stripped`, so the layering only works if `strip` moves with it). `_frontier_structure.py` documents that width as a *structural over-estimate*; as an attacker surrogate the suite computes the cone **exactly** as the Heisenberg support with Clifford cancellation (the PPE frontier's support after pushing every Clifford through — `CliffordConjugator`, which can shrink or grow the support), on whichever of {raw, Clifford-pre-conjugated} gives the smaller max width; the choice and both widths are recorded. Diagonal gates do not spread a Z-only string (already there).
- **Estimator:** when the widest cone w_max ≤ `max_width` (default 20 = `MAX_STATEVECTOR_QUBITS`), compute each term exactly on its cone with the Lab Compiler (`compile_circuit` on the restricted sub-circuit, B = K points) and sum. Bound kind R (exact, tolerance 1e-10·‖O‖₁).
- **Cost model:** predicted = Σⱼ 2^{wⱼ}·(gates in cone j); reported cost = `w_max · log10 2`.
- **Status rule (unambiguous):** `w_max > max_width` → `fails` (cost `w_max · log10 2`, censored at max_width); `w_max ≥ n` (and ≤ max_width) → `brute_force` (the "cone" is the whole register: this *is* statevector simulation and says nothing about structure); `w_max < n` and `w_max ≤ max_width` and the evaluation finishes in budget → `wins` with the copy "cost 2^{w_max} < 2^n". At n ≤ 20 a brute-force S5 always runs, which is exactly why the statevector oracle exists and why the verdict copy states "statevector simulation is feasible at n = N".
- This is the standard backward-light-cone restriction. The Bravyi–Gosset–Movassagh mean-value algorithms (Nat. Phys. 17, 337 (2021), doi:10.1038/s41567-020-01109-8 — Barvinok interpolation, OR-polynomial, Monte Carlo + MPS) beat light-cone brute force and are **not implemented** (listed in `NOT_IMPLEMENTED`).

### 2.7 Surrogate S6 — Fourier-series surrogate of a learning model (claim class B; reported on the `model_surrogate` line, never in the verdict)

Only meaningful when the circuit is a **learning model**: some parameters are *data* inputs x (re-uploading encodings) and the rest are trainable θ. The user declares the data parameters (§5: `settings.surrogates.fourier.data_params`, or the module-level `nuclei_data_params = ["x[0]", "x[1]"]`). Without a declaration S6 and S7 are `not_applicable: "no data parameters declared"` — the UI says how to declare them.

**Theory** (Schuld, Sweke & Meyer, PRA 103, 032430 (2021); Schreiber, Eisert & Meyer, PRL 131, 100803 (2023)). With each data parameter xᵢ entering only through Pauli rotations e^{−i(aₖxᵢ)Pₖ/2} with rational coefficients aₖ (`ParamRef.coeff`; the IR already restricts angles to affine maps), the model is a multivariate trigonometric polynomial

  f_θ(x) = Σ_{ω∈Ω} c_ω(θ) e^{iω·x}, Ω = { Σₖ sₖ aₖ eᵢ(ₖ) : sₖ ∈ {−½, 0, +½}·(eigenvalue gaps) } ⊂ ℝᵈ,

with |Ω| ≤ ∏ᵢ (2Lᵢ + 1) for Lᵢ the number of encoding gates of xᵢ with unit coefficient (Pauli generators have eigenvalues ±1, so the spectrum per gate is {−1, 0, 1} in units of aₖ). The spectrum is enumerated exactly from the IR (sum-set of per-gate frequency sets, deduplicated with a rational key; coefficients are rounded to 1e-9 rationals or S6 is `not_applicable: "irrational encoding coefficient"`).

**Surrogate.** Given a *fixed* θ* (the user's current values, or the sampled θ⁽ᵏ⁾), the surrogate is the coefficient vector c(θ*) ∈ ℂ^{|Ω|}, obtained by solving the linear system f_θ*(x⁽ʲ⁾) = Σ_ω c_ω e^{iω·x⁽ʲ⁾} on |Ω| + oversampling (default 1.5·|Ω|) random inputs x⁽ʲ⁾ ~ U[0,2π)ᵈ (least squares, `numpy.linalg.lstsq`; condition number recorded). The oracle for f_θ*(x⁽ʲ⁾) is the **trusted oracle hierarchy** (§3.4): statevector for n ≤ 20, else any class-A surrogate that already won. If no oracle exists S6 is `not_applicable: "no trusted oracle at this width"` — exactly the Schreiber et al. situation where the surrogate must be *extracted from the trained quantum model*, which the suite cannot do classically. The report says so.

**Accuracy.** Held-out test: 64 fresh x; `max_j |f̂(x_j) − f_oracle(x_j)|` ≤ ε ⇒ empirical win (bound kind **H**: a held-out empirical check, never rigorous; the UI label says "empirical, 64 held-out inputs, at one θ*"). When the oracle is itself a class-A surrogate with bound B_oracle (not the statevector), the reported accuracy is `held-out max + B_oracle`, labelled "includes the oracle's bound"; the statevector oracle contributes 1e-10·‖O‖₁. Reported cost = `log10 |Ω|`. Applicability cap: |Ω| ≤ `max_spectrum` (default 4096) else `fails` ("spectrum too large for the budget"). **Budget:** the oracle needs ≈ 1.5·|Ω| + 64 evaluations; S6 first checks `measured per-eval time × evaluations ≤ remaining budget` (per-eval time from the oracle's own timing) and reports `not_applicable: "oracle too slow for |Ω| = … within the budget"` with the estimate instead of starting a run it cannot finish.

**Claim** on win: "At the evaluated θ*, the model's input–output map is reproduced by a classical trigonometric polynomial with |Ω| coefficients (empirical, held-out). This removes any *inference-time* advantage of the trained model (Schreiber et al.); it says nothing about training and nothing about the variational cost C(θ)." This claim is rendered on the `model_surrogate` line of the Quantumness tab and is **excluded** from `winners`, `cheapest_winner`, the `resists` count and the joint verdict.

### 2.8 Surrogate S7 — Random Fourier features dequantization (claim class C; `model_surrogate` line only)

**Theory** (Landman et al., arXiv:2210.13200; Sweke et al., Quantum 9, 1640 (2025) for the necessary-and-sufficient conditions). Sample D frequencies ω₁…ω_D from a distribution over Ω (uniform over the enumerated spectrum, or the Landman "tree sampling" over the sum-set which the IR makes exact), build features φ(x) = [cos(ωᵢ·x), sin(ωᵢ·x)]ᵢ ∈ ℝ^{2D}, and fit a ridge regression to the **model's own outputs** f_θ*(x) on N training inputs (the model is the target function; this is the "classically approximating a VQC" experiment of Landman et al.). Report the held-out error with D and N; sweep D ∈ {16, 32, …, D_max} (default D_max = 512) and record `features_needed` = the first D whose held-out max error ≤ ε (or null).

- **Applicability:** same as S6 (declared data params, trusted oracle).
- **Bound kind H.** Reported cost = `log10(features_needed)`.
- **Claim** on win: "A classical RFF model with D features reproduces the quantum model's function on held-out inputs at this θ*." The spec deliberately does **not** claim training dequantization on the user's dataset unless the user supplies one (`nuclei_dataset = {"x": ..., "y": ...}` module hook, v1.1 — open question §8).

### 2.9 The joint verdict map — exact semantics

**Trainability axis** T ∈ {`bp`, `no_bp_evidence`, `unknown`} with evidence level. The axis is named for what is measured (gradient-variance scaling); the UI renders `no_bp_evidence` as "no barren plateau detected (gradient-variance scaling)" and never as "trainable", because absence of a barren plateau does not guarantee trainability (local minima: Anschuetz & Kiani, Nat. Commun. 13, 7760 (2022)). Copy `NO_BP_CAVEAT` ships next to every T rendering.
- `scaling` (strongest): the job's `scaling` fit verdict (PRD 14 §5.5 rules): `barren_plateau` → `bp`; `polynomial` → `no_bp_evidence`; `inconclusive` → `unknown`.
- `single_size` (weak): no scaling study. Decide on the **interval endpoints** of the normalized mean variance `Var[∂C]/‖O‖₁²` (interval `[lo, hi]` from `gradients.variance_mean_interval`, divided by ‖O‖₁²): `lo ≥ τ_hi` → `no_bp_evidence` "non-vanishing at n = N"; `hi < τ_lo` → `bp` "vanishing at n = N"; else `unknown`. τ_hi = 1e-4 and τ_lo = 1e-8 are **labelled heuristics** (settings `single_size_thresholds`, shown in the claim text). A point estimate is never used. The verdict text always carries "(at n = N only; no scaling evidence)".
- `lie`: `simulability.kind == exponential_dla` with `status == complete` and the observable in 𝔤 → prediction `bp` *in the deep-circuit regime* (Ragone assumptions); recorded as supporting evidence, never as the sole basis for `bp`.
The kernel picks the strongest available level and records `trainability_evidence: {level, basis, text}`.

**Simulability axis** S ∈ {`simulable`, `resists_implemented`, `inconclusive`}, computed **only from class-A reports whose `bound_kind ∈ {rigorous, exact}`**. Class B/C reports and class-N reports (spec 02) never enter it.
- `simulable` iff ≥ 1 class-A surrogate has status `wins` (strictly sub-brute-force, §2.1), the target is not `target_trivial`, **and** the consistency check passes (§3.4). `winners` lists every class-A winner with its cost and the brute-force cost it beat; `cheapest_winner` is the winner with the smallest reported cost (ties → the lower surrogate index). `brute_force` reports are listed separately in `brute_force: [ids]` and never set `simulable`.
- `resists_implemented` iff **n > `MAX_STATEVECTOR_QUBITS` (20)** (below that, statevector simulation is feasible and the only honest statement is `brute_force_simulable`), every class-A surrogate is `fails`, `brute_force` or `not_applicable`, no class-A surrogate is `budget_exhausted`, `unavailable` or `error`, the target is not trivial, and at least **3 distinct algorithm families** actually ran to `fails`/`brute_force`, counted over `families = {light_cone, pauli_path (S1 ∪ S3), gsim, mps}` (S1 and S3 count once). Fewer than 3 families is `inconclusive: "too few surrogate families ran"`. A `budget_exhausted` class-B/C surrogate never blocks a class-A verdict.
- `inconclusive` otherwise (budget exhaustion, errors, consistency failure, trivial target), with the reasons listed.
- **n ≤ 20:** the axis value is `simulable` when a genuine (sub-brute-force) class-A win exists, else `brute_force_simulable` (a fourth value, rendered "brute-force simulable at n = N (2^N amplitudes); no structural reduction found"). `resists_implemented` is unreachable at n ≤ 20 by construction, and the tab says why.

**Scaling property (optional `surrogate_scaling` mode).** Classical simulability is a scaling property; a single-n report is not. When the file exposes `n_qubits` through `params` (exactly as PRD 14's scaling builder), `settings.surrogates.scaling_qubits` (2–6 sizes) runs the class-A suite at every size and fits each surrogate's cost measure (`w_max`, `log2 chi_needed`, `log2 frontier_needed`, `t_eff`, `log2 d`) against n with the PRD 14 AIC exponential-vs-polynomial rule (`scaling.fit_*` reused). The result `surrogate_scaling: {per_surrogate: {fit, verdict ∈ polynomial|exponential|inconclusive}, families_polynomial: [...]}` is the **only** basis for a family-level statement ("the MPS cost of this family grows polynomially / exponentially in n"); fewer than 4 distinct sizes is always `inconclusive`, as in PRD 14. Censored costs are treated as right-censored by the fit (reported, never extrapolated below the cap).

**Joint verdict** `quantumness.verdict`:
| T \ S | simulable | brute_force_simulable (n ≤ 20) | resists_implemented (n > 20) | inconclusive |
|---|---|---|---|---|
| bp | `bp_detected` (note: also simulable by S) | `bp_detected` | `bp_detected` | `bp_detected` |
| no_bp_evidence | `no_bp_detected_simulable` | `no_bp_detected_brute_force_only` | `no_bp_detected_resists_implemented_surrogates` | `no_bp_detected_simulability_inconclusive` |
| unknown | `simulable_bp_unknown` | `brute_force_only_bp_unknown` | `resists_implemented_bp_unknown` | `inconclusive` |

**The exact claim for `no_bp_detected_resists_implemented_surrogates`** (this text ships verbatim in the kernel result, the UI and the certificate):

> For this circuit **at n = {n}** (m = {m} parameters), observable {O}, parameter distribution {𝒟}, at {K} sampled parameter points with accuracy target ε = {ε} (= {ε_rel_std} × the cost's spread over the points): every implemented classical surrogate in suite version {v} either did not apply (reasons listed) or failed to reach ε within its budget ({budgets}); {families_ran} distinct algorithm families ran. Gradient-variance evidence: {level}: {text}. No barren plateau detected is not a guarantee of trainability (Anschuetz & Kiani 2022). This is a statement about **these implementations, these budgets and this qubit count**. It is not a proof that the cost is classically hard, not a claim of quantum advantage, not a statement about the family's scaling (see `surrogate_scaling`), and not evidence about surrogates that are not implemented (listed: {not_implemented}) — in particular not about quantum-enhanced (classical-shadow) surrogates, which Cerezo et al. allow. Larger budgets, better orderings, or other methods may succeed. Treat it as a lead.

**The claim for `brute_force_simulable`** (n ≤ 20): "At n = {n} statevector simulation is feasible (2^{n} amplitudes); {ids} reproduced the cost only at brute-force cost and no implemented surrogate found a structural reduction below 2^{n}. This says nothing about larger n."

`not_implemented` is a fixed list in `surrogates/registry.py`: `{"tensor network (PEPS/TTN)", "belief propagation / BP-TN", "Clifford perturbation theory", "stabilizer-rank / sum-over-Cliffords (Bravyi–Gosset 2016; Bravyi et al. 2019)", "BGM mean-value algorithms (Barvinok interpolation, MC+MPS)", "quantum-enhanced (classical-shadow) surrogates (Cerezo et al. 2025)", "noise-induced classical simulation", "sparse Pauli dynamics / Heisenberg with Hermite truncation", "neural quantum states"}` — honest scoping shown in the UI.

### 2.10 Error-bar and confidence semantics (summary table)

| Surrogate | Class / family | Bound kind | What the interval means | Can it set the verdict? |
|---|---|---|---|---|
| S1 PPE | A / pauli_path | R | truncation ℓ1 mass | yes (`wins`); `brute_force` when all 4^n strings |
| S2 𝔤-sim | A / gsim | R (exact, tol 1e-8‖O‖₁) | floating point | yes; `brute_force` when d ≥ 4^n − 1 |
| S3 Clifford-path | A / pauli_path | R (exact) | none (D = 0 required) | yes; `brute_force` without Clifford dressing |
| S4 MPS | A / mps | R (triangle bound at the orthogonality centre) + H (convergence) | rigorous: (2δ+δ²)‖O‖₁; heuristic: |Ĉ_χ − Ĉ_{χ/2}| | rigorous only; `brute_force` when χ reaches 2^{⌊n/2⌋} / the Schmidt rank |
| S5 light cone | A / light_cone | R (exact) | floating point | yes; `brute_force` when w_max ≥ n |
| S6 Fourier | B | H (held-out max error + oracle bound) | empirical, 64 inputs, one θ* | **no** — `model_surrogate` line only |
| S7 RFF | C | H (held-out max error + oracle bound) | empirical | **no** — `model_surrogate` line only |

Numbers are never interval midpoints; a surrogate that stops early returns `estimate: null` with the interval it reached (PRD 14 PH-C1 standard).

---

## 3. Kernel design

### 3.1 Module layout (new files in bold; everything else is reuse)

```
kernel/surrogates/                    # ONE surrogate registry + simulators/fitters shared by ideas 1, 2 and 6 (master §2.3)
├── __init__.py
├── base.py                           # SurrogateReport, PointResult, statuses, BoundKind, ClaimClass A|B|C|N, SurrogateContext
├── registry.py                       # SUITE, SUITE_EXTENSIONS, SUITE_VERSION, NOT_IMPLEMENTED, suite_fingerprint(), EXPORTABLE_KINDS
├── oracle.py                         # trusted oracle hierarchy (§3.4)
├── suite.py                          # run_surrogate_suite(...) orchestrator, consistency check, cost table
├── quantumness.py                    # joint verdict (§2.9) from {gradients, scaling, lie, surrogates}
├── quick.py                          # certificate_cheap(circuit, observable, *, time_budget_s, seed, cancel) + is_available() — used by specs 03/04
├── mps.py                            # numpy-only MPS circuit simulator (state, gates, SWAP routing, truncation ledger, Pauli-sum expectation)
├── gsim.py                           # 𝔤-sim: structure constants from a Lie basis, adjoint propagation, expectation
├── _expm.py                          # expm fallback (Padé 13 + scaling/squaring) when scipy is absent
├── spectrum.py                       # feature frequency lattices from the IR (shared with spec 03 Route A)
├── fourier.py                        # trig-poly DFT-exact / least-squares fit, interval propagation, predict (shared with spec 03)
├── rff.py                            # random Fourier features fit (shared with spec 03 Route C)
├── shadow.py                         # classical-shadow snapshot simulation / import / MoM estimator / HKP budget (spec 03 Route B)
└── methods/
    ├── ppe.py                        # S1
    ├── stabilizer.py                 # S3
    ├── light_cone.py                 # S5 (uses kernel/trainability/lightcone.py)
    ├── gsim.py                       # S2 (thin: lie_algebra → ../gsim.py)
    ├── mps.py                        # S4 (sweep driver over ../mps.py)
    ├── fourier.py                    # S6
    └── rff.py                        # S7

kernel/trainability/
├── lightcone.py                      # moved from discovery/evaluators/_frontier_structure (light_cone_width + Clifford pre-conjugation)
├── analyses_surrogates.py            # registers the "surrogates" analysis + its settings section (registries from master unit F-1)
├── declarations.py                   # (F-1) reads nuclei_data_params / nuclei_model / nuclei_dataset / nuclei_observable — one reader
├── inspect.py                        # + data_params / model / dataset fields via declarations.py
├── handlers.py                       # + trainability_surrogate_catalog registered through register_sync (no shared edit)
├── provenance.py                     # PROTOCOL_VERSION = "1.4" (F-1); suite fingerprint registered via register_fingerprint
└── jobs.py                           # F-1 (Wave 1): register_result_hook("quantumness", ...) assembles the §3.6 dict in jobs._terminal_message so a cancelled job still carries it; per-analysis cumulative partials
```

### 3.2 Data structures (binding)

```python
# kernel/surrogates/base.py
SurrogateStatus = Literal["wins", "brute_force", "fails", "budget_exhausted", "not_applicable", "unavailable", "error"]
SurrogateFamily = Literal["light_cone", "pauli_path", "gsim", "mps", "model"]   # S1 and S3 share "pauli_path"
BoundKind = Literal["rigorous", "heuristic", "exact"]
ClaimClass = Literal["A", "B", "C", "N"] # A: cost dequantization; B: trained-model surrogate; C: RFF dequantization; N: noisy-cost surrogate (spec 02)

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
    family: SurrogateFamily
    status: SurrogateStatus
    brute_force_cost: float | None      # the brute-force cost (same units as cost["reported"]) this surrogate had to beat
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
    all_settings: dict                  # the full clamped job settings (noise, qkernel, ...) for SUITE_EXTENSIONS
    noise_model: "NoiseModel | None"    # settings.noise.model resolved by the suite (spec 02's noisy_ppe reads it)
    n_qubits: int
    backend: str
    seed: int
    deadline: float                     # perf_counter deadline for this surrogate
    progress: Callable[[float, str], None]
    cancel: Callable[[], bool]
    oracle: "Oracle | None"             # §3.4, set by the suite before class B/C surrogates run

class Surrogate(Protocol):
    id: str; version: str; claim_class: ClaimClass; family: SurrogateFamily; order: int
    def applicable(self, ctx: SurrogateContext) -> tuple[bool, str | None]: ...
    def predicted_cost(self, ctx: SurrogateContext) -> dict[str, Any]: ...
    def run(self, ctx: SurrogateContext) -> SurrogateReport: ...   # never raises; errors -> status "error"
```

Registry: `SUITE: tuple[Surrogate, ...]` in `order` = (light_cone, stabilizer, gsim, ppe, mps, fourier, rff) — cheap structural checks first, so predicted costs are known before expensive runs. `SUITE_VERSION = "1.0.0"`; `suite_fingerprint()` = sha256 of `kernel/surrogates/**/*.py` + `kernel/trainability/lightcone.py` bytes in sorted order (goes into provenance next to `analyses_fingerprint`).

### 3.3 Orchestrator — `suite.py`

```python
def run_surrogate_suite(circuit, observable, *, settings: dict, seed: int, init: str, backend: str,
                        progress=None, cancel=None) -> dict
```
Steps:
1. Draw K points from `default_rng(seed)` (reuse `analyses._draw_values`); K = `settings["points"]` (1–64, default 8). Record `n_qubits`, `statevector_feasible = n ≤ 20` and the brute-force costs per surrogate.
2. Budget split: `time_budget_s` total (default 60; range 5–600). Each surrogate gets `per_surrogate_budget_s` (default 15) **or** the remaining total, whichever is smaller; unspent time rolls forward. A surrogate that cannot start within budget is `budget_exhausted: "no time left"`.
3. Run in registry order, honouring `settings["suite"]` (subset of ids). Progress: `fraction = done/len(suite)` plus the surrogate's inner progress, message `"{id}: {detail}"` (≤ 10/s, as PRD 14).
4. After class A, evaluate the constant-predictor baseline (`target_trivial`), build the oracle (§3.4) and run class B/C and class N (`SUITE_EXTENSIONS`, with `ctx.noise_model` populated from `settings.noise.model`).
5. Consistency check (§3.4, class A only). 6. Cost table + the result dict:

```json
{"suite_version": "1.0.0", "epsilon": 0.0123, "epsilon_relative": 0.01, "points": 8, "init": "uniform",
 "observable_l1": 1.23, "values_sha256": "<64 hex>",
 "reports": [ SurrogateReport.to_json(), ... ],
 "n_qubits": 12, "statevector_feasible": true, "epsilon_over_cost_std": 0.08, "target_trivial": false,
 "winners": ["light_cone", "mps"], "cheapest_winner": "light_cone", "brute_force": ["stabilizer"], "families_ran": ["light_cone", "pauli_path", "mps"],
 "simulability": {"kind": "simulable"|"brute_force_simulable"|"resists_implemented"|"inconclusive", "reasons": [..]},
 "model_surrogate": {"fourier": {"status": "wins", "label": "empirical", "spectrum": 25, "claim": "..."}, "rff": {...}} | null,
 "surrogate_scaling": null | {"sizes": [...], "per_surrogate": {...}, "families_polynomial": [...]},
 "consistency": {"status": "pass"|"fail"|"skipped", "pairs": [{"a": "mps", "b": "ppe", "max_gap": 1e-4, "allowed": 0.0246}], "statevector_checked": true},
 "not_implemented": ["tensor network (PEPS/TTN)", ...],
 "budget": {"total_s": 60, "used_s": 41.2, "per_surrogate_s": 15},
 "elapsed_ms": 41231}
```

### 3.4 Trusted oracle hierarchy and the consistency check (`oracle.py`)

- `Oracle.evaluate(values: (B, m)) -> (B,)` returns C at arbitrary θ. Sources in priority order: (1) compiled statevector when n ≤ `MAX_STATEVECTOR_QUBITS` (20) and the batch fits the memory guard; (2) a class-A surrogate that **won** at every point, cheapest first, re-run at the requested θ with the same budget per call; (3) none.
- Consistency (class A only; `brute_force` reports participate because they estimate the same C(θ⁽ᵏ⁾)): for every pair of class-A winners/brute-force reports (plus the statevector when available) the estimates at each point must satisfy |Ĉ_a − Ĉ_b| ≤ B_a + B_b (bound sum; exact methods contribute 1e-8·‖O‖₁). A violation marks both reports `notes += ["consistency violation vs {other}"]`, sets `simulability.kind = "inconclusive"` with reason `suite_inconsistent`, and the job logs the pair at WARNING (this is a bug signal, by design loud).

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
{"verdict": "no_bp_detected_resists_implemented_surrogates",
 "n_qubits": 24, "statevector_feasible": false,
 "trainability": {"axis": "no_bp_evidence", "evidence": {"level": "scaling", "basis": "aic_power_law", "text": "Var[∂C] ∝ n^(−1.9) …"}, "caveat": "<NO_BP_CAVEAT>"},
 "simulability": {"axis": "resists_implemented", "winners": [], "cheapest_winner": null, "brute_force": [], "families_ran": ["light_cone","pauli_path","mps"], "reasons": []},
 "model_surrogate": null,
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
 "rff": {"features_max": 512, "train_inputs": 256},
 "scaling_qubits": [],                                 // optional surrogate_scaling mode: 2..6 sizes, needs `n_qubits` in params
 "single_size_thresholds": {"hi": 1e-4, "lo": 1e-8}}   // labelled heuristics for the single_size trainability level
```
- `settings.surrogates.fourier.data_params` resolution order (via `kernel/trainability/declarations.py`, master F-1): request → module-level `nuclei_model["features"]` (spec 03) → module-level `nuclei_data_params: list[str]` → none. `inspect` reports the resolved list in `trainability_inspected.data_params: string[]` (new optional field).

### 4.2 Streaming

- `trainability_progress {job_id, analysis: "surrogates", fraction, message: "mps: χ=16, point 3/8"}`.
- `trainability_partial {job_id, analysis: "surrogates", result: <§3.3 dict>}`.
- `trainability_result` gains `quantumness: <§3.6 dict> | null` and `provenance.suite_version`, `provenance.suite_fingerprint`, `provenance.kernel.nuclei_protocol = "1.4"`, `provenance.kernel.scipy: string | null`.

### 4.3 New sync message

| Request | Response |
|---|---|
| `trainability_surrogate_catalog {request_id?}` | `trainability_surrogate_catalog_result {request_id?, suite_version, surrogates: [{id, version, claim_class, title, summary, bound_kinds: string[], cost_label, requires: string[], available: bool, unavailable_reason: string|null, citation: {label, url}}], not_implemented: string[]}` |

The frontend calls this once per Lab session to render the surrogate list (including which are unavailable, e.g. a future optional backend) **before** the user runs anything. Kernel-age detection goes through the F-1 `lab_capabilities` sync message (master §4.3): the client calls it once per session and gates the catalog call on `analyses ∋ "surrogates"`; no reply within the timeout is treated as "kernel too old for the Quantumness Certificate (needs lab protocol ≥ 1.4) — update the kernel from Settings".

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

1. User opens a Python file with a parameterized Qiskit/Cirq circuit in Research mode (the `lab-project` e2e fixture has `ansatz/hardware_efficient.py` and `ansatz/tfim_hva.py`).
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
| result | full tab (§5.2.5) | verdict pill (tones: bp_detected → danger, simulable → neutral, brute_force_only → neutral with "at n = N" subtitle, resists → quantum, inconclusive → warning) |
| surrogate `brute_force` | row with a hatched grey pill "brute force (2^N)" and the copy `BRUTE_FORCE_NOTE`; never counted as a win | "Brute-force simulable at n = N" when no genuine win exists |
| class B/C result | separate "Trained-model surrogate (empirical, at θ*)" block under the table; never in the winners list | — |
| error (orchestrator) | `LabCallout tone=danger` with `code` and message; Retry | "Failed" |
| surrogate `not_applicable` | row with grey pill and the reason; for Fourier/RFF a "Declare data parameters" hint with the `nuclei_data_params = [...]` snippet (copy button) | — |
| surrogate `unavailable` | row with the dependency name + "Install from Settings → Research catalog" (future; v1 has none) | — |
| consistency failure | red row "Surrogates disagree: {a} vs {b}" + "This is a kernel bug; please report with the certificate" | "Inconclusive" |

### 5.4 Honesty copy (verbatim strings in `src/services/quantumness/copy.ts`)

- `RESISTS_CAVEAT`: "Resists all implemented surrogates means: these implementations, at these budgets, did not reach the accuracy target. It is not a proof of classical hardness and not a claim of quantum advantage."
- `SIMULABLE_NOTE`: "A classical method reproduced the cost within ε at each of the K = {K} sampled parameter points at n = {n}, with cost {cost} below the brute-force cost {brute}. Any quantum advantage for this cost would have to come from somewhere this suite did not measure."
- `BRUTE_FORCE_NOTE`: "Reproduced the cost only at brute-force cost (2^{n} amplitudes). This is not a structural reduction and says nothing about larger n."
- `NO_BP_CAVEAT`: "No barren plateau detected is evidence from gradient-variance scaling. Absence of barren plateaus does not guarantee trainability (local minima: Anschuetz & Kiani 2022)."
- `MODEL_SURROGATE_NOTE`: "The trained model's input→output map at θ* has a classical twin (empirical, held-out). This is about inference, not about the variational cost; it does not enter the verdict."
- `SCALING_ONLY_NOTE`: "Classical simulability is a scaling property. This report is for n = {n}; run the surrogate scaling mode for a statement about the family."
- `HEURISTIC_LABEL`: "empirical (held-out inputs) — not a rigorous bound".
- `MPS_TWO_NUMBERS`: "Rigorous bound (used for the verdict) vs convergence estimate (heuristic)."
- `SINGLE_SIZE_EVIDENCE`: "Trainability evidence is from this qubit count only. Run Scaling for a verdict about the family."
- `NOT_IMPLEMENTED_TITLE`: "Not in this suite (results say nothing about these):".

### 5.5 TS types, stores, components (binding names)

- Types: `src/types/trainability.ts` (`TrainabilityAnalysis += 'surrogates'`, `TrainabilityTabId += 'quantumness'`, `TrainabilityInspection.data_params?`, `TrainabilitySettings.surrogates?`, `TrainabilityResults.surrogates?`, `trainability_result.quantumness?`, provenance fields, catalog request/response) and `src/types/quantumness.ts` (`SurrogateId`, `SurrogateStatus` incl. `brute_force`, `SurrogateFamily`, `BoundKind`, `ClaimClass`, `SurrogatePointResult`, `SurrogateReport`, `SurrogateSuiteResult`, `QuantumnessVerdict`, `SurrogateCatalogEntry`) are written by **F-2 in Wave 1** from the shapes above; FE-Q edits no shared type file.
- `src/services/quantumness/client.ts`: `surrogateCatalog(session)` (request_id-correlated; gated on `lab_capabilities`).
- `src/services/quantumness/view.ts` (pure): `deriveQuantumnessView(results, quantumness)`, cost-bar math (brute-force bar drawn as the reference line), status tones; `copy.ts` (§5.4); `certificateSection.ts` registers the Quantumness section with `certificate.ts`'s section registry (F-3); `context.ts` registers the Dirac block with `contextProviders.ts`.
- `src/stores/quantumnessStore.ts`: `catalog: AsyncState<SurrogateCatalog>`, `loadCatalog()`; the `surrogates` settings slice and the `quantumness` tab are registered through `labAnalyses.ts` (F-3), so `trainabilityStore.ts` is not edited.
- `src/components/trainability/analyses/quantumness/{QuantumnessTab,SurrogateTable,SurrogateCostBars,VerdictCell,ModelSurrogateBlock,index}.tsx` — the `index.ts` registration provides the picker entry (off by default, hint), the tab, the VerdictRail card and the certificate section. All built on `src/components/lab/` primitives (`LabHeatmap`/`LabLineChart`/`IntervalBars` from `charts.tsx`, F-3); no hex colors; tabular-nums; chart accessible names.
- Palette commands: `src/components/trainability/features/quantumnessCommands.ts` registers the two commands with `featureCommands.ts` (F-3 registry; the palette↔registry parity test covers them automatically). The TRN003 code action "Check with the surrogate suite →" is `src/components/editor/codeActions/quantumnessActions.ts`, registered with the F-3 code-action registry.

---

## 6. Goldilocks evaluator (Idea 2)

### 6.1 Purpose and entry

- **Kind:** `goldilocks`, version `1.0.0`, task `quantum_circuit`, entry `build(n_qubits: int, n_layers: int)` returning a parameterized Qiskit/Cirq circuit (same entry as `trainability_frontier`, so the frontier template and seeds reuse).
- **Question:** "Find an ansatz family with no barren plateau detected **and** that resists the fully classical surrogate suite at sizes where brute force is not an option." The honest baseline must score poorly (the HEA seed is light-cone-simulable). **Every scored size must exceed `light_cone.max_width` and `MAX_STATEVECTOR_QUBITS` (20)**; a config that scores at n ≤ 20 is rejected at validation (`invalid_config: "goldilocks needs qubits > 20; below that every circuit is brute-force simulable"`). Resistance is "cost-growth evidence", never "the budget ran out".

### 6.2 Config (JSON Schema in `_goldilocks_config.py`; defaults)

```json
{"qubits": [24, 32, 48],               // 21..128, 2..6 values, every value > light_cone.max_width (20); screen runs at qubits[0] = 24
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

Stage `screen` runs 1–7 on `qubits[:1]` (= 24 by default, above the light-cone cap, so the light cone can genuinely fail) with the suite limited to `light_cone, stabilizer, gsim` (seconds); `full` runs everything at every n; `confirm` repeats `full` with a fresh seed **and doubled budgets** (`chi_max ×2`, `time ×2`, `max_frontier ×2`, `t_max + 4`). The gradient-variance (trainability) term uses the PPE at every scored n (the PPE path is required above 20 qubits, hence `require_ppe_class` defaults to true).

### 6.4 Scoring

- **Trainability term** = frontier's `fit_trainability` (bits lost per doubling, `−min(D, 6)`, secant rules, exactness penalty) — reused as-is.
- **Resistance** r ∈ [0, 1] is defined **on the largest scored n only** (never aggregated as a min over sizes, where brute force or the light-cone cap would pin it), from **circuit-derived** quantities, with budget censoring reported as a separate flag:
  - wins or `brute_force` → 0 (a surrogate that reproduced the cost, at any cost ≤ brute force, is not resisted);
  - `not_applicable` → excluded (**not** 1: a surrogate that does not apply says nothing);
  - light cone: h = min(1, (w_max − max_width) / (n − max_width)) — how far the exact cone width exceeds the cap toward the full register (0 at the cap, 1 at w_max = n);
  - Clifford-path / PPE: h = min(1, (log2 frontier_needed_lower − log2 max_frontier_screen) / (2n − log2 max_frontier_screen)) where `frontier_needed_lower` is the rigorous lower bound on the frontier needed to reach ε (from the ledger: the frontier at which D would have been ≤ ε, extrapolated from the measured D(frontier) curve's *observed* points only — never below the last measured frontier); when the run completed with D > ε at the cap, h = min(1, log10(D/ε) / 3) (how far the discarded mass sits above the target, saturating at 1000×);
  - MPS: h = min(1, log10(B_χmax / ε) / 3) — the rigorous error achieved at the cap divided by ε, in decades (0 when the bound is within ε, i.e. a win; 0.5 at 30×; 1 at ≥ 1000×). The settings-derived `log2(χ_max)/log2(χ_cap)` is **not** used;
  - 𝔤-sim: h = 1 when `fails` because d > cap at `complete`, 0.5 when the closure was truncated (unknown).
  - r = **min** over applicable class-A surrogates (the weakest link decides simulability). `metrics.resistance.censored: [ids]` lists every surrogate whose h came from a budget-limited run; when any applicable surrogate is censored, r is capped at **0.7** and the honesty text says "resistance partly reflects budgets". If fewer than 3 distinct algorithm families ran, r is capped at 0.5 and `metrics.resistance.note` says "too few surrogate families ran".
  - **Monotonicity check across n** (when ≥ 2 sizes are scored): r at each n is recorded; a candidate whose r *decreases* with n (a surrogate gets relatively cheaper at larger n) has `metrics.resistance.monotone: false` and is penalised by `w_f·3` in the fitness; when the multi-n suite ran, the fitted slope of `log χ_needed`, `log frontier_needed` and `w_max` against n (`surrogate_scaling`, §2.9) is reported as `resistance_growth` and shown in the drawer as the primary evidence ("resistance = cost-growth evidence").
- **Budget fragility** f = max(0, r_full − r_confirm) at the confirm stage (0 at other stages) — a candidate whose resistance evaporates with doubled budgets is penalized; the honesty text explains it.
- **Fitness** = `w_t · trainability_term + w_r · 6·r − w_f · 6·f − inexact_penalty`. (6 is the trainability cap, so both axes have the same range.) 
- **Objectives:** `beta` (minimize; CI, `fit_method`), `resistance` (maximize; r, weakest surrogate, per-surrogate h), `cheapest_surrogate_cost` (maximize; the reported cost of the weakest surrogate, censored flag).
- **Descriptors:** `weakest_surrogate` (categorical 0..6 in registry order, 7 bins), `light_cone_qubits` (0..64, 8 bins), `two_qubit_gates_per_layer` (0..64, 8 bins), `dla_fill_fraction` (0..1, 8 bins; frontier rule at the largest probe), `mps_chi_needed_log2` (0..10, 11 bins; censored → top bin, flagged).
- **Metrics:** the full suite result at every n, `resistance` breakdown, trainability fit, `gradient_map` (addendum §C, via `gradient_map.ppe_gradient_map`), `dla_probes`, structure signatures, and the mandatory honesty text:

> "Resistance is cost-growth evidence: how far the weakest implemented classical surrogate stayed above the accuracy target at the largest scored size, with budget-limited runs flagged. It is not classical hardness. It says nothing about quantum-enhanced classical simulation (shadow-based), which Cerezo et al. (2025) allow and this suite does not implement. A high score is a lead to investigate, not a counterexample."

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
| Exploit budgets (resistance only because time ran out) | censored runs flagged and r capped at 0.7; h from circuit-derived quantities only (rigorous error at the cap, frontier lower bound), never from the settings; confirm doubles budgets; fragility penalty |
| Exploit "too few surrogates ran" | r capped at 0.5 (counted by distinct families) |
| Score at sizes where brute force wins | config validation requires every scored n > 20; r is defined at the largest n only |
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

`kernel/discovery/seeds/goldilocks.py` + `src/services/discovery/templates.ts` entry `goldilocks`: the frontier HEA seed (RY/RZ + CZ brick, open chain) with `build(n_qubits, n_layers)` in the evolve block. Expected at defaults: at n = 24 with 4 brick layers and a local-Z observable the exact backward cone has width ≤ 9 < 20, so the light cone **wins** (a genuine sub-brute-force reduction) ⇒ r = 0, fitness ≈ trainability term alone (≈ −0.1): an honest "not a counterexample" baseline, and the first thing the mutator must escape.

---

## 7. Validation plan

### 7.1 Unit tests (kernel; files are owned per §9)

- `test_surrogates_mps.py`: (a) χ = 2^{⌊n/2⌋} exact ≡ statevector (`compile_circuit`) to 1e-10 on random circuits n ≤ 10 incl. long-range gates and 3q gates; (b) forced truncation (χ = 2, 4) — **the rigorous interval always contains the statevector value** (1000 seeded random circuits, property-style loop); (c) truncation ledger sums; (d) memory guard; (e) cancellation mid-sweep returns `budget_exhausted` with the partial sweep; (f) orderings produce identical results when exact; (g) GHZ needs χ = 2, product state χ = 1; (h) a 4-qubit brick circuit's `chi_needed` matches the Schmidt rank computed densely; (i) **mixed-canonical contract**: the 1000-seed property loop uses random gate orders with long-range (SWAP-routed) gates plus an adversarial case where the orthogonality centre starts far from the gate — the computed ε_k must equal the exact discarded Schmidt weight (dense SVD) to 1e-12, and a deliberately non-canonical state injected through a test seam makes the centre assertion fire; (j) `brute_force` status when χ_needed reaches 2^{⌊n/2⌋} (n = 6, χ_max = 128) and `wins` for the same circuit at n = 20 with χ_needed = 4.
- `test_surrogates_gsim.py`: (a) free-fermion chain ({Xᵢ}∪{ZᵢZᵢ₊₁}, n = 2..6) 𝔤-sim ≡ statevector to 1e-8 for 50 random θ; (b) so(8) HEA (n = 3) likewise; (c) O ∉ 𝔤 → `not_applicable` with residual reported; (d) `_expm` ≡ `scipy.linalg.expm` to 1e-12 when scipy is present (importorskip) and against the eigendecomposition path always; (e) cost model fields.
- `test_surrogates_fourier.py` / `test_surrogates_rff.py`: (a) spectrum enumeration vs the Schuld–Sweke–Meyer count for single-qubit re-uploading with L encodings (|Ω| = 2L+1) and the 2-D product case; (b) the trig-poly fit reproduces the model to 1e-8 on fresh inputs when |Ω| is enumerated fully (n ≤ 6); (c) RFF held-out error decreases with D and the reported `features_needed` is monotone in ε; (d) irrational coefficient → `not_applicable`; (e) no data params → `not_applicable` with the hint; (f) oracle-bound propagation: with a class-A oracle of bound B the reported accuracy is held-out max + B; (g) **a Fourier-only win never sets `simulable`** (suite with every class-A surrogate `fails` + Fourier `wins` ⇒ `simulability.kind != simulable`, `winners == []`, `model_surrogate.fourier.status == wins`).
- `test_trainability_lightcone.py`: moved tests (`strip` + `light_cone_width`) + Clifford pre-conjugation shrinks the cone for `H…H`-dressed global-Z; the exact Heisenberg-support cone is ≤ the structural over-estimate on 200 random circuits and strictly smaller on a Clifford-cancelling fixture; exact cone evaluation ≡ statevector 1e-10; the frontier evaluator still imports `light_cone_width` (re-export); status table: `w_max > max_width → fails`, `w_max ≥ n → brute_force`, else `wins`.
- `test_surrogates_suite.py` / `test_surrogates_{ppe,stabilizer,light_cone}.py`: registry order, ids and families (S1/S3 share `pauli_path`); stabilizer t_eff counts (Clifford circuit t = 0; one T adds 1; rotations at π/2 multiples excluded) and `brute_force` when no rotation is Clifford; PPE sweep stops at the first winning frontier and reports `brute_force` when all 4^n strings were enumerated; `target_trivial` for a constant cost; `epsilon_over_cost_std` reported; suite consistency check pass/fail (inject a lying surrogate via a test seam and assert `suite_inconsistent`); budget rollover; cancel; determinism (bit-identical JSON over two runs); every status reachable; `not_implemented` list present.
- `test_surrogates_quantumness.py`: every cell of the §2.9 table reached by synthetic inputs; `single_size` decides on interval endpoints normalised by ‖O‖₁² (lo/hi cases + unknown) and carries the n-only caveat; `NO_BP_CAVEAT` present with every T rendering; `resists` requires n > 20, ≥ 3 distinct families (light_cone + ppe + stabilizer is **two** families and yields `inconclusive`), no class-A budget exhaustion, non-trivial target; `brute_force` reports never produce `simulable`; `brute_force_simulable` at n ≤ 20; class B/C/N excluded from `winners`; claim text snapshots (resists + brute-force); `surrogate_scaling` fit reuses `scaling.fit_*` and is `inconclusive` below 4 sizes; no string in the kernel output contains the substring "trainable" as a verdict token (regression grep).
- `test_trainability_settings.py` (extend, via the F-1 section registry): clamping of every surrogates field incl. `scaling_qubits` and `single_size_thresholds`, unknown id → `surrogate_unknown`.
- `test_trainability_handlers.py` (extend): the catalog message with/without `request_id`; `test_trainability_jobs_integration.py` (extend): a job with `["gradients","lie","surrogates"]` streams `surrogates` progress/partial and a `quantumness` field; cancel mid-suite yields `cancelled` with partial reports.
- `test_trainability_provenance.py` (extend): `1.4`, `suite_version`, `suite_fingerprint` stable across runs and changing when a suite file changes (tmp copy test).
- Discovery: `test_discovery_goldilocks.py` (config schema incl. the `qubits > 20` rule, stages, each guardrail with a cheating candidate rejected *by that guardrail*, scoring formulas on synthetic suite reports incl. the "too few families" cap, the censored cap at 0.7, r defined at the largest n only, the circuit-derived h formulas (a budget change with identical reports must not change h except through the censored flag), the monotonicity penalty, descriptors, seed scores as stated in §6.8 within tolerance), `test_discovery_goldilocks_audit.py` (suite_attack flips a fake "resists" record whose MPS win appears at 4× budget; orderings; resistance_recheck thresholds; exploit fixture replay), `test_discovery_conjecture_*` extensions for the new features and predictions, `test_discovery_evaluators.py` registry listing, `test_discovery_optional_deps.py` (goldilocks imports without any optional package).

### 7.2 Physics validation (explicit tolerances; `_trainability_physics_helpers.py` extended)

| Check | n | Tolerance |
|---|---|---|
| Every surrogate's estimate vs statevector at K = 8 points on 200 seeded random circuits (mixed gate set) | 2–10 | within its own stated bound; exact kinds 1e-8·‖O‖₁ |
| MPS rigorous bound contains the truth under forced truncation | 4–12 | always (0 violations) |
| MPS heuristic estimate vs truth | 4–12 | reported only; a table in the docs showing how often the heuristic under-estimates (expected: sometimes) |
| 𝔤-sim vs statevector on so(2n), free-fermion and QAOA-ring (shared params) circuits | 2–8 | 1e-8 |
| Light cone exact vs statevector for brick depth 1–3 with local Z | 6–16 | 1e-10 |
| Fourier fit vs model on fresh x | 1–6 | 1e-8 (full spectrum) |
| Suite on the HEA seed: light cone `wins` at n = 8 (exact cone width 5 < 8), MPS `wins` with χ_needed ≤ 16 at depth 2 | 8 | as stated; `simulability.kind == simulable` with `cheapest_winner == light_cone` |
| Suite on a depth-20 all-to-all RZZ/RX circuit at n = 10: light cone `brute_force` (w = 10 = n), MPS `fails` with χ_needed censored at 64 (or `brute_force` if χ reaches 32), PPE `fails` censored, stabilizer `brute_force` | 10 | statuses as stated; `simulability.kind == brute_force_simulable`; statevector still decides consistency |
| Same circuit at n = 24 (PPE class, no statevector): light cone `fails` (w = 24 > 20), MPS censored, PPE censored ⇒ `inconclusive` (budget), not `resists` | 24 | `resists_implemented` requires every class-A report to be `fails`/`not_applicable` without censoring |
| Constant-cost circuit (observable commuting with every gate): `target_trivial` ⇒ `inconclusive` | 6 | as stated |

### 7.3 Frontend tests

- Vitest: `quantumness.test.ts` (view derivation for every verdict/status), `quantumnessCopy` snapshot, `certificate.test.ts` snapshot with quantumness, `client.test.ts` catalog + "kernel too old" mapping, store tests (catalog lifecycle, tab, settings), jsdom render tests for `QuantumnessTab` in every §5.3 state (seeded fixtures in `fixtures.ts`: `surrogateSuiteFixture`, `quantumnessFixture`, `surrogateCatalogFixture`), `VerdictRail` with the new card, `TargetBar` checkbox + hint; discovery: evaluator chip/template/drawer section render, `redQueenPrompt` snapshot with the Goldilocks paragraph, archive with the categorical descriptor.
- **Playwright** `tests/e2e/quantumness.spec.ts` (stub kernel pattern of `trainability.spec.ts`, fixture project `lab-project`): (1) catalog renders with 7 surrogates and the not-implemented list; (2) tick Quantumness → Run → progress rows → result: verdict pill text `Trainable · resists implemented surrogates`, the claim block, 7 rows with the expected statuses, consistency "pass"; (3) `not_applicable` Fourier row shows the data-params hint with the snippet; (4) cancel mid-run → "Cancelled after 3 of 7" + inconclusive; (5) old-kernel stub (error on catalog) → the banner, Run still works for other analyses; (6) Export certificate → the fixture bridge receives `.trainability.json` containing `quantumness` and `.md` containing the claim; (7) palette command "Run quantumness certificate" from the editor lands on the running Lab. `tests/e2e/discovery.spec.ts` gains: wizard shows the Goldilocks template; a stubbed evaluation with `goldilocks` metrics renders the drawer's suite section and the Red Queen exploit lane. Screenshots at 1440/1024 light/dark for the Quantumness tab.
- Manual real-kernel run (release gate): the HEA seed and the depth-20 circuit, screenshots attached to the PR.

### 7.4 CI

- `kernel-tests.yml`: the `pytest-minimal-venv` job already globs `test_trainability_*.py`; add `kernel/tests/test_discovery_goldilocks*.py` and assert in `test_discovery_optional_deps.py` that `kernel.surrogates` imports with scipy **absent** (monkeypatched `sys.modules["scipy"] = None`) and the `_expm` fallback is used (test marks which path ran).
- A `physics` marker for the §7.2 loops (≤ 90 s total) runs in the main job; the 1000-circuit MPS property loop is capped at 20 s via a seeded subset in CI and the full loop runs under `NUCLEI_SLOW_TESTS=1`.
- Playwright job: `quantumness.spec.ts` added to the lab project list.

---

## 8. Acceptance criteria

- [ ] `trainability_start` with `analyses: ["surrogates"]` on the `lab-project/ansatz/hardware_efficient.py` fixture returns a `surrogates` partial with 7 reports and a non-null `quantumness` in ≤ 60 s on the dev container; every report has a status from the enum (incl. `brute_force`) and a reason when not `wins`/`fails`/`brute_force`; the verdict at n ≤ 20 is `simulable` or `brute_force_simulable`, never `resists`.
- [ ] No new required dependency: `kernel/requirements.txt` unchanged; every new module imports without scipy/stim; scipy is used opportunistically and reported in provenance.
- [ ] Every surrogate's win is checked against statevector (n ≤ 20) or against another winner; a seeded injected disagreement yields `suite_inconsistent` and `inconclusive`.
- [ ] The MPS rigorous bound has zero violations over the §7.2 property loop; the heuristic is labelled heuristic everywhere it appears (kernel JSON, UI, certificate).
- [ ] 𝔤-sim computes expectations (not only dimensions) and matches statevector to 1e-8 on the listed algebras; `not_applicable` when neither O nor ρ₀ lies in 𝔤, with the residual.
- [ ] Fourier/RFF are `not_applicable` without declared data params, with an actionable hint; with `nuclei_data_params` they run and are labelled empirical.
- [ ] The `resists` verdict is only emitted for n > 20 when ≥ 3 distinct class-A families ran to `fails`/`brute_force` with no budget exhaustion and a non-trivial target; class B/C/N results never set `simulable`; `brute_force` never counts as a win; the claim texts match §2.9 verbatim (snapshots).
- [ ] Trainability evidence level is always shown as "no barren plateau detected / barren plateau / unknown" (never "trainable"), with `NO_BP_CAVEAT`; single-size evidence decides on interval endpoints and carries the n-only caveat.
- [ ] Certificate JSON/MD include `quantumness`, the suite table, `suite_version` and `suite_fingerprint`; bit-for-bit reproducibility test passes for `surrogates`.
- [ ] Catalog message works; an old kernel yields the "kernel too old" banner, not a blank tab.
- [ ] Every §5.3 state has a jsdom test and the Playwright path (§7.3) passes against the stub kernel; palette commands exist and work.
- [ ] `goldilocks` is listed by `discovery_evaluators`, has a template, rejects configs with any scored n ≤ 20, every guardrail has a cheating-candidate test, the seed scores as §6.8 states, r is circuit-derived at the largest n with censoring flagged, and the Red Queen audit's `suite_attack` flips a seeded fake-resistant record.
- [ ] Conjecture features/predictions validate and a conjecture with `resistance >= 0.5` runs the suite on held-out circuits.
- [ ] Docs: `trainability-lab.mdx` (Quantumness section), `discovery-engine.mdx` (Goldilocks), `messages-lab.mdx` (v1.4), protocol changelog, CLAUDE.md "Kernel Protocol v1.4".
- [ ] Minimal-venv CI job green with the new tests.

---

## 9. Implementation breakdown — units of work and file ownership

**The master plan's §7 tables are the only ownership record.** This section maps the spec's logical units onto master units and names exactly the master's files; nothing here may name a file the master assigns to another unit (`scripts/check-wave-ownership.py` fails the plan otherwise). There are no "shared edits", no "marked blocks" and no lines "handed to the lead": every extension goes through a Wave 1 registry.

| Spec unit | Master unit (wave) | Scope | Files (verbatim from master §7) |
|---|---|---|---|
| U1 Surrogate base + cheap surrogates, U5 suite + verdict + protocol | **Q1** (Wave 2a) | `base.py`, `registry.py`, `oracle.py`, `suite.py`, `quantumness.py`, `quick.py`, S1 `ppe`, S3 `stabilizer`, S5 `light_cone`, the `lightcone.py` move (`strip` + `light_cone_width`), `analyses_surrogates.py` (settings section, analysis + result hook + catalog sync handler registration), suite fingerprint, docs fixtures | `kernel/surrogates/{__init__,base,registry,oracle,suite,quantumness,quick}.py`, `kernel/surrogates/methods/{__init__,ppe,stabilizer,light_cone}.py`, `kernel/trainability/{lightcone,analyses_surrogates}.py`, `kernel/discovery/evaluators/_frontier_structure.py` (re-export lines), `kernel/tests/test_surrogates_{base,suite,quantumness,quick,ppe,stabilizer,light_cone}.py`, `kernel/tests/test_trainability_lightcone.py`, `kernel/tests/research_corpus/q1/**`, `docs-site/fixtures/lab_trainability_surrogate_catalog.*`, `docs-site/fixtures/lab/trainability_surrogates.stream.json` |
| U2 MPS, U3 𝔤-sim | **Q2** (Wave 2a) | `mps.py` (mixed-canonical contract), `gsim.py`, `_expm.py`, S4 and S2 drivers | `kernel/surrogates/{mps,gsim,_expm}.py`, `kernel/surrogates/methods/{mps,gsim}.py`, `kernel/tests/test_surrogates_{mps,gsim,expm}.py` |
| U4 Fourier + RFF (+ spec 03's pure fitters) | **Q3** (Wave 2a) | `spectrum.py`, `fourier.py`, `rff.py`, `shadow.py`, S6/S7, `inspect.data_params` via `declarations.py` | `kernel/surrogates/{spectrum,fourier,rff,shadow}.py`, `kernel/surrogates/methods/{fourier,rff}.py`, `kernel/trainability/inspect.py`, `kernel/tests/test_surrogates_{spectrum,fourier,rff,shadow}.py`, `kernel/tests/test_trainability_inspect.py` |
| U7 Goldilocks evaluator, U8 audit + conjecture hook | **G1** (Wave 3b) | evaluator, config, resistance, fitness, seed, audit, `_frontier_shared.py`, conjecture features, exploit fixtures | `kernel/discovery/evaluators/{goldilocks,_goldilocks_config,_goldilocks_resistance,_goldilocks_fitness}.py`, `kernel/discovery/evaluators/{__init__,availability}.py` (entries), `kernel/discovery/seeds/{goldilocks,__init__}.py`, `kernel/discovery/audits/{goldilocks,_frontier_shared,trainability_frontier}.py`, `kernel/discovery/conjecture/{predicate,spec,tester,semantics}.py`, `kernel/tests/test_discovery_goldilocks*.py`, `test_discovery_seeds.py`, `test_discovery_evaluators.py`, `test_discovery_conjecture_*.py`, `test_discovery_exploits.py`, `kernel/tests/fixtures/exploits/goldilocks-*.json` |
| U6 Lab frontend, U9 Discovery frontend | **FE-Q** (Wave 4a) | Quantumness tab/table/bars/cell/model-surrogate block + registration, client, view, copy, certificate section, Dirac context, palette commands, TRN003 code action, Goldilocks evaluator definition + drawer, e2e | `src/components/trainability/analyses/quantumness/**`, `src/services/quantumness/{client,view,copy,context,certificateSection}.ts` (+ tests), `src/stores/quantumnessStore.ts`, `src/services/discovery/evaluatorDefinitions/goldilocks.ts`, `src/services/discovery/{templates,honesty,redQueenPrompt}.ts` (goldilocks blocks), `src/components/discovery/goldilocks/**`, `src/components/trainability/features/quantumnessCommands.ts`, `src/components/editor/codeActions/quantumnessActions.ts`, `tests/e2e/quantumness.spec.ts`, `tests/e2e/real/quantumness.real.spec.ts`, `tests/e2e/real/goldilocks.real.spec.ts`, `tests/e2e/fixtures/lab-project/models/data_model.py` |
| U10 Lead: docs, CI, wiring | **F-1 / F-2 / F-3** (Wave 1: registries, types) and **X** (Wave 5b: docs, CI) | — | per master §7 |

Dependencies inside the wave: Q2 and Q3 build against `base.py`'s frozen interface (§3.2) and may start immediately; Q1 integrates with stub surrogates behind the registry and swaps. G1 needs `run_surrogate_suite` (Wave 2a). FE-Q builds against `src/services/quantumness/fixtures.ts` (F-2) first.

Anyone needing a change in a file they do not own reports the exact diff to the owner and does not edit it.

---

## 10. Cross-spec interfaces (what this spec provides / needs)

**Provides**
- `kernel.surrogates.suite.run_surrogate_suite(circuit, observable, *, settings, seed, init, backend, progress, cancel) -> dict` (§3.3) and `kernel.surrogates.base.SurrogateReport` — for **Spec 02** (noisy trainability may want the suite on noiseless proxies; noise-aware surrogates are *not* in this suite — Spec 02 owns them and may register additional `Surrogate` implementations via `SUITE_EXTENSIONS` in `kernel/surrogates/registry.py`, a tuple appended after the core suite, with claim class `"N"`; `quantumness.py` lists class-N reports but excludes them from the noiseless `simulability` axis and surfaces them as `quantumness.noise`).
- `kernel.surrogates.quick.certificate_cheap(circuit, observable, *, time_budget_s, seed, cancel) -> dict` and `is_available() -> bool` — the cheap structural certificate (light cone, stabilizer count, 𝔤-sim dimension, small-frontier PPE) consumed by spec 03 (`simulability_warning`) and spec 04 (the verifier's `certificate` check). Returns the §3.6 shape with `evidence: "cheap"`.
- `kernel.surrogates.gsim.GSim` (basis, structure constants, `evaluate(values)`), `kernel.surrogates.mps.MpsState`, and the pure fitters `kernel.surrogates.{spectrum,fourier,rff,shadow}` — for **Spec 03** (symmetry compiler / classical deploy): a winning surrogate can be *exported* as a classical program. This spec adds to every report `exportable: {"kind": "fourier", "ref": "<job_id>/<surrogate_id>"} | null` — **`EXPORTABLE_KINDS = {"fourier"}` in v1**: only the Fourier route has validated accuracy semantics in spec 03 (exact-spectrum DFT or labelled least squares). 𝔤-sim, MPS and light-cone wins carry `exportable: null` with the note "export route not defined in v1 (needs a self-checking numpy program with a per-call rigorous bound)"; widening `EXPORTABLE_KINDS` requires spec 03 to define such a route first. Spec 03 defines the export format and the deploy path and must not re-implement the simulators or the fitters (its `kernel/deploy/spectrum.py` and `kernel/deploy/surrogates/` are thin re-exports).
- `quantumness` verdict dict (§3.6) in `trainability_result` and in the certificate — for **Spec 04** (verified suggestions), which may cite `verdict`, `cheapest_winner` and the claim text, and must not restate the claim in stronger words.
- `kernel.trainability.lightcone.light_cone_width` (moved; `_frontier_structure` re-exports).

**Needs**
- From Spec 02: `NoiseModel.from_json` so the suite can populate `SurrogateContext.noise_model` from `settings.noise.model` for `SUITE_EXTENSIONS` (the suite imports it lazily; absent → `noise_model = None` and `noisy_ppe` reports `not_applicable`). If Spec 02 introduces a noisy IR, the suite's applicability functions must be given a `noise: None` guarantee (the suite refuses noisy circuits with `not_applicable: "noisy circuit"` — a one-line check against the IR `notes`/a future `noise` field; the interface is `ParamCircuit` as today).
- From Spec 03: none; the `exportable` field is additive and may be null.
- From Spec 04: none.

---

## 11. Risks and open questions

**Risks**
1. **MPS rigorous bound is loose** on circuits where the heuristic converges early; the verdict will say "fails" while the heuristic says "converged". This is by design (honesty) but users may find it conservative. Mitigation: both numbers shown; a one-liner explains why the heuristic cannot win. The tighter fidelity-product bound ∏(1 − εₖ)^{1/2} may be adopted **only with a written proof in the spec and the same 0-violation property test**; Q2 ships the triangle bound in v1.
2. **𝔤-sim at d ≈ 2048** costs d³ ≈ 8.6e9 flops for the eigendecomposition per distinct generator; with many distinct generators it may exhaust its budget on circuits that *are* 𝔤-sim simulable. Mitigation: budget-aware (reports `budget_exhausted`, never `fails`); the Krylov/`expm_multiply` path when scipy is present (v1.1).
3. **Fourier/RFF require an oracle**; at n > 20 without a winning class-A surrogate they are `not_applicable`, which users may read as "resists". The UI sentence for that case is explicit ("needs a trusted oracle; this says nothing about simulability").
4. **Suite time.** Default 60 s may be too long for the habitual "run everything" click. Mitigation: `surrogates` off by default; the checkbox shows the budget; progress per surrogate; cancel keeps partial results.
5. **Goldilocks reward hacking** beyond §6.5: the resistance formula's clip fractions are a judgment call; the Red Queen audit and the exploit-fixture loop are the standing defence. Red-team before release (adversarial review gate in U10).
6. **Ownership friction:** `_settings.py`, `job_worker.py`, `handlers.py` are U5-owned but U1–U4 need nothing in them before U5 — confirmed by the registry design.

**Open questions (decide before U5 ships)**
1. Should `resists_implemented` require the **statevector** cross-check at n ≤ 20 to have run (it always does when n ≤ 20) and, above 20, require ≥ 2 winners agreeing for `simulable`? Current rule: one winner suffices for `simulable`; consistency is a bug detector, not a quorum.
2. Default ε: 0.01·max(1, ‖O‖₁) vs a per-term normalization (as the frontier evaluator rescales max |cⱼ| = 1). **Decided (master plan):** the Lab keeps the user's observable; Goldilocks rescales; both are shown in the UI's ε line.
3. Training dequantization on a **user dataset** (`nuclei_dataset` hook) — v1.1; the model-as-target RFF experiment ships in v1.
4. Should the Goldilocks `confirm` stage's min-over-orderings MPS also apply at `full` (cost ×3)? Current: `confirm` and audit only.
5. Conjecture Engine: should `resistance` conjectures use `full` budgets (slow) or `screen` (fast, weaker)? Current: screen budgets with the caveat in the ledger.
6. ~~Citations to verify~~ Resolved: Cerezo et al., Nat. Commun. 16, 7907 (2025); Larocca et al., Nat. Rev. Phys. 7, 174–189 (2025).

---

## 12. References (verified unless marked)

- Cerezo, Larocca, García-Martín, Diaz, Braccia, Fontana, Rudolph, Bermejo, Ijaz, Thanasilp, Anschuetz, Holmes, "Does provable absence of barren plateaus imply classical simulability? Or, why we need to rethink variational quantum computing", Nat. Commun. 16, 7907 (2025), doi:10.1038/s41467-025-63099-6; arXiv:2312.09121.
- Anschuetz, Kiani, "Quantum variational algorithms are swamped with traps", Nat. Commun. 13, 7760 (2022); arXiv:2205.05786.
- Schreiber, Eisert, Meyer, "Classical surrogates for quantum learning models", Phys. Rev. Lett. 131, 100803 (2023); arXiv:2206.11740.
- Landman, Thabet, Dalyac, Mhiri, Kashefi, "Classically approximating variational quantum machine learning with random Fourier features", ICLR 2023; arXiv:2210.13200.
- Sweke, Recio-Armengol, Jerbi, Gil-Fuster, Fuller, Eisert, Meyer, "Potential and limitations of random Fourier features for dequantizing quantum machine learning", Quantum 9, 1640 (2025); arXiv:2309.11647.
- Schuld, Sweke, Meyer, "Effect of data encoding on the expressive power of variational quantum-machine-learning models", Phys. Rev. A 103, 032430 (2021).
- Nemkov, Kiktenko, Fedorov, "Fourier expansion in variational quantum algorithms", Phys. Rev. A 108, 032406 (2023); arXiv:2304.03787.
- Angrisani, Schmidhuber, Rudolph, Cerezo, Holmes, Huang, "Classically estimating observables of noiseless quantum circuits", Phys. Rev. Lett. 135, 170602 (2025); arXiv:2409.01706 (guarantee scoped to random circuits whose layer distributions are invariant under single-qubit rotations).
- Rudolph, Fontana, Holmes, Cincio, "Classical surrogate simulation of quantum systems with LOWESA", arXiv:2308.09109.
- Goh, Larocca, Cincio, Cerezo, Sauvage, "Lie-algebraic classical simulations for variational quantum computing", arXiv:2308.01432.
- Ragone, Bakalov, Sauvage, Kemper, Ortiz Marrero, Larocca, Cerezo, "A Lie algebraic theory of barren plateaus for deep parameterized quantum circuits", Nat. Commun. 15, 7172 (2024).
- Bravyi, Gosset, "Improved classical simulation of quantum circuits dominated by Clifford gates", Phys. Rev. Lett. 116, 250501 (2016) — cited only as a NOT_IMPLEMENTED method.
- Bravyi, Browne, Calpin, Campbell, Gosset, Howard, "Simulation of quantum circuits by low-rank stabilizer decompositions", Quantum 3, 181 (2019) — NOT_IMPLEMENTED.
- Vidal, "Efficient classical simulation of slightly entangled quantum computations", Phys. Rev. Lett. 91, 147902 (2003).
- Schollwöck, "The density-matrix renormalization group in the age of matrix product states", Ann. Phys. 326, 96 (2011).
- Zhou, Stoudenmire, Waintal, "What limits the simulation of quantum computers?", Phys. Rev. X 10, 041038 (2020).
- Bravyi, Gosset, Movassagh, "Classical algorithms for quantum mean values", Nat. Phys. 17, 337 (2021), doi:10.1038/s41567-020-01109-8 — NOT_IMPLEMENTED (the suite implements plain light-cone restriction).
- Larocca et al., "Barren plateaus in variational quantum computing", Nat. Rev. Phys. 7, 174–189 (2025); arXiv:2405.00781.
