# VQC diagnosis: why `variational_train` trails the quantum kernel, and a calibrated trainer

Evidence base: `results.md` in this directory (seed 7, 2-layer re-uploading
classifier, `Z0`, Adam/adjoint, 60 epochs, lr 0.15), plus the score-level
experiments summarized below (run on the box, `PYTHONPATH=.` from the worktree
root, full test venv). All numbers below are seed 7 unless stated.

## Root cause

The headline failures (moons n=48: test 0.357 vs train 0.735; moons/blobs
generally 0.44–0.64 while the fidelity kernel on the same feature map scores
0.71–1.0) are **not primarily a decision-threshold problem**. They are a
**variational fit problem**: training plateaus with weak, low-amplitude,
heavily overlapping class scores whose ranking does not reliably generalize.
Four checked hypotheses, in order of importance:

1. **Weak fit / loss plateau (primary).** At the final theta, class-conditional
   score means on train differ by only ~0.1–0.3 with per-class sd ~0.25
   (moons n=48: y=-1 mean -0.191, y=+1 mean +0.104), train AUC is only
   0.62–0.77 on moons/blobs, and MSE loss ends at 0.82–0.95 — barely below the
   1.0 loss of a constant-zero predictor. The loss reaches ~0.84 by epoch 10
   and then barely moves; 300 epochs or lr 0.05/0.5 leave moons n=120 loss at
   0.909–0.916 (vs 0.916 at 60 epochs). This is an optimization/expressibility
   plateau for this ansatz + observable + MSE on moons/blobs geometry, not
   undertraining. The same setup fits circles/xor cleanly (loss 0.13–0.16,
   class means ≈ ∓0.6/±0.8, AUC 1.0), and kernel ridge on the same feature
   map solves its convex readout exactly — so the information is in the
   feature map; the variational decoder fails to extract it on moons/blobs.
   Where the ranking itself inverts out of sample (moons n=48 test AUC 0.347,
   moons n=200 test AUC 0.372, despite train AUC 0.73/0.64), no monotone
   decision rule can recover accuracy above chance.

2. **No bias/threshold (real but minor).** Prediction is `sign(<O>)` with no
   offset. A threshold sweep on *train* scores finds optima near zero
   (|t| ≤ 0.15 in all diagnosed cases) worth +0.00–0.09 train accuracy and
   ≈0 test accuracy on the failing cases (moons n=48: 0.357 → 0.357). Worth
   fixing — it is free and never hurts on train — but it does not explain the
   gap to the kernel.

3. **No best-theta restore (real, small).** `variational_train` returns the
   post-final-epoch theta. History best train accuracy exceeds the final
   value in several runs (moons n=120: 0.643 best vs 0.571 final; blobs
   n=120 min-loss epoch is 9 of 60). Restoring the min-train-loss theta is a
   cheap safeguard, though on moons n=48 every epoch's test accuracy is
   ≈0.357, so restore alone cannot fix that case.

4. **Ruled out: label/sign convention and the angle wrap.** `y_signed = 2y-1`
   is consistent everywhere (train scores for y=+1 exceed y=-1 in every
   diagnosed run; the moons n=48 test inversion is a 14-row generalization
   failure, not a flipped convention). In `qml_data._scale`, exactly two
   entries per column are exactly 0.0 (the column min, and the max wrapping
   2π → 0); `RX(0)` and `RX(2π)` differ only by a global -1 phase, and
   `<Z0>` at x0=0 vs x0=2π agrees to 2e-16 — the wrap is physically a no-op
   for angle encoding. Init sensitivity is moderate (moons n=48, seeds 0–7:
   test 0.357–0.714, loss always 0.78–0.90), consistent with the plateau
   being reached from every `uniform(0, 2π)` start.

## Method: `kernel/trainability/qml_calibrated.py`

`variational_calibrated` keeps tandem's model, MSE loss, exact adjoint
gradients and full-batch Adam (same seeded init stream, same result-dict
conventions), and changes only the decision rule and theta selection:

- **Best-theta restore on train MSE**, the objective being optimized. An
  optional stratified validation carve (`val_fraction > 0`, selection on
  validation MSE, gradients on the subtrain remainder) exists but is off by
  default: a prototype sweep showed that at n=48–200 the carve starves the
  optimizer and selects undertrained thetas from as few as ~8 validation
  rows (e.g. blobs n=48 seed 4 test 0.286 with carve vs 0.714 without).
- **Calibrated threshold**: deployed rule `+1 iff <O> >= t`, with `t`
  maximizing accuracy on the full train split at the restored theta
  (`select_threshold`; candidates include 0.0, so calibrated train accuracy
  ≥ `sign(<O>)` train accuracy by construction; ties break toward 0).
- Optional `class_weight="balanced"` inverse-frequency MSE reweighting.
- Result adds `threshold`, `threshold_train_accuracy`, `sign_train_accuracy`,
  `sign_test_accuracy` (plain `sign` at the same restored theta),
  `best_epoch`, `selection`, `val_fraction`, `n_subtrain`, `n_val`,
  `class_weight`, `best_selection_loss`. `final_train/test_accuracy` are the
  calibrated (deployed) numbers. Deterministic given `seed`; threshold and
  selection read train rows only (covered by a leakage test that flips test
  labels via monkeypatched `load_dataset`).

## Benchmark (seed 7, benchmark settings; plain column reproduces `results.md`)

| dataset | n | plain test | calibrated test | sign test @cal θ | calibrated train | threshold | best epoch | kernel test |
|---|---|---|---|---|---|---|---|---|
| moons | 48 | 0.357 | 0.357 | 0.357 | 0.765 | +0.024 | 55 | 0.714 |
| moons | 120 | 0.639 | 0.639 | 0.639 | 0.643 | +0.116 | 60 | 0.806 |
| moons | 200 | 0.450 | 0.417 | 0.450 | 0.636 | +0.073 | 54 | 0.767 |
| blobs | 48 | 0.714 | 0.714 | 0.714 | 0.794 | -0.087 | 57 | 1.000 |
| blobs | 120 | 0.556 | 0.556 | 0.556 | 0.655 | -0.015 | 9 | 0.972 |
| blobs | 200 | 0.583 | 0.567 | 0.583 | 0.636 | +0.012 | 49 | 1.000 |
| circles | 48 | 1.000 | 1.000 | 1.000 | 1.000 | 0.000 | 58 | 1.000 |
| circles | 120 | 1.000 | 1.000 | 1.000 | 1.000 | 0.000 | 60 | 1.000 |
| circles | 200 | 0.950 | 0.983 | 0.950 | 1.000 | +0.231 | 60 | 0.983 |
| xor | 48 | 1.000 | 1.000 | 1.000 | 0.971 | 0.000 | 60 | 0.929 |
| xor | 120 | 0.972 | 0.972 | 0.972 | 1.000 | -0.161 | 55 | 0.972 |
| xor | 200 | 0.983 | 0.983 | 0.983 | 0.993 | -0.031 | 39 | 0.983 |

Reading: calibration consistently lifts train accuracy (+0.01–0.09 over
`sign` at the same theta) and helps where the ranking is sound (circles
n=200: 0.950 → 0.983, matching the kernel), is neutral in most rows, and
costs 1–2 test rows where the train-fitted threshold does not transfer
(moons/blobs n=200). It does **not** close the gap to the quantum kernel on
moons/blobs, because that gap is the ranking/fit plateau of root cause 1 —
closing it needs ansatz/observable/loss work (e.g. a margin or logistic loss
on a scaled score, data re-uploading variants, or kernel-ridge readout on
learned features), not decision-rule calibration.

## Tests

`kernel/tests/test_trainability_qml_calibrated.py` (8 tests): threshold unit
behavior (offset recovery, zero tie-break, never worse than `sign` on its
inputs), end-to-end blobs accuracy ≥ `sign` baseline at the same theta,
threshold in [-1, 1], no test-label leakage into threshold/best-epoch/theta,
validation-carve and balanced-weight paths, determinism/progress/cancel.
Run with the tandem QML suites: 49 passed.
