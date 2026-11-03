# QML extensions beyond tandem scope — ranked update (2026-11-02)

Delta to `docs/qml-extensions-research.md` (committed in `5de9a0e0`) and
`docs/quantum-ml-extensions-spec.md` (untracked, tandem-adjacent). Status
correction: tandem QML is no longer uncommitted — HEAD `5de9a0e0` ships
`qml_kernel.py` (fidelity kernel, `centered_alignment:43`, ridge `:56`),
`qml_train.py` (`resolve_data_params:46`, adjoint/parameter-shift, Adam/GD/SPSA),
`qml_data.py:30` (moons/circles/blobs/xor, 2-feature binary) and `noise.py`.
Worktree clean except `SHARED_QML_NOTES.md`, the spec, and
`trainability-extension-points.md`. Bounds for all candidates: ≤20q
statevector (`compiler.py:52`), numpy-only (no sklearn in kernel deps),
engines = `KernelProgram.states/expectations/value_and_grad/value_and_grad_costate`
(`compiler.py:160-219`). Ranking = value × fit ÷ effort. KTA optimization and
"learned feature maps" are one candidate with two tiers (not two).

| # | Candidate | Effort | Fit anchor in Nuclei |
|---|---|---|---|
| 1 | Classical-baseline Lab (RBF/linear ridge + MLP phase-2 + `g_CQ`) | S | `kernel_ridge_accuracy` takes any Gram |
| 2 | Trainability-aware training (QNG + Lie/landscape pre-flight) | M | `lie.py:296`, `landscape.py:48`, `states()` |
| 3 | KTA / learned feature maps (+ projected kernel variant) | M | `centered_alignment` is the objective |
| 4 | Data re-uploading depth + Fourier spectrum study | M | x-name reuse already binds; `scaling.py:299` sweep |
| 5 | QCBM generative modeling (exact KL/MMD) | M–L | exact Born probs from `states()`, costate grads |
| 6 | Architecture-searched feature maps | L | no synthesis engine — defer |

## 1. Classical-baseline benchmarking (do first; spec A)
Bowles, Ahmed & Schuld [1] benchmark 12 QML models on 160 datasets: out-of-the-box
classical models outperform quantum classifiers, and unentangled circuits often do
best — so a quantum accuracy without a same-split classical number is uninterpretable.
Ship RBF kernel (median-heuristic γ grid, train-only selection to avoid leakage) and
linear ridge on the identical `load_dataset/split_dataset(seed)` split, reusing
`kernel_ridge_accuracy` verbatim; add Huang's geometric difference
`g_CQ = sqrt(λmax(Kq^½(Kc+λI)⁻¹Kq^½))` [2], which bounds achievable separation before
training. MLP: pure-numpy MLP is real work and weaker than RBF-ridge on 2 features —
phase 2. Mandatory coupling: bandwidth-tuned quantum kernels collapse toward RBF [3],
so #3 must display this baseline. Spec A already designs this (`qml_baseline.py`).

## 2. Trainability-aware training (Nuclei-unique flagship; spec C = phase i)
Three layers: (i) quantum natural gradient `θ ← θ − η(g+λI)⁺∇L`, `g` = Fubini–Study
metric (Re QGT) [4]; exact via parameter-shift on `states()`, O(m²) — cap params,
`metric_every`; QNG amplifies flat directions but does not cure barren plateaus
(gradients below shot noise stay lost), and the metric's max rank is bounded by the
dynamical Lie algebra dimension [5]. (ii) Pre-flight: Nuclei already predicts gradient
variance from DLA dimension + purities (`lie._prediction`, `lie.py:296-313`), and DLA
dimension also bounds overparameterization threshold `M_c` and QFIM/Hessian rank [5] —
show "params vs dim(g)" and the scaling verdict (`scaling.py:299`) in the training tab
before spending epochs. (iii) Policy: small-init, per-parameter LR ∝ 1/√Var(g_i),
landscape slice at the trained point (`landscape.py:48` takes an explicit center),
effective-dimension/Fisher diagnostic [6]. No competitor couples a DLA engine +
landscape + scaling fitter to its own trainer. Phase (i) as a NEW module; tandem's
`_OPTIMIZERS=(adam,gd,spsa)` (`qml_train.py:70`) stays untouched.

## 3. KTA optimization = learned feature maps (spec B)
Optimize the embedding itself for centred alignment: tier 1 per-feature bandwidth
`x → w⊙x` (standard lever vs exponential fidelity-kernel concentration [7]); tier 2
trainable `U(x;θ)` parameters [8]. Nuclei already computes the exact objective
(`centered_alignment` over `fidelity_kernel(states)`); SPSA (2 kernel builds/step,
fine ≤200 samples) avoids deriving the batch-coupled costate gradient in v1, and
recent work shows Nyström low-rank approximation cuts KTA kernel-build cost with
noise-robustness data [9] — the scaling path if sample caps rise. Must bind data via
`resolve_data_params` (x-prefix) because `quantum_kernel` rejects
`len(parameters) != n_features` (`qml_kernel.py:98-104`); restore best iterate
(tandem early-stop does not). Add the projected quantum kernel (Gaussian kernel on
1-RDM features [2]) as a variant: resists concentration, features are free from
`states()`. Honesty: train-split alignment only, test observational, RBF number (#1)
always shown [3].

## 4. Data re-uploading depth studies (deferred in spec)
Sweep re-upload layers L; plot accuracy, gradient variance, and empirical Fourier
spectrum vs L. Single-qubit re-uploading is a universal classifier [10]; encoding
circuits are partial Fourier series whose accessible frequencies are eigenvalue
differences of encoding Hamiltonians, growing with re-uploads [11]. Already
expressible: parameter names are unique and bound by name (`qml_train._values_matrix`),
so reusing `x0` in L layers works today — the gap is study/UX, not IR. Copy the
`scaling_study` sweep+fit pattern; 1-D expectation grid + numpy FFT gives the empirical
spectrum. New work: a layer-replication helper on the flat `ParamCircuit` op list.

## 5. QCBM generative modeling (deferred in spec)
Train `p_θ(z)=|⟨z|U(θ)|0⟩|²` to a target bitstring distribution (Bars-and-Stripes,
discretized mixtures). Differentiable QCBM training via kernelized MMD [12]; PQCs as
generative models [13]. Nuclei's edge: at ≤20q `states()` gives exact Born
probabilities — exact KL, no shot-noise MMD estimation — and
`value_and_grad_costate` (`compiler.py:198`) is built for caller losses over final
states. Costs: new data kind (bitstrings, not `qml_data` 2-D), histogram tab,
documented plateau risk for global generative losses (pair with #2 diagnostics;
local f-divergence losses mitigate). Highest novelty, furthest from supervised UX.

## 6. Architecture-searched feature maps (defer)
Genetic search over map structure [14] needs a synthesis/mutation engine Nuclei lacks
(`convert.py` only imports Qiskit/Cirq), costs population × kernel builds, and inverts
the IDE premise (user authors, Lab analyzes). #3's continuous relaxation captures most
of the gain.

## Sequencing
1 → 3 (embeds 1) → 2(i) → 4 → 2(ii/iii) → 5; spec A→B→C order is consistent. All new
modules standalone-testable before registry wiring (8-step recipe in
`trainability-extension-points.md`); custom-dataset loader (survey doc) multiplies
value of 1/3/5. Position everything as design/diagnostics at ≤20q, not advantage [1,2,7].

## Sources
[1] Bowles, Ahmed & Schuld, arXiv:2403.07059 (2024). [2] Huang et al., Nat. Commun.
12, 2631 (2021), arXiv:2011.01938. [3] arXiv:2503.05602 (2025), bandwidth/RBF
similarity. [4] Stokes et al., Quantum 4, 269 (2020), arXiv:1909.02108. [5] Larocca
et al., Nat. Comput. Sci. 3, 542 (2023), arXiv:2109.11676. [6] Abbas et al., Nat.
Comput. Sci. 1, 403 (2021), arXiv:2011.00027. [7] Thanasilp et al., Nat. Commun. 15,
5200 (2024). [8] Hubregtsen et al., Phys. Rev. A 106, 042431 (2022), arXiv:2105.02276.
[9] Coelho et al., arXiv:2502.08225 (2025), Nyström KTA. [10] Pérez-Salinas et al.,
Quantum 4, 226 (2020), arXiv:1907.02085. [11] Schuld, Sweke & Meyer, Phys. Rev. A 103,
032430 (2021). [12] Liu & Wang, Phys. Rev. A 98, 062324 (2018), arXiv:1804.04168.
[13] Benedetti et al., Quantum Sci. Technol. 4, 043001 (2019); npj QI 5, 45 (2019) QCBM
benchmarking. [14] arXiv:2302.02980 (2023), hybrid genetic feature-map design.
