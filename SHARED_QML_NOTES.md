# SHARED QML NOTES — coordination note for the tandem agent

**Date:** 2026-11-02 · **Worktree:** `.worktrees/quantum-ai-ml` (branch
`quantum-ai-ml`) · **From:** a parallel Muse workflow (several
read-only research agents + this writer). We are *not* editing your QML
implementation — this note and one spec are our only new deliverables
this round. Existing research docs from our side (also new-files-only,
already in `docs/`): `qml-extensions-research.md`,
`qml-ide-surfaces-survey.md`, `qml-userdata-hardware-research.md`,
`trainability-architecture-map.md`.

## Who we are / how we work

A second agent team tasked with designing QML extensions *beyond* your
scope. Rules we operate under: check `git status` in this worktree
before touching anything; **new files only**; never edit a file you
have modified or created (list below); no commits, no push. Kernel
tests we run (read-only): `cd kernel &&
~/.cache/nuclei-test-venvs/full/bin/python -m pytest`.

## Test finding (your QML suite) — please read

- **Earlier verified run (prior agent): 26 passed, 4 failed.**
  All 4 were `test_datasets_are_deterministic_binary_and_angle_scaled`
  (one per dataset) in `kernel/tests/test_trainability_qml.py`, which
  asserts `X < 2π` per the `[0, 2π)` contract in `qml_data.py`.
  **Root cause:** `_scale` computed `(raw − lo)/span · 2π`, mapping each
  column's maximum to *exactly* `2π` — outside `[0, 2π)`, and also the
  same rotation as `0` (angle collision).
- **Live recheck by us, 2026-11-02: 30 passed, 0 failed** (the three
  QML/noise test files). `_scale` now ends with `% _TWO_PI`, which
  fixes the test. One residual nit for your judgment (we did *not*
  edit it): `%` maps the column maximum to exactly `0.0`, colliding
  with the column minimum's angle. Capping instead —
  `np.minimum(scaled, np.nextafter(2π, 0))` — keeps max/min distinct.

## Files we will add (new files only, per spec)

Design: `docs/quantum-ml-extensions-spec.md` + this note.
(Note: your QML landed as commit `5de9a0e0` while we were writing —
the worktree was clean except our two new files when we finished.
We still hold to new-files-only for the implementation below.)

```
kernel/trainability/qml_baseline.py     # classical-baseline benchmark
kernel/trainability/qml_align.py        # KTA-optimized feature maps
kernel/trainability/qml_qng.py          # quantum-natural-gradient trainer
kernel/tests/test_trainability_qml_baseline.py
kernel/tests/test_trainability_qml_align.py
kernel/tests/test_trainability_qml_qng.py
src/components/trainability/tabs/ClassicalBaselineTab.tsx
src/components/trainability/tabs/KernelAlignmentTab.tsx
src/components/trainability/tabs/VariationalQngTab.tsx
src/components/trainability/qmlExtensionTabs.test.tsx
src/services/trainability/qmlExtensionSettings.test.ts
```

Wiring those analyses end-to-end eventually needs small diffs to
registry files you currently own (`_settings.py`, `job_worker.py`,
`src/types/trainability.ts`, `src/services/trainability/settings.ts`,
`AnalysisTabs.tsx`, `TargetBar.tsx`). The spec (§5) lists them, but we
will **not** make them unilaterally — they land as one separate commit
on top of your `5de9a0e0`, or by you if you prefer.

## Files we will never touch (yours)

Update 2026-11-02 (later same day): your QML is now committed as
`5de9a0e0`; `git status` shows only new docs from our side
(this note, the spec, plus research updates). We verified the three
QML/noise test files again live: **30 passed**. Our never-touch list
below is unchanged in spirit — every file your commit created or
modified stays yours; our work remains new-files-only.

Modified by you in `5de9a0e0`: `kernel/trainability/{_settings,analyses,job_worker}.py`,
`src/types/trainability.ts`, `src/stores/trainabilityStore.ts`,
`src/services/trainability/{settings,certificate}.ts`,
`src/components/trainability/{AnalysisTabs,TargetBar}.tsx`,
`src/components/trainability/tabs/GradientsTab.tsx`.
Created by you in `5de9a0e0`: `kernel/trainability/{qml_data,qml_kernel,
qml_train,noise}.py`, `kernel/tests/test_trainability_{qml,
qml_optimizers,noise}.py`, `src/components/trainability/tabs/
{QmlKernelTab,VariationalTrainTab}.tsx`,
`src/components/trainability/qmlTabs.test.tsx`,
`src/services/trainability/{qmlSettings,qmlOptimizers,noiseSettings}.test.ts`.

If our new-file names above ever collide with something you create,
yours wins — ping via this file and we'll rename ours.

## Implementation update (2026-11-03, parallel workflow)

Extensions A/B/C from `docs/quantum-ml-extensions-spec.md` are now
implemented as new untracked files (no tandem file modified):
`kernel/trainability/qml_baseline.py` (`classical_baseline`),
`qml_align.py` (`kernel_alignment_search`), `qml_qng.py`
(`variational_qng`, `fubini_study_metric`) + tests
`kernel/tests/test_trainability_qml_{baseline,align,qng}.py`
(18 new tests). Run: 48 passed (18 new + your 30 QML/noise) in 0.92s.

Two spec deviations worth knowing: (1) the state parameter-shift in
`fubini_study_metric` needs a `1/(4 sin(s/2))` scale, not the
observable rule's `/2` — the spec's own RX closed form (0.25) caught
it; (2) QNG reparameterization invariance is tested as the metric
transformation law `g' = D g D`, since seeded init makes scaled/
unscaled trajectories start at different physical points.

Not done by us: the three TS tabs + TS tests and the five registry
diffs (spec section 5) — the tabs need result types in your
`src/types/trainability.ts`, and this worktree has no `node_modules`
to verify TS. Kernel modules are importable/testable standalone as
the spec planned.

Pre-existing failure at `5de9a0e0` (not from our files; ours are
imported nowhere yet): `tests/test_docs_lab_fixtures.py::
test_lab_stream_fixture[trainability_start]` — the live result now
carries `channel_noise`/`shot_noise_variance` keys the docs fixture
lacks. Everything else in the `-k trainability` suite: 938 passed.
The lab fixtures need regenerating from the real kernel.

## Status update (2026-11-03, docs synthesis)

New docs from this pass (our files only): `docs/train-your-first-
quantum-ml-model.md` (user guide, Starlight frontmatter matching
`docs-site/src/content/docs/research/trainability-lab.mdx` so it can
be promoted to docs-site verbatim) and `docs/qml-final-synthesis.md`
(full state, file inventory, ranked next features). This append is
the only edit to this file; no tandem-owned file was touched.

**Benchmark summary** (`docs/qml-benchmark-results/results.md`, 88
rows, seed 7; feature map `RX(x0),RX(x1),CZ`, 2-layer re-uploading
classifier, `Z0`; sizes 48/120/200 + depth/alignment study at 120):
quantum kernel ties RBF on `circles` (1.000 vs 1.000 at n=120) and
`xor` (0.983 vs 0.983 at n=200), edges it on `blobs` at n=120 (0.972
vs 0.944, `quantum_ahead`), and loses on `moons` at every size
(0.714/0.806/0.767 vs 0.929/0.972/1.000, `classical_ahead`). The
variational classifier (Adam) is excellent on `circles`/`xor`
(0.95–1.000) and weak on `moons` (0.357–0.639) and `blobs`
(0.556–0.714) — see VQC note below. Alignment search improves train
alignment on all four datasets at n=120 (`moons` 0.291→0.328,
`circles` 0.391→0.395, `blobs` 0.853→0.887, `xor` 0.387→0.454) with
test accuracy 1.000 except `moons` (0.778). QNG tracks Adam's final
loss closely at ~2× wall time; SPSA trails Adam wherever Adam learns
(and only edges it on `moons`, where both fail).
Simulated noise (512 shots, depol/readout 0.05) moves variational
test accuracy by ≤0.071 absolute across all 12 combinations (three
slightly up, four unchanged) — mild, and within 0–2 test samples.

**Kernel wiring — done by parent (uncommitted, on top of `5de9a0e0`).**
The kernel wiring is two modified tracked files (TS wiring below
adds two more):
`kernel/trainability/_settings.py` (`ANALYSES` += `classical_baseline`,
`kernel_alignment_search`, `variational_qng`; new clamped sections
`baseline{}`, `align{}`, `qng{}` + `_bool` helper) and
`kernel/trainability/job_worker.py` (`_dispatch_analysis` branches for
the three, `_check_width` 20-qubit/no-parameter coverage,
`_NOISE_AWARE` extended to all five QML analyses). The extension
modules + tests remain untracked new files, as before.

**TS wiring — landed in-tree while we wrote (uncommitted; snapshot
at delivery).** `src/types/trainability.ts` + `src/services/
trainability/settings.ts` carry all five QML analyses, the three
result types and the `baseline`/`alignment`/`qng` tab ids; the three
tab components (`ClassicalBaselineTab`, `KernelAlignmentTab`,
`VariationalQngTab`) + `qmlExtensionTabs.test.tsx` /
`qmlExtensionSettings.test.ts` exist; `AnalysisTabs.tsx` renders the
**Baseline** / **Alignment** / **QNG** tabs and `TargetBar.tsx`
offers all five analyses with their controls (Linear floor,
Alignment mode/steps, Metric λ/every). The user guide therefore
describes all five as UI analyses. Caveat: uncommitted, and TS tests
not run by us (no `node_modules`) — code-complete as read, not
test-verified here. Also new concurrently: `kernel/trainability/
qml_calibrated.py` (calibrated VQC, unwired everywhere at delivery,
cites a `vqc-diagnosis.md` not yet present) + `test_trainability_
qml_{calibrated,wiring}.py`.

**Tests re-run for this synthesis (2026-11-03):** the six QML/noise
pytest files = **48 passed in 0.95s** (`test_trainability_qml.py` 16,
`_qml_optimizers` 7, `_qml_baseline` 6, `_qml_align` 5, `_qml_qng` 7,
`_noise` 7), via `cd kernel && ~/.cache/nuclei-test-venvs/full/bin/
python -m pytest`; the two concurrent files observed separately:
`_qml_wiring` 5 passed, `_qml_calibrated` 8 passed. TS QML tests not
run (no `node_modules` in this worktree) — status unverified here.

**Pre-existing docs-fixture failure — still present, reproduced:**
`tests/test_docs_lab_fixtures.py::test_lab_stream_fixture
[trainability_start]` = **1 failed, 4 passed** (`channel_noise` /
`shot_noise_variance` unexpected in the live result). Unchanged from
the note above; fixtures still need regenerating from the real
kernel. Not caused by the extension modules.

**VQC `moons`/`blobs` weakness (headline open item).** At benchmark
settings the classifier's final loss stays ≈0.8–1.0 on both datasets
(vs ≈0.13–0.22 on `circles`/`xor`), and depth L=1–4 at n=120 does not
fix it (`moons` 0.500–0.639, `blobs` 0.500–0.611). Especially on
`blobs` — where the kernel on the same split scores 0.972–1.000 —
this looks like an optimization/loss problem, not a representation
one, but that is a hypothesis, not yet isolated. Ranked follow-ups
(best-iterate restore, per-parameter LR, trainability pre-flight in
the Training tab) are in `docs/qml-final-synthesis.md`; the
`qml_train.py` fixes are in tandem-owned files, so we have not made
them. Note the concurrent `qml_calibrated.py` (above) already
attempts best-theta restore + calibrated threshold as a separate
unwired module — it needs a head-to-head benchmark run before any
claim, which we did not do (outside the 88-row benchmark's scope).
