# QML extensions beyond tandem scope — ranked research

Scope: candidates NOT in tandem's uncommitted QML (verified `git status` in
`.worktrees/quantum-ai-ml`, branch `quantum-ai-ml`: `qml_kernel.py`,
`qml_train.py`, `qml_data.py`, `noise.py` + tabs/tests + 10 modified files).
Tandem already ships: fidelity kernel + centred alignment + ridge accuracy
(`qml_kernel.py:35-159`), variational MSE training (Adam/GD/SPSA, adjoint|
parameter-shift, `qml_train.py:76-355`), 2-feature binary synthetic data
(`qml_data.py:30,103-146`), analytic channel noise. Hard bounds for every
candidate below: statevector ≤20q (`compiler.py:52`), core deps are
numpy-only (`kernel/requirements.txt`; sklearn absent from the test venv —
verified import fails), parameter names are unique per circuit
(`ir.py:8,116`), and new analyses follow the 8-step recipe in
`docs/trainability-architecture-map.md` (handlers/jobs/client/store need no
change). Ranking = value × fit to existing engines ÷ effort.

## 1. Classical-baseline benchmarking inside the Lab (S effort, do first)

**What.** On the *same* `qml_data` split/seed as the quantum analyses:
RBF-kernel ridge, linear ridge, and (phase 2) a small MLP, plus Huang's
geometric difference `g_CQ` between the quantum and RBF Gram matrices.
Bowles, Ahmed & Schuld benchmarked 12 QML models × 160 datasets and found
"out-of-the-box classical machine learning models outperform the quantum
classifiers" and removing entanglement often helps [1]. Huang et al. show
`g(K1‖K2)` is an SVD of the two kernel matrices and bounds any possible
quantum/classical prediction separation before training [2].

**Fit.** Near-zero new machinery: an RBF Gram is ~5 lines of numpy, and
`qml_kernel.kernel_ridge_accuracy` (`qml_kernel.py:56-71`) already consumes
*any* precomputed kernel — reuse it verbatim, no sklearn. `g_CQ` reuses the
quantum kernel + its spectrum already returned by `quantum_kernel`.
Bandwidth via median heuristic + small grid. This is the honesty gate every
other candidate needs: bandwidth-tuned quantum kernels provably collapse
toward RBF kernels [3], so KTA/feature-map wins (candidate 3) are
uninterpretable without this baseline in the same tab. A pure-numpy MLP is
the only nontrivial piece; defer it (RBF-ridge is the stronger baseline on
2-feature data anyway).

## 2. Trainability-aware QNN training (M effort, Nuclei-unique flagship)

**What.** Close the loop the Lab already half-builds: (a) *pre-flight* —
run gradients/Lie/expressibility first and feed the verdict into training:
`lie._prediction` (`lie.py:296-313`) already predicts gradient variance from
DLA dimension + purities via `lie_core.predicted_variance*` when applicable;
gradient statistics give per-parameter variances (`analyses.py:268-342`);
(b) *preconditioning* — quantum natural gradient, `θ ← θ − η g⁺∇L` with `g`
the Fubini–Study metric (real part of the QGT), block-diagonal in practice
[4]; (c) *init/LR policy* — small-init (`_settings.py` HEAD
`INITS=(uniform,small)`), per-parameter LR ∝ 1/√Var, early abort when the
Lie/scaling verdict is exponential; (d) effective-dimension/Fisher-spectrum
diagnostic connecting capacity to barren plateaus [5].

**Fit.** No other QML tool couples a DLA-dimension engine, a landscape
engine (`landscape.py:48-100`, explicit `center` accepted) and a scaling-law
fitter (`scaling.py:247-335`) to its own trainer — this is the
differentiator. `compiler.KernelProgram.states` (`compiler.py:160-174`)
gives exact states for the metric at ≤20q; `value_and_grad_costate`
(`compiler.py:198-219`) gives adjoint gradients for caller-defined losses.
Costs/risks: metric is O(m²) state evaluations (fine for Lab-scale m, needs
a cap); cross-analysis wiring is new — analyses are independent entries in
one job today, so phase it: (i) QNG as a 4th optimizer inside a NEW training
module (tandem's `_OPTIMIZERS=(adam,gd,spsa)`, `qml_train.py:70` is
tandem-owned, do not edit), (ii) pre-flight verdict displayed from existing
partial results, (iii) only then automatic init/LR selection. DLA dimension
also bounds QNN generalization (covering-number/Rademacher bounds [6]) —
report it beside test accuracy.

## 3. Kernel-target-alignment optimization = learned feature maps (M)

**What.** Make the feature map itself trainable and maximize centred
kernel-target alignment — Hubregtsen et al.: variational embedding
parameters "optimized for a given dataset by increasing the kernel-target
alignment, a heuristic connected to the achievable classification accuracy"
[7]. Two tiers: (a) per-feature bandwidth scales `x → w⊙x` (the standard
remedy for exponential kernel concentration — fidelity kernels concentrate
exponentially in qubit count under expressive/global encodings [8]);
(b) full trainable embedding parameters `U(x;θ)` optimized by gradient
ascent on alignment, with ridge accuracy tracked to catch alignment
overfitting on ~48 samples. Add the projected quantum kernel (Gaussian
kernel over 1-RDM features [2]) as a kernel variant — it resists
concentration better and its features come free from `states()`.

**Fit.** Nuclei already computes the exact objective:
`centered_alignment` (`qml_kernel.py:43-53`) over `fidelity_kernel`
(`:35-40`) from batched `program.states` (`qml_kernel.py:110`). Alignment
as a function of final states is precisely a `value_and_grad_costate`
objective (custom costate λ from dAlignment/d⟨ψ|), so gradients are one
adjoint sweep, and tandem's noise kernel `K′=aK+(1−a)/D` composes.
Blocker to design around, not edit: `quantum_kernel` rejects
`len(parameters) != n_features` (`qml_kernel.py:98-104`), so a NEW analysis
module must bind data via `qml_train.resolve_data_params`
(`qml_train.py:46-56`, x-prefixed = data, rest = trainable). Ship only
*with* candidate 1 visible: optimal bandwidth tuning makes quantum kernels
resemble RBF kernels [3] — the UI must show both.

## 4. Data re-uploading depth studies + Fourier spectrum (M)

**What.** Sweep re-uploading depth L and show accuracy, gradient variance
and the model's accessible Fourier spectrum vs L. Pérez-Salinas et al. show
a single qubit with data re-uploading is a universal classifier [9];
Schuld, Sweke & Meyer prove encoding circuits are partial Fourier series in
the data whose frequency spectrum is set by the encoding Hamiltonians'
eigenvalue differences and grows with re-uploading [10].

**Fit.** Re-uploading is *already expressible*: parameter names are unique
(`ir.py:116`) and bound by name (`qml_train._values_matrix`,
`qml_train.py:59-68`), so reusing `x0` in L layers just works in both tandem
paths — tandem's stated "no re-uploading" gap is a study/UX gap, not an IR
gap. The new work is the study harness: `scaling.scaling_study`
(`scaling.py:299-335`) already implements the build(n, layers) sweep +
WLS/AIC fitting pattern to copy, and a 1-D expectation grid + numpy FFT
(`program.expectations`, `compiler.py:175-186`) yields the empirical
spectrum to plot against the theoretical one. Depth-vs-trainability
trade-off reuses gradients/expressibility per L. Needs a circuit-layer
replication helper on `ParamCircuit` (new code; IR ops are a flat list).

## 5. QCBM generative modeling (M–L, opens unsupervised)

**What.** Train a parameterized circuit so its Born distribution
`p_θ(z)=|⟨z|U(θ)|0⟩|²` matches a target bitstring distribution. Liu & Wang
give differentiable QCBM training minimizing kernelized MMD, with KL as a
check on small systems [11]; Benedetti et al. frame PQCs generically as ML
models including Born machines [12]. Targets: Bars-and-Stripes (the
canonical QCBM benchmark [11,12]), plus discretized Gaussians/mixtures.

**Fit.** At ≤20q Nuclei has an unfair advantage: `program.states`
(`compiler.py:160`) gives *exact* Born probabilities — exact KL, no shot
noise, no sampling-based MMD estimation — and `value_and_grad_costate` was
designed for exactly this caller-defined objective over final states
(MMD/KL costate over `|ψ|²`). No observable needed, unlike every current
analysis. Costs: entirely new data kind (bitstring distributions; `qml_data`
is 2-D continuous only), new histogram-comparison tab, and barren-plateau
risk is documented for generative losses — pair with candidate 2's
diagnostics. High value, but furthest from the current supervised UX;
sequence after 1–3.

## 6. Architecture-searched feature maps (L, defer)

Genetic/neural search over feature-map *structure* (e.g. hybrid genetic
optimization of quantum feature maps [13]) scores lowest: Nuclei has no
circuit-synthesis/mutation engine (`convert.py` only imports Qiskit/Cirq),
search cost is (population × kernel builds), and it inverts the IDE's
premise that the user authors the circuit and the Lab analyzes it.
Candidate 3's continuous relaxation (bandwidth + embedding parameters)
captures most of the gain at a fraction of the machinery.

## Cross-cutting caveats

- All six are capped by tandem's 2-feature binary synthetic datasets; the
  custom-dataset loader from `docs/qml-ide-surfaces-survey.md` multiplies
  the value of 1, 3 and 5 and should land early.
- The 4 known test failures are tandem's `qml_data._scale` mapping a column
  max to exactly 2π (prior verified result) — no candidate here depends on
  touching tandem files; all are NEW modules + the standard registry steps
  *after* tandem's `_settings.py`/`job_worker.py` edits settle.
- Everything is exact-statevector ≤20q: position all of it as
  design/diagnostics, not advantage claims [1,2,8].

## Sources

[1] Bowles, Ahmed & Schuld, "Better than classical? The subtle art of
benchmarking quantum machine learning models", arXiv:2403.07059 (2024).
[2] Huang et al., "Power of data in quantum machine learning", Nat. Commun.
12, 2631 (2021); arXiv:2011.01938 — geometric difference, projected kernels.
[3] "On the similarity of bandwidth-tuned quantum kernels and classical
kernels", arXiv:2503.05602 (2025), Quantum Sci. Technol. (2025).
[4] Stokes, Izaac, Killoran & Carleo, "Quantum Natural Gradient", Quantum
4, 269 (2020); arXiv:1909.02108.
[5] Abbas et al., "The power of quantum neural networks", Nat. Comput. Sci.
1, 403 (2021); arXiv:2011.00027 — effective dimension, Fisher spectrum.
[6] "Generalization analysis of quantum neural networks using dynamical
Lie algebras", arXiv:2504.09771 (2025).
[7] Hubregtsen et al., "Training quantum embedding kernels on near-term
quantum computers", Phys. Rev. A 106, 042431 (2022); arXiv:2105.02276.
[8] Thanasilp et al., "Exponential concentration in quantum kernel
methods", Nat. Commun. 15, 5200 (2024).
[9] Pérez-Salinas et al., "Data re-uploading for a universal quantum
classifier", Quantum 4, 226 (2020); arXiv:1907.02085.
[10] Schuld, Sweke & Meyer, "Effect of data encoding on the expressive
power of variational quantum-machine-learning models", Phys. Rev. A 103,
032430 (2021) — Fourier-series view.
[11] Liu & Wang, "Differentiable learning of quantum circuit Born
machines", Phys. Rev. A 98, 062324 (2018); arXiv:1804.04168.
[12] Benedetti et al., "Parameterized quantum circuits as machine learning
models", Quantum Sci. Technol. 4, 043001 (2019).
[13] "Hybrid genetic optimisation for quantum feature map design",
arXiv:2302.02980 (2023); cf. Hubregtsen et al. (2022) on trainable maps.
