# QML in Nuclei — final synthesis

**Date:** 2026-11-03 · **Worktree:** `.worktrees/quantum-ai-ml` (branch
`quantum-ai-ml`, HEAD `5de9a0e0` plus uncommitted kernel wiring and new
extension modules) · **Scope:** complete state of quantum machine
learning in the Trainability Lab — the tandem implementation
(`5de9a0e0`), the three post-tandem extensions from
`docs/quantum-ml-extensions-spec.md`, their wiring, tests and benchmark
evidence. Every metric below comes from files opened or tests run for
this synthesis (commands at the end); no number is estimated.

## TL;DR

Nuclei ships five QML analyses over four built-in 2-feature binary
datasets, all behind the Trainability Lab's existing job/settings
machinery, all numpy-only and deterministic given the seed:

| # | Analysis | Kernel module | Lab UI |
|---|---|---|---|
| 1 | `quantum_kernel` — fidelity kernel + ridge | `qml_kernel.py` | ✅ **Kernel** tab |
| 2 | `variational_train` — VQC (Adam/GD/SPSA) | `qml_train.py` | ✅ **Training** tab |
| 3 | `classical_baseline` — RBF/linear + `g_CQ` + verdict | `qml_baseline.py` | ✅ **Baseline** tab (uncommitted) |
| 4 | `kernel_alignment_search` — trainable feature maps (KTA) | `qml_align.py` | ✅ **Alignment** tab (uncommitted) |
| 5 | `variational_qng` — quantum natural gradient | `qml_qng.py` | ✅ **QNG** tab (uncommitted) |

Plus the shared substrate: `qml_data.py` (datasets + encoding contract)
and `noise.py` (simulated shot/depolarizing/readout channel for the
noise-aware analyses). All five analyses are wired end to end —
kernel settings/dispatch and TS types/settings/tabs — but everything
past tandem's two analyses is still uncommitted in this worktree,
and the TS tests could not be run here (no `node_modules`; see
Wiring state, a dated snapshot of a tree that moved during writing).
A sixth module, `qml_calibrated.py`, appeared concurrently
addressing the VQC weakness below; it is unwired and outside the
benchmark's scope. The 88-row benchmark says the
quantum kernel is competitive with RBF on `blobs`/`circles`/`xor` and
loses on `moons`, while the variational classifier excels on
`circles`/`xor` and is weak on `moons`/`blobs`. Nothing here is, or
claims to be, a quantum advantage demonstration.

## How it works (shared contract)

Every analysis is `fn(circuit[, observable], *, cfg…, seed, progress,
cancel, backend) -> dict`: JSON-able, deterministic except
`elapsed_ms`, using `check_cancel`/`report`/`AnalysisError(code, msg)`
from `_analysis_common.py`.

- **Data** (`qml_data.py`, 148 lines): `load_dataset` / `split_dataset`
  generate `moons` / `circles` / `blobs` / `xor` with numpy only
  (no scikit-learn in kernel dependencies). Binary, `d = 2` features,
  each min–max scaled to `[0, 2π)` (`_scale` ends with `% 2π`, so the
  column maximum wraps to `0.0` and collides with the minimum's angle —
  a known residual nit recorded in `SHARED_QML_NOTES.md`). Labels come
  as `y ∈ {0,1}` and `y_signed ∈ {−1,+1}`; the stratified split is
  seeded at `seed + 7919` (default 70% train), so every analysis sees a
  bit-identical split for a given seed.
- **Data binding** (`qml_train.resolve_data_params`): parameters named
  `x*` are data parameters (or an explicit `data_params` list); the
  rest are trainable. `quantum_kernel` is stricter: it requires exactly
  `n_features` (2) parameters, else `qml_dataset_mismatch`.
  `classical_baseline` deliberately never raises there — with a
  classifier circuit it reports `quantum: null`,
  `verdict: no_quantum_kernel`, and still returns classical numbers.
- **Engines:** `KernelProgram.states / expectations / value_and_grad /
  value_and_grad_costate` only; statevector cap
  `MAX_STATEVECTOR_QUBITS = 20`. Sample cap `QML_SAMPLES_RANGE =
  (8, 200)` (default 48).
- **Noise** (`noise.py`, 260 lines): a `NoiseSpec` (shots,
  depolarizing p, readout flip) is applied analytically to
  expectations / kernels; it is a simulated channel, not a device
  calibration, and every affected result echoes `channel_noise` so a
  noisy run is self-identifying. Kernel-side the noise-aware set is
  now (`gradients`, `quantum_kernel`, `variational_train`,
  `classical_baseline`, `kernel_alignment_search`, `variational_qng`).

## The five analyses

1. **`quantum_kernel`** (`qml_kernel.py`, 159 lines) —
   `__all__ = [quantum_kernel, fidelity_kernel, centered_alignment,
   kernel_ridge_accuracy]`. Fidelity kernel `K = |⟨φ(x)|φ(x′)⟩|²`
   from exact statevectors, centred kernel-target alignment against
   `yyᵀ`, kernel ridge train/test accuracy, spectrum and effective
   dimension. UI: `QmlKernelTab.tsx` (KPI strip, Gram heatmap,
   spectrum table, noise pills, notes).
2. **`variational_train`** (`qml_train.py`, 355 lines) — score `⟨O⟩`,
   MSE vs signed labels, prediction `sign(⟨O⟩)`; exact adjoint
   gradients by default or parameter-shift; full-batch `adam` / `gd`
   / `spsa`; optional early stopping (keeps final parameters — no
   best-iterate restore). UI: `VariationalTrainTab.tsx` (loss curve,
   optimizer/method pills, initial-vs-final parameter table).
3. **`classical_baseline`** (`qml_baseline.py`, 235 lines) —
   `__all__ = [classical_baseline, rbf_kernel, linear_kernel,
   geometric_difference]`. RBF with median-heuristic γ₀ from train
   pairs only, grid `γ₀·(0.25…4)`, winner by train alignment (no test
   leakage — tested), linear floor, optional quantum block,
   `g_CQ = sqrt(λmax(Kq^½(Kc+λI)⁻¹Kq^½))` (Huang et al.), and a
   `quantum_ahead / classical_ahead / tie / no_quantum_kernel` verdict
   (|Δ| ≤ 1/n_test ⇒ tie). Motivation: Bowles–Ahmed–Schuld's finding
   that out-of-the-box classical models beat 12 QML models over 160
   datasets — a quantum accuracy without this number is
   uninterpretable.
4. **`kernel_alignment_search`** (`qml_align.py`, 270 lines) — the
   feature map becomes trainable: SPSA over per-feature log-bandwidths
   `x → w⊙x` (`bandwidth`), non-data circuit parameters (`embedding`)
   or both, maximizing train alignment, with best-iterate restore.
   Reports concentration diagnostics (off-diagonal mean/variance,
   effective dimension) before/after, and embeds
   `rbf_baseline_test_accuracy` because bandwidth-tuned quantum
   kernels can collapse toward RBF kernels.
5. **`variational_qng`** (`qml_qng.py`, 340 lines) —
   `__all__ = [variational_qng, fubini_study_metric]`. Same
   loss/gradient path as `variational_train`, update
   `θ ← θ − η(g + λI)⁺∇L` with `g` the batch-averaged Fubini–Study
   metric from parameter-shifted *states* (scale `1/(4 sin(s/2))` —
   a spec correction caught by the closed-form RX test, `g = 0.25`).
   `metric_every` / `max_metric_params` caps; solver fallbacks are
   counted in the result, never silent. Reparameterization behaviour
   is tested as the covariance law `g′ = D g D`. QNG ships as its own
   analysis rather than extending tandem's `_OPTIMIZERS` tuple.

## Wiring state

**Kernel — done (parent, uncommitted diff on top of `5de9a0e0`).**
The kernel wiring is exactly two modified tracked files (the TS
wiring below adds two more):

- `kernel/trainability/_settings.py` — `ANALYSES` extended with
  `classical_baseline`, `kernel_alignment_search`, `variational_qng`;
  new clamped sections `baseline{include_linear}`,
  `align{mode, steps, learning_rate, spsa_a, spsa_c}` and
  `qng{metric_regularization, metric_every, max_metric_params}` with
  ranges `ALIGN_STEPS (1,500)`, `METRIC_REG (1e-6,1)`,
  `METRIC_EVERY (1,50)`, `MAX_METRIC_PARAMS (1,64)`, plus a `_bool`
  validator and `ALIGN_MODES = (bandwidth, embedding, both)`.
- `kernel/trainability/job_worker.py` — `_dispatch_analysis` branches
  for the three analyses (sharing the `qml{}`/`kernel{}`/`variational{}`
  config where the spec requires it), `_check_width` extended with the
  20-qubit cap and no-parameter checks, and `_NOISE_AWARE` extended to
  all five QML analyses plus `gradients`.

Handlers, jobs, client and store are name-keyed and need no change.

**TypeScript — landed in-tree during writing (uncommitted;
snapshot at delivery time).** Initially only analyses 1–2 had any TS
presence. At delivery: `src/types/trainability.ts` admits all five
QML analyses, defines `ClassicalBaselineResult`,
`KernelAlignmentResult`, `VariationalQngResult`, `KernelAlignmentMode`
and tab ids `baseline` / `alignment` / `qng`;
`src/services/trainability/settings.ts` plumbs the
`baseline`/`align`/`qng` settings for all five; the three tab
components exist (`ClassicalBaselineTab.tsx` 129 lines,
`KernelAlignmentTab.tsx` 170, `VariationalQngTab.tsx` 130) with
component/settings tests (`qmlExtensionTabs.test.tsx`,
`qmlExtensionSettings.test.ts`); `AnalysisTabs.tsx` renders ten tabs
including **Baseline**, **Alignment** and **QNG**; and
`TargetBar.tsx` offers all five analyses with their controls
(**Linear floor** toggle, **Alignment mode/steps**, **Metric
λ/every**, shared dataset/ridge/epochs fields, shared noise row).
Also new: `kernel/tests/test_trainability_qml_wiring.py` exercising
the settings/dispatch path. Caveats: none of this is committed yet,
and the TS tests were not executed for this synthesis (no
`node_modules` in the worktree) — the UI is code-complete as read,
not test-verified here. The benchmark still drives the kernel APIs
directly.

**Concurrent sixth module.** `kernel/trainability/qml_calibrated.py`
(352 lines, untracked, unwired — no `_settings.py` / `job_worker.py`
/ TS references at last check) implements variational training with
best-theta restore and a train-calibrated decision threshold, citing
a `docs/qml-benchmark-results/vqc-diagnosis.md` that was not present
at last check. It is a direct response to the VQC weakness in Honest
limits and to ranked item 2 below; it has its own test file but is
not part of the 88-row benchmark and no accuracy claim is made for
it here.

## File inventory

Kernel (line counts via `wc -l`, 2026-11-03):

| File | Lines | Role |
|---|---|---|
| `kernel/trainability/qml_data.py` | 148 | Datasets + encoding contract |
| `kernel/trainability/qml_kernel.py` | 159 | `quantum_kernel` + shared kernel math |
| `kernel/trainability/qml_train.py` | 355 | `variational_train`, `resolve_data_params` |
| `kernel/trainability/qml_baseline.py` | 235 | `classical_baseline`, RBF/linear, `g_CQ` |
| `kernel/trainability/qml_align.py` | 270 | `kernel_alignment_search` |
| `kernel/trainability/qml_qng.py` | 340 | `variational_qng`, `fubini_study_metric` |
| `kernel/trainability/noise.py` | 260 | Simulated channel (`NoiseSpec`) |
| `kernel/trainability/qml_calibrated.py` | 352 | Calibrated VQC (concurrent, unwired — see Wiring state) |
| `kernel/trainability/_settings.py` (diff) | — | Analysis registry + `baseline`/`align`/`qng` sections |
| `kernel/trainability/job_worker.py` (diff) | — | Dispatch, width caps, noise-aware set |

Kernel tests (all under `kernel/tests/`): `test_trainability_qml.py`,
`test_trainability_qml_optimizers.py`, `test_trainability_noise.py`
(tandem, in `5de9a0e0`); `test_trainability_qml_baseline.py`,
`test_trainability_qml_align.py`, `test_trainability_qml_qng.py`
(extensions, untracked with their modules); arrived concurrently:
`test_trainability_qml_wiring.py`, `test_trainability_qml_calibrated.py`.

TypeScript (tandem, in `5de9a0e0`):
`src/components/trainability/tabs/{QmlKernelTab,VariationalTrainTab}.tsx`,
`src/components/trainability/qmlTabs.test.tsx`,
`src/services/trainability/{qmlSettings,qmlOptimizers,noiseSettings}.test.ts`,
plus the tandem edits to `src/types/trainability.ts`,
`src/stores/trainabilityStore.ts`,
`src/services/trainability/{settings,certificate}.ts` and
`src/components/trainability/{AnalysisTabs,TargetBar}.tsx`.

Docs/benchmark: `docs/quantum-ml-extensions-spec.md` (design),
`docs/qml-extensions-research.md`, `docs/qml-extensions-ranked-update.md`,
`docs/qml-benchmark-results/{run_benchmark.py,results.md,results.json}`,
`docs/train-your-first-quantum-ml-model.md` (user guide),
`SHARED_QML_NOTES.md` (coordination log), this file.

Git state (snapshot — the tree was moving during writing): HEAD
`5de9a0e0` ("Add quantum ML to Trainability Lab"); modified tracked
files at last check were the two kernel wiring diffs above plus
`src/types/trainability.ts` and `src/services/trainability/settings.ts`;
untracked: the extension modules (+ `qml_calibrated.py`), their
tests, the new tab components/tests, and the docs listed.

## Tests (run for this synthesis)

Command: `cd kernel && ~/.cache/nuclei-test-venvs/full/bin/python -m
pytest` on the six QML/noise files.

| Test file | Result |
|---|---|
| `test_trainability_qml.py` | 16 passed |
| `test_trainability_qml_optimizers.py` | 7 passed |
| `test_trainability_qml_baseline.py` | 6 passed |
| `test_trainability_qml_align.py` | 5 passed |
| `test_trainability_qml_qng.py` | 7 passed |
| `test_trainability_noise.py` | 7 passed |
| **Total (the six files above)** | **48 passed in 0.95 s** (combined run: `48 passed in 0.95s`) |
| `test_trainability_qml_wiring.py` (concurrent) | 5 passed (separate run) |
| `test_trainability_qml_calibrated.py` (concurrent) | 8 passed (separate run) |

Test idioms are uniform across tandem and extensions: closed-form
oracles (product-RX kernel, `geometric_difference(K,K) ≈ 1`,
RX Fubini–Study `0.25`), cross-oracle equality with `quantum_kernel`
on shared splits, determinism via JSON minus `elapsed_ms`,
`allow_nan=False`, cancel/progress idioms, width and error-code
checks, and a no-test-leakage test for baseline model selection.

**Known pre-existing failure (reproduced for this synthesis):**
`tests/test_docs_lab_fixtures.py::test_lab_stream_fixture[trainability_start]`
fails — `1 failed, 4 passed` — because the live gradients result now
carries `channel_noise` / `shot_noise_variance` keys the checked-in
docs fixture lacks. It predates the extension modules (they are
imported nowhere on that path) and needs the lab fixtures regenerated
from the real kernel, not a code fix. TS QML tests
(`qmlTabs.test.tsx` etc.) were **not run** for this synthesis — this
worktree has no `node_modules` — so their status here is unverified.

## Benchmark highlights

Source: `docs/qml-benchmark-results/results.md` / `results.json`
(88 rows, seed 7) produced by `run_benchmark.py` against the kernel
APIs directly. Circuits: feature map `RX(x0), RX(x1), CZ`; classifier:
2-layer re-uploading (`RX` encode → `RY(θ)` per qubit → `CZ`, twice,
plus final `RY`), observable `Z0`. Variational: Adam 60 epochs
lr 0.15; SPSA 60 epochs; QNG 40 epochs lr 0.3; noisy Adam = Adam under
`NoiseSpec(shots=512, depolarizing_p=0.05, readout_flip_p=0.05)`.
Sizes n = 48 / 120 / 200, plus a depth study (L = 1/3/4) and
alignment search (40 steps) at n = 120. All wall times are
sub-second (kernels 0.001–0.006 s; Adam 0.05–0.10 s; QNG
0.12–0.19 s; alignment search ≈ 0.05 s).

Test accuracies (n = 120):

| Dataset | VQC Adam | VQC SPSA | VQC QNG | VQC Adam + noise | Quantum kernel | Best classical (RBF) | Verdict |
|---|---|---|---|---|---|---|---|
| `moons` | 0.639 | 0.528 | 0.611 | 0.611 | 0.806 | **0.972** | classical_ahead (g_CQ 4.66) |
| `circles` | 1.000 | 0.917 | 1.000 | 0.972 | 1.000 | 1.000 | tie (g_CQ 1.47) |
| `blobs` | 0.556 | 0.444 | 0.528 | 0.583 | **0.972** | 0.944 | quantum_ahead (g_CQ 2.04) |
| `xor` | 0.972 | 0.972 | 0.972 | 0.972 | 0.972 | **1.000** | classical_ahead (g_CQ 1.43) |

Findings:

- **Quantum kernel vs RBF:** wins once (`blobs`, n = 120: 0.972 vs
  0.944), ties on `circles` at all sizes and on `blobs` (n = 200:
  1.000/1.000) and `xor` (n = 200: 0.983/0.983), loses on `moons` at
  every size (0.714/0.806/0.767 vs 0.929/0.972/1.000) and marginally on
  `xor` at n = 120 (0.972 vs 1.000). Alignments (n = 120): `blobs`
  0.856, `circles` 0.394, `xor` 0.390, `moons` 0.283 — the ranking
  predicts the accuracy ranking, as it should.
- **Variational classifier:** excellent on `circles` (0.95–1.000) and
  `xor` (0.972–1.000) with Adam; weak on `moons` (0.357–0.639) and
  `blobs` (0.556–0.714) at every size, with final losses stuck near
  0.8–1.0 (vs ≈ 0.13–0.22 on `circles`/`xor`). Depth does not fix it
  (n = 120, L = 1/3/4: `moons` 0.500/0.583/0.639, `blobs`
  0.528/0.611/0.500; note L = 1 also collapses `xor` to 0.444 —
  consistent with re-uploading theory: one encoding layer cannot
  represent the XOR boundary with this ansatz). SPSA ends at a higher
  loss than Adam wherever Adam learns (`circles`/`xor`: losses
  ≈ 0.29–0.73 vs Adam's ≈ 0.10–0.22); it only "beats" Adam on
  `moons` test accuracy at n = 48/200 (0.500/0.533 vs 0.357/0.450),
  where both optimizers have failed to learn. QNG matches Adam's final loss to 2–3 decimals almost
  everywhere (e.g. `moons` n = 48: 0.8239 vs 0.8241) at ~2× wall time
  for fewer epochs — a geometry improvement, not a trainability cure.
- **Alignment search (n = 120):** alignment improves on all four
  datasets (`moons` 0.291 → 0.328, test 0.778; `circles`
  0.391 → 0.395, test 1.000; `blobs` 0.853 → 0.887, test 1.000;
  `xor` 0.387 → 0.454, test 1.000). The `moons` gap to RBF (0.972)
  remains wide.
- **Noise:** noisy vs exact Adam differs by ≤ 0.071 in absolute test
  accuracy over all 12 combinations (largest drops: `blobs` n = 48
  −0.071, `moons` n = 200 −0.033; three combinations improve slightly,
  four are unchanged). At test sets of 14–60 points these are 0–2
  samples — the honest reading is "no measurable collapse at this
  channel strength and scale", nothing stronger.

## Honest limits

1. **Toy scale, by design.** 2 features, binary labels, 8–200 samples,
   ≤ 20 qubits, exact statevector simulation. Every "quantum win"
   above is against an RBF kernel on synthetic 2-D data at 2 qubits;
   the geometric differences (1.36–6.09) and Bowles et al.'s
   160-dataset result both say: do not generalize.
2. **Classical is ahead where it matters as a control.** On `moons`
   the classical baseline beats both quantum models at every size by
   0.17–0.57 of test accuracy. Any QML UI that hides this number is
   misleading — which is why completing the baseline's TS tab should
   precede any new quantum feature.
3. **The VQC's `moons`/`blobs` weakness is the headline open problem**
   for the supervised path. Hypotheses (not yet isolated — stated as
   hypotheses, not findings): the single-local-observable MSE loss on
   this ansatz has poor minima for these geometries; full-batch
   training at fixed learning rate with no best-iterate restore
   discards better iterates; the `blobs` case is especially telling
   because the kernel separates it almost perfectly, so the
   representation exists in the same feature map family.
4. **Alignment is a train-split objective.** Improving it is
   guaranteed (`best ≥ initial`); improving generalization is not, and
   bandwidth tuning can make the quantum kernel imitate RBF. The
   embedded RBF number is the guardrail and must survive into the UI.
5. **QNG cost scales as O(m) state batches per metric** (2m shifted
   evaluations), capped at 32 metric parameters by default; its
   metric is computed on exact states even when the loss gradient
   carries the simulated channel (documented in result notes). It
   preconditions flat directions but cannot recover gradients below
   shot noise — it does not cure barren plateaus.
6. **Data contract nits.** `_scale` wraps each column maximum to
   exactly `0.0` (angle collision with the minimum);
   `variational_train`'s early stop does not restore the best
   iterate (the alignment search deliberately does not copy this).
   Both are recorded, neither is fixed here — they belong to the
   tandem files.
7. **No user data, no hardware, no multiclass/regression.** Explicit
   non-goals of the spec; the custom-dataset loader is researched
   (`docs/qml-userdata-hardware-research.md`) but unimplemented.

## Next crazy features, ranked

Ranking continues `docs/qml-extensions-ranked-update.md` (value × fit
÷ effort), with items 1–3 of that list now implemented kernel-side.
Prerequisite zero outranks everything: **commit the wiring and run
the TS test suite** (kernel + TS wiring for analyses 3–5 is in-tree
but uncommitted, and unverified by TS tests in this worktree), wire
or retire `qml_calibrated.py`, and **regenerate the docs lab
fixtures** to clear the one pre-existing failure.

| Rank | Feature | Effort | Why next |
|---|---|---|---|
| 1 | **Trainability pre-flight in the Training tab** — show `dim 𝔤` vs parameter count, gradient-variance verdict and a post-training landscape slice at the trained point, before/after spending epochs | S–M | Nuclei-unique: the Lab already computes all of these for the identical circuit; directly attacks the `moons`/`blobs` VQC weakness by diagnosing it instead of hiding it. (Ranked-update #2, phases ii–iii.) |
| 2 | **Fix the VQC basics** — best-iterate restore on early stop, per-parameter learning rates ∝ 1/√Var(gᵢ), small-angle init option | S | Small diffs in `qml_train.py` (tandem-owned — needs their lane); the benchmark gives a ready-made before/after test on `moons`/`blobs`. A parallel attempt already exists as the unwired `qml_calibrated.py` (best-theta restore + calibrated threshold) — benchmark it head-to-head before choosing. |
| 3 | **Projected quantum kernel variant** — Gaussian kernel on 1-RDM features, free from `states()` | S–M | Resists fidelity-kernel concentration; drops into the baseline/alignment machinery as another Gram supplier. |
| 4 | **Data re-uploading depth + Fourier spectrum study** — sweep L, plot accuracy / gradient variance / empirical Fourier spectrum | M | Re-uploading already binds by name (the benchmark's L = 1 `xor` collapse is the motivating plot); the gap is a layer-replication helper + study UX modelled on `scaling_study`. |
| 5 | **Custom-dataset loader** — user CSV → 2-feature (then k-feature) angle-encoded datasets with the same split contract | M | Multiplies the value of everything above; researched already. Must keep the deterministic-split and no-leakage invariants. |
| 6 | **QCBM generative modelling** — train Born distributions with exact KL/MMD at ≤ 20 qubits via `value_and_grad_costate` | M–L | Highest novelty; needs a new data kind (bitstrings) and a histogram tab; pair with rank-1 diagnostics for its known plateau risks. |
| 7 | **Costate-gradient KTA (alignment v2)** — replace SPSA's 2-kernel-builds-per-step with exact batch gradients; Nyström approximation if sample caps rise | M | Only worth it once sample sizes grow past ~200; SPSA is fine today (0.05 s per search). |
| 8 | **Architecture-searched feature maps** | L | Deferred: needs a synthesis/mutation engine Nuclei lacks, and inverts the IDE premise (user authors, Lab analyzes). Alignment search captures most of the gain continuously. |

Sequencing: commit + TS verification + fixture regeneration → 1 →
2 → 3 → 4 → 5 → 6; 7 when caps rise; 8 stays deferred.

## How to reproduce every number in this file

```bash
# On the Linux box, in the worktree:
cd ~/Desktop/code/nuclei/.worktrees/quantum-ai-ml/kernel

# The 48-test QML/noise suite (expect: 48 passed):
~/.cache/nuclei-test-venvs/full/bin/python -m pytest \
  tests/test_trainability_qml.py \
  tests/test_trainability_qml_optimizers.py \
  tests/test_trainability_qml_baseline.py \
  tests/test_trainability_qml_align.py \
  tests/test_trainability_qml_qng.py \
  tests/test_trainability_noise.py -q

# The known pre-existing failure (expect: 1 failed, 4 passed):
~/.cache/nuclei-test-venvs/full/bin/python -m pytest \
  tests/test_docs_lab_fixtures.py -q

# The 88-row benchmark (regenerates results.md / results.json):
~/.cache/nuclei-test-venvs/full/bin/python \
  ../docs/qml-benchmark-results/run_benchmark.py
```

Primary sources opened for this synthesis:
`docs/qml-benchmark-results/results.md` (+ `results.json`,
`run_benchmark.py`), `docs/quantum-ml-extensions-spec.md`,
`docs/qml-extensions-ranked-update.md`, `SHARED_QML_NOTES.md`,
`kernel/trainability/{qml_data,qml_kernel,qml_train,qml_baseline,
qml_align,qml_qng,noise}.py`, the uncommitted diffs to
`_settings.py` / `job_worker.py`,
`src/components/trainability/AnalysisTabs.tsx`,
`src/components/trainability/tabs/{QmlKernelTab,VariationalTrainTab}.tsx`,
`src/components/trainability/TargetBar.tsx`,
`src/types/trainability.ts`, `src/services/trainability/settings.ts`,
`docs-site/src/content/docs/research/trainability-lab.mdx` and
`src/data/lessons/track6-qml.ts` (guide conventions).


