# Quantum-ML extensions spec — Trainability Lab (post-tandem)

Status: design only, 2026-11-02. Author: parallel Muse workflow agent
(see `SHARED_QML_NOTES.md` at worktree root). Target worktree:
`.worktrees/quantum-ai-ml` (branch `quantum-ai-ml`), on top of the tandem
agent's QML (`kernel/trainability/{qml_data,qml_kernel,qml_train,
noise}.py` + `QmlKernelTab`/`VariationalTrainTab` + tests — uncommitted
when this spec was researched, committed as `5de9a0e0` while it was
being written; still treated as tandem-owned throughout).
Research basis: `docs/qml-extensions-research.md` (ranked candidates 1–3
below), wiring basis: `docs/trainability-architecture-map.md`.

## Ground rules inherited from tandem code (verified in bodies)

- Every analysis is `fn(circuit[, observable], *, cfg…, seed, progress,
  cancel, backend) -> dict`, JSON-able, deterministic except `elapsed_ms`,
  using `check_cancel`/`report`/`AnalysisError(code,msg)` from
  `_analysis_common.py`. Tandem exemplars: `quantum_kernel`
  (`qml_kernel.py`, `__all__=[quantum_kernel, fidelity_kernel,
  centered_alignment, kernel_ridge_accuracy]`) and `variational_train`
  (`qml_train.py`, `resolve_data_params` x-prefix convention).
- Data comes only from `qml_data.load_dataset`/`split_dataset`
  (numpy-only, 2-feature binary, `[0,2π)` angles, stratified split at
  `seed+7919`). No new dependency: `kernel/requirements.txt` has no
  sklearn; all three extensions are numpy-only like tandem's.
- Statevector cap `MAX_STATEVECTOR_QUBITS=20` (`compiler.py:52`);
  `KernelProgram.states/expectations/value_and_grad/value_and_grad_costate`
  (`compiler.py:160-219`) are the only engines needed.
- Settings are clamped sections in `_settings.normalize_settings`
  (`qml{}`, `kernel{ridge_lambda}`, `variational{}`, `noise{}`) and
  dispatch is an explicit branch in `job_worker._dispatch_analysis` plus a
  `_check_width` cap. Handlers/jobs/client/store are name-keyed and need
  no change (architecture map, step 4).

## New-files-only discipline

Until tandem's branch lands, **implementation adds new files only**. The
five registry files tandem is actively editing (`_settings.py`,
`job_worker.py`, `src/types/trainability.ts`,
`src/services/trainability/settings.ts`,
`src/components/trainability/AnalysisTabs.tsx`) are *not* touched; §5
lists the exact small diffs for each, to be applied in one commit after
tandem merges. Kernel modules below are written to be importable and
testable standalone (direct calls, exactly like `test_trainability_qml.py`
calls `quantum_kernel`/`variational_train`) before that wiring exists.

## Chosen extensions (3)

| # | Analysis name | New kernel module | Effort | Why first/together |
|---|---|---|---|---|
| A | `classical_baseline` | `qml_baseline.py` | S | Honesty gate: no quantum number is interpretable without it |
| B | `kernel_alignment_search` | `qml_align.py` | M | Crazy #1: the feature map itself becomes trainable (KTA) |
| C | `variational_qng` | `qml_qng.py` | M | Crazy #2: trainability-aware QNN preconditioning (quantum natural gradient) |

Deferred (research doc candidates 4–6): re-uploading/Fourier study,
QCBM, architecture search. Non-goals for all three: user datasets,
multiclass/regression, hardware execution, a new `qml_*` protocol prefix,
any advantage claim (every result carries tandem's "not a quantum
advantage claim" note style, `qml_kernel.py` notes field).

---

## A. `classical_baseline` — classical-baseline benchmark analysis

**Question it answers in one glance:** "On *this* split, does my feature
map beat an out-of-the-box RBF kernel, and could it possibly?" Bowles,
Ahmed & Schuld (arXiv:2403.07059) found classical baselines beat 12 QML
models across 160 datasets; Huang et al. (Nat. Commun. 12, 2631) give the
geometric difference `g_CQ` bounding any achievable separation.

### Kernel API (mirrors `quantum_kernel` exactly)

```python
# kernel/trainability/qml_baseline.py
__all__ = ["classical_baseline", "rbf_kernel", "linear_kernel",
           "geometric_difference"]

def classical_baseline(
    circuit: ParamCircuit, *,
    dataset="moons", dataset_samples=48, noise=0.1, train_fraction=0.7,
    ridge_lambda=1.0, gamma_scales=(0.25, 0.5, 1.0, 2.0, 4.0),
    include_linear=True, seed=0, progress=None, cancel=None,
    backend="auto", channel_noise=None,
) -> dict[str, Any]: ...
```

- Reuse, never reimplement: `load_dataset`/`split_dataset` (same `seed`
  ⇒ bit-identical split to the quantum run), `kernel_ridge_accuracy`
  and `centered_alignment` from `qml_kernel.py` — they already consume
  any precomputed Gram matrix.
- RBF `K=exp(-γ‖x−x'‖²)` on the scaled features; `γ₀` = median heuristic
  `1/median‖x−x'‖²` over **train pairs only**, grid `γ₀·gamma_scales`.
  Winner selected by train alignment (tie → train accuracy); test
  accuracy of the winner is reported but never used for selection.
  Linear kernel `XXᵀ` as the floor.
- Quantum side (optional, never an error): if
  `len(circuit.parameters) == n_features`, compute states via
  `compile_circuit(...).states(X)` exactly as `quantum_kernel` does and
  reuse `fidelity_kernel` (+ `noisy_fidelity_kernel` when
  `channel_noise` is non-exact, mirroring `qml_kernel`). Otherwise
  `quantum: null` with a note — a classifier circuit still gets its
  classical numbers. This deliberately differs from `quantum_kernel`'s
  `qml_dataset_mismatch` raise.
- `geometric_difference(K_q, K_c) =
  sqrt(λ_max(K_q^{1/2} (K_c + εI)^{-1} K_q^{1/2}))`, `ε = ridge_lambda`
  (same regularizer as the ridge solve, stated in `notes`). Symmetric
  eigendecomposition via `np.linalg.eigh`; clip negative eigenvalues
  like tandem's spectrum code.

### Result dict (field names reuse `QuantumKernelResult` vocabulary)

`dataset, n_samples, n_features, noise, channel_noise, n_train, n_test,
labels, train_indices, baselines: [{name: "rbf"|"linear", gamma,
alignment, train_accuracy, test_accuracy, effective_dimension}],
best_baseline (name), quantum: {alignment, train_accuracy,
test_accuracy, effective_dimension} | null, geometric_difference: float
| null, delta_test_accuracy (quantum − best classical) | null, verdict:
"quantum_ahead"|"classical_ahead"|"tie"|"no_quantum_kernel" (|Δ| ≤ 1/n_test
⇒ tie), n_qubits, backend, elapsed_ms, notes[]`.

### Acceptance tests (`kernel/tests/test_trainability_qml_baseline.py`)

Mirror tandem fixtures `_feature_map()`/`_classifier()` and idioms
(determinism via `json.dumps` minus `elapsed_ms`; `allow_nan=False`):

1. Closed forms: `rbf_kernel` on 3 hand points equals manual
   `exp(-γ‖·‖²)`; `geometric_difference(K, K) ≈ 1` (atol 1e-6).
2. Sanity: blobs (40 samples, seed 2) best RBF test accuracy ≥ 0.8;
   product-RX feature map quantum block equals `quantum_kernel`'s
   alignment/accuracies for the same seed (oracle cross-check).
3. No test leakage: permuting test labels must not change chosen
   `best_baseline`/γ.
4. Classifier circuit (5 params) ⇒ `quantum is None`,
   `verdict == "no_quantum_kernel"`, baselines still present.
5. Determinism, progress monotonic ending at 1.0, `AnalysisCancelled`
   on `cancel=lambda: True`, >20q ⇒ `IrError("too_many_qubits")`.
6. Settings/dispatch (post-wiring): defaults + clamps, canonical
   ordering in `normalize_analyses`, `run_analysis` smoke like tandem's
   `test_job_worker_dispatches_both_qml_analyses`.

---

## B. `kernel_alignment_search` — KTA-optimized feature maps (crazy #1)

**Idea:** stop treating the feature map as fixed. Optimize per-feature
bandwidths `x → w⊙x` (tier 1) and/or the circuit's non-data parameters
`θ` in `U(x;θ)` (tier 2) to maximize the centred kernel-target
alignment tandem already computes (`centered_alignment`,
`qml_kernel.py`). Hubregtsen et al., Phys. Rev. A 106, 042431
(arXiv:2105.02276); bandwidth is also the standard lever against
exponential kernel concentration (Thanasilp et al., Nat. Commun. 15,
5200). **Mandatory honesty coupling:** bandwidth-tuned quantum kernels
collapse toward RBF kernels (arXiv:2503.05602), so every result embeds
extension A's best-RBF test accuracy on the same split.

### Kernel API (mirrors `variational_train` binding rules)

```python
# kernel/trainability/qml_align.py
__all__ = ["kernel_alignment_search"]

def kernel_alignment_search(
    circuit: ParamCircuit, *,
    dataset="moons", dataset_samples=48, noise=0.1, train_fraction=0.7,
    ridge_lambda=1.0, data_params=None, mode="bandwidth",  # |"embedding"|"both"
    steps=40, learning_rate=0.1, spsa_a=0.05, spsa_c=0.1,
    seed=0, progress=None, cancel=None, backend="auto", channel_noise=None,
) -> dict[str, Any]: ...
```

- Binding via `qml_train.resolve_data_params` (x-prefixed = data, rest =
  trainable) — this is how it escapes `quantum_kernel`'s
  "exactly `n_features` parameters" restriction without editing tandem
  code. Values matrix copied from `qml_train._values_matrix` pattern,
  with data columns pre-multiplied by `exp(log_w)`, `log_w` init 0.
- Objective: centred alignment of the **train** Gram matrix only.
  Optimizer: SPSA (Rademacher, `a/k^.602`, `c/k^.101` — tandem's SPSA
  schedule in `qml_train`) over `log_w` (tier 1) and optionally `θ`
  (tier 2). SPSA is chosen deliberately: alignment couples the whole
  batch, so `value_and_grad_costate`'s per-chunk costate does not
  directly yield its gradient; each SPSA step is 2 kernel builds
  (`states` + `fidelity_kernel`), fine at `QML_SAMPLES_RANGE ≤ 200`.
  A costate-gradient v2 is an explicit follow-up, not v1.
- **Best-iterate restore:** track `(log_w, θ)` at the best train
  alignment and return those (tandem's early-stop does not restore best
  θ — a gap noted in prior review; do not copy it).
- Concentration diagnostics per result: off-diagonal kernel mean/variance
  and `effective_dimension` (tandem's formula) before/after.
- Errors reuse tandem codes: no data params / unknown `data_params` ⇒
  `qml_dataset_mismatch`; `mode in {embedding,both}` with no trainable
  params ⇒ `AnalysisError("no_parameters", …)`; >20q ⇒ `too_many_qubits`.

### Result dict

`dataset…, mode, data_params, trainable_params, initial/final/best:
{alignment, train_accuracy, test_accuracy}, bandwidth: [w0, w1],
final_parameters (θ at best, name→value like `variational_train`),
history: [{step, alignment, train_accuracy, test_accuracy}],
concentration: {before/after: {offdiag_mean, offdiag_var,
effective_dimension}}, rbf_baseline_test_accuracy (from
`qml_baseline`), kernel (best Gram, same shape as `quantum_kernel`'s),
labels, train_indices, steps_run, n_qubits, backend, elapsed_ms, notes[]`
(incl. "alignment optimized on train split; test accuracy is
observational" + RBF-collapse caveat).

### Acceptance tests (`kernel/tests/test_trainability_qml_align.py`)

1. Oracle: at `log_w=0, θ=θ₀` with a pure feature map, initial alignment
   and Gram equal `quantum_kernel`'s for the same seed/dataset.
2. `best.alignment ≥ initial.alignment` (restore invariant); on blobs
   with a deliberately shrunk map (data params pre-scaled ×0.05 via
   `ParamRef` coeff), bandwidth search recovers test accuracy ≥ initial.
3. Determinism; `w > 0` always (log-parameterization); history length
   `== steps_run`; cancel/progress idiom; JSON-able.
4. Error codes above; `mode="bandwidth"` on the 5-param classifier
   fixture works (θ frozen at tandem's init draw).

---

## C. `variational_qng` — trainability-aware QNN preconditioning (crazy #2)

**Idea:** the Lab's whole premise is diagnosing trainability; close the
loop inside the trainer. Quantum natural gradient,
`θ ← θ − η (g + λI)⁺ ∇L`, with `g` the Fubini–Study metric (real part
of the quantum geometric tensor), preconditioning exactly the
directions barren-plateau diagnostics flag as flat. Stokes et al.,
Quantum 4, 269 (arXiv:1909.02108). Nuclei-unique because the same job UI
already shows gradient variances, Lie-algebra dimension and scaling
verdicts for the identical circuit (research doc candidate 2; UI
pre-flight coupling is phase 2, §5).

### Kernel API (superset of `variational_train`'s signature)

```python
# kernel/trainability/qml_qng.py
__all__ = ["variational_qng", "fubini_study_metric"]

def variational_qng(
    circuit: ParamCircuit, observable: PauliSum, *,
    dataset="moons", dataset_samples=48, noise=0.1, train_fraction=0.7,
    epochs=60, learning_rate=0.1, data_params=None,
    metric_regularization=1e-3, metric_every=1, max_metric_params=32,
    seed=0, progress=None, cancel=None, backend="auto", channel_noise=None,
) -> dict[str, Any]: ...
```

- Loss/gradient path identical to tandem: MSE vs `y_signed`,
  `sign(<O>)` prediction, exact adjoint grads via
  `KernelProgram.value_and_grad`. Data binding via `resolve_data_params`
  + `_values_matrix` pattern. Only the update rule is new — tandem's
  `_OPTIMIZERS=(adam,gd,spsa)` in `qml_train.py` is tandem-owned and is
  **not** extended; QNG ships as its own analysis.
- Metric: per train sample, `g_ij = Re[⟨∂ᵢψ|∂ⱼψ⟩ −
  ⟨∂ᵢψ|ψ⟩⟨ψ|∂ⱼψ⟩]`, averaged over the train batch. `∂ψ` by
  parameter-shift on **states**: `program.states` at `θ ± (π/2)eᵢ`
  (exact for Pauli-generated rotations; same ≤14q/no-U-gate caveats as
  tandem's parameter-shift path are documented in `notes`). Cost
  `2m` state batches per metric, hence `metric_every` and the
  `max_metric_params` cap (exceed ⇒
  `AnalysisError("qml_metric_too_large", …)`).
- Update: solve `(g + λI)δ = ∇L` (`np.linalg.solve`, falling back to
  `lstsq` then to a plain gradient step on `LinAlgError`/condition
  blow-up, each fallback counted in the result — never silent).
  `channel_noise`: v1 applies tandem's `expectation_scale` handling to
  the loss gradient exactly as `qml_train` does and notes the metric is
  computed on exact states (scoped, like `noise.py`'s v1 scope).

### Result dict

Everything `VariationalTrainResult` carries (`data_params,
trainable_params, initial/final_parameters, initial/final_loss,
final_train/test_accuracy, history[{epoch, loss, train_accuracy,
test_accuracy}], …`) plus `optimizer: "qng"`, per-epoch history extras
`{grad_norm, natural_grad_norm, metric_condition}`,
`metric_eigenvalues` (final), `metric_effective_dimension`,
`fallbacks: int`, `metric_every`, `metric_regularization`, `notes[]`.

### Acceptance tests (`kernel/tests/test_trainability_qml_qng.py`)

1. Closed form: 1-qubit `RX(θ)|0⟩` ⇒ `fubini_study_metric == [[0.25]]`
   (atol 1e-10) for several θ; metric symmetric PSD (eig ≥ −1e-12) on
   tandem's `_classifier()` fixture.
2. End-to-end on blobs (40 samples, seed 4, epochs 40): final loss <
   initial, final test accuracy ≥ 0.75 (same bar as tandem's training
   test); history length and `final_parameters` keys match tandem shape.
3. Invariance probe: reparameterizing one angle by ×2 (`ParamRef`
   coeff) changes the plain gradient but leaves the natural-gradient
   trajectory's loss at epoch 5 within tolerance of the unscaled run.
4. Determinism; cancel/progress; cap error code; JSON-able;
   `fallbacks` present and 0 on the well-conditioned fixture.

---

## §5 Wiring — new files now, registry diffs after tandem lands

New files (the only implementation artifacts until tandem merges):

```
kernel/trainability/qml_baseline.py        kernel/tests/test_trainability_qml_baseline.py
kernel/trainability/qml_align.py           kernel/tests/test_trainability_qml_align.py
kernel/trainability/qml_qng.py             kernel/tests/test_trainability_qml_qng.py
src/components/trainability/tabs/ClassicalBaselineTab.tsx
src/components/trainability/tabs/KernelAlignmentTab.tsx
src/components/trainability/tabs/VariationalQngTab.tsx
src/components/trainability/qmlExtensionTabs.test.tsx
src/services/trainability/qmlExtensionSettings.test.ts
```

Deferred registry diffs (apply once, post-tandem; each mirrors how
tandem added `quantum_kernel`/`variational_train`):

1. `_settings.py`: append `"classical_baseline",
   "kernel_alignment_search", "variational_qng"` to `ANALYSES`; new
   clamped sections `baseline{gamma_scales fixed tuple, include_linear}`,
   `align{mode, steps(1..500), learning_rate, spsa_a, spsa_c}`,
   `qng{metric_regularization(1e-6..1.0), metric_every(1..50),
   max_metric_params(1..64)}` via existing
   `_section/_int/_float/_choice` helpers; reuse `qml{}`/`variational{}`
   for dataset/epochs/data_params.
2. `job_worker.py`: three inline dispatch branches like tandem's
   `quantum_kernel` branch; add all three names to the
   `>MAX_STATEVECTOR_QUBITS` tuple in `_check_width` and to
   `_NOISE_AWARE`; `classical_baseline` is exempt from the
   no-parameters raise only when the circuit has ≥1 parameter to bind
   the quantum side — with zero parameters it returns baselines with
   `quantum: null` (specify this in `_check_width` exclusion).
3. `src/types/trainability.ts`: extend `TrainabilityAnalysis` union +
   `TRAINABILITY_ANALYSES`, add `ClassicalBaselineResult`,
   `KernelAlignmentResult`, `VariationalQngResult` (extends
   `VariationalTrainResult` shape), register in `TrainabilityResults`.
4. `src/services/trainability/settings.ts`: `TargetSettings` fields +
   `toKernelSettings` sections; keep all three out of `defaultAnalyses`
   (tandem excludes QML by default there — same opt-in policy).
5. `AnalysisTabs.tsx` (+ `TargetBar.tsx` controls): `TAB_ITEMS` entries
   + `AnalysisPanel` blocks rendering the new tab components, following
   the `QmlKernelTab`/`VariationalTrainTab` blocks verbatim.
   Baseline tab renders the A-vs-quantum table and verdict pill;
   alignment tab renders history + before/after heatmaps (reuse kernel
   heatmap markup); QNG tab reuses the variational loss-curve layout
   plus metric-condition sparkline.

No changes needed: `handlers.py`, `jobs.py`, `client.ts`,
`trainabilityStore.ts` reducer (name-keyed end to end).

## Sequencing & global acceptance

A → B → C (B embeds A's RBF number; C is independent but riskiest
numerically). Global gates before the wiring commit: all new kernel
tests green via `cd kernel && ~/.cache/nuclei-test-venvs/full/bin/python
-m pytest`; tandem's existing QML suite still green (30 passed at spec
time — see `SHARED_QML_NOTES.md`); TS tab/settings tests green; every
new analysis ≤20q, numpy-only, deterministic modulo `elapsed_ms`;
no file tandem owns appears in `git status` as modified by us.

## Sources

Bowles et al. arXiv:2403.07059 · Huang et al. Nat. Commun. 12, 2631
(arXiv:2011.01938) · Hubregtsen et al. PRA 106, 042431
(arXiv:2105.02276) · Thanasilp et al. Nat. Commun. 15, 5200 · Stokes
et al. Quantum 4, 269 (arXiv:1909.02108) · bandwidth/RBF similarity
arXiv:2503.05602. Full discussion: `docs/qml-extensions-research.md`.
