# PRD 15 · Spec 02 — Device-noise-aware trainability and the quantum-kernel "power of data" check

**Status:** Spec v2 (2026-10-19, revised after the physics and engineering review — see master §10) · binding technical contract for the parallel build · branch `feat/prd15-quantumness-lab` (based on v0.14.1)
**Workspace:** Research mode only (Learn mode is being deprecated and is not touched by this spec)
**Protocol:** Kernel lab messages **v1.4** (additive-only on v1.3; `provenance.PROTOCOL_VERSION = "1.4"` is set once by the master plan's foundations unit F-1)
**Depends on:** PRD 14 (`docs/research/PRD_14_QUANTUM_AI_LAB.md`, `PRD_14_ADDENDUM.md`): the IR (`kernel/trainability/ir.py`), the lowering walk (`_circuit_walk.py`), the Pauli Propagation Engine (`ppe_core.py`, `pauliprop.py`, `_ppe_compile.py`), the compiled statevector backend (`compiler.py`, `statevector.py`), scaling verdicts (`scaling.py`), lint (`lint.py`), provenance, jobs (`jobs.py`, `job_worker.py`, `kernel/lab_proc.py`), the hardware providers (`kernel/hardware/*`), and the Lab design system (`src/components/lab/`).
**Companion specs:** `01_QUANTUMNESS_CERTIFICATE` (surrogate suite, `SUITE_EXTENSIONS`, joint verdict), `03_SYMMETRY_COMPILER_AND_CLASSICAL_DEPLOY` (`nuclei_model` / `nuclei_dataset` declarations, `kernel/deploy/dataset.py`, `kernel/lab_routes.py`), `04_LEARNED_DECODERS_AND_VERIFIED_SUGGESTIONS` (`trainability_verify` consumes `gradient_variances_noisy`). Interfaces are named in §10, never redesigned here.

This document is both the product requirement and the implementation contract. Wire shapes, file layouts, signatures and ownership are fixed. If a contract here is wrong, raise it; do not silently diverge.

> **Master-plan resolution (2026-10-19).** This spec is governed by `docs/research/PRD_15_QUANTUMNESS_LAB.md` §4.3 and §7: `kernel/noise/` is the ONE noise-model layer shared by ideas 1, 3, 7 and 8, the `noisy_ppe` surrogate registers in `kernel/surrogates/registry.py: SUITE_EXTENSIONS`, the dataset loader is `kernel/trainability/dataset.py` and the declaration reader `kernel/trainability/declarations.py` (both F-1), `PROTOCOL_VERSION = "1.4"` and the lab message router (`kernel/lab_routes.py`) are owned by the Wave 1 foundations unit F-1, settings/analysis/handler/palette/Dirac/e2e-fixture extensions go through registries instead of shared-file edits, and the units below map onto the master waves as stated in §9. Learn mode is deprecated; nothing here touches it.

---

## 0. One-paragraph summary

**Idea 3 — Noise-aware trainability.** The PPE learns Pauli noise. A `NoiseModel` (per-gate / per-qubit Pauli channels, idle T1/T2 as Pauli-twirled amplitude damping + dephasing, per-qubit readout error) is applied in the Heisenberg picture as a per-string damping factor, so every existing PPE quantity — gradient variances, cost variance, expectation bounds, the scaling verdict — is computed **under noise with the same rigorous truncation intervals**. Noise models come from built-in presets, from `noise/*.noise.yaml` (schema 2, a superset of the QEC noise library), or from a **device calibration snapshot** fetched through `kernel/hardware/*` (live) or bundled (offline). The certificate gains "no barren plateau detected under a Pauli-twirled model built from the `{provider}/{backend}` calibration fetched `{fetched_at}`" — a statement about the **model**, never "trainable on `<device>`" (the substring `trainable on` next to a device name is forbidden by a snapshot test). The Pauli-twirl approximation is stated, bounded a priori (separately for expectations and for gradient variances), optionally replaced by exact non-unital propagation, and validated against an exact density-matrix simulator at n ≤ 10. Because noise damps high-weight strings, the noisy PPE can reach a given accuracy with a smaller frontier; the Lab shows that cost comparison **at equal accuracy** (frontier needed for D ≤ ε, noisy vs noiseless, both D values shown), and a `noisy_ppe` surrogate registered through spec 01's `SUITE_EXTENSIONS` turns it into a separate, clearly-labelled "the noisy cost is classically simulable" line.

**Idea 4 — Quantum-kernel power of data.** A Lab analysis `qkernel` and lint rules `QK001–QK006` for a feature-map circuit plus a dataset (project CSV/NPY, path-validated; or built-in demo data): the fidelity Gram matrix (statevector, n ≤ 20) and the projected quantum kernel (statevector, or PPE with rigorous intervals up to 128 qubits), a finite-shot model, exponential-concentration diagnostics, the geometric difference g(K_C‖K_Q) and model complexities s_K(N) of Huang et al., bandwidth tuning, spectrum/effective dimension/target alignment, and classical baselines fitted in numpy. The verdict's scope is stated exactly: *relative to these classical kernels, on this dataset of N points, with these finite-sample caveats*.

**The honest frame, repeated in the UI:** a noisy verdict is a statement about a *model* of the device (Pauli-twirled, calibration-dated); a kernel verdict is a statement about *the classical kernels we compared*, never about all classical methods.

---

## 1. Motivation and novelty

### 1.1 Why

PRD 14's Lab answers "is this ansatz trainable?" for a perfect device. Two facts from the literature make that answer incomplete for anyone who will run on hardware or do QML:

1. **Noise flattens landscapes on its own** — noise-induced barren plateaus (Wang et al., Nat. Commun. 12, 6961 (2021)): under local Pauli noise the gradient decays exponentially in the noisy depth, independently of the parameter initialisation. Stilck França & García-Patrón (Nat. Phys. 17, 1221 (2021)) bound noisy optimisation against classical Gibbs sampling. Conversely, Mele et al. (arXiv:2403.13927; Nat. Phys. (2026), doi:10.1038/s41567-026-03245-z) show non-unital noise makes circuits effectively shallow and *removes* barren plateaus for local observables — while also making them classically simulable: Fontana et al. (LOWESA, arXiv:2306.05400, npj QI (2025)) and Schuster, Yin, Gao & Yao (arXiv:2407.12768; Phys. Rev. X 15, 041018 (2025)) give polynomial-time classical algorithms for noisy expectation values. **Noise therefore moves a circuit along both axes of spec 01's verdict map at once**, and a tool that reports trainability without noise reports the wrong cell.
2. **Quantum kernels can be beaten by classical ones on the same data** — Huang et al. (Nat. Commun. 12, 2631 (2021)) give the geometric-difference / model-complexity test that says, *for a given dataset*, whether a quantum kernel can even possibly outperform a classical one; Thanasilp, Wang, Cerezo & Holmes (Nat. Commun. 15, 5200 (2024), doi:10.1038/s41467-024-49287-w) show kernel values concentrate exponentially (expressivity, global measurements, entanglement, noise) so finitely many shots see no data; Shaydulin & Wild (arXiv:2111.05451; Phys. Rev. A 106, 042407 (2022)) and Canatar et al. (TMLR 2023, arXiv:2206.06686) show bandwidth decides whether a kernel generalises at all; Kübler, Buchholz & Schölkopf (NeurIPS 2021) tie all of it to the RKHS spectrum.

No shipping IDE runs any of these tests on *the user's own* circuit, data and device calibration, with intervals.

### 1.2 What is genuinely new

| Capability | Prior art | New in Nuclei |
|---|---|---|
| Noisy gradient variances | NIBP bounds (Wang et al.) are analytic upper bounds; numerics use density matrices at n ≲ 12 | **Exact second-moment Pauli propagation under Pauli noise** (the PRD 14 doubled chain with per-string damping), to 128 qubits, with the same rigorous truncation ledger; `Var[∂C]` and `Var[C]` as intervals, noiseless vs noisy side by side |
| Noisy classical simulation | LOWESA / Schuster et al. are expectation-value algorithms with average-case error bounds | The PPE's **a posteriori** ledger (exactly what was discarded) is the only rigorous number; a LOWESA/Schuster-style **weight-cut estimate** is shown next to it, explicitly labelled `heuristic (average-case)`; the noisy run is registered as a labelled surrogate so spec 01's certificate says "the *noisy* cost is simulable" without conflating it with the noiseless verdict |
| Non-unital noise | Usually Pauli-twirled silently | Twirl is the default **and stated**; `nonunital: "exact"` propagates the identity branch of amplitude damping exactly; the twirl gap has rigorous a priori bounds — one for expectations, a separate one for gradient variances — each shown next to the quantity it bounds, and both measured against a density-matrix oracle at n ≤ 10 |
| Device calibration | Hand-copied T1/T2 into a simulator noise model | `hardware_calibration` through the existing providers, a bundled offline snapshot, the user-editable `*.noise.yaml`, an explicit circuit→device layout, the gate-error → Pauli-probability conversion table shown in the UI and the certificate, and a certificate line dated by the calibration timestamp |
| Noise-aware scaling verdict | — | PRD 14's AIC exponential-vs-polynomial fit on *noisy* variances at every (n, L), plus a noise-strength sweep |
| Power-of-data check | `quask` (Di Marcantonio et al.) implements g and projected kernels as a library; no IDE integration, no intervals | In-Lab on the user's feature map; projected kernel via PPE **with rigorous entry intervals** above 20 qubits; concentration diagnostic against the shot-noise floor; g at several regularisations (it is λ-sensitive, and we say so); classical baselines with bandwidth search fitted in numpy; a verdict whose scope is the compared kernels |
| Kernel lint | — | `QK001–QK006`: structural rules in the 0.35 s lint budget, in the editor, before any job runs |

What is **not** claimed: that a Pauli-twirled model is the device; that anything is "trainable on" a device (the certificate says "no barren plateau detected under a model built from a dated calibration"); that absence of a barren plateau is trainability (Anschuetz & Kiani 2022); that the model survives non-Pauli correlated errors or drift; that "cannot beat these classical kernels" means "no classical method wins" or vice versa. §2.9 and §3.8 state the claims exactly.

---

## 2. Idea 3 — Math and physics

### 2.1 Setting

- `ParamCircuit` (PRD 14 §5.1), n qubits, parameters θ ∈ ℝᵐ, |0ⁿ⟩, observable O = Σⱼ cⱼ Qⱼ (`PauliSum`), ‖O‖₁ = Σ|cⱼ|.
- The PPE's class (unchanged): single-Pauli rotations with integer frequencies, Clifford fixed gates, independent parameters for variances (`pauliprop.build_rotation_program`). Noise does **not** change the class: a noise channel is θ-independent.
- A **noisy program** is the rotation program interleaved with Pauli channels: `[ … , rotation_j, channel(j), …]`. The Heisenberg sweep goes last-to-first; a channel is applied to the frontier *before* the gate it follows in time (i.e. in the same order the Heisenberg walk meets them).

### 2.2 Pauli channels in the Heisenberg picture

A Pauli channel on a set of qubits S with distribution {p_E} over Pauli strings E on S acts as Λ(ρ) = Σ_E p_E E ρ E. Its adjoint is diagonal in the Pauli basis:

  Λ†(P) = λ_P · P,   λ_P = Σ_E p_E (−1)^{[P,E]} = 1 − 2 Σ_{E : {P,E}=0} p_E ∈ [−1, 1],

where [P,E] = 1 iff P and E anticommute (restricted to S). Hence **a Pauli channel never changes a Pauli string, only its weight**. Closed forms used by the kernel:

| Channel | Parameters | λ for a string P restricted to the channel's qubits |
|---|---|---|
| 1q depolarizing, ρ ↦ (1−p)ρ + (p/3)(XρX+YρY+ZρZ) | p ∈ [0, 3/4] | λ = 1 − 4p/3 if P ≠ I, else 1 |
| 1q dephasing, ρ ↦ (1−p)ρ + pZρZ | p ∈ [0, 1/2] | λ_X = λ_Y = 1 − 2p, λ_Z = 1 |
| 1q general Pauli (p_x, p_y, p_z) | Σ ≤ 1 | λ_X = 1 − 2(p_y+p_z), λ_Y = 1 − 2(p_x+p_z), λ_Z = 1 − 2(p_x+p_y) |
| 2q depolarizing, ρ ↦ (1−p)ρ + (p/15) Σ_{E≠II} EρE | p ∈ [0, 15/16] | λ = 1 − 16p/15 if P∣_S ≠ II, else 1 |
| 2q general Pauli (16 probabilities) | | λ_P = Σ_E p_E (−1)^{[P,E]} |
| **Pauli-twirled amplitude damping + dephasing (T1/T2)**, duration t | γ = 1 − e^{−t/T1}, λ_φ = e^{−t/T2} | λ_X = λ_Y = e^{−t/T2}, λ_Z = e^{−t/T1}; equivalently p_x = p_y = γ/4, p_z = (1 − e^{−t/T2})/2 − γ/4 (requires T2 ≤ 2T1, else `noise_model_invalid`) |
| Readout (per qubit, p01 = P(read 1 ∣ prepared 0), p10) | | handled as an **observable substitution**, §2.4 |

Derivation for T1/T2: amplitude damping with Kraus K₀ = diag(1, √(1−γ)), K₁ = √γ |0⟩⟨1| has the Pauli transfer map X ↦ √(1−γ) X, Y ↦ √(1−γ) Y, Z ↦ (1−γ) Z + γ I. Its Pauli twirl keeps the diagonal (λ_X = λ_Y = √(1−γ) = e^{−t/2T1}, λ_Z = 1−γ) and drops the non-unital term γ I. Pure dephasing multiplies λ_X, λ_Y by e^{−t/T_φ} with 1/T_φ = 1/T2 − 1/(2T1), giving the table row. Randomized compiling (Wallman & Emerson, PRA 94, 052325 (2016)) tailors a device's actual cycle noise *toward some* stochastic Pauli channel under assumptions such as gate-independent easy-gate errors; it does **not** make the device channel equal to this calibration-derived model. The certificate therefore says "a Pauli-twirled model of the device; randomized compiling tailors device noise toward a Pauli channel, which may differ from this one".

**Approximation stated once:** v1's default propagates the *twirled* (unital, Pauli) model. The dropped term γ I is exactly the non-unital part that Mele et al. show can *remove* barren plateaus. Therefore: (a) the UI says "Pauli-twirled model" everywhere the number appears; (b) `nonunital: "exact"` (§2.5) propagates it; (c) §2.6 bounds the gap a priori; (d) §7.2 measures it.

### 2.3 Noisy Pauli propagation — expectations and second moments

**Expectation at fixed θ** (single chain, `ppe_core.expectation_bounds`): a channel step multiplies each row's weight by λ_Q (computed from the row's restriction to S via the symplectic bit arrays: `anticommutes = popcount((qx & ez) ^ (qz & ex)) & 1`, vectorised over the channel's Pauli support list). Rows with |w| < `min_weight_abs` are pruned **and accounted** exactly as today. Because |λ| ≤ 1, the ledger invariant "a discarded row contributes at most |w| to the final sum" still holds, so `⟨O⟩ ∈ [kept − D, kept + D]` remains rigorous.

**Second moments** (doubled chain, `gradient_variances`): a pair (Q, Q′) with weight w is θ-independent under a channel, so averaging over angles commutes with it: the pair's weight becomes w · λ_Q · λ_{Q′}. The fork rule and the truncation ledger are unchanged; the discarded-mass bound again uses |λ_Q λ_{Q′}| ≤ 1.

**Early exits must become noise-aware (binding).** PRD 14's `_filter_exact(chain, union_before[j], final)` moves every string that commutes with all remaining rotations straight into `final`; at the very start it does so against `union_before[n_rot]`. With channels interleaved those strings are still damped by every remaining (earlier-in-time) channel, so reusing the function unchanged **overstates** noisy expectations and variances — wrong, not loose. The noisy engine therefore (1) precomputes, per channel position j, the suffix product `Λ_j(P) = ∏_{channels before j in time} λ_{P}` and multiplies every finalised string (and every pair, by `Λ_j(Q)·Λ_j(Q′)`) by it when it is moved to `final`, then applies the readout map (§2.4); (2) under `nonunital: "exact"` disables the `union_before` early exits after the first damping event (the Z→I branch changes which strings commute with later rotations, so the precomputed masks no longer apply) and recomputes them per branch only when the frontier is small (< 4096 rows), else runs without early exits. Regression test: trailing idle noise on a string that commutes with every rotation must damp the result (density matrix agrees to 1e-10).

**Engine decision (binding).** Rather than forking the two chain loops, `ppe_core.gradient_variances` and `ppe_core.expectation_bounds` gain two keyword-only hooks with default `None`: `channel_step(chain, j) -> chain` (called between rotation steps, in Heisenberg order) and `finalize(strings, j) -> weights` (called on every string moved to `final`, including the initial `union_before[n_rot]` pass). With both hooks `None` the engine is **byte-identical** to PRD 14 (the full PRD 14 PPE suites plus a bit-identical-JSON determinism test on the PRD 14 fixtures gate N2's change); `kernel/noise/ppe_noisy.py` supplies the hooks and never copies the loops. So

  Var_noisy[∂_k C] ∈ [max(0, kept − D_k), kept + D_k],  Var_noisy[C] = E[C²] − E[C]²  (as PRD 14 PH-C2),

with `E[C]` from the mean chain (strings that anticommute with any later rotation die; surviving Z-type strings carry ∏λ). `E[∂_k C] = 0` still holds (a channel does not depend on θ_k; the derivative of a trigonometric polynomial without constant term averages to 0).

**Diagonal chains stay non-negative** only when every λ ≥ 0. A general Pauli channel can have λ_P < 0 (p anticommuting mass > 1/2); then the "diagonal chain is a Markov chain" optimisation is off and the two-sided interval is used. The kernel decides per model (`NoiseModel.all_nonnegative`).

**Idle noise and scheduling.** The IR has no timing. `kernel/noise/schedule.py` builds an ASAP layering (greedy: a gate goes in the first layer after all layers that touch its qubits; ≤ 40 lines), assigns each layer a duration = max gate duration in it (from the model's `durations`, defaults 1q 35 ns, 2q 300 ns, readout 1 µs — IBM-like values, labelled "default durations" in provenance), and inserts the idle channel (T1/T2 row for that duration) on every qubit **not** touched in the layer. In the Heisenberg sweep an idle channel is a channel like any other. Users can disable idle noise (`idle: false`).

**Where channels go.** `after_gate` (default): a channel on the gate's qubits after each gate, rates by gate class (1q, 2q, by name when the model has per-gate entries). Fixed Clifford gates that `_ppe_compile` pushes to the end are a subtlety: PRD 14 conjugates Cliffords into the observable so the engine sees only rotations. With noise **the Clifford frame must also conjugate the channels**: a Pauli channel conjugated by a Clifford C is the Pauli channel with distribution p_{C E C†} — still a Pauli channel on the same qubits (a Clifford maps strings to strings), so `_ppe_compile` extends naturally: `kernel/noise/compile.py: compile_noisy_program(program, channels)` runs the PRD 14 frame walk and emits each channel's support list conjugated by the frame at that point. Unit tests check this against the un-pushed density-matrix simulator.

### 2.4 Readout error as an exact observable substitution (in the measurement frame, before any Clifford conjugation)

Readout acts at measurement time on the observable **as measured**, i.e. after every gate including the trailing fixed Cliffords that `_ppe_compile` later pushes into the observable. The substitution is therefore applied to the original observable O **before** `compile_noisy_program` conjugates anything through the Clifford frame; applying it after the push (to `C†OC`, which can contain X/Y letters where the physical measurement was Z and vice versa) gives the wrong noisy expectation and the wrong gradient scaling.

**Measurement model (stated in the model card):** each Pauli term is measured in its local Pauli basis with per-qubit readout flips (p01ᵢ = P(read 1 | prepared 0), p10ᵢ); the single-qubit basis-change rotations that precede a non-Z measurement are **noiseless** (option `readout.basis_change_noise: "none" | "1q_gate"` models them as 1q gates when set). For product readout noise the measured expectation of a term is obtained by substituting on every site in its support, **whatever the letter**,

  Pᵢ ↦ aᵢ Pᵢ + bᵢ I,  aᵢ = 1 − p01ᵢ − p10ᵢ,  bᵢ = p10ᵢ − p01ᵢ,

with the sign of bᵢ fixed by the basis-change convention (the +1 eigenstate of Pᵢ is rotated onto |0⟩; for Pᵢ = Z this is the identity rotation, so the formula reduces to the familiar Z form), and expanding the product (a weight-w term becomes ≤ 2ʷ lower-weight terms; capped at w ≤ 16 per term, else `noise_not_applicable: "readout expansion too large"`). This is exact for product readout noise under the stated measurement model. `compile_noisy_program` then conjugates the **substituted** observable through the Clifford frame exactly as PRD 14 does. Identity terms add a constant to E[C] and nothing to gradients. Test (binding): density matrix + explicit readout channel on circuits with a trailing H/CX block and X- and Y-type observable terms agrees with the noisy PPE to 1e-10.

### 2.5 Non-unital propagation (`nonunital: "exact"`)

Amplitude damping's adjoint is Z ↦ (1−γ) Z + γ I, X ↦ √(1−γ) X, Y ↦ √(1−γ) Y (no twirl). On a string with Z on the channel's site this **branches**: one row keeps Z (weight × (1−γ)), one row replaces Z by I (weight × γ) — again a Pauli-string-to-Pauli-string linear map, so both the single chain and the doubled chain handle it (a pair branches into ≤ 4 rows). Everything in §2.3 stays valid with "|λ| ≤ 1" replaced by "the ℓ1 norm of the row's image is ≤ 1" ((1−γ) + γ = 1), which keeps the ledger rigorous. The cost: the frontier can grow by a factor ≤ 2 per Z-site per damping event, so `exact` is budget-guarded like everything else and reports `budget_exhausted` honestly. `E[C]` under non-unital noise: the mean chain's rows that spawn identities survive rotations differently (an identity on a site no longer anticommutes), so `_cost_mean` must run the branching too — it is a single sweep and cheap.

### 2.6 A priori bounds (reported next to the a posteriori ledger)

1. **Twirl gap — two bounds, each shown next to the quantity it bounds.** Let the exact (non-unital) and twirled channel sequences differ only in the amplitude-damping applications j = 1..N_AD with damping γ_j. *Expectation gap (hybrid argument):* write the difference as a telescoping sum over the N_AD positions where one application is swapped from exact to twirled; the adjoint of a CPTP map is unital and contractive in operator norm, the two adjoint channels differ only in the term γ_j·(Z→I) on one site, so each swap changes the Heisenberg-evolved observable by at most γ_j‖O‖_op, giving

   |⟨O⟩_exact − ⟨O⟩_twirled| ≤ `twirl_gap_expectation` := min(2‖O‖_op, Σ_j γ_j ‖O‖_op) ≤ N_AD·γ_max·‖O‖₁

   (‖O‖_op is computed exactly for n ≤ 12 and replaced by its upper bound ‖O‖₁ above; the ledger says which). The ℓ1 "path" argument of the first draft is **not** valid (rotations can grow Pauli ℓ1 mass by √2 per branch) and is not used. *Gradient-variance gap:* for a frequency-f rotation the parameter-shift rule gives ∂C = f·(C(+π/2f) − C(−π/2f))/2, so |∂C_exact − ∂C_twirled| ≤ f·`twirl_gap_expectation` =: δ_f and |∂C| ≤ f‖O‖_op; with E[∂C] = 0 under both models,

   |Var_exact[∂C] − Var_twirled[∂C]| ≤ `twirl_gap_variance` := min(f_max²‖O‖_op², 2·f_max·‖O‖_op·δ_{f_max}).

   The kernel reports `bounds.twirl_gap_expectation` next to every twirled **expectation** (`simulability_under_noise`, `cost_mean`) and `bounds.twirl_gap_variance` next to every twirled **variance** (`gradients_noisy`, `noise_sweep`, `scaling_noisy`); the §2.9 claim quotes the variance bound. Showing an expectation bound next to a variance is a category error and is forbidden by the view tests. Both are usually loose; §7.2 tabulates how loose, and the density-matrix check asserts `observed gap ≤ bound` for **both** quantities.
2. **Weight-cut estimate (heuristic, average-case).** The LOWESA / Schuster et al. (PRX 15, 041018 (2025)) guarantees are *average-case* (over input states and angles, typically in ℓ2); for the fixed-θ single chain, Pauli ℓ1 mass can grow by up to √2 per branching rotation, so `‖O‖₁·L·λ_max^{k+1}` is **not** a worst-case bound. The kernel reports it as `weight_cut_estimate` with `bound_kind: "heuristic"` and the label "average-case heuristic (LOWESA / Schuster et al.)", as an *explanation* of why noisy propagation is cheap. λ_max is the maximum |λ| over all **non-identity** Paulis of every channel; when λ_max = 1 (e.g. dephasing-only models, where λ_Z = 1) the estimate is `not_applicable: "a Pauli with λ = 1 exists"`. The **verdict always uses the exact ledger D**, never the estimate.
3. **NIBP reference line (Wang et al. 2021, Theorem 1, exact constants).** Wang et al. (Nat. Commun. 12, 6961, arXiv:2007.14384, Eqs. 11–12) bound, for local Pauli noise acting **before and after every layer** on every qubit with Pauli damping parameter q = max(|q_X|, |q_Y|, |q_Z|) (a λ in our notation, not an error probability), L layers and an observable with N_O terms of coefficient vector ω:

   |∂_k C̃| ≤ √(8 ln 2) · N_O · ‖ω‖_∞ · ‖η_{lm}‖₁ · n^{1/2} · q^{cL+1},  c = 1/(2 ln 2).

   The kernel implements this expression verbatim with q = max λ from the model and ‖η_{lm}‖₁ from the generator of parameter k, clips the curve at its trivial bound (f²‖O‖₁² for the variance view), and labels it "analytic upper bound (Wang et al. 2021, Thm. 1), often loose". It is shown **only** when the model has local Pauli noise on every qubit before and after every layer (the schedule's idle + after-gate placement with per-qubit channels satisfies this; a model with gate-only noise on a subset of qubits does not); otherwise the sweep shows "reference not applicable to this noise placement". Never used as a number for the user's circuit.

### 2.7 What the noisy quantities mean (semantics table)

| Quantity | Method | Interval | Meaning |
|---|---|---|---|
| `gradients_noisy.per_parameter[k].interval` | noisy PPE | rigorous truncation | Var_θ[∂_k C] under the model |
| `gradients_noisy.cost_variance_interval` | noisy PPE | rigorous | Var_θ[C] under the model |
| `noise_sweep.points[s]` | noisy PPE at scale s·model | rigorous per point | how variance decays with noise strength |
| `scaling_noisy.fit` | PRD 14 scaling fit on noisy variance intervals | AIC + bootstrap CI as PRD 14 | `barren_plateau` / `polynomial` / `inconclusive` **under the model** |
| `simulability_under_noise` | noisy PPE expectation at K points (spec 01 points) | rigorous | whether the *noisy* cost is reproduced within ε |
| `bounds.twirl_gap_expectation` / `bounds.twirl_gap_variance` | analytic (hybrid argument) | a priori, rigorous | gap between exact and twirled expectations / variances; shown next to the matching quantity only |
| `bounds.weight_cut_estimate` | analytic | heuristic (average-case) | explanation of cost, never the verdict |
| `density_matrix_check` (n ≤ 10, opt-in) | exact DM, full channels | Monte-Carlo bootstrap over θ | validation of the twirl at this n |

Numbers are never interval midpoints (PRD 14 PH-C1). A noisy variance whose interval is uninformative is `null` with the interval.

### 2.8 Regimes and "not applicable"

- Circuit outside the PPE class (non-Clifford fixed gate, shared/affine parameters, multi-Pauli generator): noisy PPE `not_applicable` with PRD 14's reason. Fallback: **density-matrix sampling** at n ≤ 10 (the §2.4 readout substitution applies to the observable before simulation in exactly the same way) (`kernel/noise/densitymatrix.py`, bootstrap CIs exactly like `analyses._sampling_result`; 4ⁿ·16 B ≤ 16 MiB; parameter-shift gradients remain valid under θ-independent noise); above 10 qubits `noise_not_applicable: "needs the PPE class or n ≤ 10"`.
- `init = "small"`: the PPE's uniform-angle averaging does not apply (PRD 14); same fallback rule.
- Non-Pauli channels (coherent over-rotation, leakage, crosstalk, correlated errors, non-Markovian drift): **not modelled**; listed in `not_modelled` and shown in the UI.
- A calibration without T2 (or T2 > 2T1 after rounding): idle channel `not_applicable` for that qubit, with the reason, rest of the model used.
- Two-qubit gates on pairs not in the device's coupling map: the model uses the device median 2q error and flags the gate (`layout_warnings`); no routing is performed — "this is the circuit as written, on qubits 0..n−1 of the device" is the stated scope, and the user can give a `layout` list.

### 2.9 The noisy certificate claim (ships verbatim)

> Under the noise model "{model_name}" ({source}: a Pauli-twirled model built from the {provider}/{backend} calibration fetched {fetched_at}, or preset/file), a Markovian, gate-local model with {n_channels} channels{ nonunital_note } (gate errors converted by 1q p = 3r/2, 2q p = 5r/4), the mean gradient variance of this circuit (n = {n}, m = {m}, observable {O}, θ ~ {𝒟}) is in [{lo}, {hi}] (noiseless: [{lo0}, {hi0}]). Scaling under the model over n ∈ {sizes}: {verdict} ({fit}) — rendered as "no barren plateau detected under the model" / "barren plateau under the model" / "inconclusive", never as "trainable". This describes the model, not the device: coherent, correlated, leakage and drift errors are not modelled (listed), calibration data ages, randomized compiling tailors device noise toward a Pauli channel that may differ from this one, and the twirl drops non-unital effects whose a priori bound on these variances is {twirl_gap_variance}. Absence of a barren plateau does not guarantee trainability (Anschuetz & Kiani 2022). Treat it as a lead to confirm on hardware.

---

## 3. Idea 4 — Math and estimators

### 3.1 Setting

A **feature map** is a `ParamCircuit` whose parameters split into data parameters x ∈ ℝᵈ and (optional) trainable parameters w. Declaration order of precedence (implemented once in `kernel/trainability/declarations.py`, master F-1): request `settings.qkernel.data_params` → module-level `nuclei_model["features"]` (spec 03) → module-level `nuclei_data_params` (spec 01) → none (`qkernel_needs_data_params`, with the snippet to add). Trainable parameters are fixed at `nuclei_model["weights"]` when present, else at 0 (stated in the result as `weights: "zeros"`).

A **dataset** is (X ∈ ℝ^{N×d}, y ∈ ℝ^N or {±1}^N) from `nuclei_dataset` (spec 03's forms: tuple, callable, `{"csv": path}`, plus `{"npy": path}` / `{"npz": path, "x": key, "y": key}` added here), from a request-level `dataset: {"path": ...}`, or a built-in demo (§3.9). Path rule (kernel-side, authoritative, implemented in `kernel/trainability/dataset.py`, master F-1): the lab request carries a top-level `project_root` (every v1.4 lab request may; see the master §4); the resolved real path must be inside it, extension ∈ {.csv, .npy, .npz}, file size ≤ 32 MiB, N ≤ `max_rows` (default **1024**, cap 4096) rows and d ≤ 256 columns, else `dataset_invalid` / `dataset_path_outside_project` / `dataset_too_large`. **Before loading**, the loader reads the `.npy` header (`np.lib.format.read_array_header_1_0/2_0`) or, for `.npz`, each member's header through `zipfile` plus `ZipInfo.file_size`, and enforces `shape × dtype.itemsize ≤ 64 MiB` and `file_size ≤ 32 MiB` per member — a zip can declare arrays that inflate to gigabytes, and `np.load(allow_pickle=False)` would still inflate them. Files are opened with `O_NOFOLLOW` and the realpath is re-verified through the open file descriptor (`os.fstat` + `/proc/self/fd` or `F_GETPATH`), closing the symlink TOCTOU. CSV: header row optional, last column is y unless `y_column` is given; numeric only; NaN → `dataset_invalid` naming the row. `trainability_inspect` **never parses data in the server process**: it reports `dataset: {path, bytes, rows_estimate}` from the file size, the header and a streamed line count only; the dataset is loaded in the job worker. The frontend never ships dataset contents over the socket; inline datasets (`{"inline": {X, y}}`) are capped at 256 rows × 64 columns.

### 3.2 Kernels

- **Fidelity (embedding) kernel** K_Q(x, x′) = |⟨φ(x)|φ(x′)⟩|², φ(x) = U(x, w)|0⟩. Statevector only: compute Φ ∈ ℂ^{N×2ⁿ} in batches (`KernelProgram.states`, PRD 14 memory guard: N·2ⁿ·16 B ≤ 512 MiB per batch, so N = 1024 at n = 14, N = 64 at n = 20), K = |Φ Φ†|². n > 20 → `not_applicable: "fidelity kernel needs statevector (n ≤ 20) or hardware shots"`. Exact to float.
- **Projected quantum kernel** (Huang et al., their Eq. for K^{PQ}): K_P(x, x′) = exp(−γ Σ_k ‖ρ_k(x) − ρ_k(x′)‖_F²) with ρ_k the 1-qubit reduced state. ‖ρ_k − ρ′_k‖_F² = ½ Σ_{P∈{X,Y,Z}} (⟨P_k⟩_x − ⟨P_k⟩_{x′})². So the projected kernel needs only the **3n local expectations** r(x) = (⟨X_k⟩, ⟨Y_k⟩, ⟨Z_k⟩)_k per point:
  - statevector (n ≤ 20): exact;
  - **PPE (20 < n ≤ 128, PPE class):** each ⟨P_k⟩_x by `ppe_expectation_bounds` at the bound values θ = (x, w) with interval [lo, hi] (shared parameters are allowed in expectation mode). Intervals propagate rigorously: with r ∈ [r_lo, r_hi] componentwise, the squared distance lies in [Σ (max(0, gap))², Σ (max |diff|)²] where gap/diff are the interval-arithmetic bounds of each component difference, and K_P = exp(−γ·d²) is monotone, so every Gram entry gets a rigorous interval [K_lo, K_hi]. Downstream statistics (§3.4–3.6) are **not** computed on K_lo/K_hi (g, s_K, the spectrum and the CV error are non-monotone matrix functions, and the entrywise bound matrices need not be PSD, so √K can fail). They are computed on the kept Gram matrix K̂ with a **perturbation bound** attached: with w_max the largest entry half-width, ‖K − K̂‖_op ≤ N·w_max; Weyl's inequality bounds every eigenvalue shift by N·w_max, and for the λ-regularised quantities g_λ and s_λ the resolvent bound ‖(K̂+λI)⁻¹ − (K+λI)⁻¹‖_op ≤ N·w_max / (λ(λ − N·w_max)) (valid when N·w_max < λ) gives an interval on g and s. When the resulting interval on g spans both sides of the threshold, or N·w_max ≥ λ, the geometry stage is `inconclusive: "projected-kernel PPE intervals too wide at this budget (N·w_max = …, λ = …)"`. The PPE route is limited to N ≤ 128 points (subsampled with a seeded, stratified draw when the dataset is larger; the report states the subsample) because it makes 3nN `expectation_bounds` calls, and the PPE program is compiled **once per feature map** and re-bound per point.
  - γ: default 1 (Huang's choice after data standardisation), sweepable in §3.6.
- **Classical baselines** (numpy, `kernel/qkernel/classical.py`): linear, polynomial (degree 2, 3), RBF exp(−‖x−x′‖²/(2σ²)) over a σ grid (median heuristic × {¼, ½, 1, 2, 4}), Laplacian. Every classical kernel is normalised so Tr K = N (as Huang et al. require for g to be meaningful).

### 3.3 Finite-shot model

Hardware estimates K̂ from M shots. For the fidelity kernel via inversion test, M·K̂ ~ Binomial(M, K): Var[K̂] = K(1−K)/M. For projected kernels each ⟨P_k⟩ is estimated from M shots (per basis; 3 bases): Var ≈ (1−⟨P⟩²)/M, propagated by the delta method into K_P. The kernel computes, for user-given `shots` (default `null` = exact):
- a **shot-noise floor** σ_shot = max entry standard error;
- a **resolvability ratio** R = Std_{x≠x′}[K] / σ_shot — the Thanasilp criterion in numbers: when R ≲ 1 the finite-shot Gram matrix is indistinguishable from its mean (the model ignores the data);
- a seeded **noisy Gram sample** K̂ (one draw, labelled "simulated shot noise, one draw") used to re-run §3.4–3.6 so the user sees how the verdict moves. This is a *model* of shot noise, not hardware data; the UI says so.

### 3.4 Exponential concentration diagnostics (Thanasilp et al. 2024)

Over the dataset: μ_K = mean of off-diagonal entries, σ_K² = variance, min/max, and the histogram. Report `concentration: {sigma: σ_K, sigma_over_shot_floor: R, verdict}` with verdict `concentrated` when σ_K < 1/√M (for the given shots) or σ_K < 1e-3 (exact), `resolved` when R ≥ 3, else `marginal`. Optional **concentration-vs-n sweep** (`settings.qkernel.sweep_qubits`, when the file exposes `n_qubits` via `params`, exactly as PRD 14's scaling builder does): σ_K at each n, fitted with PRD 14's AIC exponential-vs-polynomial machinery (`scaling.fit_*` reused on log σ_K) → `concentrating_exponentially` / `polynomial` / `inconclusive` (< 4 sizes). The four sources of concentration (expressivity, global measurement, entanglement, noise) are named in the UI text; the fidelity kernel is the "global measurement" case and the projected kernel the local one, which the tab explains.

### 3.5 Geometric difference and model complexity (Huang et al. 2021)

With Gram matrices normalised to Tr K = N (so the mean eigenvalue is 1 and every λ below is **in units of the mean eigenvalue**, never ∝ N):

- **Geometric difference** g(K_C ‖ K_Q) = ‖ √K_Q (K_C + λ I)⁻¹ √K_Q ‖_∞^{1/2}, computed by eigendecomposition (`numpy.linalg.eigh`, PSD-projected: negative eigenvalues below −1e-10·N are an error, tiny ones clipped). Huang et al.'s main text defines the unregularised g = ‖√K_Q K_C⁻¹ √K_Q‖^{1/2} and gives only qualitative cutoffs ("≈ 1 small", "∝ √N large"); the regularised variant with its **training-error condition** is in their Supplementary §4 and §6. Nuclei implements that regularised definition: for each classical kernel, λ_C is chosen as the **smallest value on the grid {1e-4, 1e-3, 1e-2, 1e-1}** at which the classical kernel's regularised training error on the actual labels stays below `train_error_max` (default 0.1 of ‖y‖²/N for regression, 5 % misclassification for labels); g is reported at every λ on the grid (g_λ is monotonically non-increasing in λ, and the table says so) and the verdict uses g at λ_C with the condition shown. A `classical_kernel_matches_geometric_power` verdict is issued **only when the conclusion holds at every λ on the grid down to the smallest** (so a large N cannot mechanically push a concentrated K_Q to "suffice" through the regularisation).
- **Model complexity** s_K(N) = yᵀ (K + λI)⁻¹ K (K + λI)⁻¹ y for the regularised predictor (reduces to yᵀK⁻¹y at λ → 0), for every kernel, same λ grid, **on the actual labels**.
- **Prediction-error relation** used only as a *relation*: Huang's bound scales as O(√(s_K(N)/N)), and s_C(N) ≤ g² s_Q(N) (Huang Thm. 1 chain); so when g ≈ 1 the classical kernel's guaranteed error is at least as good, and when g ≫ 1 **and** s_Q(N) ≪ N a quantum advantage is *possible* on this data — possible, not demonstrated.
- The **Huang flow chart** is implemented as a pure function (§4.4 `verdict.py`), with every threshold **labelled a heuristic** in the verdict text and exposed in settings: for each classical kernel C compute g_C at λ_C; let g* = min_C g_C and C* the argmin. Then:
  - `classical_kernel_matches_geometric_power` ("classical kernel {C*} matches the quantum kernel's geometric power on this data (Huang bound, λ = {λ_C})") if g* ≤ g_thresh (default 1 + 3/√N — a finite-sample slack chosen by us, **not** from Huang et al.; the UI says so) **at every λ on the grid**;
  - `possible_advantage_on_this_data` if g* ≥ c·√N (default c = 0.25, shown as "g* ≥ {c}·√N = {value}") **and** s_Q(N) ≤ N/2 **and**, on the actual labels, s_Q(N) < s_C*(N) (the label-specific comparison Huang et al. apply after g is large — a geometrically different quantum kernel whose complexity on *these* labels is not lower than the classical one gives no advantage);
  - `inconclusive` otherwise (g* in between, s_Q(N) ≈ N, s_Q ≥ s_C*, N < 32, kernel intervals uninformative, or the training-error condition unmet at every λ), with the reason.
  Every verdict carries `scope: "relative to {kernels}, N = {N}, λ_C = {λ} (training-error condition {cond}); thresholds g_thresh = {…}, c = {…} are heuristics"` and the **empirical check** below.

### 3.6 Empirical check, bandwidth, spectrum

- **Cross-validated error** for every kernel with kernel ridge regression (numpy; classification by sign), using **nested CV**: an inner loop (3-fold, seeded) selects α ∈ {1e-3, 1e-2, 1e-1, 1} (in mean-eigenvalue units), the RBF σ, the bandwidth c and — for "best classical" — the classical kernel, and the outer 5 folds measure the error, so the selection is never scored on the folds it was tuned on. Quantum vs classical is compared **paired**, on per-example losses of the same outer folds: the reported interval is a bootstrap over examples of the mean paired difference (1000 resamples, seeded), with the Nadeau–Bengio corrected resampled t-test p-value alongside; the old "bootstrap over 5 folds" (5 dependent values) is not a valid CI and is not used. One eigendecomposition per kernel is reused across all λ and α. This is the ground truth the geometric test is a predictor of; the tab shows both and never lets g override a measured error ("g said possible; measured paired difference quantum − RBF = +0.19 [0.12, 0.26] — classical wins on these folds").
- **Bandwidth** (Shaydulin & Wild; Canatar et al. — note that small-bandwidth quantum kernels approach classical kernels, which the tab states next to the curve): rescale inputs x ↦ c·x, c ∈ {0.05, 0.1, 0.2, 0.5, 1, 2} (configurable), recompute the quantum Gram, σ_K, the spectrum and the CV error; report the best c and the curve. The Gram recompute is N statevector/PPE evaluations per c — budgeted; coarse grid first, refine around the best c if time remains.
- **Spectrum / effective dimension / alignment**: eigenvalues of K/N (log-scale plot), effective dimension d_eff(λ) = Tr[K (K + λ I)⁻¹], kernel-target alignment A = yᵀ K y / (‖y‖² ‖K‖_F) (Hubregtsen et al., PRA 106, 042431 (2022); ‖y‖² rather than N so regression targets are handled), task-model alignment: cumulative fraction of ‖y‖² captured by the top-k eigenvectors (Canatar et al.'s "target is in the top of the spectrum" criterion). Flat spectra (d_eff ≈ N) are flagged as the Kübler et al. "too general to learn" regime.

### 3.7 Complexity and budgets

| Step | Cost | Cap / budget |
|---|---|---|
| Fidelity Gram | N statevector runs + N²·2ⁿ for the inner products (batched) | n ≤ 20; N ≤ `max_rows` (default 1024, cap 4096); explicit 512 MiB batch guard in `gram.py` (`N_batch·2ⁿ·16 B ≤ 512 MiB`, independent of `compiler._MAX_OUTPUT_BYTES`); `time_budget_s` default 60 (5–600) |
| Projected Gram (statevector) | N runs + 3nN expectations + N²·3n | same |
| Projected Gram (PPE) | 3nN `expectation_bounds` calls (program compiled once), each with `max_frontier` (default 200 000) | n ≤ 128; **N ≤ 128 (subsampled, stated)**; `per_point_budget_s` 0.5 default; cancellation between calls |
| g, s_K, spectrum per kernel per λ | O(N³) eigh **once per kernel**, reused across λ and α | single-threaded BLAS in Lab jobs: measured 1.07 s at N = 2048, ≈ 8.5 s at N = 4096 per kernel — hence `max_rows` 1024 by default and a pre-run estimate (`kernels × eigh(N) + nested CV`) assuming single-thread BLAS, shown before Run; perf test records time at the defaults |
| CV | nested: 5 outer × 3 inner solves per kernel, reusing the eigendecomposition | same |
| Bandwidth sweep | ×|c grid| Gram recomputes | budget-guarded, coarse-to-fine |

Everything is cancellable between data points / kernels; partial results stream per stage (§5).

### 3.8 The kernel verdict claim (ships verbatim)

> On this dataset (N = {N}, d = {d}, {source}), with the quantum {fidelity|projected} kernel of this feature map (n = {n}, data parameters {x}, weights {w_source}) compared against {kernels}: the minimum geometric difference is g = {g} (kernel {C*}, λ_C = {λ} in mean-eigenvalue units, chosen so the classical training error ≤ {cond}; g at the other λ: {g_grid}); model complexities on these labels s_Q = {sQ}, s_{C*} = {sC}; nested 5-fold CV paired difference quantum − best classical = {Δ} [{Δ_lo}, {Δ_hi}]. Verdict: {verdict_text}. Thresholds (g ≤ {g_thresh}; g ≥ {c}·√N; s_Q ≤ N/2) are heuristics, not theorems. This is relative to the classical kernels compared; other classical methods, other regularisations, more data, or a different embedding can change it. Finite-sample caveats: N = {N}; kernel entries are {exact | PPE intervals with N·w_max = {…} (perturbation bound) | simulated shot noise at M = {M}}.

### 3.9 Built-in demo datasets (`kernel/qkernel/demo.py`, generated, no files)

`two_moons` (N = 256, d = 2, labels ±1, seeded noise 0.1), `xor_blobs` (N = 256, d = 2), `circles` (N = 256, d = 2), `huang_engineered` (N = 200, d = n: labels built by Huang et al.'s eigenvector construction — y is the top eigenvector of √K_Q (K_C + λI)⁻¹ √K_Q, rescaled, so that s_Q = 1 and s_C = g² by construction for the chosen classical kernel C = RBF at the median bandwidth — i.e. engineered to favour the quantum kernel; the UI says "engineered to favour this kernel; it demonstrates the test, not an advantage"). All deterministic from `default_rng(seed)`.

---

## 4. Kernel design

### 4.1 Module layout (new files in bold-less code; everything else is reuse)

```
kernel/noise/                                  # Idea 3 (new package; no optional imports)
├── __init__.py
├── model.py            # NoiseModel / Channel dataclasses, validation (wire JSON -> model), presets, scaling by `strength`
├── channels.py         # closed-form lambda tables (§2.2), T1/T2 -> (px,py,pz), readout substitution (§2.4)
├── schedule.py         # ASAP layering, durations, idle-channel placement
├── compile.py          # rotation program + channels -> NoisyProgram (Clifford frame conjugates channels)
├── ppe_noisy.py        # noisy single chain + doubled chain (thin wrappers over ppe_core primitives, §4.3)
├── densitymatrix.py    # exact DM simulator for n <= 10: full channels (AD un-twirled), parameter-shift gradients
├── analyses.py         # gradients_noisy, noise_sweep, scaling_noisy, simulability_under_noise, density_matrix_check
├── bounds.py           # twirl_gap_expectation, twirl_gap_variance, weight_cut_estimate (heuristic), NIBP Thm. 1 reference curve
├── calibration.py      # CalibrationSnapshot, calibration_to_noise_model(snapshot, layout), bundled loader
├── bundled/            # <provider>_<backend>_<date>.json snapshots + manifest.json (sha256, fetched_at, script version)
└── surrogate.py        # `noisy_ppe` Surrogate registered in kernel/surrogates/registry.py: SUITE_EXTENSIONS (claim class "N")

kernel/hardware/
├── base.py             # + HardwareProvider.get_calibration(backend) -> CalibrationSnapshot | None (default None)  [extend-only]
├── ibm_provider.py     # + get_calibration via backend.properties()                                            [extend-only]
├── ionq_provider.py    # + get_calibration via /backends/{name} characterization (device-average)               [extend-only]
└── manager.py          # + get_calibration(provider, backend)                                                   [extend-only]

kernel/qkernel/                                # Idea 4 (new package)
├── __init__.py
├── featuremap.py       # data/weight split, binding (x, w) -> values vector, declaration resolution
├── dataset.py          # thin re-export of kernel/trainability/dataset.py (the single loader, master F-1) + standardisation
├── demo.py             # built-in datasets
├── gram.py             # fidelity Gram (statevector), projected Gram (statevector | PPE with intervals), shot model
├── classical.py        # linear/poly/rbf/laplacian kernels, normalisation, bandwidth grids
├── geometry.py         # geometric difference, model complexity, spectrum, d_eff, alignment (pure numpy)
├── concentration.py    # sigma_K, resolvability ratio, verdict; sweep over n via scaling fit
├── krr.py              # kernel ridge regression + k-fold CV + bootstrap
├── bandwidth.py        # c-grid sweep orchestration
├── verdict.py          # Huang flow chart + claim text (pure)
├── lint.py             # QK001–QK006 (called from trainability/lint.py when data params exist)
└── analysis.py         # run_qkernel(...) orchestrator with stages, progress, cancel, budgets

kernel/trainability/
├── analyses_noise.py   # registers gradients_noisy / noise_sweep / scaling_noisy + the "noise" settings section + the two sync handlers (F-1 registries; no shared edit)
├── analyses_qkernel.py # registers qkernel + the "qkernel" settings section (F-1 registries; no shared edit)
├── lint.py             # + one call into kernel.qkernel.lint when data params are declared                                      [shared, 6 lines]
├── scaling.py          # + `variance_fn` injection point (default = today's gradient_statistics)                                 [extend-only]
└── provenance.py       # noise_fingerprint / qkernel_fingerprint registered via register_fingerprint (F-1); PROTOCOL_VERSION owned by F-1

kernel/server.py        # the "hardware_calibration" branch is added by F-1 (base provider returns None → calibration_unavailable); N3 only implements providers
```

All numpy; `scipy` optional (never required). No new entry in `kernel/requirements.txt`. Files ≤ 400 lines (`densitymatrix.py`, `gram.py` may reach 500).

### 4.2 Data structures (binding, frozen)

```python
# kernel/noise/model.py
ChannelKind = Literal["depolarizing", "dephasing", "pauli", "depolarizing2", "pauli2", "thermal"]  # thermal = T1/T2 for a duration

@dataclass(frozen=True)
class Channel:
    kind: ChannelKind
    qubits: tuple[int, ...]                 # 1 or 2 circuit qubits
    params: tuple[float, ...]               # p | (px,py,pz) | p | 16 probs | (t_ns, t1_ns, t2_ns)
    lambdas: tuple[float, ...]              # precomputed per-Pauli damping (3 for 1q, 15 for 2q) — derived, cached
    nonunital_gamma: float = 0.0            # thermal only: γ for the exact identity branch

@dataclass(frozen=True)
class Readout:
    p01: float; p10: float

@dataclass(frozen=True)
class NoiseModel:
    name: str
    source: dict                            # {"kind": "preset"|"file"|"calibration", "path"?, "provider"?, "backend"?, "fetched_at"?, "sha256"?}
    one_qubit: dict[str, tuple[float, float, float]]   # gate class/name -> (px,py,pz); key "*" = default
    two_qubit: dict[str, tuple[float, ...]]            # "*" or gate name -> (p,) depolarizing or 16 probs
    per_qubit_scale: dict[int, float]       # optional multipliers (from calibration: qubit i's error / median)
    per_edge: dict[tuple[int, int], tuple[float, ...]] # calibration: edge-specific 2q channel
    thermal: dict[int, tuple[float, float]] # qubit -> (T1_ns, T2_ns); missing -> no idle noise on that qubit
    durations: dict[str, float]             # gate class/name -> ns; defaults applied and recorded
    readout: dict[int, Readout]
    idle: bool = True
    nonunital: Literal["twirl", "exact"] = "twirl"
    strength: float = 1.0                   # global multiplier on every probability (clamped so channels stay valid)
    not_modelled: tuple[str, ...] = ("coherent errors", "leakage", "crosstalk", "correlated errors", "drift")
    layout: tuple[int, ...] | None = None   # circuit qubit i -> device qubit layout[i]
    layout_warnings: tuple[str, ...] = ()
    def to_json(self) -> dict: ...
    @staticmethod
    def from_json(raw: dict) -> "NoiseModel": ...    # strict; raises NoiseError("noise_model_invalid", path)
    def scaled(self, s: float) -> "NoiseModel": ...   # new object
    @property
    def all_nonnegative(self) -> bool: ...

# kernel/noise/compile.py
@dataclass(frozen=True)
class NoisyProgram:
    program: tuple                          # PRD 14 RotationProgram items
    channel_at: tuple[tuple[int, ...], ...] # per rotation index j: channel ids applied *after* gate j (time order)
    channels: tuple[Channel, ...]           # Clifford-frame-conjugated
    readout_observable: Observable          # the substituted observable (§2.4)
    n_channels: int

# kernel/noise/calibration.py
@dataclass(frozen=True)
class QubitCalibration: t1_ns: float | None; t2_ns: float | None; readout: Readout | None; gate_errors: dict[str, float]; gate_durations_ns: dict[str, float]
@dataclass(frozen=True)
class EdgeCalibration: gate: str; error: float; duration_ns: float | None
@dataclass(frozen=True)
class CalibrationSnapshot:
    provider: str; backend: str; fetched_at: str; source: Literal["live", "bundled", "file"]
    qubits: dict[int, QubitCalibration]; edges: dict[tuple[int, int], EdgeCalibration]
    coupling_map: tuple[tuple[int, int], ...]; notes: tuple[str, ...]; sha256: str
    def to_json(self) -> dict: ...

# kernel/qkernel/gram.py
@dataclass(frozen=True)
class Gram:
    kind: Literal["fidelity", "projected", "classical"]
    name: str
    K: np.ndarray                            # (N, N) estimate (kept value for PPE)
    K_lo: np.ndarray | None; K_hi: np.ndarray | None   # rigorous bounds (PPE route) else None
    method: Literal["statevector", "ppe_bounded", "ppe_exact", "classical"]
    informative: bool                        # every entry interval width <= 0.1
    shots: int | None
```

**Gate-error → channel conversions (frozen; recorded in `calibration.py`, shown in the UI's model card and in the certificate as an r ↔ p table).** For the uniform-Pauli channel on d-dimensional support, ρ ↦ (1−p)ρ + p/(d²−1)·Σ_{E≠I} EρE, the entanglement (process) fidelity is F_pro = 1 − p and Nielsen's formula (Phys. Lett. A 303, 249 (2002)) F_avg = (d·F_pro + 1)/(d + 1) gives the average gate infidelity r = 1 − F_avg = p·d/(d+1), i.e. **p = r·(d+1)/d**:

| support | d | conversion | cap |
|---|---|---|---|
| 1 qubit | 2 | **p = (3/2)·r** | p ≤ 3/4 |
| 2 qubits (uniform over the 15 non-identity Paulis) | 4 | **p₁₅ = (5/4)·r** | p₁₅ ≤ 15/16 |

(The first draft's 1q value p = 2r mislabelled the depolarizing-λ convention and overstated every calibrated 1q channel by 33 %; the bracketed "64r/45" was inverted — p_total = 15λ/16 = 5r/4. Both are deleted.) r is the provider's reported EPG / average gate infidelity (RB). **Gate-time decoherence policy (binding):** the gate channel is matched to the RB r, which already includes decoherence during the gate, so **no** additional thermal channel is applied to the gate's own qubits for the gate's duration; idle thermal noise of duration `layer_duration − own_gate_duration` is applied to every qubit in the layer (so a qubit that finishes a short 1q gate inside a long 2q layer idles for the remainder), and full `layer_duration` to untouched qubits. The unit test computes F_avg by Haar integration over explicit Kraus maps (never from these constants) and asserts p = 3r/2 and p₁₅ = 5r/4 to 1e-6; REV-P signs off on the table.

### 4.3 Pure functions (the contracts other units code against)

```python
# noise
channels.lambdas_1q(px, py, pz) -> (λX, λY, λZ);  channels.lambdas_2q(probs16) -> np.ndarray[15]
channels.thermal_channel(t_ns, t1_ns, t2_ns) -> Channel               # raises NoiseError if t2 > 2 t1
channels.readout_substitute(observable: Observable, readout: dict[int, Readout], *, max_weight=16) -> Observable
schedule.layers(circuit: ParamCircuit) -> list[list[int]]              # gate indices per ASAP layer
schedule.idle_channels(circuit, model) -> list[tuple[int, Channel]]    # (after gate index, channel)
compile.compile_noisy_program(circuit, observable, model, *, independent: bool) -> NoisyProgram
ppe_noisy.gradient_variances(prog: NoisyProgram, n_params, *, max_weight, min_weight_abs, max_frontier, time_budget_s, progress, cancel) -> dict   # same shape as ppe_core.gradient_variances + {"n_channels", "nonunital"}
ppe_noisy.expectation_bounds(prog, values, **budget) -> dict          # same shape as ppe_core.expectation_bounds
densitymatrix.expectation(circuit, values, observable, model) -> float                      # exact, full channels
densitymatrix.gradient_statistics(circuit, observable, model, *, samples, seed, init, progress, cancel) -> dict  # analyses.gradient_statistics shape, method "density_matrix"
bounds.twirl_gap_expectation(prog, observable) -> float; bounds.twirl_gap_variance(prog, observable, f_max) -> float
bounds.weight_cut_estimate(prog, max_weight) -> float | None   # heuristic; None when λ_max == 1
bounds.nibp_reference(model, circuit, observable) -> dict | None  # Wang et al. Thm. 1 curve, None when the placement does not match
analyses.gradient_variances_noisy(circuit, observable, model, *, method="auto", **budget) -> dict  # §5.1 shape; cross-spec name for spec 04
analyses.noise_sweep(circuit, observable, model, *, scales, **budget) -> dict
analyses.scaling_noisy(build, model, *, qubits, layers, observable_spec, **kw) -> dict   # = scaling.scaling_study(variance_fn=noisy)
analyses.simulability_under_noise(circuit, observable, model, *, values, epsilon, **budget) -> dict
calibration.calibration_to_noise_model(snapshot, *, n_qubits, layout=None, strength=1.0, idle=True, nonunital="twirl") -> NoiseModel
calibration.load_bundled() -> list[CalibrationSnapshot]; calibration.from_file(obj: dict) -> CalibrationSnapshot

# qkernel
featuremap.resolve(circuit, declarations: Declarations, request_data_params) -> FeatureMap   # {data: [...], weights: {name: value}, source}; `Declarations` from kernel.trainability.declarations (F-1) — the ONLY reader
dataset.load(spec: dict, *, project_root: str | None, seed) -> Dataset             # X, y, source, sha256, standardised flag
gram.fidelity_gram(program, featuremap, X, *, batch, progress, cancel) -> Gram
gram.projected_gram(circuit, featuremap, X, *, gamma, method, budget, progress, cancel) -> Gram
gram.shot_noise(gram: Gram, shots: int, rng) -> Gram
classical.grams(X, *, kinds, bandwidth_grid) -> list[Gram]
geometry.geometric_difference(K_c, K_q, lam) -> float; geometry.model_complexity(K, y, lam) -> float
geometry.spectrum(K) -> np.ndarray; geometry.effective_dimension(K, lam) -> float; geometry.alignment(K, y) -> float
concentration.summary(gram, shots) -> dict; concentration.sweep(sigmas_by_n) -> dict
krr.cv_error(K, y, *, folds, alphas, seed, task) -> dict
verdict.decide(report: dict, *, g_thresh, g_large, min_N) -> dict                   # pure, table-tested
analysis.run_qkernel(circuit, loaded, settings, *, project_root, seed, backend, progress, cancel) -> dict
lint.qk_rules(circuit, featuremap, X_stats | None) -> list[diagnostic]
```

`ppe_noisy` does **not** copy `ppe_core` and does **not** reuse `_filter_exact` unchanged (§2.3): N2 adds the two keyword-only hooks `channel_step=None, finalize=None` to `ppe_core.gradient_variances` / `expectation_bounds` (and threads `finalize` through `_filter_exact` and the initial `union_before[n_rot]` pass), with default-`None` behaviour byte-identical to PRD 14, gated by the full PRD 14 PPE suites plus a bit-identical-JSON determinism test. `ppe_noisy.py` supplies `_channel_step(chain, channel, nonunital)` and `_finalize_with_suffix(strings, j)` (suffix products of λ + readout map). `_cost_mean` under `nonunital: "exact"` runs the branching as a separate single sweep.

### 4.4 Budgets, cancellation, resource limits

- Jobs run in the existing trainability worker subprocess (`job_worker.py`), inheriting the 20-min wall, CPU limit, process-group kill, the **group-RSS memory ceiling** that F-1 adds to `LabJobManager` (`procrun` poll-and-kill; `worker_died` with `too_much_memory`), `MAX_JOBS_PER_OWNER = 2`, `MAX_JOBS_GLOBAL = 4` (the F-1 shared counter in `lab_proc.py`).
- `cancel()` polled per rotation/channel step (PPE), per density-matrix sample, per data point (Gram), per kernel (geometry), per fold (CV).
- Noisy PPE frontier cap 2 000 000 (as PRD 14), `nonunital: exact` default cap 500 000; time budgets clamped 0.5–120 s per analysis; noise sweep ≤ 8 scales; density-matrix check n ≤ 10, samples ≤ 2000.
- Gram memory: N² × 8 B × (1 + 2 for bounds) ≤ 400 MiB ⇒ N ≤ 4096 (default `max_rows` 1024); statevector batches under an explicit 512 MiB guard in `qkernel/gram.py` (PRD 14's `compiler._MAX_OUTPUT_BYTES` is 4 GiB and is not the guard).
- Determinism: all randomness from `default_rng(seed)` with domain separation (`seed`, `"qkernel:shots"`, `"qkernel:cv"`, `"noise:dm"`); same inputs ⇒ bit-identical JSON except `elapsed_ms`.
- Security: datasets are **data** (numpy `np.load(..., allow_pickle=False)`, CSV via `np.genfromtxt` with explicit dtype) — never unpickled, never `exec`'d; path validation is kernel-side; `nuclei_dataset` callables run in the job subprocess with the same trust as the user's circuit code (PRD 14's model).

---

## 5. Protocol — lab messages v1.4 (additive)

All replies flat `{"type": ...}`; errors `{"type": "error", "phase": "trainability" | "hardware", "code", "message", "job_id"?, "request_id"?, "path"?}`; sync requests honour `request_id` per `kernel/lab_protocol.py`.

### 5.1 `trainability_start` extensions

`analyses` may include `"gradients_noisy"`, `"noise_sweep"`, `"scaling_noisy"`, `"qkernel"`. New settings sections (all optional; clamped in `_settings.py`; unknown keys → `invalid_request` with the path):

```json
"noise": {
  "model": { ...NoiseModel.to_json()... } | null,   // ALWAYS a fully resolved NoiseModelJson carrying source.{kind, sha256, fetched_at}; presets/files are resolved by the frontend, calibrations ONLY through trainability_calibration_to_model / hardware_calibration beforehand — a {"preset"} or {"calibration"} object here is `noise_model_invalid: "unresolved model; resolve it first"`
  "strength": 1.0,                       // 0 .. 10
  "idle": true, "nonunital": "twirl",    // "twirl" | "exact"
  "method": "auto",                      // "auto" | "ppe" | "density_matrix"
  "sweep_scales": [0, 0.25, 0.5, 1, 2],  // <= 8 values in [0, 10]
  "ppe": {"max_frontier": 2000000, "time_budget_s": 20, "max_weight": null},
  "density_matrix": {"samples": 500},    // 16 .. 2000, n <= 10
  "simulability": {"points": 8, "epsilon_relative": 0.01},
  "check_density_matrix": false          // opt-in validation run (n <= 10)
},
"qkernel": {
  "data_params": [],                     // overrides module declarations
  "dataset": {"demo": "two_moons"} | {"path": "data/train.csv", "y_column": null} | {"inline": {"X": [[...]], "y": [...]}} | null,   // null -> nuclei_dataset
  "kernel": "auto",                      // "auto" | "fidelity" | "projected" | "both"   (auto: both at n <= 20, projected above)
  "gamma": 1.0,                          // 0.01 .. 100
  "shots": null,                         // null | 100 .. 1e7
  "classical": ["linear", "poly2", "rbf", "laplacian"],
  "lambda_grid": [1e-4, 1e-3, 1e-2, 1e-1],
  "bandwidth_grid": [0.05, 0.1, 0.2, 0.5, 1, 2],
  "sweep_qubits": [],                    // <= 8 sizes; needs `n_qubits` in params like PRD 14 scaling
  "cv_folds": 5, "time_budget_s": 60, "per_point_budget_s": 0.5, "max_rows": 1024,   // cap 4096; PPE projected route additionally subsamples to 128
  "standardize": true
}
```

The `noise.model` is always a **fully resolved** `NoiseModelJson`: presets/files are resolved by the frontend (the kernel has no YAML parser; the frontend parses `*.noise.yaml` and sends JSON), and calibrations are resolved **before** the job through `trainability_calibration_to_model` (§5.3), whose reply the frontend stores and sends back unchanged. Jobs never fetch: job workers are `python -I` subprocesses with a minimal environment and no provider state, settings normalisers are pure, and a live fetch inside `start` would make provenance non-reproducible. Provenance records the model's `source.sha256` and `fetched_at` exactly as the frontend sent them.

### 5.2 Streaming and results

- `trainability_progress {job_id, analysis: "gradients_noisy" | "noise_sweep" | "scaling_noisy" | "qkernel", fraction, message}` (≤ 10/s). qkernel messages name the stage: `"qkernel: gram (projected, PPE) 120/256"`, `"qkernel: geometry rbf λ=1e-3"`.
- `trainability_partial {job_id, analysis, result}` per analysis; for `qkernel` **also one partial per stage** (`result.stage ∈ dataset | gram | classical | geometry | concentration | cv | bandwidth | verdict`, each carrying the cumulative report), so the tab fills in progressively and a cancel keeps the finished stages.
- `trainability_result.results.gradients_noisy`:

```json
{"method": "ppe_noisy" | "density_matrix", "nonunital": "twirl" | "exact", "model": {"name", "source", "n_channels", "strength", "idle", "not_modelled": [...], "layout_warnings": [...], "sha256"},
 "per_parameter": [{"name", "variance": 1.1e-3 | null, "interval": [lo, hi], "dead", "dead_reason"}],
 "variance_mean": 9.1e-4 | null, "variance_mean_interval": [lo, hi],
 "cost_mean": 0.12, "cost_variance": null, "cost_variance_interval": [lo, hi],
 "noiseless": {"variance_mean": ..., "variance_mean_interval": [...], "frontier_peak": 48213},
 "frontier_peak": 2117, "frontier_ratio": 0.044, "discarded_mass": 0.0, "status": "complete",
 "bounds": {"twirl_gap_expectation": 3.2e-3, "twirl_gap_variance": 6.1e-3, "operator_norm_source": "exact" | "l1_upper_bound",
            "weight_cut_estimate": {"max_weight": null, "value": null, "bound_kind": "heuristic", "not_applicable": null}},
 "cost_at_equal_accuracy": {"epsilon": 0.0123, "frontier_needed_noisy": 1800, "frontier_needed_noiseless": 41000, "D_noisy": 0.009, "D_noiseless": 0.011} | null,
 "readout": {"applied": true, "expanded_terms": 6},
 "density_matrix_check": null | {"n": 6, "samples": 500, "variance_mean_ci95": [..], "twirled_ci95": [..], "exact_ci95": [..], "twirl_gap_observed": 1.1e-4, "contains_ppe": true},
 "notes": [...], "elapsed_ms": 812}
```

- `results.noise_sweep`: `{"scales": [...], "points": [{"scale", "variance_mean", "variance_mean_interval", "cost_variance_interval", "twirl_gap_variance", "frontier_peak", "status"}], "reference": {"kind": "nibp_bound", "theorem": "Wang et al. 2021 Thm. 1", "placement_matches": true, "values": [...]} | {"kind": "nibp_bound", "placement_matches": false, "reason": "..."} | null, "notes"}`.
- `results.scaling_noisy`: the PRD 14 `ScalingStudy` shape with `"noise": {model summary}` added and `method: "ppe_noisy"`.
- `results.qkernel` (cumulative report):

```json
{"dataset": {"source": "demo:two_moons" | "project:data/train.csv" | "nuclei_dataset" | "inline", "N": 256, "d": 2, "task": "classification" | "regression", "sha256", "standardized": true, "y_column"},
 "feature_map": {"data_params": ["x0","x1"], "weights": {"source": "nuclei_model" | "zeros", "n": 4}, "n_qubits": 4},
 "grams": [{"name": "fidelity", "kind": "fidelity", "method": "statevector", "informative": true, "shots": null, "summary": {"mean_offdiag", "sigma", "min", "max"}, "histogram": {...}},
           {"name": "projected", "kind": "projected", "method": "ppe_bounded", "max_interval_width": 0.03, "informative": true, ...},
           {"name": "rbf(σ=0.71)", "kind": "classical", ...}],
 "concentration": {"fidelity": {"sigma": 0.21, "shot_floor": null, "ratio": null, "verdict": "resolved"}, "projected": {...}, "sweep": null | {"sizes": [...], "sigma": [...], "fit": {...PRD14 fit...}, "verdict": "concentrating_exponentially"}},
 "geometry": {"lambda_grid": [...], "per_lambda": [{"lambda": 1e-3, "g": {"rbf(σ=0.71)": 1.9, "linear": 7.2, ...}, "s": {"fidelity": 41.3, "rbf(σ=0.71)": 58.0, ...}}],
              "spectrum": {"fidelity": [eigs...], "projected": [...]}, "d_eff": {...}, "alignment": {...}, "target_fraction_top_k": {...}},
 "cv": {"folds": 5, "task": "classification", "errors": {"fidelity": {"mean": 0.08, "ci95": [0.05, 0.12], "alpha": 0.01}, "rbf(σ=0.71)": {...}}},
 "bandwidth": {"grid": [...], "best_c": 0.5, "curve": [{"c", "sigma", "d_eff", "cv_error", "ci95"}]},
 "verdict": {"kind": "classical_kernel_matches_geometric_power" | "possible_advantage_on_this_data" | "inconclusive", "g_min": 1.1, "classical_argmin": "rbf(σ=0.71)", "lambda": 1e-3, "lambda_condition": "train_error ≤ 0.05", "g_grid": {...}, "thresholds": {"g_thresh": 1.19, "c": 0.25, "label": "heuristic"}, "s_q": 41.3, "s_c": 58.0, "reasons": [...], "scope": "...", "claim": "<§3.8 text, filled>",
             "measured": {"paired_difference": {"mean": 0.19, "ci95": [0.12, 0.26], "nadeau_bengio_p": 0.003}, "quantum_best": {"name", "error"}, "classical_best": {...}, "winner_on_split": "classical" | "quantum" | "tie"}},
 "stage": "verdict", "elapsed_ms": 14120, "notes": [...]}
```

### 5.3 New sync messages

| Request | Response |
|---|---|
| `trainability_noise_presets {request_id?}` | `trainability_noise_presets_result {presets: [{"id", "title", "summary", "model": NoiseModelJson, "citation"?}], "bundled_calibrations": [{"provider", "backend", "fetched_at", "n_qubits", "sha256"}], "not_modelled": [...]}` |
| `trainability_calibration_to_model {request_id?, provider, backend, n_qubits, layout?, strength?, idle?, nonunital?, source?: "live"\|"bundled"\|"auto"}` | `trainability_noise_model {model: NoiseModelJson, snapshot: {provider, backend, fetched_at, source, sha256, notes}, warnings: [...]}` or error `calibration_unavailable` (with `reason` and whether a bundled snapshot exists). The handler reaches the hardware manager through `kernel.hardware.manager.get_manager()` (F-1 moves the `server.py` singleton behind it, so no circular import), runs the fetch with a **20 s timeout** and a 4 MiB response cap, and parses provider JSON strictly (unknown shapes → `calibration_unavailable: "unrecognised calibration payload"`). |
| `hardware_calibration {request_id?, provider, backend}` (hardware family, `kernel/server.py`) | `hardware_calibration_result {snapshot: CalibrationSnapshot.to_json()}` or `{"type":"error","phase":"hardware","code":"calibration_unavailable","message"}` |

An old kernel answers the trainability ones with `unknown_message`, mapped by the client to the "kernel too old for lab protocol 1.4" banner (same path as spec 01's catalog).

### 5.4 Error codes (phase `trainability` unless noted)

| code | when |
|---|---|
| `noise_model_invalid` | schema violation; `path` names the field (e.g. `thermal.3.t2_ns > 2*t1_ns`) |
| `noise_not_applicable` | outside PPE class and n > 10 (no density-matrix fallback); readout expansion too large |
| `calibration_unavailable` | provider not connected / no API / bundled snapshot missing (also phase `hardware`) |
| `qkernel_needs_data_params` | no data parameters declared (message carries the snippet) |
| `dataset_invalid`, `dataset_path_outside_project`, `dataset_too_large` | §3.1 rules; `path` field |
| `qkernel_width` | fidelity kernel requested at n > 20 and no projected fallback allowed |
| `qkernel_not_ppe_class` | projected kernel at n > 20 but the feature map is outside the PPE class |
| existing `invalid_request`, `unknown_analysis`, `analysis_unavailable`, `no_parameters`, `ppe_not_applicable`, `cancelled` | unchanged |

Per-stage failures inside `qkernel` never fail the job: the stage is recorded in `notes` with its code and later stages that depend on it are `skipped`.

### 5.5 Lint extension

`trainability_lint_result.diagnostics` may now contain `QK001–QK006` (same diagnostic shape as `TRN*`, `citation` filled); `summary.qkernel = {"data_params": [...], "source": "nuclei_model" | "nuclei_data_params" | null}`. Rules run only when data params are declared (QK001 fires when a `nuclei_dataset` exists but no data params do).

| code | severity | title | rule |
|---|---|---|---|
| QK001 | warning | Dataset without data parameters | `nuclei_dataset` present, no `nuclei_model.features` / `nuclei_data_params` |
| QK002 | info | Single-layer encoding | every data parameter enters exactly one gate ⇒ spectrum {−1, 0, 1} per feature (Schuld, Sweke & Meyer, PRA 103, 032430 (2021)); suggests re-uploading |
| QK003 | warning | Fidelity kernel likely to concentrate | data params on ≥ 12 qubits with ≥ 2 entangling layers between encodings and no projected-kernel declaration (Thanasilp et al. 2024, "global measurement" source) |
| QK004 | info | Unscaled encoding | all data `ParamRef.coeff == 1` and (when the dataset is loaded) the data range exceeds 2π ⇒ aliasing; points to the bandwidth sweep (Shaydulin & Wild 2022) |
| QK005 | info | Trainable feature map without weights | trainable parameters present and no `nuclei_model.weights` ⇒ analysed at zeros |
| QK006 | info | Redundant consecutive encodings | same data parameter on the same axis consecutively on one qubit (sum of angles; mirrors TRN005) |

---

## 6. Frontend / UX (Research workspace)

### 6.1 Where it lives

- **Trainability Lab** (`'trainability'` rail view), Analyze mode (spec 03's `labModes.ts` switch; this spec adds nothing to the mode list):
  - **TargetBar** gains a **Noise** picker (`LabSelect`): *None* · presets (from `trainability_noise_presets`) · *Device…* (opens the calibration drawer) · project `noise/*.noise.yaml` with a `circuit_noise` block · *Edit…* (opens the YAML in the editor). Current choice shown as a pill "Noise: ibm_torino · 2026-10-12 · twirled".
  - **Analysis picker** gains *Gradients under noise*, *Noise sweep*, *Scaling under noise* (enabled only when a model is chosen; hint "pick a noise model first") and *Kernel power of data* (enabled when data params are declared or a dataset is picked; hint with the snippet otherwise).
  - **Tabs:** `TrainabilityTabId += 'noise' | 'qkernel'`. **Noise tab**: noiseless-vs-noisy variance interval bars per parameter (`IntervalBars` from `src/components/lab/charts.tsx`, F-3), the cost-variance pair, the **equal-accuracy cost card** ("frontier needed for D ≤ ε: noisy {a} vs noiseless {b}, D = {…}/{…}" — never a ratio of peaks at the same pruning threshold; hidden with the reason when the noiseless run did not reach ε), the noise-sweep curve (`LabLineChart`) with the NIBP reference line (dashed, labelled, or "reference not applicable to this noise placement"), the scaling-under-noise fit card (reusing `ScalingTab`'s fit renderer with the noisy study), the model card (source, channels, the r ↔ p conversion table, not-modelled list, `twirl_gap_variance` next to the variances and `twirl_gap_expectation` next to the expectations — never crossed, layout warnings), and the density-matrix check card when run. **Kernel tab**: dataset card (source, N, d, task, standardised, subsample note), Gram heatmaps (`LabHeatmap`, one per kernel, shared colour scale) with the σ_K / shot-floor KPI, the geometry table (g per classical kernel per λ with the training-error condition marked, s_K per kernel on the labels, with the λ selector and the perturbation-bound column on the PPE route), the spectrum chart (log eigenvalues per kernel), the paired CV table with interval bars, the bandwidth curve (with the "small bandwidth → classical" note), and the **verdict cell** with the §3.8 claim in a quoted block and the "thresholds are heuristics" line.
  - **VerdictRail** gains two `LabCard`s (registered through `labAnalyses.ts`): *Under noise* (pill text exactly **"No BP under noise model"** / "BP under noise model" / "Inconclusive" / "Not run"; subtitle "model built from {provider}/{backend} calibration fetched {fetched_at}") and *Kernel power of data* (pill per verdict kind).
  - **Certificate** (section registered with `certificate.ts`, F-3): new sections "Noise model" (full model summary, the r ↔ p table and the §2.9 claim — "no barren plateau detected under a Pauli-twirled model built from the {provider}/{backend} calibration fetched {fetched_at}"; a snapshot test forbids the substring `trainable on` anywhere near a device name in the kernel claim, `certificateSection.ts`, the VerdictRail pill and the e2e assertions) and "Quantum kernel" (§3.8 claim, geometry table, paired CV table). JSON gains `noise`, `qkernel`, `provenance.noise_fingerprint`, `provenance.qkernel_fingerprint`.
- **Calibration drawer** (`LabDrawer`): provider/backend from the existing Hardware panel's connected providers (`hardware_connected_providers`, `hardware_list_backends`); "Fetch calibration" → `trainability_calibration_to_model`; shows fetched_at, per-qubit T1/T2/readout table (first 16 qubits + expand), the layout editor (default identity; validation: distinct, in range), strength slider, idle toggle, non-unital toggle (with the honesty line), **Save as `noise/<backend>-<date>.noise.yaml`** (writes schema-2 YAML via `PlatformBridge.writeFile`, then re-discovered by the library — files are the truth, as the QEC library does). Offline: bundled snapshots are listed with "bundled snapshot from {date} — not live" and the Fetch button explains why live is unavailable.
- **Noise library**: the existing noise-model library UI (`src/components/experiments/NoiseModelLibrary.tsx`) lists schema-2 files with a "circuit noise" chip; no new library UI is built (research-only, reused).
- **Command palette** (`src/components/trainability/features/noiseCommands.ts` → F-3's `featureCommands.ts` registry): `Trainability: Run under device noise` (opens the Lab, ticks the three noise analyses, prompts for a model if none), `Trainability: Check kernel power of data`, `Trainability: Fetch device calibration`.
- **Editor**: `QK00x` markers through the existing lint-marker path (`useTrainabilityLint`, `lintMarkers.ts`, FE-K); `QK001`'s quick-fix is `src/components/editor/codeActions/qkernelActions.ts`, registered with F-3's code-action registry, and inserts the `nuclei_data_params = [...]` line.
- **Dirac context** (`src/services/noise/context.ts` and `src/services/qkernel/context.ts`, registered with F-3's `contextProviders.ts`, Research only): a capped "Noise" block (model name/source/date, noisy vs noiseless variance intervals, scaling verdict) and a "Kernel" block (verdict kind, g_min, best classical, CV pair).

### 6.2 User paths (must work end to end)

**Noise.** 1. Open `ansatz/hardware_efficient.py` in Research mode, Trainability Lab. 2. TargetBar → Noise → *Device…* → the drawer lists the IBM provider connected in the Hardware panel (or, offline, the bundled `ibm_torino` snapshot). Fetch → model preview with "as of 2026-10-12T04:10Z". Apply. 3. Tick *Gradients under noise* + *Noise sweep* (+ *Scaling under noise* when the file has `n_qubits` in `params`). Run (⌘⇧↵). 4. Progress streams ("noisy PPE: rotation 40/96, frontier 1 204"); cancel available. 5. Noise tab fills; VerdictRail *Under noise* shows "No BP under noise model". 6. Export certificate → `experiments/<stem>.trainability.{json,md}` contains the noise section and the dated, model-scoped claim.

**Kernel.** 1. Open `models/feature_map_2d.py` (fixture; declares `nuclei_model` with features and `nuclei_dataset = {"csv": "data/moons.csv"}`). 2. The Lab's lint shows no QK001; TargetBar shows "data: x0, x1 · dataset: data/moons.csv (N = 256)". 3. Tick *Kernel power of data*; optionally set shots = 4096 and pick classical kernels. Run. 4. Stages stream: dataset → grams (heatmaps appear) → classical → geometry → concentration → cv → bandwidth → verdict. 5. Verdict cell: "Classical kernel rbf(σ = 0.71) matches the quantum kernel's geometric power on this data (Huang bound, λ_C = 1e-3; paired CV difference +0.01 [−0.02, 0.04])". 6. Try the `huang_engineered` demo from the dataset picker → "Possible advantage on this data — engineered to favour this kernel".

### 6.3 States (every one designed; never a blank box)

| State | Noise tab / rail | Kernel tab / rail |
|---|---|---|
| idle, analysis not selected | `LabEmptyState` "Not run" + button that ticks the analyses | same |
| no noise model chosen | `LabCallout` "Pick a noise model in the target bar" + preset shortcuts | — |
| no data params | — | `LabEmptyState` with the `nuclei_data_params` / `nuclei_model` snippet (copy + insert buttons) |
| no dataset | — | dataset picker (demo list, project files filtered to csv/npy/npz, "Declare in code" hint) |
| presets loading / old kernel | skeleton / "kernel lab protocol < 1.4" banner with Settings link | same |
| web build | existing `LabDesktopRequired` | same |
| calibration fetching | drawer spinner with provider name | — |
| calibration unavailable | drawer callout with the reason and the bundled fallback (if any) | — |
| running | per-analysis `LabProgress`; stage rows for qkernel; Cancel | same |
| partial (cancelled mid-run) | finished analyses rendered; banner "Cancelled; {k} analyses finished" | finished stages rendered; verdict "inconclusive: cancelled at stage {s}" |
| not applicable | card with the reason (e.g. "outside the PPE class and n = 14 > 10; density-matrix fallback unavailable") | grey pill with the reason (fidelity above 20 qubits; PPE intervals too wide) |
| error | `LabCallout tone=danger` with code + message, Retry; `path` from dataset errors is shown | same |
| stale (editor or dataset file changed since run) | "stale" badge, Re-run | same |
| density-matrix check disagrees with the twirl (gap > bound) | red card "Twirl gap {x} exceeds its a priori bound — kernel bug; please report" | — |

### 6.4 Honesty copy (verbatim strings in `src/services/trainability/noiseCopy.ts`, `qkernelCopy.ts`)

- `TWIRL_NOTE`: "Noise is modelled as Pauli channels (Pauli-twirled, Markovian, gate-local). Randomized compiling tailors device noise toward a Pauli channel, which may differ from this one; the a priori twirl gap for the quantity shown is next to it."
- `NO_BP_NOISE_PILL`: "No BP under noise model" (the only allowed pill text for the positive case; "trainable under noise" / "trainable on {device}" never appear).
- `NO_BP_CAVEAT` (shared with spec 01): "Absence of barren plateaus does not guarantee trainability (Anschuetz & Kiani 2022)."
- `CONVERSION_TABLE`: "Gate errors from the calibration are converted to Pauli probabilities by p = 3r/2 (1 qubit) and p = 5r/4 (2 qubits), where r is the reported average gate infidelity."
- `NOT_MODELLED`: "Not modelled: coherent errors, leakage, crosstalk, correlated errors, drift."
- `CALIBRATION_AGE`: "Calibration from {provider}/{backend}, fetched {fetched_at}. Devices drift; refetch before relying on this."
- `LAYOUT_NOTE`: "Circuit qubit i is assumed to run on device qubit {layout[i]}; no routing was performed. Gates on uncoupled pairs use the device median error and are flagged."
- `NOISE_CHEAPER`: "At equal accuracy (D ≤ ε = {ε}), the noisy propagation needed a frontier of {a} vs {b} noiseless (D = {Da} / {Db}). The noisy cost may be classically simulable even when the noiseless one is not (see Quantumness)." (Shown only when both runs reached ε; otherwise "cost comparison unavailable: the noiseless run did not reach ε at the cap".)
- `NIBP_REFERENCE`: "Dashed line: analytic upper bound of Wang et al. (2021, Theorem 1), often loose; not a property of this circuit." / `NIBP_NOT_APPLICABLE`: "Reference not applicable to this noise placement (Theorem 1 assumes local Pauli noise on every qubit before and after each layer)."
- `WEIGHT_CUT_HEURISTIC`: "Weight-cut estimate: average-case heuristic (LOWESA / Schuster et al.), not a bound; the verdict uses the exact ledger."
- `THRESHOLDS_HEURISTIC`: "The thresholds g ≤ {g_thresh}, g ≥ {c}·√N and s_Q ≤ N/2 are heuristics, not theorems."
- `BANDWIDTH_NOTE`: "Small-bandwidth quantum kernels approach classical kernels (Shaydulin & Wild; Canatar et al.)."
- `KERNEL_SCOPE`: "Relative to the classical kernels compared, on this dataset. Not a statement about all classical methods."
- `ENGINEERED`: "This demo's labels were engineered to favour the quantum kernel. It demonstrates the test, not an advantage."
- `SHOT_MODEL`: "Shot noise is simulated (one seeded draw of the binomial model), not measured."
- `G_LAMBDA`: "The geometric difference depends on the regularisation λ (in units of the mean eigenvalue); the table shows the grid. The verdict uses λ_C = {λ}, the smallest λ at which the classical training error stays below {cond}, and holds at every λ on the grid."
- `PPE_INTERVALS`: "Above 20 qubits every kernel entry is a rigorous Pauli-propagation interval. Statistics are computed on the kept Gram matrix with a perturbation bound (‖ΔK‖ ≤ N·w_max = {…}); when that bound cannot separate the verdict, the result is inconclusive."

### 6.5 TS types, stores, components (binding names)

- **Types are written by F-2 in Wave 1** from §5 (no marked blocks, no extend-only edits by feature units): `src/types/trainability.ts` (`TrainabilityAnalysis += 'gradients_noisy' | 'noise_sweep' | 'scaling_noisy' | 'qkernel'`; `TrainabilityTabId += 'noise' | 'qkernel'`; `TrainabilitySettings.noise?`, `.qkernel?`; `TrainabilityResults.gradients_noisy? | noise_sweep? | scaling_noisy? | qkernel?`; request/response members for the two sync messages; `TrainabilityDiagnostic.code` widened to `TRN00x | QK00x`), `src/types/noise.ts` (`NoiseModelJson`, `NoiseChannelKind`, `NoiseSource`, `CalibrationSnapshot`, `NoisyGradientStatistics`, `NoiseSweep`), `src/types/qkernel.ts` (`QKernelSettings`, `QKernelDatasetRef`, `QKernelGramSummary`, `QKernelGeometry`, `QKernelVerdict`, `QKernelReport`), `src/types/noiseModel.ts` (schema-2 union: `noiseModelFileSchema` discriminated on `schema: 1 | 2`, `circuit_noise?: CircuitNoiseDef`, `circuitNoiseFor(model, strength)`, `noiseModelToYaml` writing schema 2; built-ins `ibm_like_2025`, `trapped_ion_like`, `depolarizing_1e-3`, `dephasing_only` as **circuit** presets hidden from campaigns), `src/types/hardware.ts` (`hardware_calibration` request / `hardware_calibration_result`).
- **FE-N** (Wave 4b): `src/services/noise/{client,view,copy,context,yaml,certificateSection}.ts` (+ tests; `client.ts` += `noisePresets()`, `calibrationToModel(req)`; `view.ts` pure: preset/file/calibration → `NoiseModelJson`, layout validation, age formatting, equal-accuracy cost derivation, the bound-to-quantity pairing), `src/stores/noiseStore.ts` (`noise: {choice, model, snapshot, status, error}`, `presets: AsyncState`, `setNoiseChoice`, `fetchCalibration`), `src/components/trainability/noise/{NoisePicker,CalibrationDrawer,NoiseModelCard,LayoutEditor}.tsx`, `src/components/trainability/analyses/noise/**` (tab + `index.ts` registration: picker entries, tab, VerdictRail card, certificate section, TargetBar noise slot), `src/components/experiments/NoiseModelLibrary.tsx` (circuit-noise chip), `src/components/trainability/features/noiseCommands.ts`, fixtures under `tests/e2e/fixtures/lab-project/noise/**` and `ansatz/t_gate_14.py`.
- **FE-K** (Wave 5a): `src/services/qkernel/{client,view,copy,datasets,context,certificateSection}.ts` (+ tests; `datasets.ts` discovers project files via `PlatformBridge.listDirectory` filtered to csv/npy/npz — the file itself is read by the kernel from `project_root`; the frontend never ships datasets over the socket), `src/stores/qkernelStore.ts` (`qkernelDataset`, stale detection), `src/components/trainability/analyses/qkernel/**` (tab + registration incl. the TargetBar data pill), `src/components/trainability/qkernel/{DatasetPicker,GramHeatmaps,GeometryTable,SpectrumChart,CvTable,BandwidthCurve,KernelVerdictCell}.tsx`, `src/services/trainability/{lintMarkers,useTrainabilityLint}.ts` (QK widening), `src/components/editor/codeActions/qkernelActions.ts` (QK001 quick-fix), `src/components/trainability/features/qkernelCommands.ts`.
- All built on `src/components/lab/` primitives (`LabHeatmap`, `LabLineChart`, `IntervalBars` in `charts.tsx`, added by F-3 before Wave 4); no hex colours; tabular-nums; chart accessible names; interval rendering through `intervals.ts` (`formatInterval`) — the spec 03 lint test that greps for `(lo + hi) / 2` applies.

---

## 7. Validation plan

### 7.1 Unit tests (kernel, `kernel/tests/`; owners per §9)

- `test_noise_model.py`: every channel kind parses and clamps; `from_json` rejects each malformed field with `noise_model_invalid` and the `path`; `scaled()` is immutable and clamps probabilities; `all_nonnegative`; presets load; `to_json`/`from_json` round-trip is identity; readout substitution of `Z0 Z1` with asymmetric readout equals the hand-expanded 4-term sum; T2 > 2T1 rejected.
- `test_noise_channels.py`: λ tables vs explicit 4×4 / 16×16 Pauli-transfer matrices built densely (`numpy.kron` of Kraus maps) for random (p_x, p_y, p_z), random 16-vectors, depolarizing 1q/2q, dephasing, and the thermal row (twirled AD+dephasing PTM diagonal) to 1e-12; the gate-error ↔ depolarizing conversions against the average-fidelity integral computed numerically over 2000 Haar states from explicit Kraus maps (never from the spec constants; tolerance 1e-3), asserting p = 3r/2 (1q) and p₁₅ = 5r/4 (2q); the gate-time decoherence policy (no extra thermal channel on a gate's own qubits; idle `layer_duration − own_gate_duration` on short gates in a long layer) on a hand-built two-layer circuit against the density matrix.
- `test_noise_schedule.py`: ASAP layering on hand-built circuits (depth equals the IR's known depth), idle channels placed only on untouched qubits, durations default + override, `idle: false` yields no idle channels.
- `test_noise_compile.py`: Clifford push conjugates channels: for random circuits (n ≤ 6) with fixed Cliffords interleaved, `ppe_noisy.expectation_bounds` (frontier unbounded, `min_weight_abs = 0`) equals `densitymatrix.expectation` under the **twirled** channels to 1e-10; **readout frame**: circuits with a trailing H/CX block and X- and Y-type observable terms plus asymmetric readout agree with the density matrix + explicit readout channel to 1e-10 (the substitution is applied before the Clifford push); **noise-aware finalisation**: trailing idle noise on a string that commutes with every rotation is damped (a test that reuses PRD 14's `_filter_exact` unchanged must fail); the `channel_step=None, finalize=None` path reproduces PRD 14's JSON bit-for-bit on the PRD 14 fixtures.
- `test_noise_ppe.py`: (a) variances: exact noisy PPE (no truncation) vs density-matrix Monte Carlo (2000 θ samples, bootstrap 95%) — the PPE value lies inside the CI on 50 seeded circuits n ≤ 6 (allowing ≤ 3 misses, binomial at 95%); (b) ledger: with forced truncation the interval always contains the untruncated value (500 seeded cases, 0 violations); (c) cost at equal accuracy: with truncation on (`min_weight_abs > 0`), the frontier needed to reach D ≤ ε with noise is ≤ without noise on every test circuit (precondition stated in the test: without truncation the frontiers are equal because channels with λ > 0 never remove a string); (d) `nonunital: exact` vs density matrix with **un-twirled** amplitude damping to 1e-10 at n ≤ 5 (expectations) and inside the CI (variances); (e) `twirl` vs un-twirled DM: observed expectation gap ≤ `twirl_gap_expectation` and observed variance gap ≤ `twirl_gap_variance` always; (f) negative-λ channels switch to two-sided intervals and stay correct; (g) cancellation mid-sweep → `cancelled` with a valid interval; (h) determinism (bit-identical JSON over two runs).
- `test_noise_densitymatrix.py`: DM simulator vs statevector at zero noise (1e-12); Kraus completeness; parameter-shift gradient vs finite differences (rel 1e-6) under noise; n > 10 refused.
- `test_noise_bounds.py`: `twirl_gap_expectation` ≥ observed expectation gap and `twirl_gap_variance` ≥ observed variance gap on the §7.2 corpus (both quantities); `weight_cut_estimate` is labelled heuristic, is `None` when λ_max = 1 (dephasing-only), and is **not** asserted against the discarded mass (only the rigorous ledger is asserted); the NIBP curve pins the Theorem 1 constants (√(8 ln 2), c = 1/(2 ln 2), q = max λ) by a direct formula test, is monotone, is ≥ the measured |∂C| maximum on Wang et al.'s model circuit when the placement matches (local depolarizing on every qubit before and after every layer, HEA, n = 4..6), and is `None` with the placement reason for gate-only noise on a subset of qubits.
- `test_noise_analyses.py`: result shapes (§5.2), `noiseless` block present, `frontier_ratio`, `noise_sweep` with 5 scales monotone non-increasing in `variance_mean_interval[1]` for depolarizing noise (a theorem for diagonal chains: each λ ≤ 1 — assert it), `scaling_noisy` reuses the PRD 14 fit and reaches `barren_plateau` on the NIBP model family (linear-depth HEA + depolarizing 1e-2, n = 2..7), `simulability_under_noise` wins at strong noise and `fails` at zero noise on a depth-12 all-to-all circuit at n = 10 with the frontier cap 20 000.
- `test_noise_calibration.py`: `calibration_to_noise_model` on a synthetic snapshot (all fields), on one missing T2 (idle `not_applicable` note for that qubit), on an uncoupled 2q gate (median + warning), on a bad layout (`noise_model_invalid`); bundled snapshots load and their manifest sha256 matches (an edited fixture fails CI); IBM provider `get_calibration` against a fake `backend.properties()` object; IonQ against a recorded JSON; providers without calibration return `None` and the manager raises `calibration_unavailable`.
- `test_noise_surrogate.py`: the `noisy_ppe` surrogate implements spec 01's `Surrogate` protocol, is `not_applicable` without a model, has claim class `"N"`, and its win is excluded from the noiseless simulability axis (test uses spec 01's `quantumness_verdict` when importable, else `importorskip`).
- `test_qkernel_featuremap.py`: declaration precedence (request > `nuclei_model` > `nuclei_data_params`), binding order, weights source, unknown names → `invalid_request`.
- `test_qkernel_dataset.py`: csv with/without header, `y_column`, npy/npz, inline; NaN row named; path traversal (`../`, symlink out of root, absolute path) → `dataset_path_outside_project`; size caps; `allow_pickle=False` enforced (a pickled .npy is rejected); standardisation is reversible and recorded; sha256 stable.
- `test_qkernel_gram.py`: fidelity Gram vs a naive loop (1e-12); projected Gram statevector vs PPE route on a PPE-class feature map at n ≤ 8: PPE intervals **contain** the statevector values (0 violations over 100 seeds) and are informative at the default frontier; PSD (min eigenvalue ≥ −1e-10·N); `shot_noise` binomial draw determinism; n > 20 fidelity → `not_applicable`.
- `test_qkernel_geometry.py`: g(K‖K) = 1 at every λ → 0; g_λ is monotonically non-increasing in λ (asserted); g(K_C‖K_Q) ≥ 1 is **not** a theorem — assert instead the paper's bound chain on synthetic data: s_C(N) ≤ g² s_Q(N) at λ → 0 (Huang Thm. 1 relation) for 200 random PSD pairs; the λ_C selection honours the training-error condition; `model_complexity` of a kernel that interpolates y is ≤ N; spectrum sorted, d_eff monotone decreasing in λ; alignment in [−1, 1] with ‖y‖² normalisation; the perturbation bound on g from a synthetic entrywise width contains the exact g on 200 random pairs; the `huang_engineered` construction yields s_Q = 1 and s_C = g² (1e-8); regularisation sensitivity test documents how g moves across the λ grid on `two_moons` (snapshot).
- `test_qkernel_concentration.py`: σ_K and the shot-floor ratio on a known Gram; the n-sweep fit reaches `concentrating_exponentially` on a Haar-like deep feature map (n = 2..7, fidelity kernel) and `polynomial`/`inconclusive` on a single-layer product encoding.
- `test_qkernel_krr.py`: KRR solves the normal equations (vs `numpy.linalg.lstsq`), nested CV: inner and outer folds disjoint and seeded, hyper-parameters never selected on an outer test fold (assert by tracing), classification error on linearly separable data < 0.05 with the linear kernel, the paired per-example bootstrap CI contains the mean paired difference and the Nadeau–Bengio p-value is computed; one eigendecomposition per kernel (call count asserted).
- `test_qkernel_verdict.py`: every branch of §3.5's flow chart via synthetic reports, incl. `classical_kernel_matches_geometric_power` requiring the conclusion at every λ on the grid, the s_Q < s_C label comparison gating `possible_advantage`, and thresholds labelled heuristic in `scope`; `scope` and `claim` snapshot; `measured.winner_on_split` never contradicts the paired CV; `inconclusive` for N < 32, uninformative grams, perturbation bound spanning the threshold, cancelled stages.
- `test_qkernel_lint.py`: each QK rule fires on a crafted circuit and not on its fixed version; rules run inside the lint budget; `summary.qkernel` present; the existing `test_trainability_lint.py` still passes (no TRN change).
- `test_qkernel_analysis.py`: full orchestrator on `two_moons` with a 2-qubit map streams every stage partial; cancel between stages keeps finished stages; per-stage failure (inject a classical kernel that raises) is recorded in `notes` and the verdict is `inconclusive`; determinism.
- `test_trainability_settings.py` (extend): clamping of every `noise`/`qkernel` field, unknown keys → `invalid_request` with path; `test_trainability_handlers.py` (extend, via the F-1 sync registry): the two sync messages with/without `request_id`, `lab_capabilities` listing the noise analyses, `trainability_start` with an unresolved `{"calibration": …}` model → `noise_model_invalid`, `trainability_calibration_to_model` with a hanging fake provider → `calibration_unavailable` after the 20 s timeout (patched to 0.2 s); `test_trainability_jobs_integration.py` (extend): a job with `["gradients", "gradients_noisy", "noise_sweep"]` streams the noisy partials; a `qkernel` job on the fixture map streams stage partials; `test_trainability_provenance.py` (extend): `1.4`, `noise_fingerprint`, `qkernel_fingerprint`; `test_server_hardware_calibration.py`: the `hardware_calibration` branch with a fake manager.
- `test_docs_fixtures.py` / `test_docs_lab_fixtures.py` replay the new docs fixtures automatically.

### 7.2 Physics validation (explicit tolerances; `_trainability_physics_helpers.py` extended, marker `physics`)

| Check | n | Tolerance / assertion |
|---|---|---|
| Noisy expectation, twirled channels: PPE (untruncated) vs density matrix | 2–8, 200 seeded circuits (mixed gate set, random depolarizing/dephasing/thermal channels, readout) | 1e-10 · ‖O‖₁ |
| Noisy expectation, **exact non-unital**: PPE vs DM with un-twirled amplitude damping | 2–5, 100 circuits | 1e-10 · ‖O‖₁ |
| Twirl gap: \|⟨O⟩_exact − ⟨O⟩_twirled\| vs `twirl_gap_expectation` **and** \|Var_exact − Var_twirled\| vs `twirl_gap_variance` | 2–6 | gap ≤ bound always for both; the ratios are tabulated in the docs (expected ≪ 1) |
| Noisy gradient variance: PPE vs DM Monte Carlo (2000 θ, bootstrap 95%) | 2–6, 50 circuits | PPE inside the CI in ≥ 47/50 |
| Truncation ledger under noise | 4–10, 500 cases | 0 violations |
| NIBP reproduction: linear-depth HEA with local depolarizing p ∈ {1e-3, 1e-2}, local Z observable | 2–7 | noisy `scaling_noisy` verdict `barren_plateau` at p = 1e-2 with β CI excluding 0; the fitted decay rate per layer within a factor 2 of −ln(1 − 4p/3)·(weight growth) — recorded, not asserted beyond the factor-2 check |
| Noise lowers cost at equal accuracy: frontier needed for D ≤ ε, noisy vs noiseless (truncation on) | 8–12 deep circuits | noisy ≤ noiseless on every circuit; both D values recorded; median ratio tabulated |
| Readout in the measurement frame: trailing H/CX block + X/Y observable terms + asymmetric readout, PPE vs DM | 2–6, 100 circuits | 1e-10 · ‖O‖₁ |
| Gate-error conversion: Haar-averaged fidelity of the explicit 1q/2q Kraus channels | — | p = 3r/2, p₁₅ = 5r/4 to 1e-6 |
| Projected-kernel PPE intervals contain the statevector Gram | 4–8, 100 feature maps | 0 violations |
| Huang relation s_C ≤ g² s_Q (λ → 0) | synthetic N = 64 | holds on 200 random PSD pairs (float tolerance 1e-8 relative) |
| `huang_engineered` demo | n = 4, N = 200 | verdict `possible_advantage_on_this_data` and CV quantum < classical on the split (sanity of the test, with the ENGINEERED label asserted in the report) |
| `two_moons` with a 2-qubit single-layer map vs RBF | n = 2 | verdict `classical_kernel_matches_geometric_power` (g ≤ 1 + 3/√N at every λ on the grid; training-error condition met) |

### 7.3 Property tests (seeded loops; `hypothesis` via `importorskip` when present)

- Channel composition: applying two Pauli channels in sequence equals one channel with the convolved distribution (λ multiply).
- Any Pauli channel never increases Σ|w| of a chain (ℓ1 contraction) — the ledger's premise.
- `NoiseModel.scaled(a).scaled(b) == scaled(a·b)` up to clamping; `from_json(to_json(m)) == m`.
- Gram matrices are symmetric PSD for every kernel on random data; normalisation Tr K = N after `classical.grams`.
- `geometric_difference` is invariant to a simultaneous positive rescaling of both kernels after normalisation; `model_complexity` is invariant to permuting (K, y) jointly.
- Verdict monotonicity: increasing g_min with everything else fixed never moves the verdict from `possible_advantage` to `classical_kernels_suffice`.

### 7.4 Kernel integration tests (real subprocess jobs)

- Noise job on `tests/e2e/fixtures/lab-project/ansatz/hardware_efficient.py` with the `ibm_like_2025` preset: `started → progress → partial(gradients) → partial(gradients_noisy) → partial(noise_sweep) → result(complete)`; cancel mid-sweep → `cancelled` with the gradients partials kept; busy limit shared with other Lab managers; owner release kills the worker.
- `trainability_calibration_to_model` with the provider not connected and a bundled snapshot present → model with `source.kind = "calibration"`, `source.source = "bundled"`; without a snapshot → `calibration_unavailable`.
- qkernel job on `models/feature_map_2d.py` with `{"demo": "two_moons"}` and with `{"path": "data/moons.csv", "project_root": <fixture root>}`; with `{"path": "../etc/passwd"}` → `dataset_path_outside_project` as an `analysis_error` for `qkernel`, job otherwise completes.
- Determinism: identical requests twice → identical `results` minus `elapsed_ms`.
- Minimal-venv job (`kernel-tests.yml: pytest-minimal-venv`): add `kernel/tests/test_noise_*.py kernel/tests/test_qkernel_*.py kernel/tests/test_server_hardware_calibration.py`; these must pass with numpy + qiskit + cirq only (no scipy import anywhere in the new packages; `qiskit_ibm_runtime` absent → IBM calibration test uses the fake).

### 7.5 Frontend tests (Vitest + jsdom)

- `noiseModel.test.ts` (extend): schema-2 parse/serialise round trip, schema-1 files unchanged, `circuitNoiseFor`, QEC library hides circuit-only presets from campaigns.
- `noise.test.ts`: preset/file/calibration → request JSON; layout validation; age formatting; "kernel too old" mapping in `client.test.ts` for both sync messages.
- `qkernel.test.ts`: view derivation for every verdict kind, heatmap scale shared across kernels, g table with λ selector, interval rendering through `formatInterval` only (the grep lint test).
- Store tests: noise choice lifecycle, calibration fetch states (loading/ready/error/unavailable), stale detection on dataset file change, tab registration.
- Component render tests for every state in §6.3 (seeded fixtures), honesty strings present whenever the corresponding card renders (`TWIRL_NOTE` with any noisy number, `KERNEL_SCOPE` with any verdict, `ENGINEERED` with the demo), `VerdictRail` with both cards, `TargetBar` picker + dataset pill, `CalibrationDrawer` layout editor validation.
- `certificate.test.ts` snapshot with both sections; `contextFromStores.test.tsx` for the two Dirac blocks (Research only; absent in any other mode).

### 7.6 Playwright e2e (`tests/e2e/noise.spec.ts`, `tests/e2e/qkernel.spec.ts`)

Stub-kernel pattern of `trainability.spec.ts` (`?e2eProject=lab-project&workspace=research&labKernel=…&labKernelToken=…`), fixtures from `src/services/trainability/fixtures.ts` answering every v1.4 message. Fixture files added to `tests/e2e/fixtures/lab-project/`: `noise/ibm_torino-2026-10-12.noise.yaml` (schema 2), `ansatz/t_gate_14.py` (FE-N), `models/feature_map_2d.py`, `data/moons.csv` (FE-K), `experiments/` unchanged. The fixture registry is glob-based (`import.meta.glob`, G2), so no registry file is edited.

1. **Noise, preset path**: open `hardware_efficient.py` → TargetBar Noise → preset `ibm_like_2025` → tick the three noise analyses → Run → progress rows → Noise tab shows noiseless vs noisy interval bars, the sweep curve with the dashed reference, the equal-accuracy cost card → VerdictRail *Under noise* pill reads exactly "No BP under noise model" (and the page contains no "trainable on" / "Trainable under noise") → Export → the fixture bridge receives `.trainability.json` containing `noise` and `.md` containing "calibration fetched".
2. **Noise, device path**: Noise → *Device…* → drawer lists `ibm / ibm_torino` (stub `hardware_connected_providers` + `hardware_list_backends`) → Fetch → stub `trainability_noise_model` → preview shows `fetched_at` and the layout editor → Apply → pill shows the date → Save as YAML → the bridge records `noise/ibm_torino-<date>.noise.yaml` with `schema: 2`.
3. **Noise, unavailable**: stub returns `calibration_unavailable` → drawer shows the reason and the bundled fallback; choosing it labels the pill "bundled snapshot".
4. **Noise, not applicable**: fixture `ansatz/t_gate_14.py` (a `T` gate at n = 14; owned by FE-N) → the Noise tab's `not applicable` card with the PPE/DM reason; other analyses still render.
5. **Noise, cancel**: cancel during the sweep → banner, gradients kept, verdict pill "Inconclusive".
6. **Kernel, happy path**: open `models/feature_map_2d.py` → dataset pill shows `data/moons.csv` → tick *Kernel power of data* → Run → stage partials fill heatmaps, geometry table, CV table, bandwidth curve → verdict cell "Classical kernel … matches the quantum kernel's geometric power…" with the scope sentence and the heuristic-thresholds line → Export includes `qkernel`.
7. **Kernel, demo + engineered label**: dataset picker → `huang_engineered` → Run → verdict "Possible advantage on this data" **and** the `ENGINEERED` line visible.
8. **Kernel, no data params**: open `hardware_efficient.py` → Kernel tab shows the snippet state → Insert → file contains `nuclei_data_params` → QK lint marker path exercised (stub lint returns QK002 → marker appears in the editor gutter).
9. **Kernel, path error**: stub answers `dataset_path_outside_project` → error card names the path; job still completes other analyses.
10. **Old kernel**: stub errors on `trainability_noise_presets` → banner; Run still works for PRD 14 analyses.
11. **Palette**: "Run under device noise" from the editor lands on the Lab with the noise analyses ticked and the picker focused when no model is set.
Screenshots at 1440/1024 light/dark for both tabs. Manual real-kernel release gate: scenarios 1 and 6 against the packaged app's managed venv, screenshots attached to the PR.

### 7.7 CI

- `kernel-tests.yml`: new globs in both jobs; `physics` marker loops ≤ 120 s total (the 500-case ledger loops use a seeded 50-case subset in CI; full under `NUCLEI_SLOW_TESTS=1`); `test_discovery_optional_deps.py` extended to assert `kernel.noise` and `kernel.qkernel` import with `scipy`, `stim`, `qiskit_ibm_runtime` blocked.
- Playwright job: the two specs added to the lab project list; `qec-frontend.yml` unchanged.
- A nightly optional job may run the IBM `get_calibration` against a recorded `qiskit_ibm_runtime` fake properties object (no network in CI, ever).

---

## 8. Acceptance checklist

Idea 3
- [ ] `trainability_start` with `["gradients", "gradients_noisy", "noise_sweep"]` and the `ibm_like_2025` preset on `hardware_efficient.py` returns rigorous noisy intervals, a `noiseless` block, `frontier_ratio < 1`, and the §2.9 claim text in ≤ 30 s on the dev container.
- [ ] Noisy PPE agrees with the density-matrix oracle to 1e-10 (twirled; and un-twirled with `nonunital: exact`) and lies inside the Monte-Carlo CI for variances on the §7.2 corpus; the ledger has zero violations.
- [ ] The twirl approximation is labelled everywhere a noisy number appears (kernel JSON `nonunital`, UI `TWIRL_NOTE`, certificate); `twirl_gap_variance` is reported next to every noisy variance and `twirl_gap_expectation` next to every noisy expectation (never crossed); the observed gaps never exceed them in tests.
- [ ] No certificate, pill, claim or e2e assertion contains "trainable on" next to a device name or "trainable under noise"; the positive pill is "No BP under noise model" (snapshot test).
- [ ] Gate-error conversions are p = 3r/2 (1q) and p = 5r/4 (2q), tested against Haar-averaged explicit Kraus maps; the r ↔ p table is shown in the UI and the certificate.
- [ ] Readout substitution is applied in the measurement frame before the Clifford push and tested with trailing H/CX blocks and X/Y observables; finalised strings carry the suffix product of remaining channels.
- [ ] `not_modelled` is shown in the UI and written to the certificate.
- [ ] Live calibration works for IBM (recorded fake in CI) and IonQ (recorded JSON); every other provider answers `calibration_unavailable` honestly; the bundled snapshot path works offline and is labelled "bundled, not live".
- [ ] A saved `noise/*.noise.yaml` (schema 2) round-trips through the library and the TargetBar picker; schema-1 QEC files are unaffected (existing tests green).
- [ ] `scaling_noisy` reproduces an NIBP verdict on the Wang et al. model family; the noise sweep's reference line implements Theorem 1's exact constants, is shown only when the noise placement matches, and is never used as the user's number.
- [ ] The `noisy_ppe` surrogate registers through `SUITE_EXTENSIONS`, is excluded from the noiseless simulability axis, and the Quantumness tab shows its line as "noisy cost".
- [ ] Every §6.3 noise state has a jsdom test; e2e scenarios 1–5, 10, 11 pass; palette commands exist.

Idea 4
- [ ] On `models/feature_map_2d.py` + `data/moons.csv` the full qkernel pipeline streams every stage and ends with a verdict whose `scope` names the compared kernels, N and λ; the claim text matches §3.8 (snapshot).
- [ ] Fidelity kernels are refused above 20 qubits with the reason; projected kernels run via PPE above 20 qubits with interval-containing entries (0 violations on the corpus) and go `inconclusive` when intervals are uninformative.
- [ ] g is reported at the λ grid (mean-eigenvalue units); the verdict names λ_C and its training-error condition, holds at every λ for the "matches" case, compares s_Q vs s_C on the labels before "possible advantage", labels its thresholds heuristic, and `measured.winner_on_split` is consistent with the paired nested-CV difference.
- [ ] Datasets outside the project, oversized, pickled or non-numeric are rejected with the specified codes and never loaded.
- [ ] Demo datasets are deterministic; the engineered demo carries the `ENGINEERED` label in the report and the UI.
- [ ] QK001–QK006 fire on crafted circuits inside the lint budget and reach the editor as markers; QK001's quick-fix inserts the declaration.
- [ ] Every §6.3 kernel state has a jsdom test; e2e scenarios 6–9 pass.

Cross-cutting
- [ ] No new required dependency; `kernel/requirements.txt` unchanged; minimal-venv CI green with every new test module; no `scipy` import in `kernel/noise` or `kernel/qkernel`.
- [ ] Provenance carries `nuclei_protocol: "1.4"`, `noise_fingerprint`, `qkernel_fingerprint`, the calibration `sha256`/`fetched_at` and the dataset `sha256`; bit-for-bit reproducibility test passes for all four analyses.
- [ ] Docs: `trainability-lab.mdx` (Noise + Kernel sections), new `research/noise-aware-trainability.mdx` and `research/quantum-kernels.mdx`, `messages-lab.mdx` (v1.4 sections with replayed fixtures), `messages-hardware.mdx` (`hardware_calibration`), protocol changelog, CLAUDE.md "Kernel Protocol v1.4".

---

## 9. Implementation breakdown — units and file ownership

**The master plan's §7 tables are the only ownership record.** This section maps the spec's logical units onto master units and names exactly the master's files; no "marked blocks", no "extend-only" edits of files another unit owns, no merge order. `scripts/check-wave-ownership.py` fails the plan if a file below is assigned elsewhere by the master.

| Spec unit | Master unit (wave) | Scope | Files (verbatim from master §7) |
|---|---|---|---|
| N1 Noise model core | **N1** (Wave 1a) | model, channels (incl. the frozen r ↔ p table), schedule (gate-time policy), readout substitution in the measurement frame, density-matrix oracle, bounds (two twirl bounds, weight-cut estimate, NIBP Thm. 1) | `kernel/noise/{__init__,model,channels,schedule,densitymatrix,bounds}.py`, `kernel/tests/test_noise_{model,channels,schedule,densitymatrix,bounds}.py`, `kernel/tests/_noise_helpers.py` |
| N2 Noisy PPE | **N2** (Wave 2a) | noisy compile (readout first, then Clifford frame conjugating channels), the `channel_step`/`finalize` hooks in `ppe_core` (default-None, byte-identical), noise-aware finalisation, non-unital exact mode | `kernel/noise/{compile,ppe_noisy}.py`, `kernel/trainability/ppe_core.py` (hooks + exports, extend-only, gated by the PRD 14 suites), `kernel/tests/test_noise_{compile,ppe,physics}.py` |
| N3 Calibration + N4 Noise analyses | **N3+N4** (Wave 3a) | providers' `get_calibration` (through `get_manager()`), bundled snapshots + script, `calibration_to_noise_model`, analyses incl. the equal-accuracy cost comparison, `scaling.variance_fn`, `noisy_ppe` surrogate in `SUITE_EXTENSIONS` (reads `ctx.noise_model`), presets/calibration sync handlers (20 s timeout), settings section, docs fixtures | `kernel/noise/{calibration,analyses,surrogate}.py`, `kernel/noise/bundled/**`, `scripts/snapshot_calibration.py`, `kernel/hardware/{ibm_provider,ionq_provider}.py` (extend-only), `kernel/trainability/{scaling,analyses_noise}.py`, `kernel/surrogates/registry.py` (`SUITE_EXTENSIONS` entry line), `kernel/tests/test_noise_{calibration,analyses,surrogate}.py`, `kernel/tests/test_server_hardware_calibration.py`, `kernel/tests/hardware/fixtures/calibration/**`, docs fixtures |
| K1 Kernel math | **K1** (Wave 2b) | feature map (declarations-only resolver), grams (explicit 512 MiB guard, PPE route N ≤ 128, program compiled once, perturbation bound), classical kernels, geometry (regularised Huang definition, λ_C selection, eigh once per kernel), concentration, nested paired KRR CV, bandwidth, verdict (renamed kinds, heuristic labels, s_Q vs s_C) | `kernel/qkernel/{__init__,featuremap,gram,classical,geometry,concentration,krr,bandwidth,verdict}.py`, `kernel/tests/test_qkernel_{featuremap,gram,geometry,concentration,krr,verdict,physics}.py`, `kernel/tests/_qkernel_helpers.py` |
| K2 Datasets + lint + demo, K3 analysis + protocol | **K2+K3** (Wave 3a) | demo data (eigenvector-engineered `huang_engineered`), QK rules, lint hook, orchestrator, settings section, analysis registration (per-stage partials through the F-1 partial emitter), docs fixtures | `kernel/qkernel/{demo,lint,analysis}.py`, `kernel/qkernel/dataset.py` (re-export of the F-1 loader), `kernel/trainability/{lint,analyses_qkernel}.py`, `kernel/tests/test_qkernel_{demo,lint,analysis}.py`, docs fixtures |
| F1 Noise frontend | **FE-N** (Wave 4b) | §6.5 FE-N list | `src/components/trainability/analyses/noise/**`, `src/components/trainability/noise/{NoisePicker,CalibrationDrawer,NoiseModelCard,LayoutEditor}.tsx`, `src/services/noise/{client,view,copy,context,yaml,certificateSection}.ts` (+ tests), `src/stores/noiseStore.ts`, `src/components/experiments/NoiseModelLibrary.tsx` (circuit-noise chip), `src/components/trainability/features/noiseCommands.ts`, `tests/e2e/noise.spec.ts`, `tests/e2e/real/noise.real.spec.ts`, `tests/e2e/fixtures/lab-project/noise/**`, `tests/e2e/fixtures/lab-project/ansatz/t_gate_14.py` |
| F2 Kernel frontend | **FE-K** (Wave 5a) | §6.5 FE-K list | `src/components/trainability/analyses/qkernel/**`, `src/components/trainability/qkernel/{DatasetPicker,GramHeatmaps,GeometryTable,SpectrumChart,CvTable,BandwidthCurve,KernelVerdictCell}.tsx`, `src/services/qkernel/{client,view,copy,datasets,context,certificateSection}.ts` (+ tests), `src/stores/qkernelStore.ts`, `src/services/trainability/{lintMarkers,useTrainabilityLint}.ts`, `src/components/editor/codeActions/qkernelActions.ts`, `src/components/trainability/features/qkernelCommands.ts`, `tests/e2e/qkernel.spec.ts`, `tests/e2e/real/qkernel.real.spec.ts`, `tests/e2e/fixtures/lab-project/{models/feature_map_2d.py,data/moons.csv}` |
| L Lead | **F-1 / F-2 / F-3** (Wave 1) and **X** (Wave 5b) | registries, types, `hardware_calibration` server branch, `get_manager()`, dataset loader with header checks, docs, CI | per master §7 |

Dependencies: N2 builds against N1's frozen dataclasses; N3+N4 need N1, N2 and the F-1 registries; K2+K3 need K1 and the F-1 loader; FE-N/FE-K build against `src/services/{noise,qkernel}/fixtures.ts` (F-2) first. Estimated size unchanged (N1 ≈ 1 400 LOC incl. tests; N2 ≈ 1 000; N3+N4 ≈ 1 700; K1 ≈ 1 700; K2+K3 ≈ 1 300; FE-N ≈ 1 600; FE-K ≈ 1 500).

---

## 10. Cross-spec interfaces

**Provides**
- `kernel.noise.analyses.gradient_variances_noisy(circuit, observable, noise_model, *, method="auto", max_frontier, time_budget_s, min_weight_abs, progress, cancel) -> dict` with the `ppe_gradient_variances` shape plus `nonunital`, `bounds`, `noiseless` — the exact name **spec 04 §9** asks for; `NoiseModel.from_json` accepts the wire model so `trainability_verify` can pass `settings.noise.model` through unchanged.
- `kernel.noise.surrogate.NoisyPpeSurrogate` (id `noisy_ppe`, claim class `"N"`, order after the core suite) registered in spec 01's `SUITE_EXTENSIONS`; reports `exportable: null` (a noisy surrogate is not a deployable classical model in spec 03's sense).
- `kernel.noise.model.NoiseModel` and `apply`-style transforms are **not** circuit rewrites; spec 03's "run before/after under noise" (its §10) can call `gradient_variances_noisy` directly on each compiled IR — no noisy IR is introduced, so spec 01's `ParamCircuit`-stays-noiseless guarantee holds (the suite's applicability functions never see noise).
- `kernel.qkernel.dataset.load(spec, *, project_root, seed)` with path validation, `allow_pickle=False` and the size caps — offered to spec 03's `kernel/deploy/dataset.py` as the single loader (see **Needs**).
- `kernel.qkernel.gram.projected_gram` PPE route (local expectations with intervals) — reusable by spec 03's Route B / shadow comparisons if wanted.
- `hardware_calibration` and `CalibrationSnapshot` — reusable by PRD 11 (fleet benchmarking) as the per-backend calibration record.

**Needs**
- From **spec 01**: `SUITE_EXTENSIONS: tuple[Surrogate, ...]` in `kernel/surrogates/registry.py` and the `Surrogate` / `SurrogateContext` / `SurrogateReport` contracts (§3.2 there); **one rule in `quantumness.py`**: claim class `"N"` reports are listed but excluded from the noiseless `simulability` axis, and surfaced as `quantumness.noise: {"noisy_cost_simulable": bool, "surrogate": "noisy_ppe", "model": ...} | null`. Until spec 01 lands, N4 ships the surrogate class with an `importorskip`-guarded test and no registration.
- From **F-1 (master)**: the single declaration reader `kernel/trainability/declarations.py` (precedence request > `nuclei_model.features` > `nuclei_data_params`) — K1's `featuremap.resolve` depends on it **only** (no fallback reader, no dependency on `kernel/deploy/model.py`, which lands a wave later); the dataset loader home is `kernel/trainability/dataset.py` (master F-1); `kernel/qkernel/dataset.py` and spec 03's `kernel/deploy/dataset.py` re-export it (the signature above is the contract); `kernel/lab_routes.py` and the shared `lab_proc` job counter (this spec adds no new prefix: everything is `trainability_*` plus one `hardware_*` message); `labModes.ts` (no new mode).
- From **spec 04**: nothing. (Spec 04's verifier consumes `gradient_variances_noisy` and adds its own verdict line.)
- **Shared files** are handled by the master plan's registries (Wave 1): the only remaining extend-only edits in this spec are `kernel/trainability/ppe_core.py` (N2: the two default-None hooks + exports), `kernel/trainability/scaling.py` (`variance_fn`, N3+N4) and `kernel/trainability/lint.py` (6-line hook, K2+K3), each owned by exactly one unit in its wave.

---

## 11. Risks and open questions

**Risks**
1. **The twirl is the wrong model exactly where it matters.** Mele et al.'s result says non-unital noise is what *removes* barren plateaus; a twirled model can report `barren_plateau` where the device would not (and vice versa). Mitigation: `nonunital: "exact"` is implemented in v1 (not deferred), the gap bound is shown with every twirled number, the density-matrix check is one click at n ≤ 10, and the certificate claim names the model. Open: make `exact` the default when the model has thermal channels and the budget allows (decide after measuring the frontier growth on the corpus; N2 reports).
2. **Calibration → channel conversion constants.** The first draft had the 1q constant wrong (p = 2r instead of 3r/2); the frozen table in §4.2, the Haar-integration test from explicit Kraus maps and REV-P's sign-off are the defence; the UI and the certificate show the conversion rule.
3. **Provider calibration APIs are uneven.** IBM exposes everything; IonQ exposes device averages; Quantinuum/Braket/Azure/Google expose little or nothing through this client. The product must not pretend: "unavailable" + bundled snapshot + user YAML. Bundled snapshots age — the manifest date is in every certificate.
4. **Readout expansion is exponential in observable weight.** Capped at weight 16 per term; global observables beyond that get `not_applicable` for the readout part (noise still applied) with a note.
5. **g is λ-sensitive and N-sensitive.** Reporting a grid and a slack is honest but may read as hedging. The measured CV error is always shown next to it so the user has a hard number.
6. **Fidelity kernels above 20 qubits** are simply not computable here; users may expect them. The projected kernel via PPE is the honest substitute and the tab explains Huang et al.'s own argument for projected kernels.
7. **Gram O(N³) at N = 4096** can take a minute per kernel per λ; the UI shows the estimate before Run and the orchestrator does geometry at the verdict λ first, the rest of the grid if time remains.
8. **Shared-file contention** with specs 01/03/04 is removed by the Wave 1 registries (master §2.1): no marked blocks and no merge order remain in this spec.
9. **`ppe_core` privates.** N2 depends on PRD 14's private chain primitives; renaming them public is a one-line change but must not alter behaviour (PRD 14 suites gate it).

**Open questions (decide before N4 / K3 ship)**
1. Default for `nonunital` when thermal channels exist: `twirl` (cheap, stated) or `exact` (rigorous, costlier)? Proposed: `twirl` by default with the one-click `exact` and a hint when `twirl_gap_variance > 10 % of the noiseless variance`.
2. Should `scaling_noisy` scale the noise with n (fixed per-gate rates, more gates → more noise — the NIBP setting) only, or also offer "fixed total noise budget"? Proposed: per-gate rates only in v1 (that is the physical case).
3. The g verdict thresholds (1 + 3/√N; g ≥ c·√N with c = 0.25; s_Q ≤ N/2) are our heuristics, not Huang et al.'s theorems and not from their text. Exposed in settings and labelled in the scope sentence (done); revisit after use.
4. Fidelity-kernel entries from **hardware** (the user ran the inversion test on a QPU): accept a `{"gram_json": path}` dataset form so measured Gram matrices can go through §3.4–3.6? Cheap (K2) and useful; proposed v1.1.
5. Should the `noisy_ppe` surrogate also exist as a Goldilocks (spec 01) descriptor ("resists classically *even with device noise*")? Interesting but it inverts the Goldilocks objective; defer to a PRD 15 addendum.
6. Which `qiskit_ibm_runtime` channel/instance conventions does `get_calibration` assume? Follow `ibm_provider.connect`'s; verify against the current SDK before N3 ships (`backend.properties()` is being replaced by `backend.target` in recent SDKs [verify]; N3 supports both).
7. Does the bundled `ibm_torino`-style snapshot need an explicit licence note for redistributing calibration data? Lead to check IBM's terms before committing a real snapshot; otherwise ship a synthetic "ibm_like_2025" snapshot clearly labelled synthetic.

---

## 12. References (verified 2026-10-19 unless marked)

1. S. Wang, E. Fontana, M. Cerezo, K. Sharma, A. Sone, L. Cincio, P. J. Coles, "Noise-induced barren plateaus in variational quantum algorithms", Nature Communications 12, 6961 (2021); doi:10.1038/s41467-021-27045-6; arXiv:2007.14384.
2. E. Fontana, M. S. Rudolph, R. Duncan, I. Rungger, C. Cîrstoiu, "Classical simulations of noisy variational quantum circuits", npj Quantum Information (2025), doi:10.1038/s41534-024-00955-1; arXiv:2306.05400 (LOWESA).
3. T. Schuster, C. Yin, X. Gao, N. Y. Yao, "A polynomial-time classical algorithm for noisy quantum circuits", Phys. Rev. X 15, 041018 (2025); arXiv:2407.12768.
4. A. A. Mele, A. Angrisani, S. Ghosh, S. Khatri, J. Eisert, D. Stilck França, Y. Quek, "Noise-induced shallow circuits and absence of barren plateaus", arXiv:2403.13927; Nature Physics (2026), doi:10.1038/s41567-026-03245-z.
5. D. Stilck França, R. García-Patrón, "Limitations of optimization algorithms on noisy quantum devices", Nature Physics 17, 1221–1227 (2021); arXiv:2009.05532.
6. J. J. Wallman, J. Emerson, "Noise tailoring for scalable quantum computation via randomized compiling", Phys. Rev. A 94, 052325 (2016); arXiv:1512.01098.
7. H.-Y. Huang, M. Broughton, M. Mohseni, R. Babbush, S. Boixo, H. Neven, J. R. McClean, "Power of data in quantum machine learning", Nature Communications 12, 2631 (2021); doi:10.1038/s41467-021-22539-9; arXiv:2011.01938.
8. S. Thanasilp, S. Wang, M. Cerezo, Z. Holmes, "Exponential concentration in quantum kernel methods", Nature Communications 15, 5200 (2024), doi:10.1038/s41467-024-49287-w; arXiv:2208.11060.
9. R. Shaydulin, S. M. Wild, "Importance of kernel bandwidth in quantum machine learning", arXiv:2111.05451; Phys. Rev. A 106, 042407 (2022).
10. A. Canatar, E. Peters, C. Pehlevan, S. M. Wild, R. Shaydulin, "Bandwidth enables generalization in quantum kernel models", Transactions on Machine Learning Research (2023); arXiv:2206.06686.
11. J. M. Kübler, S. Buchholz, B. Schölkopf, "The inductive bias of quantum kernels", NeurIPS 2021; arXiv:2106.03747.
12. T. Hubregtsen, D. Wierichs, E. Gil-Fuster, P.-J. H. S. Derks, P. K. Faehrmann, J. J. Meyer, "Training quantum embedding kernels on near-term quantum computers", Phys. Rev. A 106, 042431 (2022); arXiv:2105.02276.
13. M. Schuld, R. Sweke, J. J. Meyer, "Effect of data encoding on the expressive power of variational quantum-machine-learning models", Phys. Rev. A 103, 032430 (2021); arXiv:2008.08605.
14. M. Cerezo, A. Sone, T. Volkoff, L. Cincio, P. J. Coles, "Cost function dependent barren plateaus in shallow parametrized quantum circuits", Nature Communications 12, 1791 (2021) — already cited by `lint.py`.
15. M. Ragone et al., "A Lie algebraic theory of barren plateaus for deep parameterized quantum circuits", Nature Communications 15, 7172 (2024) — PRD 14.
16. A. Angrisani, A. Schmidhuber, M. S. Rudolph, M. Cerezo, Z. Holmes, H.-Y. Huang, "Classically estimating observables of noiseless quantum circuits", arXiv:2409.01706 — spec 01.
17. M. A. Nielsen, "A simple formula for the average gate fidelity of a quantum dynamical operation", Phys. Lett. A 303, 249 (2002) — the infidelity ↔ depolarizing conversion (F_avg = (d·F_pro + 1)/(d + 1)).
20. E. R. Anschuetz, B. T. Kiani, "Quantum variational algorithms are swamped with traps", Nature Communications 13, 7760 (2022); arXiv:2205.05786 — absence of BPs ≠ trainability.
21. C. Nadeau, Y. Bengio, "Inference for the generalization error", Machine Learning 52, 239–281 (2003) — corrected resampled t-test for CV comparisons.
18. F. Di Marcantonio, M. Incudini, D. Tezza, M. Grossi, "Quantum Advantage Seeker with Kernels (QuASK): a software framework to speed up the research in quantum machine learning", Quantum Mach. Intell. 5, 20 (2023) [verify] — prior-art library for g and projected kernels.
19. Y. Liu, S. Arunachalam, K. Temme, "A rigorous and robust quantum speed-up in supervised machine learning", Nature Physics 17, 1013–1017 (2021) [verify pages] — cited in the docs page only, as the existence proof the kernel verdict must not be confused with.
