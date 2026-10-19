# PRD 15 — Spec 04: Learned QEC decoders and physics-verified Dirac suggestions

Status: v2 for implementation (2026-10-19, revised after the physics and engineering review — see master §10). Branch `feat/prd15-quantumness-lab`, based on v0.14.1.
Protocol: additive extension of lab messages v1.3 → **v1.4** (two new message families, `qec_learned_*` and `trainability_verify*`).
Companion specs: `01_QUANTUMNESS_CERTIFICATE`, `02_NOISY_TRAINABILITY_AND_KERNELS`, `03_SYMMETRY_COMPILER_AND_CLASSICAL_DEPLOY` (interfaces named in §9; never redesigned here).

> **Master-plan resolution (2026-10-19).** This spec is governed by `docs/research/PRD_15_QUANTUMNESS_LAB.md` §4.3 and §7: the cheap certificate is `kernel.surrogates.quick.certificate_cheap`, the noisy check is `kernel.noise.analyses.gradient_variances_noisy`, the symmetry proposer is the `symmetry_propose` sync message (`kernel/symmetry/propose.py`), and the `qec_learned_` prefix is one entry in `kernel/lab_routes.py`, `PROTOCOL_VERSION = "1.4"` and the lab message router (`kernel/lab_routes.py`) are owned by the Wave 1 foundations unit F-1, settings/analysis/handler/palette/Dirac/e2e-fixture extensions go through registries instead of shared-file edits, and the units below map onto the master waves as stated in §9. Learn mode is deprecated; nothing here touches it.

This document covers two ideas:

- **Idea 7 — Learned decoders in the QEC Workbench** (§1–§4): train a neural decoder on syndromes, compare it against matching, union-find and (on small codes) the exact maximum-likelihood floor, with paired confidence intervals and a leakage ledger; and let the Discovery Engine evolve decoder *architectures* through a new evaluator whose design makes test-set leakage impossible.
- **Idea 8 — Physics-verified Dirac suggestions** (§5–§8): Dirac proposes ansatz edits; the kernel re-analyses every proposal (lint, Pauli-propagation variance intervals, Lie closure, cheap certificate) in the candidate sandbox *before* the user sees it, and the editor only ever shows interval-separated, reproducible claims with an applicable diff.

The honesty rules of PRD 14 §1 apply unchanged: no midpoint-of-interval numbers, every value carries a method label and an interval or a `not_applicable` / `inconclusive` reason, and nothing is claimed that the kernel did not compute.

---

## 0. Ground rules that shape both ideas

1. **The managed venv has numpy, qiskit (+ scipy transitively), cirq, websockets, keyring, ruff. Nothing else.** `stim`, `pymatching`, `sinter`, `torch`, `pyarrow`, `duckdb`, `jsonschema` are optional (`kernel/discovery/_optional.py`, `src-tauri/src/commands/frameworks.rs` catalog). Every new kernel module imports cleanly without them; optional imports are lazy and surface as `missing_dependency` errors naming a catalog entry. The minimal-venv CI job (`kernel-tests.yml: pytest-minimal-venv`) must run every new test module and pass with the optional packages absent (tests that genuinely need one use `pytest.importorskip`).
2. **Every number is computed by trusted kernel code on an artifact**, never by LLM-written code and never by candidate code. The candidate sandbox (`kernel/discovery/candidate_worker.py` + `sandbox.py` + `isolation.py`) is the only place untrusted code runs. On the owner's Ubuntu 24.04 box `bwrap` is blocked (`kernel.apparmor_restrict_unprivileged_userns=1`), so the sandbox must not degrade to `process` silently: R-F adds a **`landlock` isolation tier** (Landlock ABI 8 is available there: read-only interpreter/venv, `kernel/` and system libs; read-write scratch only; project root read-only when the candidate needs it; TCP denied on ABI ≥ 4) and a **mandatory static AST pre-screen** (`kernel/discovery/prescreen.py`, R-F) that rejects `__import__`, `eval`/`exec`/`compile`, `importlib`, `open` in write modes, `os.remove/unlink/rmdir`, `shutil`, `pathlib` `write_*`/`unlink`, and `getattr` on string literals naming blocked attributes — mandatory whenever the isolation tier is `process`, and run before any `claude`-origin candidate executes at any tier. `process` additionally needs per-session `isolation_consent` with the exact capability text.
3. **Every feature has an end-to-end user path** (trigger → progress → result → error/unavailable states) and a Playwright spec against the stubbed-kernel pattern of `tests/e2e/discovery.spec.ts`.
4. **Reproducibility**: same inputs + seed → bit-identical outputs on the same backend. Seeds are derived per purpose with SHA-256 domain separation (as `qec_stats.derive_seed` does today).

---

## 1. Idea 7 — Motivation and novelty

### 1.1 What exists

- Google DeepMind's AlphaQubit (Bausch et al., *Nature* 635, 834–840 (2024), arXiv:2310.05900) trains a recurrent transformer decoder on simulated and then experimental surface-code data and beats matching-based decoders on Sycamore data. Earlier neural decoders: Torlai & Melko (PRL 119, 030501 (2017)); Varsamopoulos, Criger & Bertels (*Quantum Sci. Technol.* 3, 015004 (2018), arXiv:1705.00857); Chamberland & Ronagh (arXiv:1802.06441); Meinerz, Park & Trebst (PRL 128, 080505 (2022)); Varbanov et al. (arXiv:2307.03280, Phys. Rev. Research 7, 013029 (2025)); Lange et al. GNN decoders (arXiv:2307.01241, Phys. Rev. Research 7, 023181 (2025)).
- Classical baselines: minimum-weight perfect matching via Sparse Blossom (Higgott & Gidney, arXiv:2303.15933, *Quantum* 9, 1600 (2025); PyMatching 2), Union-Find (Delfosse & Nickerson, arXiv:1709.06218, *Quantum* 5, 595 (2021)) and its weighted variant (Huang, Newman & Brown, *Phys. Rev. A* 102, 012419 (2020)).
- In Nuclei today: `qec_memory` evaluator samples with Stim and decodes with PyMatching (`kernel/discovery/evaluators/qec_memory.py`, `qec_stats.py` with Wilson intervals, per-round conversion and the log-space Λ interval); the Decoder Workbench (`src/components/qec/DecoderWorkbench.tsx`) compares sinter campaign decoders; the interactive WASM matcher (`src/lib/qecDecoderWasm.ts`) re-decodes hand-toggled syndromes; the data engine imports `.dets`/`.b8` captures (`kernel/qec_data/adapters/stim_results.py`).

### 1.2 What is genuinely new here

1. **A DEM-native, numpy-only decoding lab.** All sampling, training and evaluation run from a *detector error model text* (Stim's documented DEM format) with a pure-Python parser and a numpy sampler. The DEM can come from Stim when it is installed, from a `.dem` file in the project, or from bundled DEMs generated offline by a pinned Stim and committed with provenance. A user with the stock managed venv can train and compare decoders on day one; installing Stim only widens the set of sources.
2. **The maximum-likelihood floor as a first-class number.** For small DEMs the kernel computes the *exact* ML decoder by an exact F2 convolution over the (syndrome, logical) state space — cost O(m·2^{n_D+n_L}) time and 2^{n_D+n_L} floats, gated on **n_D + n_L ≤ 24**, *not* on the mechanism count (the first draft's m ≤ 22 cap excluded every bundled circuit-level DEM: rep d=3 has 27 mechanisms, d=5 111, surface d=3 286). Every other decoder is then reported as an excess over the ML floor with a paired interval. No published decoder UI reports "distance to optimal" for the same shots; here it is the headline number whenever it is computable, and "not applicable (n_D + n_L > 24)" otherwise.
3. **Paired comparison statistics.** All decoders decode the *same* held-out shots, so decoder A vs B is a paired binary experiment. The report uses the discordant-pair counts (b = A wrong, B right; c = A right, B wrong), a validated **paired-difference interval** (Newcombe's method 10, the hybrid score interval — *Stat. Med.* 17, 2635 (1998); Tango's score interval as the alternative; Agresti–Min as fallback), with the verdict derived from that single interval (consistent with an exact McNemar test, McNemar, *Psychometrika* 12, 153 (1947)), and **Holm–Bonferroni** adjustment across every comparison in a run. This is both stronger and more honest than the usual overlapping-CI comparison, and it does not use the "exact conditional" mapping of a Wilson interval on b/(b+c) treating b + c as fixed, which Newcombe shows mis-covers the unconditional paired difference.
4. **A leakage ledger.** Train / validation / test / generalization shots are drawn from SHA-256 domain-separated seeds, every split is hashed, and the result document records the hashes and asserts disjointness. The Discovery evaluator goes further: the candidate never sees any data (it emits an architecture *spec*; the trusted scorer draws the data), so leakage is impossible by construction, not by policy.
5. **Architecture evolution with distance generalization as an objective.** The `decoder_architecture` evaluator trains at a small distance and scores held-out LER at the training distance *and* at d + 2, so the search is pushed toward architectures that transfer rather than memorise — an honest "not applicable" is reported when an architecture is distance-specific by construction (fixed input width without a geometric embedding).

### 1.3 What this is not

Not a replacement for PyMatching/sinter campaigns (those remain the path for large distances and real-time decoding). Not a claim that a numpy MLP beats AlphaQubit: the numpy path targets d ≤ 7, ≤ ~2·10^5 training shots, minutes of CPU. Larger models need the optional torch path (§3.4) and the UI says so.

---

## 2. Idea 7 — Math, estimators, algorithms, validity

### 2.1 Detector error model, sampling, decoding

A DEM is a set of independent error mechanisms `e_k ~ Bernoulli(p_k)`, k = 1..m. Each mechanism is a tuple of **components** `((D_{k,1}, L_{k,1}), (D_{k,2}, L_{k,2}), …)` — Stim's `^`-separated decomposition (e.g. `error(p) D0 D1 ^ D2 D3`, which circuit-level `decompose_errors=True` DEMs use to express Y-type errors as hyperedges split into graphlike pieces). The mechanism's total symptom is the **XOR** (symmetric difference) of its components' detector and observable sets — the union is wrong for sampling. With `H_D ∈ F2^{n_D×m}` and `H_L ∈ F2^{n_L×m}` built from the XOR-ed symptoms, the syndrome and logical flips of a sample `e ∈ F2^m` are `s = H_D e`, `ℓ = H_L e` (mod 2). The components are kept because the matching-graph decoders use them as edges (exactly as PyMatching does): discarding the decomposition would make `is_graphlike` false on precisely the surface-code sources where "learned decoder vs MWPM" matters, and a matching graph rebuilt without them would be an artificially weak baseline (a false "better than MWPM").

- **Sampler (numpy, exact for the DEM).** Draw `E ∈ {0,1}^{B×m}` with `E[:,k] ~ Bernoulli(p_k)` from a seeded `np.random.Generator(PCG64)`; `S = (E @ H_Dᵀ) mod 2`, `Λ = (E @ H_Lᵀ) mod 2`, computed in uint8 with `np.bitwise_xor.reduce` over sparse column lists for memory (m up to ~10^5, B batches of ≤ 2^14). This is the same model Stim samples from when it samples a DEM (`stim.DetectorErrorModel.compile_sampler`); it is *not* the circuit: a DEM already contains the decomposition choices (`decompose_errors`) and the approximations Stim made (e.g. independent mechanisms). The UI labels every DEM-sampled number "sampled from the DEM, not the circuit" and shows the DEM's provenance.
- **Parallel mechanisms** are merged with `p = p_1(1-p_2) + p_2(1-p_1)` **only when their full symptom sets (all components, XOR-ed detectors and observables) are identical**, exactly as `kernel/qec/dem.py` does for the graph view; mechanisms with the same XOR-ed symptom but different component splits are kept separate.
- **Decoding** maps `s ↦ ℓ̂`. A shot is a logical error when `ℓ̂ ≠ ℓ` on any observable (`np.any(ℓ̂ != ℓ, axis=1)`), matching `qec_stats.sample_logical_errors`.

### 2.2 Decoders

| id | Where | Requires | Validity |
|---|---|---|---|
| `exact_ml` | `kernel/qec/learned/decoders/exact_ml.py` | numpy | DEM with **n_D + n_L ≤ `ML_MAX_STATE_BITS` (24)** (F2 convolution over the (syndrome, logical) state space; m unbounded). Else `not_applicable: "n_D + n_L = … > 24"`. |
| `union_find` | `.../union_find.py` | numpy (pure Python graph ops) | Matching-graph DEMs only: every **component** touches ≤ 2 detectors (the decomposition the DEM carries is used as edges). Undecomposed hyperedges → `not_applicable` with the hyperedge count (reuses the honesty of `dem.py`). |
| `mwpm` | `.../mwpm.py` | pymatching (lazy) | Same graph condition. Built from the **original canonical DEM text** (`pymatching.Matching.from_detector_error_model_file` on the text, or a `stim.DetectorErrorModel` when Stim is present), never from a lossy re-serialisation. `missing_dependency` (catalog id `pymatching`) when absent. |
| `mlp_numpy` | `.../nn_numpy.py` | numpy | Any DEM. Input width fixed = n_D → distance-specific. |
| `mlp_numpy` + `feature: round_diff` | same | numpy | Rounds inferred from DEM detector coordinates (time axis = last coordinate) when present; otherwise the feature is `not_applicable`. |
| `transformer_torch`, `conv_torch` | `.../nn_torch.py` | torch (lazy; catalog entry `torch`, new) | Any DEM; distance-agnostic when coordinates exist (geometric embedding). |

**Exact ML.** For a syndrome `s`, the ML logical class is `argmax_{ℓ} Σ_{e : H_D e = s, H_L e = ℓ} Π_k p_k^{e_k}(1-p_k)^{1-e_k}`. The kernel computes the full joint distribution `P(s, ℓ)` by an **exact F2 convolution** over the `2^{n_D+n_L}` (syndrome, logical) states: start with `P = δ_{(0,0)}` and, sequentially over mechanisms, `P ← (1 − p_k)·P + p_k·shift(P, D_k ⊕ L_k)` where `shift` XORs every state index by the mechanism's symptom (a permutation of the array, `np.take` with a precomputed index map or a bit-trick on the flat index). Cost O(m·2^{n_D+n_L}) time and `2^{n_D+n_L}` float64 — rep d=3 with 3 rounds is 2^9 = 512 states, surface d=3 at 24 detectors + 1 observable is 2^25 ≈ 268 MB and is **not** applicable; the gate is **n_D + n_L ≤ 24** (`ML_MAX_STATE_BITS`), never the mechanism count. The table `T[s] → argmax_ℓ P(s, ℓ)` (memory `2^{n_D}·2^{n_L}` entries, *not* `2^{n_D}·n_L`) is cached. Larger DEMs: `not_applicable` with the reason. The bundled manifest test asserts that at least two bundled DEMs (repetition d = 3 and d = 5 circuit-level, 3 rounds: n_D = 8 and 24) are `exact_ml`-applicable. This decoder is the floor: for the DEM's own noise, no decoder has lower expected LER (standard maximum-likelihood optimality for a known channel). The report shows `ler_ml` with its Wilson interval and each decoder's `excess_over_ml` as a paired difference (§2.4).

**Union-Find.** Delfosse–Nickerson cluster growth by half-edges on the matching graph with boundary vertices, union by rank with path compression, peeling decoder on the spanning forest to pick a correction, then `ℓ̂ = H_L c`. Edges are the DEM's **components**. Weighted growth follows Huang, Newman & Brown (PRA 102, 012419 (2020)) with the log-likelihood weight PyMatching uses, `w = round(ln((1 − p)/p) · 1000)`, clamped at `p ≥ 0.5` (`w = 0`), so growth is deterministic and consistent with MWPM's weights. Complexity `O(n α(n))` per shot; pure Python is acceptable for n_D ≤ ~2000 and ≤ 10^5 shots (budgeted; progress-reported). Threshold behaviour is validated against the literature values only qualitatively (see §6).

**MWPM.** `pymatching.Matching.from_detector_error_model_file(<original canonical DEM text>)` (or `from_detector_error_model(stim.DetectorErrorModel(text))` when Stim is importable — `from_detector_error_model` takes a Stim object, so the file-based loader is what "requires only pymatching" means); `decode_batch`. Never built from a re-serialisation that dropped the `^` decomposition. Test: on a Stim rotated-surface-code DEM, `mwpm` predictions are identical to PyMatching run on the Stim DEM object, and `union_find` is applicable.

**Neural decoders (numpy).** Supervised classification: input `x = s ∈ {0,1}^{n_D}` (optionally concatenated with per-round XOR differences `s_t ⊕ s_{t-1}` when the DEM has a time axis, the "detection-event difference" preprocessing of the AlphaQubit lineage), output logits `z ∈ R^{n_L}`, loss = mean binary cross-entropy `Σ_j BCE(σ(z_j), ℓ_j)`. Architectures (`spec.layers`): `dense(width, act)`, `residual_dense(width)`, `dropout(p)`, `layernorm`; activations `relu|gelu|tanh`. Optimiser: Adam (β = (0.9, 0.999), ε = 1e-8) with cosine decay, mini-batches of 256–2048, L2 weight decay. Initialisation: Kaiming-uniform from the seeded generator. Backprop is hand-written in numpy (`nn_numpy.py` ≤ 400 lines); float32 throughout. Early stopping on the **validation** split (never on test). All randomness from one `Generator` seeded by `derive_seed(seed, "train")`.

**Why an MLP is a legitimate baseline.** For d ≤ 5 memory experiments the syndrome space is small enough that an MLP with 1–3 hidden layers of width 128–512 learns the dominant error classes from ≤ 10^5 shots; this is the regime of Varsamopoulos et al. and Chamberland & Ronagh. The report's job is to measure, with intervals, where it lands between union-find, MWPM and the ML floor — not to promise it beats them.

### 2.3 Splits, seeds, leakage ledger

Seeds: `splits.derive_seed(seed, domain, distance, p)` = first 8 bytes of SHA-256(`"qec_learned:{seed}:{domain}:{distance}:{p}"`) — a new function in `kernel/qec/learned/splits.py` (`qec_stats.derive_seed(seed, distance)` is not a domain-string API and is not reused), domains `train`, `val`, `test`, `test_confirm:{k}`, `gen_d+2`, `calib`. Shots per split are configurable (defaults `train 50 000, val 5 000, test 20 000`). **The test-split size is fixed before any decoding** — either as the configured `test.shots`, or by a stop rule that depends only on decoder-independent quantities (the count of non-trivial syndromes reaching `test.min_nontrivial`), recorded in the ledger as `test_stop_rule`. A stop rule keyed on any decoder's errors (optional stopping) would invalidate the nominal coverage of every interval below and is not offered. Once drawn, the identical shot matrix is decoded by every decoder.

**Adaptive overfitting ledger.** Because the test split is a deterministic function of the user seed, a user iterating architectures with the same seed selects on the test set. The ledger records a per-project **test-split use counter** (`experiments/.qec_learned_splits.json`: `{seed, distance, p} → uses`), shown in the report ("test split used 7 times in this project"), and the panel offers **"Confirm on a fresh test split"**, which re-decodes the saved decoders on `test_confirm:{k}` with a never-used k. Any "better than reference" shown as **final** (the report's headline, the exported MD) must come from a split never used for selection; otherwise it is labelled "selection split — confirm on a fresh split".

Leakage ledger (in `provenance.splits`): for each split, `{domain, seed, shots, sha256(S||Λ bytes)}`; a `disjoint: true|false` flag computed by hashing each row (SHA-256 of the packed row) into a set and checking train ∩ test = ∅ at the row level **for distinct error patterns**; because syndromes repeat legitimately (the same `s` occurs in train and test), the ledger reports `shared_syndrome_fraction` honestly instead of pretending it is zero, and `disjoint` refers to the *draws* (seed domains), which is what prevents training on the test draw.

### 2.4 Statistics (reusing `qec_stats.py`)

- Per decoder on the test split: `errors`, `shots`, `ler_shot`, Wilson 95% `ci95_shot`, per-round `ler_round`, `ci95` via `round_summary(errors, shots, rounds)` (rounds from the source; when unknown the per-round fields are `null` and labelled "per-shot only").
- **Paired comparison vs reference** (reference = `exact_ml` if available, else `mwpm` if available, else `union_find`): discordant counts `b, c`; `delta_shot = (b − c)/shots` with a **validated paired-difference interval**: Newcombe's method 10 (hybrid score, Stat. Med. 17, 2635 (1998)) by default, Tango's score interval (`stats.paired_interval(method="tango")`) as the alternative, Agresti–Min as fallback when the score iteration fails to converge; the interval level is **Holm–Bonferroni adjusted** across the family of all comparisons in the run (every decoder × reference at d and at d + 2, and per source), and the UI shows "adjusted (k comparisons)". The verdict derives from **that single interval**: `better` if entirely < 0, `worse` if entirely > 0, else `indistinguishable`; the exact McNemar p-value is reported alongside and the two agree by construction of the score interval (a disagreement is a test failure). With `b + c = 0` the verdict is `identical_on_these_shots`. A `better` verdict against `exact_ml` is impossible for the DEM's own noise and is reported as `suspect: "likely bug or leakage"`, never as a verdict.
- **Ratio to ML floor** `ler_dec / ler_ml` with the log-space delta-method interval of `qec_stats.lambda_ratio` (reused verbatim, including its `inconclusive` cases for zero counts). Its delta method assumes **independent** rates; on paired same-shot data it is conservative, and the UI labels the interval "conservative (ignores pairing)".
- **Distance generalization**: a second test split at `d + 2` from a *different* DEM (same family, same `p`, provided by the source; `not_applicable` when the source has no such DEM or the architecture is distance-specific). Reported with the same paired statistics against the reference decoder at `d + 2`.
- Λ between `d` and `d + 2` for each decoder via `lambda_ratio` (reused). Reported only when both per-round rates are defined.
- **Ranking** (`comparison.ranking`): decoders are ordered only where their adjusted paired intervals separate; ties are shown as tie groups (`[["ml"], ["mlp", "uf"]]`), never by point estimate.

### 2.5 Regimes and "not applicable"

- Saturation (`ler_shot ≥ 0.5`) → `saturated: true`, per-round rate 0.5, paired verdicts still computed.
- Zero errors on test → Wilson upper bound shown, point estimate shown as "< 1/shots observed", ratios `inconclusive` (existing `lambda_ratio` logic).
- Hyperedge DEMs → `union_find`/`mwpm` `not_applicable` with the hyperedge count; `exact_ml` and neural decoders still run.
- Non-memory DEMs (no observables) → the source is rejected at `qec_learned_sources` time with `no_observables`.
- Training divergence (NaN loss) → decoder status `failed` with `training_diverged`; the rest of the report proceeds.

### 2.6 Complexity and budgets

Sampling `O(B·nnz(H))`; exact ML `O(m · 2^{n_D+n_L})` time, `2^{n_D+n_L}` floats memory (hence the n_D + n_L ≤ 24 cap); UF `O(n α(n))` per shot; MLP training `O(epochs · N · Σ width_i width_{i+1})`. Default budgets: `training.time_budget_s` 120 (clamped 5–900), total job wall 20 min (inherits `WALL_LIMIT_SECONDS`), evaluation shots capped at 10^6, CPU limit via `apply_cpu_limit`. Cancellation is cooperative at batch granularity and the process group is killed by the manager otherwise.

---

## 3. Idea 7 — Kernel design

### 3.1 Module layout (new package `kernel/qec/learned/`)

```
kernel/qec/learned/
  __init__.py            # public: run_job, list_sources (no optional imports at module import)
  dem_text.py            # parse_dem(text) -> Dem ; serialize(Dem) ; flatten repeat/shift ; merge parallel
  dem_sampler.py         # DemSampler(dem, seed): sample(batch) -> (S uint8[B,n_D], L uint8[B,n_L])
  sources.py             # DemSource resolution: bundled | project_file | circuit (stim, lazy) | campaign_task
  bundled/               # committed DEM text fixtures + manifest.json (stim version, generator args, sha256)
  splits.py              # derive_seed, Split, draw_splits, ledger()
  decoders/
    base.py              # Decoder protocol: fit(S, L, S_val, L_val, budget, progress, cancel) ; predict(S) -> L̂ ; describe()
    exact_ml.py          # enumeration decoder with caps
    union_find.py        # Delfosse–Nickerson UF + peeling
    mwpm.py              # pymatching wrapper (lazy import)
    nn_numpy.py          # layers, forward/backward, Adam, early stopping
    nn_torch.py          # optional torch models behind lazy import
    registry.py          # DECODERS: id -> spec {title, requires, distance_agnostic, config_schema}
  arch_spec.py           # DecoderSpec JSON schema + validation (shared with the Discovery evaluator)
  stats.py               # paired_comparison(), excess_over_ml(), report assembly (imports qec_stats)
  job_worker.py          # subprocess entry (JSON lines), mirrors kernel/trainability/job_worker.py
  jobs.py                # LearnedDecoderJobManager(LabJobManager) : limits, bootstrap
  handlers.py            # qec_learned_* websocket handlers (sync + job), error envelopes
  provenance.py          # build_provenance(): versions, dem sha256, splits ledger, decoders fingerprint
```

Rules: no module imports `stim`, `pymatching` or `torch` at import time (`kernel/discovery/_optional.lazy_module` / `is_importable`). `dem_text.py` is the only DEM parser and is shared with the Discovery evaluator (§4). Files stay under 400 lines; `nn_numpy.py` may reach 500.

### 3.2 Core data structures (pure, immutable)

```python
@dataclass(frozen=True)
class Dem:
    n_detectors: int
    n_observables: int
    probs: np.ndarray            # float64[m]
    components: tuple[tuple[tuple[tuple[int, ...], tuple[int, ...]], ...], ...]   # per mechanism: ((D-set, L-set), ...) as written (the `^` split)
    det_cols: tuple[tuple[int, ...], ...]   # per mechanism, sorted detector ids = XOR of the components' D-sets
    obs_cols: tuple[tuple[int, ...], ...]   # XOR of the components' L-sets
    detector_coords: dict[int, tuple[float, ...]]   # may be empty
    is_graphlike: bool           # every COMPONENT touches <= 2 detectors
    canonical_text: str          # the canonical serialisation (components preserved) that mwpm loads
    hyperedges: int
    sha256: str                  # of the canonical serialised text

@dataclass(frozen=True)
class Split:  domain: str; seed: int; shots: int; sha256: str
@dataclass(frozen=True)
class DecoderSpec:  id: str; kind: str; config: dict   # validated by arch_spec.validate(kind, config)
@dataclass(frozen=True)
class DecoderReport:  # one per decoder (see wire shape §3.6)
```

Pure functions: `parse_dem`, `merge_parallel`, `draw_splits(dem, seed, sizes, stop_rule) -> dict[str, (S, L, Split)]`, `paired_comparison(wrong_a, wrong_b) -> dict`, `fit_predict(spec, data, budget, progress, cancel) -> (predict_fn, training_curve)`. Training state is local to `fit`; nothing module-global.

### 3.3 Sources

`list_sources(project_files, circuit_text, language)` returns:

- `bundled`: entries from `bundled/manifest.json` (repetition d = 3, 5, 7 and rotated surface d = 3, 5 memory-Z at p ∈ {1e-3, 3e-3, 1e-2}, SI1000-style generator args; generated by a pinned Stim at build time and committed; each entry stores `stim_version`, generator args, `sha256`, `rounds`, and the companion `d+2` DEM id). Always available.
- `project_file`: every `*.dem` under the project (≤ 8 MB), listed by **relative path only**; the kernel reads the file from the validated `project_root` when selected (size-capped, `O_NOFOLLOW`), and the text is **never** sent over the socket (an 8 MB frame would exceed the 1 MiB inbound cap and disconnect the Lab socket, cancelling every Lab job).
- `circuit`: the active editor circuit when `language == "stim"` **and** Stim is importable: `stim.Circuit(text).detector_error_model(decompose_errors=True)` with fallback to undecomposed (same rule as `dem.py`); when Stim is absent the entry is listed with `available: false, missing: ["stim"], install: {...}` (same shape as `availability.describe`). For a `d+2` companion the circuit must come from `qec_generate` (the kernel re-generates with `distance + 2`); otherwise the generalization test is `not_applicable: "no d+2 companion for this source"`.
- `campaign_task`: tasks from the current campaign (`circuit_text` per sinter task) when Stim is importable.

### 3.4 Optional torch path

`nn_torch.py` is imported only when `spec.kind in {"transformer_torch", "conv_torch"}`. If `torch` is not importable the job answers `missing_dependency` with `install: {catalog_ids: ["torch"], hint}`. A new Research-catalog entry `torch` (label "PyTorch (CPU)", `pip_name: "torch>=2.4,<3"`, import `torch`, group `research`, ~200 MB, not recommended) is added to `frameworks.rs` and `_optional.CATALOG_IDS`. Determinism: `torch.manual_seed`, `torch.use_deterministic_algorithms(True)`, single-threaded; the provenance records `torch` version. The torch path is explicitly "best effort reproducible across torch versions".

### 3.5 Job model

`LearnedDecoderJobManager(LabJobManager)` in `jobs.py` (NAME `qec_learned`, BUSY_CODE `qec_learned_busy`, INTERNAL_CODE `qec_learned_internal`, `MAX_JOBS_PER_OWNER = 1`, `MAX_JOBS_GLOBAL = 2`, wall 20 min; registered with `lab_proc.register_manager` so the Lab-wide cap of 4 running jobs also applies). The worker (`job_worker.py`, bootstrap like trainability's) reads one JSON spec from stdin and streams events:

```
{"event": "prepared", "dem": {n_detectors, n_observables, mechanisms, is_graphlike, hyperedges, sha256, rounds}, "splits": [...]}
{"event": "progress", "decoder": id|null, "phase": "sampling"|"training"|"evaluating"|"generalizing", "fraction", "message"}
{"event": "partial", "decoder": id, "report": DecoderReport}
{"event": "decoder_error", "decoder": id, "code", "message"}
{"event": "fatal", "code", "message"}
{"event": "done", "comparison": {...}, "provenance": {...}}
```

Rate-limited progress (≤ 10/s) and the cancel/kill semantics are inherited from `kernel/lab_proc.py`. The DEM is parsed in the worker (never in the server process) because parsing a hostile 8 MB file is CPU-bounded there.

### 3.6 Trusted results only

The worker runs only trusted code (our decoders) on *data*; the LLM/candidate path (§4) never reaches this worker. User-provided `.dem` files are data, parsed by a strict parser with size caps (≤ 8 MB, ≤ 200 000 mechanisms, ≤ 65 536 detectors), never `exec`'d.

---

## 4. Idea 7 — Discovery evaluator `decoder_architecture`

### 4.1 Contract

- Kind `decoder_architecture`, version `1.0.0`, task **`decoder_spec`** (new sandbox task: the entry returns a JSON-serialisable dict, no circuit). Entry signature: `build_decoder(n_detectors: int, n_observables: int, rounds: int | None, distance: int) -> dict`. The sandbox calls it once per `(distance)` in `config.distances` (default `[3, 5]`) and returns the dicts as artifacts `{"kind": "decoder_spec", "spec": {...}}`.
- The trusted scorer (`score` in `kernel/discovery/evaluators/decoder_architecture.py`) validates each spec with `arch_spec.validate`, resolves the DEM source from config (`source: {"bundled": "<id>"}` or `{"circuit_family": "surface_code:rotated_memory_z", "p": 1e-3}` needing Stim), draws splits with seeds derived from the evaluation `seed`, trains, and scores. **The candidate never receives any sample**: its only inputs are integers describing the problem. Leakage is impossible by construction and the Guardrails tab says exactly that.
- Objectives: `logical_error_per_round` at the largest distance (minimize, with `ci95`), `parameters` (minimize). Descriptors: `log10_parameters` (0–7), `depth_layers` (0–16). Fitness: `-log10(max(ci95_hi, FITNESS_FLOOR))` averaged over distances (as `qec_memory`), **minus** `GENERALIZATION_PENALTY = 0.5` when the architecture is distance-specific or the `d+2` test is worse than the reference decoder beyond the paired interval, **minus** `0.25` per decoder whose training hit the budget before validation loss plateaued (`training_censored`). Nothing is added for beating MWPM; the ML floor is reported but never used to inflate fitness.
- Guardrails (first-fail, order): `spec_schema`, `parameter_budget` (≤ `config.max_parameters`, default 2·10^6), `training_budget` (per-spec `time_budget_s` ≤ stage budget), `nontrivial` (test LER must beat the trivial decoder `ℓ̂ = 0` beyond the paired interval, else `rejected`), `reference_available` (WARN when neither MWPM nor UF is applicable, in which case the paired verdict is against `exact_ml` or `trivial`), `determinism` (confirm stage only: retrain with the same seed, bit-identical test predictions, else FAIL).
- Stages: `screen` → `{train_shots: 10_000, test: {min: 2000, max: 5000, max_errors: 50}, distances: [first]}`; `full` → defaults; `confirm` → `determinism` on, fresh seeds, both distances.
- Availability: listed in `availability.REQUIRES` as `()` (numpy-only when the config uses a bundled DEM); the scorer raises `MissingDependency(["stim"])` at run time only for `circuit_family` sources, and the frontend's config form defaults to a bundled source so the evaluator is usable in the stock venv.
- Red Queen audit (`audits/decoder_architecture.py`): re-draws test shots with a different seed domain, re-trains from scratch, requires LER agreement by an **unpaired two-proportion interval** (Newcombe hybrid score for two independent binomials — the audit's draw and the evaluator's draw are independent, so a paired interval does not apply), re-checks the parameter count by instantiating the spec independently.
- **Champion reporting**: the `screen` and `full` stages score every candidate on a fixed seed, so their LERs are selection-split numbers; the champion's reported LER comes **only** from the `confirm` stage's fresh seeds, and the archive marks every other number "selection split".

### 4.2 Why an architecture spec and not code

Letting candidates ship arbitrary training code would make "did it cheat on the test set" an unanswerable question for a scorer that must hand the data over. A declarative spec (layers, widths, activations, features, optimiser hyper-parameters within bounded ranges) keeps all learning inside trusted code while leaving a rich search space (the LLM mutator edits the Python that *builds* the spec, so it can reason about rounds/distance). The honesty text in the Definition panel states this trade-off.

---

## 5. Idea 8 — Motivation and novelty

### 5.1 What exists

AlphaEvolve (Novikov et al., arXiv:2506.13131) and FunSearch (Romera-Paredes et al., *Nature* 625, 468–475 (2024)) pair an LLM proposer with a trusted evaluator in an evolutionary loop; Nuclei's Discovery Engine is that loop for quantum programs (PRD 14 §7.4, `services/discovery/llmMutator.ts`, `diff.ts`, sandbox + trusted scorer). IDE assistants (Copilot-style) propose edits with no physics check. Nuclei's Dirac today: chat with context (`useDirac.ts`), ⌘K inline edit and ⌘I compose that replace code after a *textual* preview (`InlineEditWidget.tsx`, `DiffPreview.tsx`), and lightbulb code actions from static circuit heuristics (`quantumCodeActions.ts`).

### 5.2 What is new

**Every suggestion is a verified claim about the user's own circuit, or it is not shown as a suggestion.** Dirac proposes SEARCH/REPLACE edits; the kernel re-analyses each resulting program in the candidate sandbox, computes exact or rigorously-bounded quantities (PPE gradient-variance intervals, DLA dimension and purities, TRN lint, optional cheap certificate from spec 01), compares them to the *same* quantities on the baseline, and only interval-separated improvements are labelled "verified". Suggestions that fail are shown collapsed as "rejected: <reason>" (never hidden silently, so the user learns what Dirac tried), and overlapping intervals are "inconclusive". The diff applies in Monaco with undo. The proposer is interchangeable: Claude (with an API key), the AST mutator (`discovery_mutate`, offline), or spec 03's symmetry compiler (deterministic rewrites). This makes the feature usable and honest with no network at all.

---

## 6. Idea 8 — Math, verification rules, validity

### 6.1 Quantities (all existing kernel analyses on the IR)

For a baseline program `P0` and candidate `Pi`, the observable `O` is resolved **once from the baseline** (as in `trainability_start`: request → `nuclei_observable` → `preset:local_z`) and **the same `O` is used for every candidate**. A candidate whose code changes `nuclei_observable` or `nuclei_model`, or whose resolved observable text would differ from the baseline's, is rejected with `observable_changed` — switching a global-Z layout to a local one is the canonical way to game trainability (the Cerezo cost-locality effect) and is never "verified". The verifier computes on the IR (never by running candidate code outside the sandbox):

1. **Lint** `TRN001–TRN007` (`lint.lint`) — errors reject, warnings are shown.
2. **Structural invariants** (precisely): `n_qubits` equal; `len(parameters) ≥ 1`; **`support(O)` and the coefficients of `O` identical** (the observable is frozen, so this is a consistency assertion); the candidate's parameter count and parameter sharing are recorded and, when they differ from the baseline, the card is flagged "parameter count/sharing changed — mean variance is not like-for-like" and the per-parameter variances are shown alongside the mean. Violations reject with `structure_changed`. (The first draft's "light-cone qubit set unchanged" is dropped: the backward light cone necessarily changes when gates change, so it was either ill-defined or contradictory with cost edits.)
3. **Gradient variance** by PPE (`ppe_core.gradient_variances` via `pauliprop.ppe_gradient_variances`): per-parameter variances with truncation intervals `[lo, hi]`, `variance_mean_interval`, method `pauli_propagation_exact|bounded`. When `ppe_applicable` is false (non-rotation gates, `init != uniform`) or `n > MAX_PPE_QUBITS`, fall back to batched statevector sampling for `n ≤ 14` with bootstrap CI (`analyses.gradient_statistics`, 200 samples, seeded); above that the quantity is `unverifiable` and the suggestion can at most be "lint-clean", never "verified".
4. **Lie closure** (`lie.lie_algebra`, budget 3 s, `max_dimension` 4096): dimension (or lower bound with `complete: false`), classification, Ragone prediction applicability, `g`-purity membership.
5. **Cheap certificate** (cross-spec §9: `certificate_cheap(ir, observable, budget_s)`), only when the spec 01 kernel module is importable and the budget allows; otherwise `skipped`. It carries spec 01's `brute_force` status, and the card never renders a brute-force result as "simulable" (it says "brute-force simulable at n = N"). For goal `trainability` it is **required** when available (§6.2).
6. **Cost** (`kernel/discovery/cost.two_qubit_cost`, `total_depth`) for the "no free lunch" line in the UI.

### 6.2 Verdict rules (deterministic, pure, unit-tested)

Let `V0 = [lo0, hi0]` and `Vi = [loi, hii]` be the mean-gradient-variance intervals (both from the same method; a method mismatch, e.g. exact vs bounded, is allowed but labelled). Define `informative(V)` as in PPE: `lo > 0` and `hi/lo ≤ 2` (reuses `_frontier_probe.is_informative_point`).

- `rejected` — lint error, structure violation, `observable_changed`, AST pre-screen rejection, sandbox failure, IR conversion failure, PPE/sampling failure on the candidate, or `hii < lo0` with the user's goal being *trainability* (a verified regression).
- `verified_improvement` — goal `trainability`: `loi > hi0` (interval-separated), both informative, **and the DLA dimension is non-decreasing** (complete closure on both, `dim_i ≥ dim_0`) with the Lie classification not moving to polynomial / `g_sim_feasible`. The easiest way to raise gradient variance is to collapse expressivity (remove entanglers, make the circuit a product, restrict it to a small DLA), which under Cerezo et al. makes it classically simulable; such a candidate gets the verdict `improvement_by_reduced_expressivity` instead — rendered "variance gained by reducing expressivity; likely classically simulable (Cerezo et al.)", with the DLA numbers and the cheap certificate line, and **no plain "verified" pill** (Apply stays available, clearly labelled). When the `certificate_cheap` check is available it is mandatory for this goal and its spec 01 verdict is quoted untouched; goal `cost`: two-qubit cost strictly lower with `loi ≥ lo0` (no measurable variance loss: `hii ≥ lo0` is required in addition, otherwise `inconclusive`); goal `expressivity`: DLA dimension strictly larger with complete closure on both and `hii ≥ lo0`.
- `verified_no_regression` — lint clean, structure ok, `hii ≥ lo0` and `loi ≤ hi0` with the cost not higher; used for "cleanup" style edits.
- `inconclusive` — intervals overlap or one is uninformative (bounded PPE that hit the budget). Shown with the numbers and "could not separate the intervals within the budget"; the user can press "Verify harder" (budget × 4, scaling check).
- `unverifiable` — no gradient quantity could be computed (n too large for sampling, PPE not applicable). Shown only under "Unverified ideas" with lint results and an explicit label.

Optional **scaling check** (off by default, user-triggered, budget 60 s): runs `scaling.scaling_study` on both programs for the inspection's `sweepable_params`, and the verdict is upgraded to `verified_improvement_scaling` only if the fitted `beta_upper95` of the candidate is below the baseline's `beta_lower95` (interval-separated slopes); otherwise the scaling line reads `inconclusive` with both intervals. In the n ≤ 14 bootstrap fallback, "Verify harder" re-runs use a **fixed seed per verification attempt** (`derive_seed(seed, "verify", attempt)`), the attempt count is recorded on the card, and repeated sampling runs are treated as a new comparison family for the (Holm–Bonferroni) multiplicity note — never as optional stopping on the same draw.

Every verdict carries the exact numbers, the method label, and the seed; the certificate line (when present) carries spec 01's own verdict and interval untouched.

### 6.3 Validity and what "verified" means (UI copy)

> Verified means the kernel re-analysed this exact program with the same observable and initialisation and the stated interval holds for this qubit count. It is not a statement about larger sizes unless the scaling line says so, and it says nothing about hardware noise (see spec 02).

### 6.4 Latency budget

Target end-to-end ≤ 30 s for 4 proposals at n ≤ 20: LLM proposal round ≤ 8 s (haiku breadth, `max_tokens` 2048, 4 proposals in one call via the existing `propose_program_edit` tool with `count` → we request one edit per call and issue 4 concurrent calls, as the discovery breadth path does); AST pre-screen (ms); sandbox IR extraction ≤ 3 s per candidate (**parallelism capped at 2** sandboxes per verify job); trusted analysis ≤ 5 s per candidate (PPE budget 3 s, Lie 1.5 s, lint 0.35 s); results stream per candidate. Hard cap `budget_ms` 60 000 → remaining candidates finish as `inconclusive: budget_exhausted`.

**Sandbox process hygiene (binding).** The verify worker spawns candidates with `run_process(own_group=False)` — or tracks each candidate's pgid and kills it on SIGTERM — so that a cancel or wall-limit kill of the job worker never orphans candidate processes (today `LabJobManager` SIGKILLs only the job worker's process group); `kill_process_group` for jobs with children uses SIGTERM then SIGKILL. Nested sandboxes **count against the Lab-wide cap** (`lab_proc.total_running()` includes them) — hence the cap of 2. The isolation tier and the per-session `isolation_consent` are passed in the job spec (the server decides, the worker enforces). The sandbox's read allow-list gets the **project root read-only** (bwrap `--ro-bind`, a Landlock read rule, `sandbox-exec` allow) when the baseline imports sibling modules or reads project data; where the tier cannot grant it, such candidates are `unverifiable: "needs project files"` with that reason, never silently `rejected`. Test: cancelling a verify job with 2 running candidates leaves no candidate process alive.

### 6.5 Caching

Key `sha256(framework || baseline_code || observable || init || seed || candidate_code || checks)` → verification record, in-memory LRU 256 in the kernel (`kernel/trainability/verify_cache.py`) and mirrored in the frontend store keyed the same way (so re-opening the panel does not re-verify). Baseline analysis is cached by `sha256(framework || code || observable || init || seed)` and reused across proposals.

---

## 7. Idea 8 — Kernel design

### 7.1 Modules

```
kernel/trainability/
  verify.py              # verify_candidates(baseline, candidates, observable, checks, budget) -> records (pure over IR + sandbox results)
  verify_rules.py        # verdict(baseline_metrics, candidate_metrics, goal) -> {verdict, reasons[], numbers}
  verify_cache.py        # LRU keyed as §6.5
  verify_handlers.py     # trainability_verify / trainability_verify_cancel (job via jobs.py)
kernel/discovery/
  candidate_worker.py    # (+) task "module_circuit": exec program, locate circuit via the same rule as
                         #     kernel/trainability/_usercode.find_circuit_object, emit IR artifact
```

`verify.py` never executes candidate code. It applies each candidate's SEARCH/REPLACE edits to the baseline kernel-side (`kernel/discovery/diff_apply.py`, F-1 — the same semantics as the frontend's `diff.ts`), runs `kernel.discovery.prescreen.check(code)` (R-F; mandatory on `process` hosts and for every `claude`-origin candidate), then calls `kernel.discovery.sandbox.run_candidate` with task `module_circuit` and `cpu_seconds = 10`, receives the IR JSON artifact, re-parses it with `ParamCircuit.from_json` (as `_circuit_common.ir_conversion_check` does), and runs the analyses. The *baseline* is the user's own code and runs the normal trusted-user path (`_usercode.load_circuit` in the job subprocess, same trust as `trainability_start`); its IR is then analysed identically so both sides use the same pipeline.

### 7.2 Job model

Verification runs as a trainability job (same `TrainabilityJobManager`, `job_id` prefix `vfy-`), so limits, cancel, wall-clock and the ≤ 10/s progress rule are inherited. The worker event stream adds `{"event": "partial", "analysis": "verify", "result": VerificationRecord}` per candidate and `{"event": "partial", "analysis": "verify_baseline", ...}` first.

### 7.3 Resource limits

≤ 8 candidates per request (`MAX_VERIFY_CANDIDATES`). **Candidates travel as SEARCH/REPLACE edits against the baseline, never as full programs**: the baseline is sent once (≤ `MAX_CODE_BYTES`), each candidate's edits ≤ 64 KB, and the whole request ≤ 900 KB (`too_large` otherwise) — 8 × 200 KB programs plus a 1 MB baseline would exceed the kernel's 1 MiB inbound frame cap and the resulting 1009 close would cancel every Lab job on the socket. PPE frontier cap 500 000 strings, Lie `max_dimension` 4096, statevector fallback n ≤ 14 with 200 samples, total `budget_ms` ≤ 120 000.

---

## 8. Protocol v1.4 (additive)

All new replies are flat `{"type": ...}`; errors `{"type": "error", "phase": "qec_learned" | "trainability", "code", "message", "job_id"?, "request_id"?}`; sync requests accept `request_id` per `kernel/lab_protocol.py`. `kernel/lab_routes.py` (master F-1) gains the entry `"qec_learned_": "kernel.qec.learned.handlers"` (which also feeds `server._LAB_MESSAGE_PREFIXES` and the phase name `"qec_learned"`); `provenance.PROTOCOL_VERSION = "1.4"` is owned by F-1.

### 8.1 `qec_learned_*`

| Request | Response(s) | Mode |
|---|---|---|
| `qec_learned_sources {project_root, project_files?: string[] (relative *.dem paths; the kernel stats them under project_root), circuit?: {text ≤ 256 KB, language}, campaign_tasks?: [{strong_id, circuit_path}]}` | `qec_learned_sources_result {sources: [DemSourceInfo], decoders: [DecoderInfo]}` | sync (worker thread; never parses a DEM) |
| `qec_learned_start {job_id, source: DemSourceRef, decoders: [DecoderSpec], seed?, splits?: {train, val, test: {min, max, max_errors}}, training?: {time_budget_s, epochs_max, batch_size}, generalization?: bool}` | `qec_learned_started {job_id}` → `qec_learned_progress {job_id, decoder, phase, fraction, message}` → `qec_learned_partial {job_id, decoder, report}` → `qec_learned_result {job_id, status, dem, splits, reports: {id: DecoderReport}, comparison, errors: {id: {code, message}}, elapsed_ms, provenance}` | job |
| `qec_learned_cancel {job_id}` | `qec_learned_cancelled {job_id, accepted}` | sync |

Shapes:

```json
DemSourceRef   = {"kind": "bundled", "id": "rep_d3_p1e-3"} | {"kind": "project_file", "path": "circuits/x.dem"} (text read by the kernel from project_root) |
                 {"kind": "circuit", "text": "...", "language": "stim", "generate": {"code": "...", "distance": 3, "rounds": 3, "noise": {...}}?} |
                 {"kind": "campaign_task", "strong_id": "...", "circuit_text": "..."}
DemSourceInfo  = {"ref": DemSourceRef(without text), "title", "available": bool, "missing"?: [..], "install"?: {...},
                  "n_detectors"?, "n_observables"?, "rounds"?, "distance"?, "has_companion_d_plus_2": bool, "provenance": {"stim_version"?, "sha256"?}}
DecoderInfo    = {"id": "exact_ml"|"union_find"|"mwpm"|"mlp_numpy"|"transformer_torch"|"conv_torch", "title", "available", "missing"?, "install"?,
                  "distance_agnostic": bool, "config_schema": {...}, "default_config": {...}}
DecoderSpec    = {"id": "<user label, [A-Za-z0-9_-]{1,32}>", "kind": DecoderInfo.id, "config": {...}}
DecoderReport  = {"id", "kind", "status": "scored"|"not_applicable"|"failed", "reason"?: str,
                  "test": {"shots", "errors", "ler_shot", "ci95_shot", "ler_round", "ci95", "saturated"} | null,
                  "paired": {"reference": "exact_ml"|"mwpm"|"union_find"|"trivial", "b", "c", "delta_shot", "delta_ci": [lo, hi], "interval_method": "newcombe10"|"tango"|"agresti_min", "level_adjusted": 0.9875, "family_size": 4, "mcnemar_p", "verdict": "better"|"worse"|"indistinguishable"|"identical_on_these_shots"|"suspect"} | null,
                  "excess_over_ml": {"ratio", "ci95", "verdict", "label": "conservative (ignores pairing)"} | null,
                  "generalization": {"distance", "test": {...}, "paired": {...}} | {"not_applicable": str},
                  "lambda": {...} | null,
                  "training": {"parameters", "epochs", "train_loss_final", "val_loss_best", "val_curve": [[epoch, loss]], "censored": bool, "elapsed_ms"} | null,
                  "compute": {"backend": "numpy"|"torch"|"pymatching", "method": str}}
comparison     = {"reference", "ml_floor_available": bool, "ranking": [[id, ...], ...] (tie groups, interval-separated only), "family_size", "notes": [str]}
provenance     = {"nuclei_protocol": "1.4", "dem_sha256", "source": DemSourceRef, "splits": [Split], "disjoint_draws": true, "test_stop_rule", "test_split_uses": int,
                  "shared_syndrome_fraction", "seed", "kernel": {"python", "numpy", "stim"|null, "pymatching"|null, "torch"|null},
                  "decoders_fingerprint": "<sha256 of kernel/qec/learned/**/*.py>", "created_at"}
```

Error codes (phase `qec_learned`): `invalid_request`, `invalid_source` (unparseable DEM, caps exceeded, `no_observables`), `missing_dependency` (+ `missing`, `install`), `unknown_decoder`, `invalid_config`, `qec_learned_busy`, `qec_learned_internal`, `cancelled` (as result status). Progress ≤ 10/s.

### 8.2 `trainability_verify`

| Request | Response(s) | Mode |
|---|---|---|
| `trainability_verify {job_id, code, language?, params?, project_root?, observable?, init?: "uniform"\|"small", seed?, goal: "trainability"\|"cost"\|"expressivity"\|"cleanup", candidates: [{id, edits: [{search, replace}], origin: "claude"\|"ast"\|"symmetry"\|"user", rationale?}], checks?: ["lint","ppe","lie","certificate","scaling"], budget_ms?, isolation_consent?: bool, attempt?: int}` (request ≤ 900 KB) | `trainability_started {job_id}` → `trainability_progress {job_id, analysis: "verify", fraction, message}` → `trainability_partial {job_id, analysis: "verify_baseline"\|"verify", result}` → `trainability_result {job_id, status, results: {"verify": {baseline, candidates: [VerificationRecord]}}, errors, elapsed_ms, provenance}` | job |
| `trainability_cancel {job_id}` | existing | sync |

```json
VerificationRecord = {"id", "origin", "verdict": "verified_improvement"|"verified_improvement_scaling"|"improvement_by_reduced_expressivity"|"verified_no_regression"|"inconclusive"|"unverifiable"|"rejected",
  "reasons": [str], "cache_hit": bool,
  "metrics": {"n_qubits", "n_parameters", "two_qubit_cost", "depth",
              "variance": {"method", "mean", "interval": [lo, hi], "interval_kind": "truncation"|"bootstrap", "informative": bool, "per_parameter": [...]} | null,
              "parameters": {"count", "shared": bool, "changed_from_baseline": bool},
              "lie": {"dimension", "complete", "classification", "prediction_applicable"} | null,
              "lint": {"diagnostics": [...], "summary": {...}},
              "certificate": {...spec 01 shape...} | {"skipped": str},
              "scaling": {"beta_ci95", "verdict"} | null},
  "baseline_delta": {"variance_log2": [lo, hi] | null, "two_qubit_cost": int, "lie_dimension": int | null},
  "diff": {"edits": [{"search", "replace"}], "spans": [{startLine, endLine}]},
  "sandbox": {"isolation", "isolation_detail"}}
```

Error codes (phase `trainability`): existing ones plus `too_many_candidates`, `candidate_too_large`, `too_large` (aggregate request), `verify_unavailable` (sandbox cannot start), `isolation_consent_required`. Candidates that fail individually never fail the job: they become `rejected` records with `reasons: ["sandbox: <code>"]`, `["prescreen: <rule>"]` or `["observable_changed"]`.

### 8.3 Protocol docs and fixtures

`docs-site/src/content/docs/kernel-api/messages-lab.mdx` gains both families; fixtures `docs-site/fixtures/lab_qec_learned_sources.*`, `lab_qec_learned_start_invalid.*`, `lab_trainability_verify_invalid.*` and streams `docs-site/fixtures/lab/qec_learned_start.stream.json`, `lab/trainability_verify.stream.json`, replayed by `test_docs_fixtures.py` / `test_docs_lab_fixtures.py`. The protocol changelog gets a v1.4 entry; CLAUDE.md gains "Kernel Protocol v1.4".

---

## 9. Cross-spec interfaces (named, not designed here)

- **Spec 01 (Quantumness certificate / surrogate suite)** — needed by §6.1(5): `kernel.surrogates.quick.certificate_cheap(circuit: ParamCircuit, observable: PauliSum, *, time_budget_s: float, seed: int, cancel) -> dict` returning spec 01's §3.6 quantumness shape with `evidence: "cheap"` (verdict, winners/cheapest surrogate, claim, `not_applicable` reasons, `elapsed_ms`); and `kernel.surrogates.quick.is_available() -> bool`. The verifier treats it as optional (`skipped` when absent) and quotes spec 01's verdict text untouched.
- **Spec 02 (Noisy trainability)** — optional check `"noisy_ppe"`: `kernel.noise.analyses.gradient_variances_noisy(circuit, observable, noise_model, *, method="auto", **budget) -> same shape as ppe_gradient_variances (+ nonunital, bounds, noiseless)`; the request carries `noise_model: NoiseModelJson` (parsed with `NoiseModel.from_json`). The verifier adds a `noisy_variance` metric with its own verdict line when the user selects a noise model in the Trainability Lab; absent → not offered.
- **Spec 03 (Symmetry compiler)** — proposer: `kernel.symmetry.propose.propose_rewrites(circuit: ParamCircuit, observable: PauliSum, *, max_proposals: int) -> list[{"preset", "code_edits": [{search, replace}], "rationale"}]` exposed by spec 03's `symmetry_propose` → `symmetry_proposals` sync message; Idea 8 only consumes the SEARCH/REPLACE list via `origin: "symmetry"`.
- **Discovery UI** — `src/types/discovery.ts` `DiscoveryEvaluatorKind` gains `'decoder_architecture'` and `DiscoveryTask` gains `'decoder_spec'` (extend-only, owned by the Lead per PRD 14 §10).

---

## 10. Frontend / UX

### 10.1 Idea 7 — "Learned Decoders" in the QEC Workbench

- **Where.** New panel `learned-decoders` in `src/layout/qecPanelRegistry.ts` (zone `canvas`, presets `['analyze']`, order 10, pinnable). Also reachable from: the Decoder Workbench header button **"Train a learned decoder on these circuits"** (uses `campaign_task` sources); the command palette **"QEC: Train learned decoder"** (`category: 'QEC'`, added in `buildCommands` via a new `CommandActions.openLearnedDecoders`); and a **Dirac** slash command `/decoders` that opens the panel with the current circuit pre-selected. Learn mode never shows it (research-only, like the rest of QEC Studio).
- **Flow.** `LearnedDecodersPanel` → Source picker (segmented: Current circuit / Campaign tasks / Project .dem / Bundled) → Decoder chips (Exact ML, Union-Find, MWPM, MLP (numpy), Transformer (torch)) each showing availability (`EvaluatorUnavailable`-style card with "Open Environment setup" when `missing`) → Split & training settings (`LabNumber` fields, clamped like the kernel) → **Train & compare** (`LabButton primary`, ⌘⇧D while the panel is focused) → live progress (`LabProgress` per decoder, phase label) → results table + charts → **Export report** (`experiments/<source-stem>.decoders.{json,md}` via `PlatformBridge`, pure renderer `services/qecLearned/report.ts` with snapshot test).
- **States.** `idle` (empty state copy: "Pick a detector error model and at least one decoder."), `sources_loading`, `unavailable_desktop` (web build: `LabDesktopRequired`), `unavailable_dependency` (per decoder, inline), `invalid_source` (inline error with the kernel message, e.g. "This DEM has no logical observables, so there is nothing to decode."), `running` (cancel button → `cancelling`), `partial` (rows fill in as `qec_learned_partial` arrive), `complete`, `cancelled`, `failed` (kernel error with code and message), `stale` (editor circuit changed since the run; banner with "Re-run").
- **Results table columns.** Decoder · Status · LER/shot [Wilson 95%] · LER/round [95%] · vs reference (Δ with interval and McNemar p, verdict pill) · Excess over ML floor (ratio [95%] or "n/a: DEM too large for exact ML") · d+2 generalization (LER [95%] or "n/a: <reason>") · Λ · Params · Train time. Charts: validation-loss curves (`LabLineChart` from `src/components/lab/charts.tsx`, added by F-3 — `LabLine`/`LabHeatmap` do not exist today), LER-by-decoder bars with interval whiskers (`IntervalBars`), a paired-outcome 2×2 grid per decoder vs reference; the "test split used N times" counter and the **Confirm on a fresh test split** button.
- **Honesty copy** (in `services/qecLearned/honesty.ts`): "Numbers are sampled from the detector error model, not from the circuit; the DEM already fixes Stim's decomposition and independence approximations." · "The ML floor is exact for this DEM; no decoder can beat it on expectation — a 'better' result against it is flagged suspect." · "Paired comparison: both decoders saw the same shots; the interval is a Newcombe hybrid-score interval on the paired difference, adjusted for {k} comparisons (Holm–Bonferroni)." · "Excess over the ML floor: conservative interval (ignores pairing)." · "A numpy MLP at d ≤ 7 is a baseline, not AlphaQubit." · "Train, validation and test shots come from different seed domains; the ledger records their hashes." · "This test split has been used {n} times in this project; confirm on a fresh split before reporting."
- **TS** (`src/types/qecLearned.ts`): `DemSourceRef`, `DemSourceInfo`, `DecoderInfo`, `DecoderSpec`, `DecoderReport`, `LearnedRunRecord`, `QecLearnedRequest`/`QecLearnedResponse` unions, status union. **Store** `src/stores/qecLearnedStore.ts` (zustand; module-scope session like `trainabilityStore`; `jobs`, `selectedJobId`, `sources`, `decodersCatalog`, `settings`, `start/cancel/refreshSources/exportReport`). **Service** `src/services/qecLearned/client.ts` (wraps a `LabSession` exactly like `trainability/client.ts`: request_id matching for sync, job events for start), `report.ts`, `honesty.ts`, `format.ts`, `fixtures.ts` (e2e/unit fixtures). **Components** `src/components/qec/learned/{LearnedDecodersPanel,SourcePicker,DecoderChips,SplitSettings,ResultsTable,PairedGrid,TrainingCurves,ReportActions}.tsx`.
- **Dirac context**: `services/qecLearned/context.ts` adds a terse block (source, reference, each decoder's LER interval and verdict) to `buildContextBlock` in Research mode.

### 10.2 Idea 8 — "Verified suggestions" in the editor, Dirac and the Lab

- **Triggers.** (a) Monaco code action (lightbulb) on any `TRN00x` marker and on the file level: **"Dirac: suggest verified edits (trainability)"** — a provider file `src/components/editor/codeActions/verifiedSuggestionActions.ts` registered with the **shared code-action registry** `src/components/editor/codeActions/registry.ts` (F-3, Wave 1; one `registerCodeActionProvider` call in `QuantumEditor.tsx`, shared by the TRN003 quantumness action, the QK001 quick-fix and this feature — today's `quantumCodeActions.ts` defines a provider that is never registered; F-3 either wires it through the registry or deletes it); (b) command palette **"Dirac: Suggest verified edits"** (category `Dirac`); (c) Dirac side panel slash command `/suggest [trainability|cost|expressivity|cleanup]`; (d) Trainability Lab `VerdictRail` button **"Ask for verified fixes"** when the verdict is barren-plateau/inconclusive; (e) keyboard **⌘⇧E** in the editor (⌘⇧S is already Save As in `App.tsx`; a shortcut-collision test over the `App.tsx` handler, every Monaco `addAction` keybinding and `featureCommands` guards the chord).
- **Proposers** (`src/services/suggestions/proposers/`): `claudeProposer.ts` (reuses `llmMutator.ts`'s tool and parsing with a suggestion prompt from `suggestions/prompt.ts`: goal, baseline metrics from the last Lab job if fresh, lint diagnostics, inspection; no EVOLVE markers → `diff.ts` whole-file region with `regionWarning` accepted), `astProposer.ts` (`discovery_mutate`, count 4, labelled "Local heuristic (no AI)"), `symmetryProposer.ts` (spec 03, when available). The orchestrator `services/suggestions/orchestrator.ts` picks proposers by availability: API key present → Claude + AST; no key → AST (+ symmetry); offline → the panel says "No API key: showing local heuristic proposals only. Add a key in Settings → Dirac AI to get Dirac's proposals." No proposer is ever silently skipped.
- **Verification client** `services/suggestions/verifyClient.ts` (sends `trainability_verify` through the Trainability Lab's `LabSession`; streams partials into `src/stores/suggestionStore.ts`).
- **Surface** `src/components/suggestions/VerifiedSuggestionsPanel.tsx` (docked in the Dirac side panel as a card stack; also opened as a `LabDrawer` from the Lab). Each card: verdict pill (`verified` quantum tone, `inconclusive` warning, `rejected` collapsed neutral, `unverifiable` muted), one-line rationale from the proposer (clearly attributed), **numbers inline**: `Var[∂C] 3.1e-3 → 1.2e-2 [exact PPE]`, `DLA dim 64 → 256 (complete)`, `2q gates 12 → 16`, certificate line, then `ProgramDiff` (reused) and **Apply** — issued through a `QuantumEditor`-registered command (FE-V owns `src/components/editor/commands/applyVerifiedEdit.ts`) that calls `editor.pushUndoStop()`, `editor.executeEdits('verified-suggestion', spans → ranges)` and `editor.pushUndoStop()` again, so one ⌘Z restores the exact baseline text; **never** `editorStore.setCode` (whether a store-driven value change keeps undo history depends on the sync code and is not guaranteed) — / **Apply & re-run analyses** / **Verify harder** (scaling; attempt counter shown) / **Why rejected?** (expands reasons). Rejected cards show the reason and never an Apply button; `improvement_by_reduced_expressivity` cards show the Cerezo caveat and the DLA numbers instead of a "verified" pill.
- **States.** `idle` (empty: "Dirac proposes edits; the kernel verifies them before you see them."), `proposing` (which proposers, spinner), `verifying` (per-candidate progress; cancel), `results` (ordered: verified → inconclusive → unverifiable → rejected), `no_proposals` ("Dirac returned no applicable edits" with the raw failure code from `llmMutator`), `kernel_unavailable` (web build or no Lab session: `LabDesktopRequired`), `stale` (editor changed since verification: cards get a "stale" badge and Apply is disabled until re-verified), `error` (kernel error code + message, retry).
- **Honesty copy** (`services/suggestions/honesty.ts`): the §6.3 paragraph; "Rejected proposals are shown so you can see what was tried"; "Local heuristic proposals are random syntax-preserving edits; they are verified exactly like Dirac's."
- **Editor integration.** Inline hints: for `verified_improvement` records the provider also contributes a Monaco `CodeAction` per card ("Apply verified edit: <rationale>") with the workspace edit computed from the SEARCH/REPLACE spans (`diff.ts` `EditSpan`), so the lightbulb itself can apply a verified edit. The provider reads from `suggestionStore` only (no network in the provider).
- **Settings → Dirac AI** gains "Suggestion proposer model" (`claude-haiku-5-5` default, `claude-sonnet-5-5`; both from the single model registry `src/config/models.ts`, F-3) and "Verify budget" (fast 30 s / thorough 120 s).

### 10.3 Status chips and mode guard

`LabStatusChips` gain a chip for a running learned-decoder job and a running verification; `ModeSwitchGuard` includes both (same pattern as trainability jobs).

---

## 11. Validation plan

### 11.1 Kernel unit tests (`kernel/tests/`)

- `test_qec_learned_dem_text.py`: parse every DEM instruction kind, `repeat` flattening, `shift_detectors`, coordinates, **`^` components**: `D0 D1 ^ D2 D3` keeps two components, its sampled symptom is the XOR (a hand-built case where the components overlap, `D0 D1 ^ D1 D2` → symptom `{D0, D2}`), `is_graphlike` is computed per component, parallel merge only for identical full symptom sets, canonical text preserves the split; caps → `invalid_source`; round-trip serialize/parse is identity on canonical text. When Stim is present (`importorskip`): `parse_dem(str(circuit.detector_error_model().flattened()))` yields the same `(n_D, n_L, m)` and `is_graphlike` as `dem.py`'s extraction.
- `test_qec_learned_sampler.py`: seed determinism (bit-identical batches); marginal detector frequencies within Wilson 99% of `Σ_k p_k·[k∈D]` (first-order) on a single-mechanism DEM and exact closed form for two mechanisms; with Stim present: KS-style agreement of logical-error frequencies between the numpy sampler and `stim.DetectorErrorModel.compile_sampler` at 10^5 shots (tolerance: overlapping Wilson 95% intervals).
- `test_qec_learned_decoders.py`: `exact_ml` (F2 convolution) on a 3-mechanism toy DEM equals brute-force posterior argmax for every syndrome, equals 2^m enumeration on random DEMs with m ≤ 12, is applicable on bundled rep d=3 (n_D = 8) and d=5 (n_D = 24) circuit-level DEMs and `not_applicable` on surface d=3 (n_D + n_L = 25); UF weights are `round(ln((1−p)/p)·1000)` with `p ≥ 0.5 → 0`; `union_find` corrects every error of weight ≤ (d−1)/2 on the repetition code d = 3, 5, 7 (exhaustive) and never corrects a weight-(d+1)/2 chain into the wrong class more often than MWPM on the same shots (paired, when pymatching present); `mwpm` == PyMatching's own `decode_batch` predictions (identity) when present, including on a Stim rotated-surface-code `decompose_errors=True` DEM where `union_find` must also be applicable; `mlp_numpy` gradient check (finite differences, rel err < 1e-4 in float64 mode), determinism, and **physics**: trained on repetition d = 3, p = 0.05 with 20 000 shots, its test LER is within the paired interval of `exact_ml` (`verdict != "worse"`), and the `trivial` decoder is `worse` than all.
- `test_qec_learned_stats.py`: McNemar exact p against known tables; Newcombe method-10 and Tango intervals against published worked examples (Newcombe 1998 Table II cases); the verdict agrees with the McNemar test on 1000 random (b, c, n) triples; Holm–Bonferroni adjustment over a synthetic family; zero-discordant case; `better` vs `exact_ml` → `suspect`; ranking produces tie groups only where intervals separate; `excess_over_ml` reuses `lambda_ratio` (ratio of a decoder to itself is `[1,1]`-contained and `inconclusive` only for zero counts) and carries the "conservative" label.
- `test_qec_learned_splits.py`: `splits.derive_seed(seed, domain, distance, p)` domain separation, ledger hashes stable, `shared_syndrome_fraction` computed, `disjoint_draws` true; the test-split size is fixed before decoding (a decoder-dependent stop rule is rejected at validation); `test_confirm:{k}` domains differ from `test`; the use counter increments and is reported.
- `test_qec_learned_jobs.py`: handler validation (`invalid_request` on every bad field), busy limit, cancel kills the group (`StreamingWS` pattern via `_auth_harness`), progress ≤ 10/s, `missing_dependency` for `mwpm`/`torch` without the packages (subprocess blocker as in `test_discovery_optional_deps.py`), bundled source works with no optional packages, `invalid_source` for an observable-less DEM.
- `test_discovery_decoder_architecture.py`: schema validation, every guardrail with a cheating candidate rejected by exactly that guardrail (over-budget params, trivial decoder, budget-exhausting spec, non-dict return), fitness penalties, `confirm` determinism check, fingerprint stable, Red Queen audit agreement.
- `test_trainability_verify.py`: verdict rules table-driven (every branch of §6.2 incl. `improvement_by_reduced_expressivity` when the DLA shrinks); structure checks; **sandbox/pre-screen**: a candidate with `import subprocess`, `os.system('true')` or `import socket` is rejected with `reasons[0]` starting `sandbox:` (the first draft's `import os` is wrong — `candidate_worker._BLOCKED_IMPORTS` blocks `os` *attributes*, not the module, and blocking `import os` would reject most real research files), a candidate using `os.path.join` still verifies, `shutil.rmtree(...)` and `open(..., 'w')` are rejected with `prescreen:`; cache hits; candidates arrive as edits and are applied kernel-side; an oversized request → `too_large`; **physics**: on a 6-qubit hardware-efficient ansatz the PPE interval of the baseline contains the statevector-sampled variance (bootstrap 95%); **a candidate that changes `nuclei_observable` from a global-Z to a local-Z layout is `rejected` with `observable_changed`** (the reverse of the first draft's test, which rewarded the canonical cheat); a real improvement — removing a dead-parameter layer or reducing depth at the fixed observable — is `verified_improvement`; a candidate that removes every entangler is `improvement_by_reduced_expressivity`, not `verified_improvement`; a candidate that adds a non-rotation gate is `unverifiable` (not `rejected`) unless lint errors; cancelling a job with 2 running candidates leaves no candidate process alive.
- `test_candidate_worker_module_circuit.py`: the new task locates the circuit like `_usercode.find_circuit_object`, blocked imports remain blocked, no-circuit → `no_artifact` error code.
- Existing `test_docs_fixtures.py` / `test_docs_lab_fixtures.py` cover the new fixtures automatically.

### 11.2 Property tests (hypothesis is not in the venv: use seeded random loops)

- Sampler: for random small DEMs, `H_D e` computed by the sparse path equals the dense matmul mod 2.
- UF: the returned correction `c` always satisfies `H_D c = s`.
- Verdict rules: monotonic — shrinking a candidate interval that is already separated never flips `verified_improvement`.

### 11.3 Frontend tests (vitest + jsdom)

Types/schema parsing (valid, invalid, defaults); clients with `createFakeSession` (request_id matching, stale replies dropped, job stream, disconnect); stores (state machine transitions incl. stale and cancel); renderers for every component with seeded states (idle/loading/populated/error/unavailable); report snapshot; `verifiedSuggestionActions` provider mapping (spans → ranges, stale disables); orchestrator proposer selection (key / no key / offline); honesty copy presence tests (the §6.3 paragraph is rendered whenever a `verified` pill is).

### 11.4 Playwright e2e (`tests/e2e/`)

- `qec-learned-decoders.spec.ts`: stub kernel (WebSocket replacement as in `discovery.spec.ts`) answering `qec_learned_sources`, streaming `started → progress → partial×3 → result` from `services/qecLearned/fixtures.ts`; user path: open Research → QEC Workbench → Analyze preset → Learned Decoders panel → pick Bundled `rep_d3_p1e-3` → tick Exact ML + Union-Find + MLP → Train & compare → rows fill → verdict pills → Export report (bridge records the write). Second test: a decoder with `missing: ["pymatching"]` renders the install card; third: cancel mid-run shows `cancelled`.
- `verified-suggestions.spec.ts`: lab-project fixture, no API key → panel explains local heuristics; stub kernel answers `discovery_mutate` and `trainability_verify` stream (one `verified_improvement`, one `inconclusive`, one `rejected`); user path: open `ansatz/hardware_efficient.py` → palette "Dirac: Suggest verified edits" (and ⌘⇧E) → cards → Apply on the verified card → editor text changes → one ⌘Z restores the exact baseline text (asserted byte-for-byte); rejected card has no Apply; an `improvement_by_reduced_expressivity` card shows the Cerezo caveat; stale badge appears after typing.
- Screenshots at 1440/1024, light/dark per `playwright.config.ts` projects.

### 11.5 CI

`kernel-tests.yml` (owned by X in Wave 5b; R-D in Wave 0): the `pytest-minimal-venv` job runs the whole `kernel/tests` suite incl. the new modules; the full job installs nothing new (torch is **not** installed in CI; torch tests `importorskip`). The two new Playwright specs run in the `lab-e2e-stub` job (all non-`@qec`, non-`@real` specs — `qec-frontend.yml` only runs `@qec`) and their `@real` counterparts in `real-kernel-e2e`. A nightly optional job may install `torch` CPU to exercise `nn_torch.py` (out of the default matrix for time).

---

## 12. Acceptance criteria

Idea 7
- [ ] With the stock managed venv (no stim/pymatching/torch) a user can open QEC Workbench → Learned Decoders, pick a bundled DEM (rep d=3 and d=5 are exact-ML-applicable by the manifest test), train an MLP, and see Exact ML, Union-Find and MLP rows with Wilson intervals, Holm-adjusted Newcombe paired verdicts and the ML-floor excess (labelled conservative); MWPM/Transformer rows show the install card, not an error.
- [ ] `^`-decomposed DEMs keep their components, sample by XOR, and leave UF/MWPM applicable; `mwpm` matches PyMatching on a Stim surface-code DEM.
- [ ] The test split is fixed before decoding, its use counter is shown, and a headline "better than reference" comes only from a never-used split; a "better than exact_ml" result is `suspect`.
- [ ] With Stim installed the current `.stim` editor circuit and campaign tasks appear as sources; with PyMatching installed the MWPM row scores and matches PyMatching's predictions exactly.
- [ ] Every number in the table has an interval and a method label or a `not applicable` reason; no point estimate is shown without its interval.
- [ ] Re-running with the same source, seed and settings reproduces every number bit-for-bit (kernel test and a UI "reproduce" block in the report).
- [ ] The report JSON/MD exports and includes the leakage ledger and provenance.
- [ ] The `decoder_architecture` evaluator appears in the Discovery catalogue, runs with a bundled source in the stock venv, every guardrail has a rejecting cheating candidate, and the Definition panel shows the "candidate never sees data" statement.
- [ ] Cancel works at every phase; a kernel crash produces a `failed` state with the code, never a hung spinner.

Idea 8
- [ ] From the editor lightbulb, the palette, `/suggest`, ⌘⇧E and the Lab rail, a user gets suggestion cards for their own file; each verified card shows baseline → candidate numbers with intervals and a diff; Apply goes through `executeEdits` with undo stops and one ⌘Z restores the exact baseline text.
- [ ] No suggestion is labelled verified unless the kernel's intervals are separated per §6.2; overlapping intervals are `inconclusive` and say so.
- [ ] Rejected proposals are visible with reasons; nothing is hidden silently.
- [ ] Without an API key the feature still works with local heuristic proposals and says so; with no kernel (web) it shows `LabDesktopRequired`.
- [ ] LLM code never runs outside the candidate sandbox (test: proposals with `import subprocess` / `os.system` / `import socket` are rejected with a sandbox reason; `shutil.rmtree` / `open(..., 'w')` with a pre-screen reason; `os.path.join` still verifies); on the owner's box the tier is `landlock`, never silently `process`.
- [ ] The observable is frozen from the baseline; `observable_changed` candidates are rejected; expressivity collapse is labelled, never "verified".
- [ ] P95 end-to-end ≤ 30 s for 4 proposals on the fixture ansätze at n ≤ 12 on the dev machine (recorded in the PR).
- [ ] Protocol v1.4 docs with replayed fixtures; CLAUDE.md updated.

---

## 13. Implementation breakdown and file ownership

**The master plan's §7 tables are the only ownership record.** This section maps the spec's logical units onto master units and names exactly the master's files; no unit below edits `job_worker.py`, `handlers.py`, `_settings.py`, `VerdictRail.tsx`, `settingsStore.ts`, `useDirac.ts`, `qecPanelRegistry.ts`, `CommandPalette.tsx` or `App.tsx` — those are F-1/F-3 registries (`scripts/check-wave-ownership.py` enforces it).

| Spec unit | Master unit (wave) | Scope | Files (verbatim from master §7) |
|---|---|---|---|
| U1 DEM core, U2 classical decoders + stats, U3 neural decoders | **L1+L2** (Wave 3b) | `dem_text` (components), sampler (XOR), `splits.derive_seed`, provenance, bundled DEMs + manifest test, `exact_ml` (F2 convolution, n_D + n_L ≤ 24), weighted UF (HNB), MWPM from canonical text, `stats` (Newcombe/Tango/Agresti–Min, Holm–Bonferroni, suspect rule, tie-group ranking), `arch_spec`, numpy/torch decoders | `kernel/qec/learned/{__init__,dem_text,dem_sampler,splits,provenance,arch_spec,stats}.py`, `kernel/qec/learned/decoders/{__init__,base,exact_ml,union_find,mwpm,nn_numpy,nn_torch,registry}.py`, `kernel/qec/learned/bundled/**`, `scripts/gen_bundled_dems.py`, `kernel/tests/test_qec_learned_{dem_text,sampler,splits,bundled,decoders_classical,decoders_nn,arch_spec,stats}.py` |
| U4 learned jobs + handlers, U5 Discovery evaluator | **L3+L4** (Wave 4a) | sources (paths only; kernel reads from `project_root`), worker, jobs (test-split counter, confirm splits), handlers, `decoder_architecture` evaluator (champion from confirm only) + audit (unpaired Newcombe) + seed, the `decoder_spec` and `module_circuit` candidate-worker tasks, docs fixtures | `kernel/qec/learned/{sources,job_worker,jobs,handlers}.py`, `kernel/discovery/evaluators/decoder_architecture.py`, `kernel/discovery/audits/decoder_architecture.py`, `kernel/discovery/seeds/decoder_mlp.py`, `kernel/discovery/candidate_worker.py`, evaluator registry entry lines, `kernel/tests/test_qec_learned_{sources,jobs}.py`, `test_discovery_decoder_architecture.py`, `test_candidate_worker_tasks.py`, `docs-site/fixtures/lab_qec_learned_*`, `docs-site/fixtures/lab/qec_learned_start.stream.json` |
| U6 Verify kernel | **V1** (Wave 4a) | verify (edits applied kernel-side, pre-screen call, frozen observable, sandbox hygiene, parallelism 2), rules (incl. `improvement_by_reduced_expressivity`), cache, handlers, the `verify` job message registered through `kernel/trainability/analyses_verify.py` (F-1's `register_job_message`), docs fixtures | `kernel/trainability/{verify,verify_rules,verify_cache,verify_handlers,analyses_verify}.py`, `kernel/tests/test_trainability_verify*.py`, `docs-site/fixtures/lab_trainability_verify_*`, `docs-site/fixtures/lab/trainability_verify.stream.json` |
| U7 Lead plumbing | **F-1** (`lab_routes` all prefixes, `PROTOCOL_VERSION`, `_optional.CATALOG_IDS`, `register_job_message`, `diff_apply.py`), **R-C** (`frameworks.rs` `torch`/`onnx`), **R-F** (`landlock` tier, `prescreen.py`), **F-2** (`src/types/{discovery,quantum,qecLearned,suggestions}.ts`), **F-3** (`qecPanelRegistry` placeholder panel, palette registry, code-action registry, job registry for `LabStatusChips`/`ModeSwitchGuard`, model registry, `LabLineChart`/`IntervalBars`), **X** (docs/CLAUDE.md/changelog) | — | per master §7 |
| U8 learned decoders frontend, U10 Discovery UI for the evaluator | **FE-L** (Wave 5a) | panel, source picker, chips, results table (adjusted intervals, tie groups, use counter, confirm button), charts, report, honesty, Dirac context provider, evaluator definition, e2e | `src/components/qec/learned/**`, `src/services/qecLearned/**`, `src/stores/qecLearnedStore.ts`, `src/components/qec/DecoderWorkbench.tsx` (header button), `src/services/discovery/evaluatorDefinitions/decoderArchitecture.ts`, `src/services/discovery/prompt.ts` (GUARDRAILS entry), `src/components/qec/learned/commands.ts`, `tests/e2e/qec-learned-decoders.spec.ts`, `tests/e2e/real/qec-learned.real.spec.ts`, `tests/e2e/real/decoder-architecture.real.spec.ts`, `tests/e2e/fixtures/qec-project/circuits/rep_d3.dem` |
| U9 verified suggestions frontend | **FE-V** (Wave 5a) | store, services (orchestrator, proposers, verifyClient sending edits, prompt, honesty, context provider), panel, code-action provider file, the Apply editor command, ⌘⇧E, `/suggest` and `/decoders` branches, rail button (registered through `labAnalyses.ts`'s rail-slot), Settings fields via the settings registry, e2e | `src/components/suggestions/**`, `src/services/suggestions/**`, `src/stores/suggestionStore.ts`, `src/components/editor/codeActions/verifiedSuggestionActions.ts`, `src/components/editor/commands/applyVerifiedEdit.ts`, `src/components/dirac/DiracSidePanel.tsx` (`/suggest`, `/decoders`), `src/components/trainability/analyses/verdictRailSuggestButton.tsx`, `src/components/suggestions/commands.ts`, `src/components/suggestions/settingsFields.ts`, `tests/e2e/verified-suggestions.spec.ts`, `tests/e2e/real/suggestions.real.spec.ts` |
| U11 Dirac context + docs | each FE unit's `context.ts` (registry) + **X** (Wave 5b) | `docs-site/src/content/docs/research/{learned-decoders,verified-suggestions}.mdx`, `messages-lab.mdx` sections | per master §7 |
| U12 Integration review | **REV-P / REV-S / REV-U** (Wave 6) | adversarial physics + security review of the kernel units, UI review of FE-L/FE-V | no files |

Build order follows the master waves. L1+L2 and FE-L/FE-V can start against the frozen wire shapes in §8 (`src/services/{qecLearned,suggestions}/fixtures.ts` from F-2). V1 uses a fake sandbox until L3+L4's `module_circuit` task merges in the same wave.

Dependency additions: **none required**. Optional, lazily imported: `torch` (new Research-catalog entry, never in `kernel/requirements.txt`, never in CI's default matrix). `pymatching`/`stim` remain optional as today.

---

## 14. Risks and open questions

Risks
1. **Pure-Python Union-Find speed.** At d = 7 circuit-level DEMs (n_D ≈ 10^3) and 10^5 shots, pure Python UF may take minutes. Mitigation: vectorised per-shot batching is not possible for UF; cap shots by time budget, report `training_censored`-style `evaluation_censored` with the shots actually decoded, and keep the per-shot loop in a tight numpy-free function. If still too slow, a `wasm/qec-decoder`-style Rust UF could be added later (out of scope now).
2. **Exact ML state-space cap** (n_D + n_L ≤ 24) makes the floor unavailable for surface d ≥ 3 circuit-level DEMs (25+ bits). The UI must say "not applicable: n_D + n_L = … > 24" and never estimate the floor.
3. **DEM-vs-circuit confusion.** Users may read DEM-sampled LERs as circuit LERs. The honesty line is mandatory on every table and in the report.
4. **LLM proposals that change semantics.** The observable is frozen from the baseline (`observable_changed` rejects), expressivity collapse is labelled, and parameter-count changes are flagged; structure checks cannot catch "a different but equally wide ansatz". The card always shows the diff and the numbers; "verified" refers to the stated quantities only.
5. **Sandbox cost for verification** (one process per candidate) could exceed the latency budget on slow machines; the panel streams partials, so partial usefulness is preserved; the budget is user-selectable.
6. **Bundled DEM provenance drift**: regenerate with the pinned Stim in `scripts/gen_bundled_dems.py`; the manifest's sha256 is asserted by a test so an edited fixture fails CI.
7. **Protocol surface growth**: two new families increase the server dispatch; all go through `_route_lab_message` and per-connection `LabContext`, so the auth/isolation tests (`test_lab_token_isolation.py`) must be extended to the new prefixes (U7).

Open questions
- ~~Should `exact_ml`'s cap be adaptive?~~ **Decided:** the F2 convolution over the (syndrome, logical) state space replaces 2^m enumeration and reaches every bundled repetition DEM; surface d = 3 circuit-level (25 bits) stays out of reach in v1. A transfer-matrix DP along the time axis for graphlike DEMs remains a follow-up.
- Do we want a `soft_syndrome` input (analog readout) for the numpy MLP, as in Varbanov et al.? It needs a source with soft data (`qec_data` typed imports); deferred until the data engine exposes per-detector confidences.
- Claude proposer model — **decided (master plan):** `claude-haiku-5-5` for `/suggest` and the lightbulb (latency), `claude-sonnet-5-5` when invoked from the Lab rail (the user is already waiting on analyses); both overridable in Settings.
- Should verified cards offer "Open in Discovery" (seed a run from the applied candidate)? Cheap to add via the existing `NewDiscoveryWizard` prefill; left to U10 if time allows.
- Spec 01's `certificate_cheap` budget semantics (is 2 s meaningful?) must be confirmed with the spec 01 owner before U6 wires it as a default check; until then it is opt-in.

---

## References

- Bausch, J. et al. Learning high-accuracy error decoding for quantum processors. *Nature* 635, 834–840 (2024). doi:10.1038/s41586-024-08148-8; arXiv:2310.05900.
- Higgott, O. & Gidney, C. Sparse Blossom: correcting a million errors per core second with minimum-weight matching. *Quantum* 9, 1600 (2025); arXiv:2303.15933.
- Delfosse, N. & Nickerson, N. H. Almost-linear time decoding algorithm for topological codes. *Quantum* 5, 595 (2021); arXiv:1709.06218.
- Gidney, C. Stim: a fast stabilizer circuit simulator. *Quantum* 5, 497 (2021); arXiv:2103.02202.
- Torlai, G. & Melko, R. G. Neural decoder for topological codes. *Phys. Rev. Lett.* 119, 030501 (2017); arXiv:1610.04238.
- Varsamopoulos, S., Criger, B. & Bertels, K. Decoding small surface codes with feedforward neural networks. *Quantum Sci. Technol.* 3, 015004 (2018); arXiv:1705.00857.
- Huang, S., Newman, M. & Brown, K. R. Fault-tolerant weighted union-find decoding on the toric code. *Phys. Rev. A* 102, 012419 (2020); arXiv:2004.04693.
- Chamberland, C. & Ronagh, P. Deep neural decoders for near term fault-tolerant experiments. arXiv:1802.06441 (2018).
- Meinerz, K., Park, C.-Y. & Trebst, S. Scalable neural decoder for topological surface codes. *Phys. Rev. Lett.* 128, 080505 (2022); arXiv:2101.07285.
- Varbanov, B. M., Serra-Peralta, M., Byfield, D. & Terhal, B. M. Neural network decoder for near-term surface-code experiments. *Phys. Rev. Research* 7, 013029 (2025); arXiv:2307.03280.
- Lange, M. et al. Data-driven decoding of quantum error correcting codes using graph neural networks. *Phys. Rev. Research* 7, 023181 (2025); arXiv:2307.01241.
- Google Quantum AI and Collaborators. Quantum error correction below the surface code threshold. *Nature* 638, 920–926 (2025); arXiv:2408.13687.
- Google Quantum AI. Suppressing quantum errors by scaling a surface code logical qubit. *Nature* 614, 676–681 (2023) [verify].
- Romera-Paredes, B. et al. Mathematical discoveries from program search with large language models. *Nature* 625, 468–475 (2024). doi:10.1038/s41586-023-06924-6.
- Novikov, A. et al. AlphaEvolve: a coding agent for scientific and algorithmic discovery. arXiv:2506.13131 (2025).
- Angrisani, A. et al. Classically estimating observables of noiseless quantum circuits. arXiv:2409.01706 (2024).
- Rudolph, M. S. et al. Pauli propagation: a computational framework for simulating quantum systems. arXiv:2505.21606 (2025).
- Ragone, M. et al. A Lie algebraic theory of barren plateaus for deep parameterized quantum circuits. *Nat. Commun.* 15, 7172 (2024).
- McNemar, Q. Note on the sampling error of the difference between correlated proportions or percentages. *Psychometrika* 12, 153–157 (1947).
- Wilson, E. B. Probable inference, the law of succession, and statistical inference. *J. Am. Stat. Assoc.* 22, 209–212 (1927).
- Newcombe, R. G. Improved confidence intervals for the difference between binomial proportions based on paired data. *Stat. Med.* 17, 2635–2650 (1998) — method 10 (hybrid score) for paired differences; the unpaired hybrid score interval (*Stat. Med.* 17, 873–890 (1998)) for the audit.
- Tango, T. Equivalence test and confidence interval for the difference in proportions for the paired-sample design. *Stat. Med.* 17, 891–908 (1998) [verify].
- Agresti, A. & Min, Y. Simple improved confidence intervals for comparing matched proportions. *Stat. Med.* 24, 729–740 (2005) [verify].
- Holm, S. A simple sequentially rejective multiple test procedure. *Scand. J. Stat.* 6, 65–70 (1979).

---

## Appendix A — `arch_spec` schema (shared by the panel and the evaluator)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object", "additionalProperties": false,
  "required": ["kind"],
  "properties": {
    "kind": {"enum": ["mlp_numpy", "transformer_torch", "conv_torch"]},
    "features": {"type": "array", "maxItems": 3, "items": {"enum": ["raw", "round_diff", "parity_pairs"]}, "default": ["raw"]},
    "layers": {"type": "array", "minItems": 1, "maxItems": 16, "items": {"anyOf": [
      {"type": "object", "additionalProperties": false, "required": ["dense", "width"],
       "properties": {"dense": {"const": true}, "width": {"type": "integer", "minimum": 4, "maximum": 4096}, "act": {"enum": ["relu", "gelu", "tanh"]}}},
      {"type": "object", "additionalProperties": false, "required": ["residual_dense", "width"],
       "properties": {"residual_dense": {"const": true}, "width": {"type": "integer", "minimum": 4, "maximum": 4096}}},
      {"type": "object", "additionalProperties": false, "required": ["dropout"], "properties": {"dropout": {"type": "number", "minimum": 0, "maximum": 0.9}}},
      {"type": "object", "additionalProperties": false, "required": ["layernorm"], "properties": {"layernorm": {"const": true}}}
    ]}},
    "optimizer": {"type": "object", "additionalProperties": false, "properties": {
      "lr": {"type": "number", "minimum": 1e-5, "maximum": 0.1, "default": 1e-3},
      "weight_decay": {"type": "number", "minimum": 0, "maximum": 0.1, "default": 0},
      "batch_size": {"type": "integer", "minimum": 32, "maximum": 4096, "default": 512},
      "epochs_max": {"type": "integer", "minimum": 1, "maximum": 500, "default": 60},
      "early_stopping_patience": {"type": "integer", "minimum": 1, "maximum": 50, "default": 8}}},
    "torch": {"type": "object", "additionalProperties": false, "properties": {
      "d_model": {"type": "integer", "minimum": 8, "maximum": 512}, "heads": {"type": "integer", "minimum": 1, "maximum": 16},
      "blocks": {"type": "integer", "minimum": 1, "maximum": 12}, "kernel": {"type": "integer", "minimum": 1, "maximum": 7}}}
  }
}
```

`arch_spec.parameter_count(spec, n_inputs, n_outputs)` is a pure function used by the `parameter_budget` guardrail and by the UI preview ("≈ 84 k parameters") before training starts. Validation uses `jsonschema` when importable, else `kernel.discovery.evaluators.base.validate_by_hand` (already supports every construct above).

## Appendix B — Example wire exchanges

**Illustrative only.** The numbers below are hand-written for shape; every docs example that ships is **regenerated from the real handler** by X (`docs-site/fixtures/lab/*.stream.json`, replayed by `test_docs_lab_fixtures.py`) and replaces this text. Shapes are consistent with §8 (rep d=3, 3 rounds: n_D = 8, 27 mechanisms, exact ML applicable; the d = 5 companion has n_D = 24 and is exact-ML-applicable too, so Λ for `exact_ml` is defined).

Learned decoders (stock venv, bundled source):

```json
→ {"type": "qec_learned_sources", "request_id": "r1", "circuit": null}
← {"type": "qec_learned_sources_result", "request_id": "r1",
   "sources": [{"ref": {"kind": "bundled", "id": "rep_d3_p1e-3"}, "title": "Repetition code d=3, p=1e-3 (SI1000-style), 3 rounds",
                "available": true, "n_detectors": 8, "n_observables": 1, "mechanisms": 27, "rounds": 3, "distance": 3, "exact_ml_applicable": true,
                "has_companion_d_plus_2": true, "provenance": {"stim_version": "1.14.0", "sha256": "…"}}, "…"],
   "decoders": [{"id": "exact_ml", "title": "Exact maximum likelihood (F2 convolution, n_D + n_L ≤ 24)", "available": true, "distance_agnostic": true, "config_schema": {}, "default_config": {}},
                {"id": "mwpm", "title": "Minimum-weight perfect matching (PyMatching)", "available": false, "missing": ["pymatching"],
                 "install": {"catalog_ids": ["pymatching"], "hint": "Install PyMatching from the Research catalog (entry: pymatching) in Environment setup."}, "distance_agnostic": true, "config_schema": {}, "default_config": {}},
                {"id": "mlp_numpy", "title": "MLP (numpy)", "available": true, "distance_agnostic": false, "config_schema": {"$ref": "arch_spec"}, "default_config": {"kind": "mlp_numpy", "layers": [{"dense": true, "width": 128, "act": "relu"}, {"dense": true, "width": 128, "act": "relu"}]}}]}

→ {"type": "qec_learned_start", "job_id": "qld-7f…", "source": {"kind": "bundled", "id": "rep_d3_p1e-3"},
   "decoders": [{"id": "ml", "kind": "exact_ml", "config": {}}, {"id": "uf", "kind": "union_find", "config": {}},
                {"id": "mlp", "kind": "mlp_numpy", "config": {"layers": [{"dense": true, "width": 128, "act": "relu"}]}}],
   "seed": 7, "splits": {"train": 50000, "val": 5000, "test": {"shots": 20000}},
   "training": {"time_budget_s": 120}, "generalization": true}
← {"type": "qec_learned_started", "job_id": "qld-7f…"}
← {"type": "qec_learned_progress", "job_id": "qld-7f…", "decoder": "mlp", "phase": "training", "fraction": 0.4, "message": "epoch 24/60, val loss 0.0131"}
← {"type": "qec_learned_partial", "job_id": "qld-7f…", "decoder": "ml", "report": {"id": "ml", "kind": "exact_ml", "status": "scored",
   "test": {"shots": 20000, "errors": 41, "ler_shot": 0.00205, "ci95_shot": [0.00151, 0.00278], "ler_round": 0.000684, "ci95": [0.000504, 0.000928], "saturated": false},
   "paired": null, "excess_over_ml": null, "generalization": {"distance": 5, "test": {"…": "…"}, "paired": null}, "lambda": {"d_from": 3, "d_to": 5, "value": 4.1, "ci95": [2.6, 6.5], "verdict": "suppressing"},
   "training": null, "compute": {"backend": "numpy", "method": "exact_ml_f2_convolution"}}}
← {"type": "qec_learned_result", "job_id": "qld-7f…", "status": "complete", "dem": {"…": "…"}, "splits": ["…"], "reports": {"ml": "…", "uf": "…", "mlp": "…"},
   "comparison": {"reference": "exact_ml", "ml_floor_available": true, "ranking": [["ml"], ["mlp", "uf"]], "family_size": 4, "notes": ["mlp vs exact_ml: indistinguishable (b=9, c=6, Newcombe-10 Δ ∈ [−0.00013, 0.00042] adjusted for 4 comparisons, McNemar p=0.61)"]},
   "errors": {}, "elapsed_ms": 48210, "provenance": {"nuclei_protocol": "1.4", "test_stop_rule": "fixed:20000", "test_split_uses": 1, "…": "…"}}
```

Verified suggestions (no API key, AST proposer):

```json
→ {"type": "discovery_mutate", "request_id": "r2", "program": "<editor code>", "seed": 11, "count": 4}
← {"type": "discovery_mutations", "request_id": "r2", "mutations": [{"program": "…", "operators": ["swap_gate_method"], "description": "rz→ry on line 12"}, "…"]}
→ {"type": "trainability_verify", "job_id": "vfy-3a…", "code": "<editor code>", "language": "python", "observable": "preset:local_z", "init": "uniform", "seed": 0,
   "goal": "trainability", "candidates": [{"id": "c1", "edits": [{"search": "qc.rz(theta[3], 2)", "replace": "qc.ry(theta[3], 2)"}], "origin": "ast", "rationale": "rz→ry on line 12"}, "…"], "checks": ["lint", "ppe", "lie"], "budget_ms": 30000, "attempt": 1}
← {"type": "trainability_started", "job_id": "vfy-3a…"}
← {"type": "trainability_partial", "job_id": "vfy-3a…", "analysis": "verify_baseline", "result": {"metrics": {"n_qubits": 8, "variance": {"method": "pauli_propagation_exact", "mean": 0.0031, "interval": [0.0031, 0.0031], "interval_kind": "truncation", "informative": true}, "…": "…"}}}
← {"type": "trainability_partial", "job_id": "vfy-3a…", "analysis": "verify", "result": {"id": "c1", "origin": "ast", "verdict": "verified_improvement",
   "reasons": ["mean gradient variance interval [0.0118, 0.0121] is above the baseline's [0.0031, 0.0031] (exact PPE)", "DLA dimension 64 → 64 (complete)", "observable unchanged", "lint clean", "two-qubit cost unchanged (14)"],
   "metrics": {"…": "…"}, "baseline_delta": {"variance_log2": [1.93, 1.97], "two_qubit_cost": 0, "lie_dimension": 0},
   "diff": {"edits": [{"search": "qc.rz(theta[3], 2)", "replace": "qc.ry(theta[3], 2)"}], "spans": [{"startLine": 12, "endLine": 12}]},
   "sandbox": {"isolation": "sandbox-exec", "isolation_detail": {"reads": "restricted"}}, "cache_hit": false}}
← {"type": "trainability_result", "job_id": "vfy-3a…", "status": "complete", "results": {"verify": {"baseline": "…", "candidates": ["…"]}}, "errors": {}, "elapsed_ms": 9120, "provenance": {"…": "…"}}
```

## Appendix C — DEM text subset accepted by `dem_text.py`

Instructions: `error(p) <targets>`, `detector(<coords>) D<i>`, `logical_observable L<i>`, `shift_detectors(<coords>) <n>`, `repeat <n> { … }`; targets `D<i>`, `L<i>`, separator `^`. A `^`-separated instruction is **one mechanism with several components**: each component's (D-set, L-set) is stored as written, the mechanism's sampled symptom is the **XOR** of the components (never the union), and the graph decoders use the components as edges, as PyMatching does. Comments `#…` and blank lines ignored. Anything else → `invalid_source: "unsupported DEM instruction '<name>' at line <k>"`. Canonical serialization sorts targets **within each component**, preserves the component order and the `^` split, prints probabilities with `repr(float)`, and is what `Dem.sha256` hashes and what `mwpm` loads.
