---
title: "Train your first quantum ML model"
description: "Train a quantum kernel and a variational classifier in Nuclei's Trainability Lab: write a circuit with x0/x1 data parameters, pick a built-in dataset, optimizer and simulated noise, and read alignment, loss and accuracy — with honest benchmark numbers for where classical models win."
---

<!--
  Location note: this guide lives in docs/ and uses the same Starlight
  frontmatter (title/description) as
  docs-site/src/content/docs/research/trainability-lab.mdx, so it can be
  promoted verbatim to
  docs-site/src/content/docs/research/train-your-first-quantum-ml-model.mdx
  plus one sidebar entry in docs-site/astro.config.mjs when the docs team
  wants it on the public site.
-->

# Train your first quantum ML model in Nuclei

The **Trainability Lab** can do more than diagnose barren plateaus: it can
train two kinds of quantum machine-learning (QML) model on the circuit in
your editor, end to end, on small built-in datasets.

- **Quantum kernel** — your circuit is a *feature map*. Nuclei computes the
  fidelity kernel `K(x, x′) = |⟨φ(x)|φ(x′)⟩|²` between every pair of data
  points and fits kernel ridge regression on it.
- **Variational training** — your circuit is a *classifier*. Parameters named
  `x0`, `x1`, … encode the data; every other parameter is optimized so that
  `sign(⟨O⟩)` matches the label (MSE loss against signed labels `−1/+1`).

Three further analyses complete the picture — **Classical baseline**
(does a plain RBF kernel beat you?), **Kernel alignment search** (tune
the feature map itself) and **Variational QNG** (train with quantum
natural gradient) — each with its own tab (**Baseline**, **Alignment**,
**QNG**). All five QML analyses are described below; start with the
kernel and the classifier, then use the baseline before believing
either.

This is a research and teaching tool, not an advantage claim. Every QML
result in Nuclei carries a note to that effect, and the
[Honest limits](#honest-limits-with-real-numbers) section below quotes
benchmark cases where a plain classical RBF kernel beats both quantum
models.

## Before you start

- Use the **desktop build** with the Python kernel running; the web build
  shows a notice instead of the Lab.
- Your circuit must be a **parameterized Qiskit or Cirq circuit** in the
  editor. The Lab runs your code once (the same trust as running it
  yourself) and converts the circuit to its internal IR.
- QML analyses are statevector-based, so circuits are capped at **20
  qubits** by the kernel.
- All built-in datasets are **binary with 2 features**, each feature
  min–max scaled to `[0, 2π)` so it can be bound directly to a rotation
  angle. There is no custom-dataset upload yet.

## Step 1 — Open the Trainability Lab

Open **Research mode** and choose **Trainability Lab** in the Research
rail. The Lab points at the circuit in your editor. Run analyses with the
**Run analyses** button or <kbd>Ctrl+Shift+Enter</kbd> on Linux/Windows
(<kbd>⌘⇧↵</kbd> on macOS); <kbd>Ctrl+Enter</kbd> keeps its global meaning
of running your code on the simulator.

Set the **observable** in the target bar (or with a module-level
`nuclei_observable` in your code — see the example below). The variational
classifier's score is `⟨O⟩` and its prediction is the sign of that score,
so a local observable such as `Z0` is the natural first choice.

## Step 2 — Write a circuit with `x0`/`x1` data parameters

The single most important convention:

> **Parameters whose names start with `x` are data parameters.** They are
> bound per-sample to dataset features (`x0` → feature 0, `x1` → feature
> 1). Every other parameter (`theta0`, `theta1`, …) is trainable.

You can override the convention with an explicit data-parameter list in
settings (`variational.data_params`), but `x0`/`x1` needs no setup.

The two analyses want slightly different circuits:

| Analysis | Circuit shape | Parameter rule |
|---|---|---|
| Quantum kernel | Feature map only | Exactly 2 parameters (`x0`, `x1`) — one per feature |
| Variational training | Encoding + trainable ansatz | `x0`, `x1` plus at least one trainable parameter |

Reusing `x0`/`x1` in several layers (data re-uploading) is allowed in the
classifier: parameters are bound by name, so every occurrence gets the
same feature value for a given sample.

### Example A — a feature map for the quantum kernel

Copy this into the editor. It is written in the same Qiskit style as
Nuclei's QML lessons (`src/data/lessons/track6-qml.ts`), with symbolic
`Parameter`s left unbound for the Lab to bind:

```python
from qiskit import QuantumCircuit
from qiskit.circuit import Parameter

# Data parameters: one per dataset feature.
x0 = Parameter("x0")
x1 = Parameter("x1")

# Feature map: angle-encode each feature, then entangle.
qc = QuantumCircuit(2)
qc.rx(x0, 0)
qc.rx(x1, 1)
qc.cz(0, 1)
```

This is exactly the feature map used in the kernel tests and in the
benchmark quoted below (`RX(x0)`, `RX(x1)`, `CZ`), so the numbers in this
guide are reproducible with this circuit.

### Example B — a variational classifier

For training, add trainable rotations after (and between) the encodings,
and name the observable:

```python
from qiskit import QuantumCircuit
from qiskit.circuit import Parameter

x0 = Parameter("x0")
x1 = Parameter("x1")
theta0 = Parameter("theta0")
theta1 = Parameter("theta1")
theta2 = Parameter("theta2")
theta3 = Parameter("theta3")
theta4 = Parameter("theta4")

# The Lab reads this if the target-bar observable field is empty.
nuclei_observable = "Z0"

qc = QuantumCircuit(2)
# Layer 1: encode, rotate (trainable), entangle.
qc.rx(x0, 0)
qc.rx(x1, 1)
qc.ry(theta0, 0)
qc.ry(theta1, 1)
qc.cz(0, 1)
# Layer 2: re-upload the data, rotate again, entangle.
qc.rx(x0, 0)
qc.rx(x1, 1)
qc.ry(theta2, 0)
qc.ry(theta3, 1)
qc.cz(0, 1)
qc.ry(theta4, 0)
```

Training will report `data_params == [x0, x1]` and
`trainable_params == [theta0, …, theta4]`; the prediction for each sample
is `sign(⟨Z0⟩)`. This 2-layer re-uploading shape is the benchmark
classifier (`vqc_*_L2` below), so again the quoted accuracies correspond
to this circuit family, the built-in datasets, and seed 7.

## Step 3 — Enable the QML analyses

In the target bar, tick the analyses you want. The five QML analyses
are:

- **Quantum kernel** (`quantum_kernel`) — **Kernel** tab.
- **Variational training** (`variational_train`) — **Training** tab.
- **Classical baseline** (`classical_baseline`) — **Baseline** tab.
- **Kernel alignment search** (`kernel_alignment_search`) —
  **Alignment** tab.
- **Variational QNG** (`variational_qng`) — **QNG** tab.

Ticking any of them reveals the shared QML settings row (dataset,
dataset size), the per-analysis fields described below, and the
simulated-noise row. The three newer analyses, in one paragraph each:

- **Classical baseline** (`classical_baseline`) — RBF (median-heuristic
  γ sweep, winner chosen on the *train* split only) and linear kernels
  with the same ridge solver on the identical split, plus the quantum
  kernel for comparison, Huang et al.'s geometric difference `g_CQ`,
  and a verdict: `quantum_ahead` / `classical_ahead` / `tie` /
  `no_quantum_kernel`. Run this before believing any quantum accuracy.
- **Kernel alignment search** (`kernel_alignment_search`) — treats the
  feature map itself as trainable: it optimizes per-feature bandwidths
  `x → w⊙x` (mode `bandwidth`), the circuit's non-data parameters
  (mode `embedding`), or both, to maximize centred kernel-target
  alignment on the train split (SPSA, best iterate restored). Every
  result embeds the best-RBF test accuracy, because bandwidth-tuned
  quantum kernels can collapse toward RBF kernels.
- **Quantum natural gradient** (`variational_qng`) — the variational
  classifier with the update `θ ← θ − η (g + λI)⁻¹ ∇L`, where `g` is the
  Fubini–Study metric averaged over the train batch. Same loss and data
  binding as variational training; only the optimizer step changes.

## Step 4 — Pick a dataset, optimizer and noise

### Dataset

| Setting | Values | Notes |
|---|---|---|
| QML dataset | `moons`, `circles`, `blobs`, `xor` (default `moons`) | Binary, 2 features, generated deterministically from the job seed |
| Dataset size | 8–200 samples (default 48) | Benchmark below uses 48 / 120 / 200 |

The kernel splits each dataset into train/test with a stratified split
(default 70% train) derived from the same seed, so the quantum kernel,
the classifier and the classical baseline all see *bit-identical* splits
for a given seed. A sensible first run: `circles` or `xor` (both quantum
models do well there), then `moons` and `blobs` to see them struggle —
see [Honest limits](#honest-limits-with-real-numbers).

### Quantum kernel settings

- **Ridge λ** (default 1) — regularization of the kernel ridge solve.
  The same field serves the classical baseline and alignment search.

### Classical baseline settings

- **Linear floor** — toggle whether the linear kernel is scored
  alongside the RBF sweep. Leave it on; it costs nothing and tells
  you when the problem was linearly easy all along.

### Kernel alignment search settings

- **Alignment mode** — `bandwidth` (default), `embedding` or `both`:
  what the SPSA search tunes. Pure feature maps (Example A) use
  `bandwidth`; classifier circuits can also tune their non-data
  parameters.
- **Alignment steps** — SPSA steps (benchmark uses 40).

### Variational QNG settings

QNG shares **Epochs** and **Learning rate** with variational training
and adds:

- **Metric λ** — regularization in `(g + λI)⁻¹` (default 10⁻³).
- **Metric every** — rebuild the Fubini–Study metric every N epochs
  instead of every epoch, to trade accuracy for speed.

### Variational training settings

- **Epochs** and **Learning rate** — full-batch training; the benchmark
  uses 60 epochs at learning rate 0.15 (Adam).
- **Optimizer** — `Adam` (default), `Gradient descent`, or `SPSA`. Start
  with Adam: in the benchmark SPSA ends at a higher loss than Adam on
  the datasets Adam can learn (e.g. `xor`, n = 48: SPSA test accuracy
  0.786 vs Adam 1.000). Where Adam itself fails (`moons`), SPSA
  occasionally lands higher by chance (n = 48: 0.500 vs 0.357) — neither
  is a result to build on there.
- **Gradient method** — `adjoint` (exact batched gradients, default) or
  `parameter_shift`. Disabled for SPSA, which estimates its own
  gradient (extra fields **SPSA a** / **SPSA c** appear).
- **Early stop** — patience in epochs, `0` = off. Note that early
  stopping keeps the *final* parameters; it does not restore the best
  epoch's parameters.

### Noise (simulated)

The **Noise (simulated)** row applies a device-channel model to the QML
analyses: **Shots** (`0` = exact), **Depolarizing p** and **Readout
flip q**. It is a simulated channel, *not* a device calibration. Results
show a `noise:` pill (and a kernel shot-variance pill for the kernel)
whenever the channel is non-exact, so a noisy run can never be mistaken
for an exact one. Leave all three at their exact defaults for your first
run; then try, for example, 512 shots with p = q = 0.05 — the benchmark
shows this changes variational test accuracy only mildly (within ±0.071
across all 12 dataset/size combinations; several are unchanged).

## Step 5 — Run and read the results

Press **Run analyses**. Each enabled analysis runs as its own job with
progress and cancellation; results land in their tabs.

### Kernel tab (`QmlKernelTab`)

- **Alignment** — centred kernel-target alignment in `[0, 1]` between
  the Gram matrix and the ideal label kernel `yyᵀ`. Higher means the
  feature map's geometry already respects the labels, before any
  fitting. Benchmark reference (Example A, n = 120): `blobs` 0.856,
  `circles` 0.394, `xor` 0.390, `moons` 0.283.
- **Test / Train accuracy** — kernel ridge accuracy on the held-out and
  training splits. Test accuracy is the number to quote.
- **Effective dim.** — effective dimension of the kernel spectrum, with
  the top eigenvalue's share. A spectrum dominated by one eigenvalue
  (kernel concentration) means most points look alike to the map.
- **Heatmap** — the full Gram matrix; brightness is `K(x, x′)`. A good
  map shows bright blocks within each class. Hovering shows the exact
  entry and both labels.
- **Notes** — read them: they restate the assumptions and the standing
  "not a quantum advantage claim" caveat.

### Training tab (`VariationalTrainTab`)

- **Final loss** (with the initial loss) and the **loss curve** over
  epochs — check the loss actually fell; a flat curve near the initial
  value with test accuracy near 0.5 means training did not learn (this
  genuinely happens on `moons`/`blobs`, below).
- **Test / Train accuracy** — `sign(⟨O⟩)` accuracy on each split.
- **Epochs / Optimizer** pills — which optimizer and gradient method
  produced the result, whether it stopped early, and the noise pill
  if a simulated channel was active.
- **Trained parameters table** — initial vs final value for every
  trainable parameter, so you can paste the trained angles back into
  code.

### Baseline, Alignment and QNG tabs

- **Classical baseline:** compare `baselines` (each with alignment and
  train/test accuracy) against the `quantum` block on the same split;
  `verdict` calls it `quantum_ahead`, `classical_ahead` or `tie`
  (|Δ| ≤ 1/n_test), and `geometric_difference` bounds how much
  separation the two kernels could ever achieve. With a classifier
  circuit (more than 2 parameters) the quantum block is `null` and the
  verdict is `no_quantum_kernel` — the classical numbers still report.
- **Alignment search:** compare `initial` vs `best` alignment (the
  search guarantees `best ≥ initial` on the train split), inspect the
  learned `bandwidth`, and always read `rbf_baseline_test_accuracy`
  next to the improved test accuracy. Test accuracy here is
  observational — alignment was optimized on train only.
- **QNG:** the training fields plus per-epoch gradient / natural-gradient
  norms and metric condition number, the final metric's eigenvalues, and
  a `fallbacks` count that discloses any epoch that fell back to a plain
  gradient step (never silent).

## A worked first session

1. Paste **Example A**, tick **Quantum kernel**, dataset `blobs`,
   size 120, run. Expect alignment ≈ 0.86 and test accuracy ≈ 0.97
   (benchmark seed 7: 0.972) — then switch the dataset to `moons` and
   watch test accuracy drop to ≈ 0.81 (0.806 at n = 120).
2. Paste **Example B**, tick **Variational training**, dataset
   `circles`, Adam. Expect the loss to fall to ≈ 0.14 and test accuracy
   1.000 (n = 120). Repeat on `moons`: expect a much worse result
   (0.639 at n = 120) — that failure is real and is the point of the
   next section.
3. Turn on simulated noise (512 shots, p = q = 0.05) and rerun
   `circles`: expect ≈ 0.97 (0.972) — a mild degradation, not a
   collapse, at this scale.

Your exact numbers depend on the job seed; the benchmark used seed 7.

## Honest limits (with real numbers)

All numbers in this section are test accuracies from the 88-row
benchmark in `docs/qml-benchmark-results/results.md` (seed 7; Examples A
and B above; reproduce with `../docs/qml-benchmark-results/run_benchmark.py`
from `kernel/`). No number is cherry-picked to flatter the quantum models.

| Dataset (n = 120) | Quantum kernel | VQC Adam | Best classical (RBF) | Verdict |
|---|---|---|---|---|
| `moons` | 0.806 | 0.639 | **0.972** | classical_ahead |
| `circles` | 1.000 | 1.000 | 1.000 | tie |
| `blobs` | **0.972** | 0.556 | 0.944 | quantum_ahead (kernel only) |
| `xor` | 0.972 | 0.972 | **1.000** | classical_ahead |

- **Classical wins on `moons` at every size.** The RBF baseline scores
  0.929 / 0.972 / 1.000 at n = 48 / 120 / 200, against the quantum
  kernel's 0.714 / 0.806 / 0.767 and the variational classifier's
  0.357 / 0.639 / 0.450. Alignment search improves the `moons` kernel
  (alignment 0.291 → 0.328, test accuracy 0.778 at n = 120) but does not
  catch the classical baseline. If your data look like `moons`, use the
  classical model.
- **The variational classifier is weak on `moons` and `blobs`.** On
  `blobs` — where the quantum kernel scores 0.972–1.000 — the trained
  classifier manages only 0.556–0.714 (Adam). This is an optimization /
  model-fit failure of this small ansatz and loss at these settings,
  not a bug: the loss curves show it directly. More layers do not fix
  it systematically (n = 120 depth study: `blobs` 0.528–0.611 for
  L = 1–4; `moons` 0.500–0.639).
- **Where quantum ties or leads, the problems are tiny and synthetic.**
  The kernel ties RBF on `circles` (1.000 vs 1.000) and `xor` (0.983 vs
  0.983 at n = 200) and edges it on `blobs` at n = 120 (0.972 vs 0.944,
  verdict `quantum_ahead`). These are 2-feature toy datasets fitted by
  exact statevector simulation at 2 qubits. They demonstrate that the
  pipeline works; they are not evidence of quantum advantage, and the
  Lab's result notes say so.
- **QNG tracks Adam, it does not rescue hard datasets.** Across the
  benchmark the QNG trainer lands within a few points of Adam on the
  same circuit (e.g. `circles` 1.000, `xor` 0.972, `moons` 0.611 at
  n = 120) at roughly twice Adam's wall time (40 epochs QNG ≈ 0.15 s
  vs 60 epochs Adam ≈ 0.09 s at n = 120). Preconditioning helps the
  geometry of a step; it cannot invent gradient signal where there is
  none.
- **Alignment search always improves alignment — and that is all it
  promises.** At n = 120 alignment rises on all four datasets
  (`moons` 0.291 → 0.328, `circles` 0.391 → 0.395, `blobs`
  0.853 → 0.887, `xor` 0.387 → 0.454), with test accuracy 1.000 on
  `circles`/`blobs`/`xor`. But alignment is optimized on the train
  split, and a bandwidth-tuned quantum kernel can end up mimicking an
  RBF kernel — which is why every result carries the RBF number next
  to it.
- **Simulated noise degrades mildly at this scale.** With 512 shots,
  depolarizing p = 0.05 and readout flip q = 0.05, variational test
  accuracy moves by at most 0.071 in either direction across the full
  benchmark (some moves are *up* — at test sets of 14–60 points, one
  sample is 0.017–0.071). Treat single-run wiggles as noise, in both
  senses, and do not extrapolate to real hardware: this is a simulated
  channel on exact statevectors, not a device.
- **Scope limits.** Binary labels, 2 features, built-in datasets only,
  ≤ 20 qubits, ≤ 200 samples per QML job, no hardware execution, and
  full-batch training. Multiclass, regression and user datasets are
  future work (see `docs/qml-final-synthesis.md`).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `qml_dataset_mismatch`: no data parameters found | No parameter name starts with `x`, and no explicit `data_params` list was set. Rename the encoding parameters to `x0`, `x1`. |
| `qml_dataset_mismatch`: parameter count ≠ features | The quantum kernel needs *exactly* 2 parameters. A classifier circuit (with `theta*` parameters) must use Variational training, alignment search or the classical baseline instead. |
| `no_parameters`: no trainable parameters | Every parameter is an `x*` data parameter. Add at least one trainable rotation for variational training. |
| `too_many_qubits` | QML analyses need a statevector; the circuit exceeds 20 qubits. |
| Test accuracy ≈ 0.5, loss barely falls | The optimizer did not learn this dataset/ansatz combination (expected on `moons`/`blobs` at the benchmark settings). Check the loss curve, try the kernel instead, and compare against the classical baseline before tuning blindly. |
| Noise fields seem ignored | Simulated noise applies to gradients and all five QML analyses; other Lab analyses note it as ignored. Check for the `noise:` pill in the result to confirm it was active. |

## Where next

- Diagnose *why* a classifier trains badly with the Lab's other tabs:
  gradient variance, scaling verdicts, Lie-algebra dimension and loss
  landscape all run on the same circuit (see the Trainability Lab
  guide).
- Read the full benchmark table (`docs/qml-benchmark-results/results.md`)
  and rerun it against your own circuit shapes with
  `run_benchmark.py`.
- For the complete state of QML in Nuclei — file inventory, test
  counts, what is wired where, and ranked next features — see
  `docs/qml-final-synthesis.md`.


