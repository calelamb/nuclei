# PRD 15 — The Quantumness Lab (master plan)

Status: master document **v2**, 2026-10-19 — revised after the adversarial physics review and the engineering/plan review (every finding resolved or answered in §10). Branch `feat/prd15-quantumness-lab` (origin/main 797da4b = released v0.14.1).
Owner: lead planner. Binding for every implementation unit; the per-idea specs in `docs/research/PRD_15/` are the detailed contracts and this document resolves every place where they disagree (§4.3). Where this document and a spec conflict, this document wins and the spec has been edited to match.

Scope note: **Learn mode is deprecated.** Nothing in PRD 15 designs for, integrates with, or fixes Learn-mode surfaces (lessons, challenges, capstones, tutor persona, onboarding playground). Every surface below is the Research workspace: Trainability Lab, Discovery Engine, QEC Studio, Experiments, the editor run path in Research mode, the command palette and Dirac as research collaborator. The byte-compatibility snapshot test for the Learn panel registry stays green only because nothing touches it.

Documents:

| Doc | Ideas | Role |
|---|---|---|
| `PRD_15/00_RELIABILITY_AUDIT.md` | — | scout report; source of Track R (§5) |
| `PRD_15/01_QUANTUMNESS_CERTIFICATE.md` | 1, 2 | surrogate suite, joint verdict, Goldilocks evaluator |
| `PRD_15/02_NOISY_TRAINABILITY_AND_KERNELS.md` | 3, 4 | noise layer, noisy PPE, calibration, quantum-kernel power of data |
| `PRD_15/03_SYMMETRY_COMPILER_AND_CLASSICAL_DEPLOY.md` | 5, 6 | symmetry compiler, classical surrogate export |
| `PRD_15/04_LEARNED_DECODERS_AND_VERIFIED_SUGGESTIONS.md` | 7, 8 | learned decoders + decoder evolution, verified Dirac suggestions |
| this file | all | vision, shared architecture, protocol v1.4 table, dependency policy, Track R, traceability, waves, DoD, review log (§10) |

---

## 1. Vision and the headline claim

### 1.1 Vision

PRD 14 made Nuclei the only IDE that *diagnoses* trainability with rigorous intervals. PRD 15 makes it the only IDE that answers the question every quantum-ML paper now has to answer, on the user's own code, with numbers it can defend:

> **Is this circuit trainable, is it classically simulable, does that survive the device's noise, and what should I do about it?**

Eight ideas, one product:

1. **Quantumness Certificate** — a suite of classical simulation attacks (Pauli propagation, 𝔤-sim, Clifford-path enumeration, MPS with a rigorous truncation bound, light cone; Fourier and random-Fourier-feature model surrogates on a separate line) joined with PRD 14's gradient-variance evidence into one verdict with an exact claim text — where reproducing the cost only at brute-force cost is reported as `brute_force`, never as a win, and the verdict always says "at n = N".
2. **Goldilocks Discovery evaluator** — evolve ansätze with no barren plateau detected *and* that resist the fully classical suite at sizes above the statevector cap (resistance = cost-growth evidence at the largest scored n, budget censoring flagged), with the suite itself as the Red Queen adversary.
3. **Device-noise-aware trainability** — the PPE learns Pauli noise; gradient variances, scaling verdicts and simulability are computed under a Pauli-twirled model built from a dated device calibration (1q p = 3r/2, 2q p = 5r/4; readout in the measurement frame; noise-aware finalisation) with the same rigorous ledger and separate twirl-gap bounds for expectations and variances.
4. **Quantum-kernel power of data** — geometric difference, model complexity, projected kernels with PPE intervals, concentration, bandwidth, and QK lint, scoped to the classical kernels actually compared.
5. **Symmetry compiler** — declare a symmetry, get an equivariant ansatz verified by the centraliser condition (`U R(g) U† = e^{iφ} R(g)`, never mere group membership), a symmetry-sector check that refuses 1-dimensional sectors, DLA/variance before and after, framework code back in the editor.
6. **Train quantum, deploy classical** — export a trained model as a validated numpy surrogate (exact-spectrum Fourier, classical shadow with HKP Theorem 1's constants and a declared input box, or labelled regression) with provenance to the training certificate.
7. **Learned QEC decoders** — numpy MLP vs weighted union-find vs MWPM vs the exact ML floor (F2 convolution, n_D + n_L ≤ 24) with validated paired-difference intervals (Newcombe hybrid score, Holm-adjusted), a fixed-before-decoding test split and a leakage ledger; Discovery evolves decoder architectures that never see data.
8. **Physics-verified Dirac suggestions** — Dirac proposes, the kernel pre-screens and verifies in the sandbox against a frozen observable, the editor shows only interval-separated claims (expressivity collapse labelled, never "verified") with an applicable, undoable diff.

And underneath: **Track R**, which makes the kernel actually run a researcher's code (no-measure circuits, library gates, parameterized ansätze, Stop, project working directory, memory guards), because the owner's report is "anytime I try to run something in nuclei there's bugs". Track R is a release blocker equal to the features.

### 1.2 The single headline claim (scoped honestly)

> **Nuclei 0.15 tells you, with rigorous intervals and on your own circuit at its qubit count, whether a parameterized quantum model shows a barren plateau, whether every fully classical surrogate we implement can reproduce its cost below brute-force cost, and whether both answers hold under a Pauli-twirled noise model built from a dated device calibration — and it can rewrite the ansatz (symmetry), export it classically (surrogate), and verify Dirac's suggestions before you see them.**

What the claim does **not** say, and the UI repeats every time: "no barren plateau detected" is gradient-variance evidence, *not* trainability (local minima: Anschuetz & Kiani 2022); "resists all implemented surrogates" is a statement about *these implementations at these budgets at this n* (never a hardness proof, never quantum advantage, never a statement about the family's scaling unless the surrogate-scaling mode ran, and nothing about quantum-enhanced classical simulation, which Cerezo et al. allow); at n ≤ 20 statevector simulation is always feasible and the UI says so; a noisy verdict is about a *Pauli-twirled, calibration-dated model* (never "trainable on" a device); a kernel verdict is *relative to the classical kernels compared* with heuristic thresholds labelled as such; "verified" means *the kernel recomputed these quantities for this qubit count with the baseline's observable*; a numpy MLP at d ≤ 7 is *a baseline, not AlphaQubit*. No number is a midpoint of an interval; every quantity carries a method label and an interval, a `not_applicable` reason, or `inconclusive`.

### 1.3 Who it is for

Researchers and graduate students doing variational QML / QEC who write Qiskit, Cirq, Stim or Q# in the editor and want the physics checks of the current literature (Cerezo et al., Nat. Commun. 16, 7907 (2025); Anschuetz & Kiani 2022; Wang et al. 2021; Huang et al. 2021; Nguyen et al. 2024; Schreiber et al. 2023; Jerbi et al. 2024; Bausch et al. 2024) run on *their* file, reproducibly, without leaving the IDE.

---

## 2. Shared architecture

### 2.1 Principles (binding)

1. **One mechanism per concern.** One surrogate registry, one noise-model layer, one dataset loader, one declaration reader, one lab message router, one job counter, one real-kernel e2e harness. Specs that each proposed their own were edited (§4.3).
2. **Registries, not shared edits.** Every file that four specs wanted to append to (`_settings.py`, `job_worker.py`, `handlers.py`, `server.py`, `trainability.ts`, `AnalysisTabs.tsx`, `VerdictRail.tsx`, `TargetBar.tsx`, `CommandPalette.tsx`, `useDirac.ts`, `e2eFixtureBridge.ts`) becomes registry-driven in Wave 1 so later units add *their own* file and never touch a shared one. Two units in the same wave never own the same file (§7).
3. **Kernel computes; frontend renders.** No physics in TypeScript beyond view derivation. Every number crossing the socket carries method + interval/reason.
4. **Honest by construction.** `interval` fields are `[lo, hi]`; the TS lint test that greps components for `(lo + hi) / 2` (spec 03 §7.5) applies to every new component.
5. **Stock-venv first.** Every feature has a working path with `kernel/requirements.txt` only (numpy, websockets, ruff, keyring, qiskit, qiskit-aer, cirq-core). Optional packages widen, never gate (§3).
6. **Usable end to end.** Every feature: trigger → running/progress → cancel → result/error/unavailable states, a stub-kernel Playwright spec, and a real-kernel Playwright spec (§5.4, §8).
7. **User code runs in a worker, once per code version.** Every message that executes user code (§5.1 R-B's list) goes through the warm run-worker pool with `project_root` cwd/`sys.path`, RSS and wall limits; parse, inspect, lint, symmetry detection and deploy inspection share one code-hash-keyed loaded-circuit cache, so an edit pause executes the program once, not 3–5 times.
8. **No files over the socket.** Datasets, `.dem` files, shadow snapshot files and candidate programs are never shipped in a frame: the kernel reads them from the validated `project_root` with size caps, and candidates travel as SEARCH/REPLACE edits. The 1 MiB inbound cap closes the socket with 1009 and cancels every Lab job, so `labSession.ts` refuses to send a frame over 1 MiB with a visible error, and an oversized request yields an error envelope, never a disconnect (handler-side validation, `max_size` raised to 4 MiB as the hard backstop).

### 2.2 Kernel package map (after PRD 15)

```
kernel/
├── run_worker.py                 # Track R: WARM worker pool for every user-code path (cancel, RSS/wall limits, project cwd/sys.path, loaded-circuit cache) [R-B]
├── framework_detect.py           # Track R: import/AST-based framework detection (R-3)                          [R-B]
├── lab_routes.py                 # prefix -> handler module registry, ALL five prefixes, lazy imports (replaces server._lab_phase) [F-1]
├── lab_protocol.py               # (+) v1.4 message catalog, request_id, project_root/file_path resolution, lab_capabilities [F-1]
├── lab_proc.py                   # (+) register_manager / total_running: Lab-wide cap of 4 jobs (nested sandboxes counted); group-RSS ceiling; project_root for every job worker [F-1]
├── hardware/manager.py           # (+) get_manager(): the hardware-manager singleton moved out of server.py       [F-1]
├── trainability/
│   ├── declarations.py           # ONE reader for nuclei_observable / nuclei_data_params / nuclei_model / nuclei_dataset [F-1]
│   ├── dataset.py                # ONE loader (csv/npy/npz/inline/callable; path-validated; allow_pickle=False)  [F-1]
│   ├── lightcone.py              # strip() + light_cone_width moved from discovery/evaluators/_frontier_structure (+exact Heisenberg-support cone) [Q1]
│   ├── _settings.py              # (+) section registry: register_section(name, normalizer)                     [F-1]
│   ├── job_worker.py             # (+) pkgutil auto-import of analyses_*.py; runners from jobs.py registry        [F-1]
│   ├── jobs.py                   # (+) register_analysis / register_result_hook / register_job_message; cumulative per-analysis partials [F-1]
│   ├── handlers.py               # (+) sync-handler registry: register_sync(type, fn)                           [F-1]
│   ├── provenance.py             # PROTOCOL_VERSION = "1.4"; fingerprint registry                               [F-1]
│   ├── analyses_surrogates.py    # registers "surrogates" analysis + "quantumness" result hook                  [Q1]
│   ├── analyses_noise.py, analyses_qkernel.py, analyses_verify.py   # N3+N4, K2+K3, V1 registrations
│   ├── verify.py, verify_rules.py, verify_cache.py, verify_handlers.py   # idea 8                               [V1]
│   └── convert.py                # (+) bounded decompose of composite blocks (R-5)                              [R-F]
├── surrogates/                   # ONE surrogate registry + simulators/fitters shared by ideas 1, 2, 6          [Q1,Q2,Q3]
│   ├── base.py                   # SurrogateReport, PointResult, statuses, BoundKind, ClaimClass A|B|C|N, SurrogateContext
│   ├── registry.py               # SUITE, SUITE_EXTENSIONS, NOT_IMPLEMENTED, SUITE_VERSION, suite_fingerprint(), EXPORTABLE_KINDS = {"fourier"}
│   ├── oracle.py, suite.py, quantumness.py, quick.py   # orchestrator, trusted oracle, joint verdict, certificate_cheap
│   ├── mps.py, gsim.py, _expm.py, spectrum.py, fourier.py, rff.py, shadow.py   # pure simulators & fitters
│   └── methods/{ppe,stabilizer,light_cone,gsim,mps,fourier,rff}.py             # Surrogate implementations
├── noise/                        # ONE noise-model layer shared by ideas 3, 1 (noisy_ppe), 7 (DEM noise), 8 (noisy check) [N1..N4]
│   ├── model.py, channels.py, schedule.py, densitymatrix.py, bounds.py          # core                          [N1]
│   ├── compile.py, ppe_noisy.py                                                 # noisy PPE                     [N2]
│   ├── calibration.py, bundled/                                                 # device calibration            [N3]
│   ├── analyses.py, surrogate.py                                                # analyses + noisy_ppe surrogate [N4]
├── qkernel/                      # idea 4                                                                       [K1,K2,K3]
├── symmetry/                     # idea 5 (+ propose.py for idea 8)                                             [S1,S2,S3]
├── deploy/                       # idea 6 (imports fitters from kernel/surrogates)                              [D1,D2,D3]
├── qec/learned/                  # idea 7                                                                       [L1,L2,L3]
├── discovery/
│   ├── evaluators/{goldilocks,_goldilocks_*,decoder_architecture}.py           # ideas 2, 7                     [G1,L4]
│   ├── audits/{goldilocks,decoder_architecture,_frontier_shared}.py                                            [G1,L4]
│   ├── candidate_worker.py       # (+) tasks decoder_spec, module_circuit                                       [L4]
│   ├── prescreen.py              # static AST pre-screen for LLM-origin candidates (mandatory on `process`)        [R-F]
│   ├── diff_apply.py             # SEARCH/REPLACE application, kernel-side mirror of src/services/discovery/diff.ts [F-1]
│   └── isolation.py              # (+) `landlock` tier (ABI probe), bwrap userns probe, consent flag (R-19)         [R-F]
└── tests/research_corpus/        # Track R golden corpus (G0): glob loader + scout/ programs [R-D]; each unit adds <unit>/ programs
```

### 2.3 The ONE surrogate registry (`kernel/surrogates/`)

Spec 01 defined the suite under `kernel/trainability/surrogates/`; spec 03 defined Fourier/shadow fitters under `kernel/deploy/surrogates/` and asked spec 01 to import them; spec 02 registers `noisy_ppe`; spec 04 asked for `certificate_cheap`. Resolution: **`kernel/surrogates/` is the single home.**

- `registry.py`: `SUITE: tuple[Surrogate, ...]` in order `(light_cone, stabilizer, gsim, ppe, mps, fourier, rff)`; `SUITE_EXTENSIONS: tuple[Surrogate, ...]` (spec 02 appends `noisy_ppe`, claim class `"N"`); `NOT_IMPLEMENTED` list (spec 01 §2.9); `SUITE_VERSION = "1.0.0"`; `suite_fingerprint()` over `kernel/surrogates/**/*.py`; **`EXPORTABLE_KINDS = {"fourier"}`** — only the Fourier route has validated accuracy semantics in spec 03; 𝔤-sim/MPS/light-cone wins carry `exportable: null` until spec 03 defines a self-checking export with per-call rigorous bounds for them. Each `SurrogateReport` carries `exportable: {"kind", "ref"} | null` (spec 01 §10) that idea 6 resolves, a `family` (`light_cone | pauli_path | gsim | mps | model`; S1 and S3 share `pauli_path`) and a status that includes **`brute_force`** (reproduced the cost only at brute-force cost — never a win; spec 01 §2.1).
- `base.py`: spec 01 §3.2 dataclasses with `ClaimClass = Literal["A","B","C","N"]`; `SurrogateContext` carries `all_settings` (the full clamped job settings), `noise_model: NoiseModel | None` (populated by the suite from `settings.noise.model` so `SUITE_EXTENSIONS`' `noisy_ppe` can run) and `n_qubits`.
- `suite.py`: `run_surrogate_suite(circuit, observable, *, settings, seed, init, backend, progress, cancel) -> dict` (spec 01 §3.3). Used by the Lab analysis (idea 1), the Goldilocks evaluator and audit (idea 2), the Conjecture tester, and the verifier's `certificate` check (idea 8).
- `quick.py`: `certificate_cheap(circuit, observable, *, time_budget_s, seed, cancel) -> dict` and `is_available() -> bool` — runs the structural class-A surrogates (`light_cone`, `stabilizer`, `gsim` dimension check, PPE at a small frontier) within the budget and returns the §3.6 quantumness shape with `evidence: "cheap"` **and the same `brute_force` status semantics**, so specs 03 (`simulability_warning`) and 04 (verifier certificate line) never quote a brute-force result as "simulable". This is the single name specs 03 (`assess`) and 04 (`certificate_cheap`) now reference.
- Pure fitters/simulators (`mps.py`, `gsim.py`, `spectrum.py`, `fourier.py`, `rff.py`, `shadow.py`, `lightcone` via `kernel/trainability/lightcone.py`) have no protocol dependencies; `kernel/deploy/` imports them for export (idea 6) and `kernel/qkernel/` may use `projected_gram`'s PPE route only through `ppe_core`.
- Quantumness verdict rules: the simulability axis is computed **only from class-A reports with `bound_kind ∈ {rigorous, exact}` and status `wins`**; class B/C (Fourier, RFF) go to a separate `model_surrogate` line and never enter `winners`, `cheapest_winner`, the resists count or the joint table; class `N` is listed in `reports`, excluded from the noiseless axis and surfaced as `quantumness.noise: {"noisy_cost_simulable": bool, "surrogate": "noisy_ppe", "model": {...}} | null` (spec 02 §10). `resists_implemented` needs n > 20 and ≥ 3 distinct families; at n ≤ 20 the honest value is `brute_force_simulable`. Trainability tokens are `bp | no_bp_evidence | unknown`, never "trainable" (spec 01 §2.9).

### 2.4 The ONE noise-model layer (`kernel/noise/` + `src/types/noiseModel.ts` schema 2)

- Kernel: spec 02 §4 as revised. `NoiseModel.from_json` is the only parser of wire noise models; presets and `*.noise.yaml` files are resolved **by the frontend** to JSON; calibrations are resolved **only** through the sync messages `trainability_calibration_to_model` / `hardware_calibration` (20 s timeout, response cap, strict parsing, via `kernel.hardware.manager.get_manager()`), whose reply the frontend stores and sends back as a fully resolved model with `source.sha256`/`fetched_at`. `trainability_start` **rejects** an unresolved `{"calibration": …}` (`noise_model_invalid`): job workers are `python -I` subprocesses with no provider state and a live fetch inside a job would make provenance non-reproducible.
- Consumers: idea 3 (`gradients_noisy`, `noise_sweep`, `scaling_noisy`, `simulability_under_noise`); idea 1 (`noisy_ppe` via `SUITE_EXTENSIONS`); idea 8 (optional `noisy_ppe` check in `trainability_verify` when the Lab has a model selected — name `kernel.noise.analyses.gradient_variances_noisy`); idea 7 (DEM sources generated through `qec_generate` take the same `noise/*.noise.yaml` library entries — schema 2 files with a `circuit_noise` block are shown with a "circuit noise" chip and hidden from sinter campaigns).
- Frontend: `src/types/noiseModel.ts` becomes a discriminated union on `schema: 1 | 2`; the existing QEC noise library UI lists both; the Trainability Lab's `NoisePicker` reads the same files. No second library.
- Not modelled, stated everywhere a noisy number appears: coherent errors, leakage, crosstalk, correlated errors, drift.

### 2.5 Shared job / progress / cancel / provenance

- Every long operation is a `LabJobManager` subclass job in a subprocess (`python -I`, minimal env, process-group kill, 20-min wall, CPU limit, **and — new, F-1 — a group-RSS memory ceiling** via `procrun.group_rss_bytes` poll-and-kill (`worker_died` / `too_much_memory`), plus `project_root` → cwd / `sys.path` / `__file__` applied in `LabJobManager._spawn` for every Lab job worker so multi-file research projects work in the Lab). Managers: trainability (ideas 1, 3, 4, 8), symmetry (5), deploy (6), qec_learned (7), discovery (2, 7-evaluator). `lab_proc.register_manager(manager)` + `lab_proc.total_running()` enforce the **Lab-wide cap of 4** running jobs, counting nested verify sandboxes; per-manager caps stay (`qec_learned`: 1 per owner, 2 global). **Discovery** is a queue-based `DiscoveryManager` with a pooled sandbox, not a `LabJobManager`: it registers its pool concurrency (default 2) as that many slots in `total_running()` (documented), so the cap is defined across every family.
- Stream shape for every job family: `<family>_started {job_id}` → `<family>_progress {job_id, stage|analysis|decoder, fraction, message}` (≤ 10/s) → `<family>_partial {job_id, ..., result}` → terminal `<family>_result {job_id, status: complete|cancelled|failed, results, errors, elapsed_ms, provenance}`; `<family>_cancel {job_id}` → `<family>_cancelled {job_id, accepted}`. Closing the socket cancels the connection's jobs (`LabContext`).
- Track R brings the **editor run path and every other user-code path** onto the same model: the `run_worker.py` warm pool with `run_cancel {run_id}` → `run_cancelled`, `timeout`, `worker_died`, `too_much_memory` (group-RSS ceiling — **never `RLIMIT_AS`**, which `kernel/agent_limits.py` records as breaking numpy/BLAS and rustworkx and which macOS rejects; **never `RLIMIT_NPROC`**, which breaks rayon).
- Provenance: `build_provenance` (PRD 14 addendum §D) + `nuclei_protocol: "1.4"` + per-feature fingerprints registered through `provenance.register_fingerprint(name, globs)` (`suite_fingerprint`, `noise_fingerprint`, `qkernel_fingerprint`, `symmetry_fingerprint`, `deploy_fingerprint`, `decoders_fingerprint`, `verify_fingerprint`). `analyses_fingerprint()` is **scoped to an explicit list of the PRD 14 analysis modules** so PRD 15 files in `kernel/trainability/` never change the PRD 14 certificate fingerprint; `conjecture/ledger.py` imports `PROTOCOL_VERSION` from `provenance` instead of keeping its own; `discovery/constants.PROTOCOL_VERSION` bumps to 2 with a worker-side check for the new `decoder_spec`/`module_circuit` tasks. Determinism contract everywhere: same inputs + seed → bit-identical JSON except `elapsed_ms`; seeds domain-separated by SHA-256 (each feature defines its own `derive_seed(seed, domain, …)`; `qec_stats.derive_seed(seed, distance)` is not a domain-string API).
- **Job hooks (F-1, `kernel/trainability/jobs.py`)** — the registries features actually need: `register_analysis(name, runner(job, progress, emit_partial, cancel), width_check, needs_parameters)` (today's `_check_width` / `_NEEDS_PARAMETERS` become registry fields and `run_job` passes a real cancel and a partial emitter); `register_result_hook(name, fn(results, request) -> dict)` for top-level fields such as `quantumness` and `quantumness.noise`, assembled in `jobs._terminal_message` so a cancelled (SIGKILLed) job still carries them; **per-analysis cumulative partials** (`job.results[analysis]` keeps the last partial, flagged `complete: false` on cancel — needed by spec 01's "Cancelled after k of N surrogates", qkernel's per-stage partials and verify's per-candidate records); `register_job_message(type, request_builder, result_assembler)` for `trainability_verify`, whose request shape is not `_build_request`'s. Discovery of `kernel/trainability/analyses_*.py` is a `pkgutil` auto-import in both `handlers.py` (server: settings sections, sync handlers) and `job_worker.main` (runners), with a test asserting the two registries agree.
- Frontend: every feature's client wraps the shared `LabSession` (`src/services/lab/labSession.ts`, one authenticated socket per Lab) with `request_id` matching for sync calls and a job event stream for jobs, exactly like `src/services/trainability/client.ts`. Status chips (`LabStatusChips`) and `ModeSwitchGuard` read a **job registry** (`src/services/lab/jobRegistry.ts`, Wave 1) so each feature registers its running-job selector instead of editing the chips.

### 2.6 Shared TS types

Wave 1 writes every v1.4 type from the frozen spec shapes so no feature unit edits a shared type file:

| File | Content | Source spec |
|---|---|---|
| `src/types/trainability.ts` (extend) | `TrainabilityAnalysis += 'surrogates' \| 'gradients_noisy' \| 'noise_sweep' \| 'scaling_noisy' \| 'qkernel' \| 'verify'`; `TrainabilityTabId += 'quantumness' \| 'noise' \| 'qkernel'`; `TrainabilityInspection.data_params?`, `.model?`, `.dataset?`; settings sections `surrogates`, `noise`, `qkernel`; sync request/response members for the catalog, presets, calibration; `TrainabilityDiagnostic.code: TRN00x \| QK00x`; `TrainabilityRequest/Response` extended | 01 §5.5, 02 §6.5, 04 §8.2 |
| `src/types/quantumness.ts` | `SurrogateId`, `SurrogateStatus`, `BoundKind`, `ClaimClass`, `SurrogatePointResult`, `SurrogateReport`, `SurrogateSuiteResult`, `QuantumnessVerdict`, `SurrogateCatalogEntry` | 01 §5.5 |
| `src/types/noise.ts` | `NoiseModelJson`, `NoiseChannelKind`, `NoiseSource`, `CalibrationSnapshot`, `NoisyGradientStatistics`, `NoiseSweep` | 02 §6.5 |
| `src/types/noiseModel.ts` (extend) | schema 2 union, `circuit_noise`, built-in circuit presets | 02 §6.5 |
| `src/types/qkernel.ts` | `QKernelSettings`, `QKernelDatasetRef`, `QKernelGramSummary`, `QKernelGeometry`, `QKernelVerdict`, `QKernelReport` | 02 §6.5 |
| `src/types/hardware.ts` (extend) | `hardware_calibration` / `hardware_calibration_result` | 02 §5.3 |
| `src/types/symmetry.ts`, `src/types/deploy.ts` | request/response unions, result shapes | 03 §5 |
| `src/types/qecLearned.ts` | `DemSourceRef`, `DemSourceInfo`, `DecoderInfo`, `DecoderSpec`, `DecoderReport`, run record, unions | 04 §8.1 |
| `src/types/suggestions.ts` | `VerificationRecord`, goals, origins, proposer availability | 04 §8.2 |
| `src/types/discovery.ts` (extend) | `DiscoveryEvaluatorKind += 'goldilocks' \| 'decoder_architecture'`; `DiscoveryTask += 'decoder_spec'`; `src/types/conjecture.ts` new features | 01 §4.5, 04 §9 |
| `src/types/quantum.ts` (extend) | `KernelMessage`/`KernelResponse` unions gain symmetry, deploy, qecLearned, suggestion members; `error.phase` union gains `'symmetry' \| 'deploy' \| 'qec_learned' \| 'hardware'`; execute additions from Track R (`run_id`, `parameter_values`, `project_root`, `file_path`, `run_cancel`/`run_cancelled`, result `measurements_source ∈ sampled | sampled_from_statevector | none`, `probabilities_exact: bool`, `bound_at`, `truncated`, `figures`) — one field set, identical to §4.2 | 03 §5.6, 04 §8, audit |

All zod schemas for files (`*.noise.yaml` schema 2, `*.discovery.yaml` evaluator configs) live next to the types as today.

### 2.7 Research-workspace information architecture

One product, one place for each thing:

**Trainability Lab** (rail view `trainability`, ⌘-number per registry) — `TrainabilityLab.tsx` gets a `LabSegmented` **mode** switch from `labModes.ts` (registry, Wave 1): **Analyze · Symmetry · Deploy**. The `TargetBar` (file, observable, settings) is shared by all modes and gains two registry slots: a **Noise** picker (idea 3) and a **data** pill with dataset picker (idea 4).
- *Analyze* tabs (registry `labAnalyses.ts`): Gradients · Scaling · Lie · Expressibility · Landscape · **Quantumness** (1) · **Noise** (3) · **Kernel** (4). Analysis picker entries, tabs and `VerdictRail` cards all come from the same registry entry per analysis, so a feature adds one file.
- *Symmetry* (5): detection chips → declaration editor → compile → rewrite table, certificate, before/after, emitted code with round-trip badge → Insert as sibling file.
- *Deploy* (6): model card (snippet quick-fix) → route picker with feasibility → train (loss curve) → export → validation report + files.
- Drawers (`LabDrawer`): **Calibration** (3, from the Noise picker), **Verified suggestions** (8, from the VerdictRail "Ask for verified fixes" button).
- VerdictRail cards (registry): Trainability · Simulability · **Quantumness** · **Under noise** · **Kernel power of data** · Symmetry (when a compile exists) · Lint · Export certificate. The certificate (`certificate.ts`) renders sections by registry.

**Discovery Engine** (rail view `discovery`) — evaluator catalogue gains **Goldilocks** (2) and **Decoder architecture** (7); the New-discovery wizard templates, Definition panel honesty text, candidate-drawer sections ("Surrogate suite", "Decoder report") and Red Queen lanes come from `src/services/discovery/evaluatorDefinitions/<kind>.ts` (registry, Wave 1).

**QEC Studio** (rail view `qec`) — new canvas panel **Learned Decoders** (7) in `qecPanelRegistry.ts` (zone `canvas`, preset `analyze`); Decoder Workbench header button "Train a learned decoder on these circuits"; the Noise Model Library shows schema-2 files with a "circuit noise" chip.

**Editor (Research mode)** — Track R states: `Running… (12 s) ■ Stop`, "N free parameters — Run at point…", histogram "no measurements; exact probabilities", `too_many_qubits` card with the memory estimate and "Use Aer MPS / run in the Lab", "kernel restarted" toast (R-7), "Linting off (ruff not installed) [Install]", inline figures panel. Lint markers `TRN00x` + `QK00x`. **Code actions go through one registry** — `src/components/editor/codeActions/registry.ts` (F-3) with a single `registerCodeActionProvider` call in `QuantumEditor.tsx`; today's `quantumCodeActions.ts` defines a provider that is never registered, and F-3 either wires it through the registry or deletes it. Provider files: `quantumnessActions.ts` ("Check with the surrogate suite →" on TRN003, FE-Q), `qkernelActions.ts` (QK001 quick-fix inserts `nuclei_data_params`, FE-K), `verifiedSuggestionActions.ts` ("Dirac: suggest verified edits" on any TRN marker and file-level; "Apply verified edit: …" per verified card, FE-V). **⌘⇧E** opens suggestions (⌘⇧S is Save As in `App.tsx`; a shortcut-collision test over the `App.tsx` handler, every Monaco `addAction` keybinding and `featureCommands` guards every chord); ⌘⇧↵ runs Lab analyses; ⌘↵ runs the circuit; ⌘⇧D trains learned decoders when the panel is focused.

**Command palette** (registry `src/components/commandPalette/featureCommands.ts`, Wave 1): `Trainability: Run quantumness certificate`, `Trainability: Export certificate`, `Trainability: Run under device noise`, `Trainability: Check kernel power of data`, `Trainability: Fetch device calibration`, `Symmetry: Detect symmetries`, `Symmetry: Compile equivariant ansatz`, `Deploy: Inspect model`, `Deploy: Train model`, `Deploy: Export classical surrogate`, `QEC: Train learned decoder`, `Dirac: Suggest verified edits`, `Discovery: New Goldilocks search`, `Discovery: New decoder-architecture search`, `Kernel: Stop run`. The palette↔registry parity test is extended to feature commands.

**Dirac (research collaborator)** — context providers registry (`src/services/dirac/contextProviders.ts`, Wave 1): quantumness block, noise block, kernel block, symmetry block, deploy block, learned-decoders block, verification block — all capped, Research only. Slash commands `/suggest [goal]` (8) and `/decoders` (7). Model IDs come from **one registry, `src/config/models.ts`** (F-3): bare aliases `claude-haiku-5-5` (proposals from `/suggest`, ghost), `claude-sonnet-5-5` (proposals from the Lab rail, tool use), `claude-opus-5-5` (conjectures, depth mutator), never dated snapshots; F-3 migrates `src/config/dirac.ts`, `ghostCompletions.ts`, `claudeClient.ts` and `services/discovery/models.ts` (which today pin `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-7` and the 5-5 ids respectively) to it, with a test that no other file hard-codes a `claude-*` id. Dirac never computes a number; every number in a Dirac reply about these features is quoted from a kernel result in context.

**Missing-dependency UX (R-15)** — the **existing** `src/stores/missingDependencyStore.ts` (extended with a source/panel key and the `catalog_ids`/`install` shape of `availability.describe`) + the existing `src/components/onboarding/MissingDependencyBanner.tsx` (already mounted in `App.tsx`) + a `MissingDependencyCard` reading the same store ("Unavailable: needs stim, pymatching · [Install]") consumed by the editor (`EditorTabs.tsx`, where the Run button lives), every Lab mode, QEC panel state components, `EvaluatorUnavailable.tsx` and the Learned Decoders decoder chips. No second store. Install resolves through the existing `framework_resolve`/catalog path.

**Lab chart primitives** — `LabHeatmap`, `LabLineChart` and `IntervalBars` do not exist today (`src/components/lab/` has `charts.tsx` with `ChartFrame`, `LegendItem`, `RampLegend`); F-3 adds them to `charts.tsx` in Wave 1 so FE units only consume them.

---

## 3. Dependency policy and managed-venv impact

**Facts (audit §2):** the installed app provisions `websockets, numpy, keyring` + catalog picks (`qiskit qiskit-aer` unpinned → Qiskit 2.x today, `cirq`, `qdk`), no `ruff`, no stim/sinter/pymatching/pyarrow/duckdb/jsonschema. `scipy` arrives transitively with qiskit/cirq and is *not declared*. CI tests Python 3.12 + Qiskit 1.4.

**Policy:**

| Package | Status | Where | Justification |
|---|---|---|---|
| numpy, websockets, keyring, ruff, qiskit (+aer), cirq-core | required | `kernel/requirements.txt`; `KERNEL_CORE_DEPS` gains `ruff>=0.6,<1.0` (R-16) | shipped today; ruff fixes the silent-lint bug |
| qiskit | required, **range widened** | `qiskit>=1.2,<3` in requirements + catalog pinned to the same range (R-14) | the owner runs 2.6; CI gets a Qiskit-2 leg; PRD 15 code must run on both |
| scipy | **optional accelerator**, never imported at module import | lazy, numpy fallback (`_expm.py`, Krylov null space) — provenance records `scipy: version \| null` | present in practice, not guaranteed by requirements |
| stim, sinter, pymatching, fusion-blossom | optional (existing catalog) | lazy via `kernel/discovery/_optional.py` | QEC sources/MWPM widen idea 7 |
| pyarrow, duckdb, jsonschema | optional (existing `qec-data` entry) | lazy; `arch_spec` validates by hand when `jsonschema` absent | unchanged |
| **torch** | optional, **new catalog entry** `torch` ("PyTorch (CPU)", `torch>=2.4,<3`, group research, ~200 MB, not recommended) | lazy; `missing_dependency` naming the entry | transformer/conv decoders (idea 7); numpy MLP needs nothing |
| **onnx** | optional, **new catalog entry** `onnx` (`onnx>=1.16,<2`, group research) | lazy; `availability.onnx` message, never an error | idea 6 ONNX export convenience |
| qiskit-ibm-runtime, qiskit-ionq | optional (existing provider entries) | live calibration (idea 3) only; bundled snapshots otherwise | — |
| hypothesis | not added | seeded loops instead | — |

**Works in the stock managed venv (no optional package):** the whole surrogate suite; Goldilocks; noisy PPE with presets, files and bundled calibration snapshots; qkernel with demo/project datasets; symmetry compile/verify/emit; Fourier/shadow/regression export (`.py` + `.json`); learned decoders on bundled DEMs with Exact ML, Union-Find and numpy MLP; the `decoder_architecture` evaluator with a bundled source; verified suggestions with the AST proposer (and Claude with a key). **Needs an optional package (shown as an install card, never an error):** MWPM row (pymatching), torch decoders (torch), ONNX file (onnx), Stim circuit/campaign DEM sources (stim), live IBM/IonQ calibration (provider SDK).

**CI matrix (Track R, §5.3):** `pytest` (3.12, Qiskit 1.x, full optional set), `pytest-qiskit2` (3.13, Qiskit 2.x, full optional set), `pytest-minimal-venv` (3.12, requirements.txt only, **whole `kernel/tests` suite** with `importorskip` everywhere; since qiskit pulls scipy transitively, "no scipy" is proven by a `sys.modules['scipy'] = None` blocker test over every new package in `test_discovery_optional_deps.py`), `corpus-app-env` (3.13, the exact catalog pip lists the shell installs), `lab-e2e-stub` (every non-`@qec`, non-`@real` Playwright spec, both viewport projects — today only `@qec` specs run in CI), `real-kernel-e2e` (Playwright against a real kernel in the `dev` and `minimal` venvs), nightly `packaged-app-smoke`. Local equivalents come from `scripts/make-test-venvs.sh` (R-D, Wave 0a: `uv` venvs for 3.12/Qiskit 1.x, 3.13/Qiskit 2.x, minimal, and the app-env catalog lists).

**Availability UI:** every kernel reply that depends on an optional package carries `available`, `missing: [...]`, `install: {catalog_ids, hint}` (shape of `availability.describe`); the frontend never greys a control without naming the package and offering Install.

---

## 4. Protocol v1.4 — consolidated message table

`kernel/trainability/provenance.py: PROTOCOL_VERSION = "1.4"` (one owner: F-1). Additive on v1.3 for lab messages; the execute-path additions are additive on v1.2. All replies flat `{"type": ...}`; errors `{"type": "error", "phase", "code", "message", "job_id"?, "request_id"?, "path"?, "source_line"?, "column"?}`; every sync request honours `request_id` (`kernel/lab_protocol.py`). Every lab request may carry `project_root` (absolute, must exist; validated server-side) and `file_path`; the kernel never `chdir`s the server process. **Frame size:** inbound frames are capped (`MAX_MESSAGE_SIZE`, raised from 1 MiB to 4 MiB as a backstop); every handler validates its own payload caps and answers `too_large` as an error envelope; files are never shipped (§2.1 item 8). **Kernel age:** `lab_capabilities {request_id?}` → `lab_capabilities_result {protocol, families, analyses, evaluators, sync_messages}` (F-1) is called once per session and gates every feature; no reply within 3 s is "kernel too old". The server's `unknown_message` reply echoes `request_id` (today `handlers._dispatch`'s else branch omits it).

### 4.1 Routing

`kernel/lab_routes.py` replaces `server._lab_phase`:

```python
LAB_ROUTES = {"trainability_": "kernel.trainability.handlers", "discovery_": "kernel.discovery.handlers",
              "symmetry_": "kernel.symmetry.handlers", "deploy_": "kernel.deploy.handlers",
              "qec_learned_": "kernel.qec.learned.handlers"}
def lab_phase(msg_type) -> str   # longest matching prefix without the trailing "_"
```

`server._LAB_MESSAGE_PREFIXES` is derived from `LAB_ROUTES`. **F-1 populates all five prefixes in Wave 1** with lazy imports — a prefix whose module does not exist yet answers `family_unavailable` — so no later unit (S2+S3, D3, L3+L4) ever edits `lab_routes.py`. `discovery_conjecture_*` and `discovery_audit*` stay under `discovery_`; there is no `conjecture_` prefix and no default phase. `hardware_calibration` is a hardware-family branch in `server.py`. The auth/isolation tests (`test_lab_token_isolation.py`, `test_kernel_auth.py`) are parametrized over every prefix in `LAB_ROUTES`.

### 4.2 Execute path (Track R; phases `parse` / `execute`)

| Request | Response | Notes |
|---|---|---|
| `parse {run_id, code, language?, project_root?, file_path?}` | `snapshot` (+ `qec_snapshot`) or `error` | superseded parses are dropped (`parse_superseded` is never sent to a stale request; the newest wins); cached by code hash in the loaded-circuit cache shared with inspect/lint/symmetry_detect/deploy_inspect |
| `execute {run_id, code, language?, params?, seed?, parameter_values?: {name: number} \| {"random_seed": int}, project_root?, file_path?}` | `result` gains `measurements_source: "sampled" \| "sampled_from_statevector" \| "none"`, `probabilities_exact: bool`, `bound_at?: {name: value}`, `truncated?: {state_vector: bool, probabilities: bool, reason}`, `figures?: [{png_base64, title}]`, `metrics`, `seed_honored`. R-1 (no measurements): `measurements = {}`, `measurements_source: "none"`, exact probabilities present (`probabilities_exact: true`) | R-1, R-4, R-11, R-12 |
| `run_cancel {run_id}` | `run_cancelled {run_id, accepted}` then the pending `error {code: "cancelled"}` | R-6; kills that run's worker; a cancel for a finished or unknown `run_id` is ignored (`accepted: false`) so Stop clicked as a run finishes never kills the next run |
| `lint` | `lint_result` gains `available: bool, reason?` | R-16 |
| new error codes | `unbound_parameters` (info-class, carries `parameters`), `too_many_qubits` (with the memory estimate and the `method=matrix_product_state` re-run action), `timeout`, `user_exit`, `worker_died`, `too_much_memory`, `unsupported_instruction` (names the gate), `output_truncated` note on `output` frames | R-4, R-11, R-6, R-7, R-2, R-22 |

### 4.3 Trainability family (`phase: "trainability"`)

| Request | Response(s) | Idea / spec |
|---|---|---|
| `trainability_inspect` | `trainability_inspected` gains `data_params: string[]`, `model: {...} \| null`, `dataset: {...} \| null` (from `declarations.py`) | 1, 4, 6 |
| `trainability_lint` | `trainability_lint_result.diagnostics` may contain `QK001–QK006`; `summary.qkernel` | 4 |
| `lab_capabilities {request_id?}` | `lab_capabilities_result {protocol: "1.4", families, analyses, evaluators, sync_messages}` | all (F-1) |
| `trainability_start {…, analyses ⊆ [gradients, scaling, lie, expressibility, entanglement, landscape, surrogates, gradients_noisy, noise_sweep, scaling_noisy, qkernel], settings.{surrogates, noise (fully resolved model only), qkernel}}` | existing stream; `trainability_partial.analysis` includes the new ids (qkernel streams one partial per stage); `trainability_result` gains `quantumness`, `results.{surrogates, gradients_noisy, noise_sweep, scaling_noisy, qkernel}`, `provenance.{suite_version, suite_fingerprint, noise_fingerprint, qkernel_fingerprint, kernel.scipy}` | 1, 3, 4 (01 §4, 02 §5) |
| `trainability_surrogate_catalog {request_id?}` | `trainability_surrogate_catalog_result {suite_version, surrogates: [...], not_implemented}` | 1 (01 §4.3) |
| `trainability_noise_presets {request_id?}` | `trainability_noise_presets_result {presets, bundled_calibrations, not_modelled}` | 3 (02 §5.3) |
| `trainability_calibration_to_model {request_id?, provider, backend, n_qubits, layout?, strength?, idle?, nonunital?, source?}` | `trainability_noise_model {model, snapshot, warnings}` or `calibration_unavailable` | 3 |
| `trainability_verify {job_id, code, language?, params?, project_root?, observable?, init?, seed?, goal, candidates[≤8] as {id, edits: [{search, replace}], origin, rationale?}, checks?, budget_ms?, noise_model?, isolation_consent?, attempt?}` (request ≤ 900 KB; candidates are edits applied kernel-side, never full programs) | `trainability_started` → `trainability_progress {analysis: "verify"}` → `trainability_partial {analysis: "verify_baseline" \| "verify", result}` → `trainability_result {results.verify: {baseline, candidates}}` | 8 (04 §8.2) |
| `trainability_cancel` | unchanged | — |
| Error codes added | `surrogate_unknown`, `surrogates_need_parameters`, `surrogates_width`, `noise_model_invalid` (incl. unresolved calibration), `noise_not_applicable`, `calibration_unavailable`, `qkernel_needs_data_params`, `dataset_invalid`, `dataset_path_outside_project`, `dataset_too_large`, `qkernel_width`, `qkernel_not_ppe_class`, `too_many_candidates`, `candidate_too_large`, `too_large`, `verify_unavailable`, `isolation_consent_required` | — |

### 4.4 Hardware family (`phase: "hardware"`)

| Request | Response |
|---|---|
| `hardware_calibration {request_id?, provider, backend}` | `hardware_calibration_result {snapshot}` or `calibration_unavailable` |

### 4.5 Symmetry family (`phase: "symmetry"`, idea 5; 03 §5)

| Request | Response(s) |
|---|---|
| `symmetry_detect {request_id?, code, language?, params?, observable?}` | `symmetry_detected {n_qubits, observable, candidates, notes}` |
| `symmetry_propose {request_id?, code, language?, params?, observable?, max_proposals?}` | `symmetry_proposals {proposals: [{code_edits: [{search, replace}], rationale, preset}]}` — the idea-8 proposer (`kernel/symmetry/propose.py`, owned by **S2+S3** in Wave 3a because it emits source through `emit.py`) |
| `symmetry_compile {job_id, code, language?, params?, observable?, symmetry, options}` | `symmetry_started` → `symmetry_progress {stage ∈ compile\|verify\|before\|after\|emit}` → `symmetry_partial` → `symmetry_result` |
| `symmetry_cancel {job_id}` | `symmetry_cancelled {job_id, accepted}` |
| Errors | `invalid_symmetry`, `symmetry_too_large`, `noncommuting_twirl`, `trivial_twirl`, `trivial_symmetry_sector`, `fixed_gate_breaks_symmetry`, `twirl_not_converged`, `unsupported_gate_for_twirl`, `emission_failed`, `artifact_stem_invalid`, `symmetry_busy`, `symmetry_internal` + inherited |

### 4.6 Deploy family (`phase: "deploy"`, idea 6; 03 §5)

| Request | Response(s) |
|---|---|
| `deploy_inspect {request_id?, code, language?, params?}` | `deploy_inspected {model, declaration_snippet?, dataset, spectrum, routes, training, notes}` |
| `deploy_train {job_id, code, language?, params?, options}` | `deploy_started` → `deploy_progress {stage: "train"}` → `deploy_partial {stage: "train", result: {epoch, train_loss, holdout_loss}}` → `deploy_result {kind: "train"}` |
| `deploy_export {job_id, code, language?, params?, project_root?, weights?, route, options}` (shadow snapshot files are read from `project_root`, never inlined) | `deploy_started` → `deploy_progress {stage ∈ evaluate\|fit\|validate\|export}` → `deploy_partial` → `deploy_result {kind: "export", results.{fit, validation, artifacts}}` |
| `deploy_cancel {job_id}` | `deploy_cancelled` |
| Errors | `no_model_declaration`, `invalid_model_declaration`, `invalid_dataset`, `unsupported_encoding`, `route_not_applicable` (incl. the grid-feasibility estimate), `spectrum_too_large`, `weights_missing`, `untrained_model`, `shadow_locality_too_high`, `shadow_import_invalid`, `shadow_input_range_missing`, `artifact_stem_invalid`, `training_unavailable`, `export_failed`, `deploy_busy`, `deploy_internal` |

### 4.7 QEC learned family (`phase: "qec_learned"`, idea 7; 04 §8.1)

| Request | Response(s) |
|---|---|
| `qec_learned_sources {request_id?, project_root, project_files? (paths only), circuit?, campaign_tasks?}` | `qec_learned_sources_result {sources, decoders}` (DEM text is read by the kernel from `project_root`, never shipped) |
| `qec_learned_start {job_id, source, decoders, seed?, splits?, training?, generalization?}` | `qec_learned_started` → `qec_learned_progress {decoder, phase, fraction, message}` → `qec_learned_partial {decoder, report}` → `qec_learned_result {dem, splits, reports, comparison, errors, provenance}` |
| `qec_learned_cancel {job_id}` | `qec_learned_cancelled` |
| Errors | `invalid_source`, `missing_dependency`, `unknown_decoder`, `invalid_config`, `qec_learned_busy`, `qec_learned_internal` |

### 4.8 Discovery family additions (`phase: "discovery"`)

- `discovery_evaluators_result` lists `goldilocks` (task `quantum_circuit`) and `decoder_architecture` (task `decoder_spec`) with availability.
- `discovery_audit` works for both via `audits/goldilocks.py`, `audits/decoder_architecture.py`.
- `discovery_conjecture_schema` exposes `weakest_surrogate`, `resistance`, `mps_chi_needed_log2`, `light_cone_qubits`, `gsim_dimension`, `stabilizer_t_eff`.
- Candidate worker tasks: `decoder_spec` (returns a dict artifact), `module_circuit` (returns the IR artifact for idea 8).
- `discovery_evaluate` and `trainability_verify` carry `isolation_consent: bool` when the host's best isolation is `process` (R-19); without consent on such hosts the kernel answers `isolation_consent_required {run_id, candidate_id}`. Ownership: kernel-side handling in `kernel/discovery/handlers.py` and the manager is **R-F**; the frontend runner (`src/services/discovery/runner.ts`, `kernelEval.ts`) and the consent dialog are **F-3**. `isolation_detail` reports the tier (`landlock | bwrap | sandbox-exec | process`) and `reads`/`writes` from the probe.

### 4.9 Resolved naming collisions (spec edits applied)

| Collision | Resolution | Spec edited |
|---|---|---|
| Four specs each "own" `PROTOCOL_VERSION = "1.4"` | F-1 owns it in Wave 1 | 01, 02, 03, 04 |
| Spec 03 `kernel/lab_routes.py` vs spec 04 editing `_LAB_MESSAGE_PREFIXES`/`_lab_phase` | `lab_routes.py` is the one mechanism (F-1); spec 04 adds its entry there | 04 §8 |
| Spec 01 `kernel/trainability/surrogates/**`, `kernel/trainability/{mps,gsim,fourier,_expm}.py` vs spec 03 `kernel/deploy/{spectrum,surrogates/*}.py` | `kernel/surrogates/` (§2.3); `kernel/deploy/` imports from it | 01 §3.1, §9; 03 §4.1, §10 |
| Spec 03 `kernel.quantumness.api.assess` and spec 04 `kernel.quantumness.certificate.certificate_cheap` (spec 01 defines neither) | `kernel.surrogates.quick.certificate_cheap` + `is_available` | 03 §10, 04 §9 |
| Spec 04 `kernel.trainability.noisy.gradient_variances_noisy` | `kernel.noise.analyses.gradient_variances_noisy` (spec 02's name) | 04 §9 |
| Spec 04 `kernel.symmetry.compiler.propose_rewrites` (no such module in spec 03) | `kernel/symmetry/propose.py: propose_rewrites` + `symmetry_propose` sync message (**S2+S3** owns: it emits through `emit.py`) | 03 §5, 04 §9 |
| Dataset loader: spec 02 `kernel/qkernel/dataset.py` vs spec 03 `kernel/deploy/dataset.py` | `kernel/trainability/dataset.py` (F-1); both re-export | 02 §4.1, 03 §4.1 |
| Declarations: `nuclei_data_params` (01) vs `nuclei_model.features` (03) vs spec 02 reading both | `kernel/trainability/declarations.py` (F-1): request > `nuclei_model.features` > `nuclei_data_params` | 01 §4.1, 02 §3.1, 03 §3.1 |
| `project_root` nested in `settings.qkernel` (02) vs top-level on `execute` (audit R-9) | top-level on every lab request and on `execute`/`parse` | 02 §5.1 |
| `ClaimClass = A\|B\|C` (01) vs class `"N"` (02) | `A\|B\|C\|N` in `kernel/surrogates/base.py` | 01 §3.2 |
| Learned-decoder manager caps vs the Lab-wide cap | per-manager caps stay; `lab_proc.total_running()` enforces 4 globally | 03 §10, 04 §3.5 |
| Model IDs "haiku/sonnet" (04) | `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5` | 04 §10.2, §14 |
| Spec 01 §5.1 "Learn is byte-for-byte unchanged" | Learn is deprecated; the statement becomes "Research only" | 01 header |
| Palette entries, `useDirac.ts` lines, `e2eFixtureBridge.ts` entries "handed to the lead" | registries (§2.1): each feature adds its own file; the e2e fixture registry is glob-based (`import.meta.glob('../../tests/e2e/fixtures/*/**', {query: '?raw', eager: true})`, G2) so FE units never edit it | all |
| Spec §9/§13 ownership tables still naming shared edits, marked blocks, stale paths (`kernel/trainability/surrogates/**`, `test_trainability_mps.py`, `quantumnessCopy.ts`, `LabHeatmap`, `NoiseModelLibrary*` under `qec/`, `lab-project/ansatz.py`, `kernel_ownership.rs` at the crate root, `gradient_map.py`) | every spec's ownership section rewritten to name exactly the master's units and files; `scripts/check-wave-ownership.py` (R-D, Wave 0a) also parses the spec tables and fails if any names a file the master assigns elsewhere | 01 §9, 02 §9, 03 §9, 04 §13 |

---

## 5. Track R — Reliability (release blocker)

Source: `00_RELIABILITY_AUDIT.md` (R-1…R-23, gates G0–G4). Research paths only. Every unit below lands with its corpus entries (RED first) and a regression test; no feature wave starts before Waves 0–1 are green.

### 5.1 Must-fix units

| Unit | Fixes | Owned files | Acceptance tests |
|---|---|---|---|
| **R-A Adapters** (Wave 0b) | R-1 no-measure circuits return statevector + exact probabilities, `measurements = {}`, `measurements_source: "none"`, `probabilities_exact: true` (never silent `measure_all`); R-2 `transpile(circuit, backend, optimization_level=0)` / bounded decompose before Aer, `unsupported_instruction` names the gate, opt-in snapshot block expansion; R-4 kernel side: `kernel/adapters/binding.py: bind_parameters(circuit, parameter_values | random_seed) -> (circuit, bound_at)` and the `unbound_parameters` info code (R-B wires it into the execute path); R-13 total adapter (`<complex[2]>`, `<unitary 4x4>`, `<block>` labels, snapshot failure degrades to "snapshot unavailable") | `kernel/adapters/**` (incl. new `binding.py`), `kernel/models/snapshot.py`, `kernel/tests/test_adapters_research_paths.py`, `kernel/tests/research_corpus/r_a/**` | `test_execute_no_measurements_{qiskit,cirq}`; parametrized library-gate test (`QFT, EfficientSU2, TwoLocal, RealAmplitudes, ZZFeatureMap, PauliEvolutionGate, iswap, rzz, rxx, cswap`); `parameter_values` bound/unbound; snapshot of `initialize/unitary/if_test` |
| **R-B Execution model** (Wave 0b) | **Scope: every message that executes user code** — `parse`, `execute`, `transpile`, `debug_trace`, `run_python`, `hardware_submit` (`_prepare_hardware_payload`), `qec_materialize`, `trainability_inspect`, `trainability_lint`, `symmetry_detect`, `symmetry_propose`, `deploy_inspect`, `qec_learned_sources` (circuit kind) — all routed through a **warm run-worker pool** (`kernel/run_worker.py`: a pre-imported fork-server / persistent worker recycled after execute, cancel, timeout or crash; a fresh interpreter costs ≈ 1.2 s and 270 MB just to import numpy/qiskit/aer/cirq, so per-run interpreters are **not** the design). Latency budgets: parse p50 ≤ 150 ms over program time, Run overhead ≤ 300 ms, lint within 0.35 s. One **code-hash-keyed loaded-circuit cache** shared by parse, inspect, lint, symmetry_detect and deploy_inspect so the program executes once per code version with the Lab open (perf test asserts a single exec). Worker sets `cwd`, `sys.path = [project_root, stdlib, site-packages]` (the kernel is launched as `python -m kernel.server` / strips its script dir, and the worker purges Nuclei's top-level modules from `sys.modules` before exec, so a researcher's sibling `kernel.py`, `noise.py`, `models.py`, `symmetry.py` wins — R-9), `__file__`, `__name__ == "__main__"` (R-10), per-run output dir; env = the full user environment minus `KERNEL_SECRET_ENV` (never `lab_proc.minimal_env`, which would strip `HOME`, proxies, `QISKIT_*`, provider env) plus `MPLBACKEND=Agg` and the `PINNED_ENV` thread caps; limits: wall-clock, `RLIMIT_CPU`, **group-RSS ceiling via `procrun`** (never `RLIMIT_AS`/`RLIMIT_NPROC`; per-OS: Linux/macOS RSS polling, Windows Job Object or polling), stdout/stderr caps (R-22); `run_id` on parse/execute, `run_cancel {run_id}` (R-6); `SystemExit`/`os._exit` → `user_exit`/`worker_died`, kernel stays up (R-7); parse coalescing + static AST fast path + 500 ms live-preview opt-in (R-8); R-11 **memory-estimate policy**, not a fixed qubit count: estimated peak = copies × 2ⁿ × 16 B vs `min(25 % of physical RAM, user setting)`; never return state vectors above 16 qubits; above budget → `too_many_qubits` with the estimate and a "Use Aer MPS / run in the Lab" action re-running with `method=matrix_product_state`; `truncated` field; R-12 figure capture → `figures`; R-20 real `__main__` module (spawn-safe); R-3 detection in `kernel/framework_detect.py` | `kernel/executor.py`, `kernel/run_worker.py`, `kernel/framework_detect.py`, `kernel/server.py` (parse/execute/run_cancel branches + `-m` launch), `kernel/trainability/_usercode.py` (`run_namespace` → pool), `kernel/tests/test_run_worker.py`, `kernel/tests/test_framework_detect.py`, `kernel/tests/test_executor_run_path.py`, `kernel/tests/research_corpus/r_b/**`, `docs/research/PRD_15/R_EXECUTION_MODEL.md` (design note first, time-boxed; carries the exec-path list) | `while True` → `timeout` within N s and the next request succeeds, **for every path in the list** (one corpus program per path: sibling import, relative data read, `while True`, `os._exit`); `run_cancel` kills within 1 s; a stale `run_cancel` is ignored; `sys.exit`/`exit()`/`quit()`/`os._exit` survive; N queued parses leave Run latency ≤ 1 program time; single exec per code version with inspect+lint+detect active; sibling `kernel.py`/`noise.py`/`models.py` shadow Nuclei's; write into the run dir; traversal refusal; main-guard program runs; n=30 → `too_many_qubits` in < 1 s without allocating; n=24 sampled run ok; RSS ceiling exceeded → `worker_died`/`too_much_memory`, kernel alive; `plt.show()` with `DISPLAY` returns < 2 s; `Pool.map` on an editor function works; 100 k lines → truncated with a note; table-driven detection; macOS leg of `test_run_worker.py` |
| **R-C Environment & shell** (Wave 0a) | R-14 one Qiskit range (`>=1.2,<3`) in catalog + requirements, `errorRewrite` migration hints for removed 1.x APIs, order-insensitive symbolic comparison; R-16 `ruff` in `KERNEL_CORE_DEPS`; R-17 Info-level rotating file log + startup environment report + "Open logs"; R-18 `--version/--help` before Tauri init; **R-7 shell-side kernel health check**: if `try_wait` reports exit or the port stops listening, auto-restart with backoff and a "kernel restarted" event for the toast; `scipy` declared optional in docs; `torch`/`onnx` catalog entries; `configure_kernel_env` strips `NUCLEI_KERNEL_DEV_ORIGINS` in release builds. Hands its CI matrix lines (Qiskit-2 leg) to R-D | `src-tauri/src/commands/frameworks.rs`, `src-tauri/src/commands/kernel.rs` (`configure_kernel_env`: `MPLBACKEND`, dev-origins strip; health check), `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`, `kernel/requirements.txt`, `kernel/agent-requirements.txt`, `kernel/discovery/_optional.py` (`CATALOG_IDS`), `src/services/errorRewrite*.ts` (Qiskit-2 table) | cargo tests for catalog pins, version flag, health-check restart; `pytest-qiskit2` job green (R-D's workflow); `lint` on a ruff-less interpreter returns `available: false`; `nuclei --version` exits 0 without a window (packaged smoke) |
| **R-D Corpus golden (G0) + wave tooling** (Wave 0a) | promote the 78-program scout corpus to `kernel/tests/research_corpus/scout/` with `expected.yaml` per env (`min`, `qk2`, `full`), driven through the real authenticated WebSocket server by a **glob-based loader** (`research_corpus/loader.py`) that picks up every `research_corpus/<unit>/` directory so later units add programs without editing R-D's files; known failures `xfail(strict=True)` tagged with R-ids; resource gates; `scripts/check-app-env.sh` (G4); **`scripts/make-test-venvs.sh`** (`uv`: 3.12/Qiskit 1.x, 3.13/Qiskit 2.x, minimal, app-env catalog lists); **`scripts/check-wave-ownership.py`** (fails a wave plan if two units in a wave name the same file, or if a spec ownership table names a file the master assigns elsewhere; run on this plan now and in CI); **sole owner of `.github/workflows/kernel-tests.yml` in Wave 0** (R-C's matrix/Qiskit-2 lines and R-E's minimal-job command are handed to R-D) | `kernel/tests/research_corpus/{__init__.py,loader.py,runner.py,_support.py,README.md,test_check_wave_ownership.py,test_kernel_client.py,test_loader.py,test_runner_helpers.py}`, `kernel/tests/research_corpus/{scout,gates}/**` (loader + `scout/` + `gates/`; per-unit `research_corpus/<unit>/` dirs belong to their units), `kernel/tests/test_research_corpus.py`, `kernel/tests/_kernel_client.py` (from `kclient.py`), `scripts/check-app-env.sh`, `scripts/make-test-venvs.sh`, `scripts/check-wave-ownership.py`, `.github/workflows/kernel-tests.yml` (CI jobs `corpus-minimal`, `corpus-app-env`, `corpus-full`, matrix + Qiskit-2 leg, minimal-job command, pytest-cov with `--cov-fail-under` per new package) | the corpus passes in all three envs with zero unexpected statuses; each PRD 15 feature adds its programs (RED) in its own directory before implementing; `check-wave-ownership.py` passes on §7 and on every spec's ownership table |
| **R-E Test hygiene (R-21)** (Wave 0a) | `pytest.importorskip` in the 11 optional-dep test modules and the stim-dependent docs fixtures; `pytest-minimal-venv` runs the **whole** `kernel/tests` (command handed to R-D); `tests/e2e/support/qecDataEngine.ts` defaults `NUCLEI_E2E_PYTHON` to the repo `.venv` or skips with a reason; cargo tests set `NUCLEI_RUNTIME_DIR` to a tempdir (never touch `~/.nuclei/runtime`) | the 11 test modules, `kernel/tests/test_docs_fixtures.py`, `kernel/tests/conftest.py`, `tests/e2e/support/qecDataEngine.ts`, `src-tauri/src/commands/kernel_ownership.rs` tests + `src-tauri/src/commands/kernel_legacy.rs` tests | minimal-venv job runs `pytest kernel/tests` green; `cargo test` leaves `~/.nuclei/runtime` untouched (test asserts) |
| **R-F Lab prerequisites + sandbox** (Wave 0a) | R-5 bounded decomposition (≤ 4 levels) of `BlueprintCircuit`/composite instructions in `convert.py` with `source_line` tracing preserved and the level in `notes`; R-19 isolation: **new `landlock` tier** in `kernel/discovery/isolation.py` (probe the ABI at startup — ABI 8 on the owner's Ubuntu 24.04 where `bwrap` is blocked by `apparmor_restrict_unprivileged_userns`; the trusted parent applies a ruleset before exec: read-only interpreter/venv, `kernel/`, system libs; read-write scratch only; project root read-only on request; TCP connect/bind denied on ABI ≥ 4; `isolation_detail.reads/writes` from the probe), `bwrap` userns probe, require per-session `isolation_consent` with the exact capability text on `process`-only hosts (kernel handling in `kernel/discovery/handlers.py` + the manager), **`kernel/discovery/prescreen.py`** static AST pre-screen (rejects `__import__`, `eval`/`exec`/`compile`, `importlib`, `open` in write modes, `os.remove/unlink/rmdir`, `shutil`, `pathlib` `write_*`/`unlink`, `getattr` on string literals naming blocked attributes; mandatory on `process` and for every `claude`-origin candidate), `kill_process_group` SIGTERM-then-SIGKILL for jobs with children; sandboxing docs | `kernel/trainability/convert.py`, `kernel/trainability/_circuit_walk.py`, `kernel/discovery/{isolation,prescreen,sandbox}.py`, `kernel/discovery/handlers.py` (consent branch), `kernel/discovery/manager.py` (consent), `kernel/tests/test_trainability_convert_composite.py`, `kernel/tests/test_discovery_isolation.py` (extend), `kernel/tests/test_discovery_prescreen.py`, `docs-site/.../sandboxing.mdx` | `EfficientSU2`/`TwoLocal`/`ZZFeatureMap`/`QFT`/`PauliEvolution` reach `trainability_inspected` with correct parameter counts; genuinely unsupported ops still `unsupported_gate` naming the op; a candidate calling `shutil.rmtree(<dir outside scratch>)` is denied or rejected under **each** tier (landlock/bwrap/sandbox-exec/process+prescreen); `discovery_evaluate` without consent on a `process` host → `isolation_consent_required {run_id, candidate_id}`; the owner's box reports tier `landlock` |
| **R-G Reliability frontend** (Wave 1b) | Stop button + `Running… (12 s)` state for editor runs and Experiment sweeps (`run_cancel {run_id}`); "N free parameters — Run at point…" (zeros / user point / seeded random) instead of a red error; histogram "no measurements in this circuit; showing exact probabilities"; `too_many_qubits` card with the estimate and "Use Aer MPS / run in the Lab"; `truncated` badge; inline Figures panel; "Linting off (ruff not installed) [Install]"; "kernel restarted" toast; R-15 `missing_dependency` routed from **every** kernel session (`kernelSession.ts`, `labSession.ts`) into the **existing** `missingDependencyStore.ts` (extended) + `MissingDependencyCard`; the 1 MiB client-side frame guard in `labSession.ts`; "Open logs" in Settings; Research catalog group offered in research onboarding | `src/hooks/useKernel.ts`, `src/services/kernelSession.ts`, `src/services/lab/labSession.ts`, `src/stores/missingDependencyStore.ts`, `src/stores/runStore.ts` (new), `src/components/common/MissingDependencyCard.tsx`, `src/components/onboarding/MissingDependencyBanner.tsx`, `src/components/onboarding/FrameworkSetup.tsx`, `src/components/editor/RunControls.tsx` (new), `src/components/editor/EditorTabs.tsx` (mounts `RunControls`), `src/components/histogram/**`, `src/components/output/FiguresPanel.tsx` (new), `src/components/qec/**` state components, `src/components/discovery/EvaluatorUnavailable.tsx`, `src/services/experimentRunner.ts` (cancel + project_root + file_path), `src/components/settings/**` (logs, lint-off; `EnvironmentPanel.tsx` consumes F-3's shims), vitest for each | vitest for every state; Playwright stub spec `run-states.spec.ts`; real-kernel specs 1–6 of audit G2; a frame > 1 MiB is refused client-side with a visible error |

### 5.2 Real-kernel e2e harness (G2) — unit **G2** (Wave 1b)

- DEV-only `?realKernel=ws://127.0.0.1:<port>&realKernelToken=<t>` branch in `createE2eFixtureBridge` returning `{...base, getPlatform: () => 'desktop', startKernel, stopKernel, getKernelAuthToken}`; `src/config/kernel.ts` reads the port from the query in DEV.
- **On-disk fixture projects.** The in-memory fixture bridge cannot satisfy a real kernel: every v1.4 request carrying `project_root` is validated server-side as an existing absolute directory, and exports written through the bridge never reach disk. In `?realKernel` mode the Playwright global setup **copies `tests/e2e/fixtures/<project>` to a temp dir**; the bridge reads and writes that on-disk copy through a node-side fixture server (a Playwright `route` on `/__fixtures/**`) and reports its absolute path as the `project_root` sent to the kernel, so the qkernel CSV dataset, deploy/symmetry file paths, `.dem` sources and R-9 sibling-import corpus programs all run, and exports are asserted on disk.
- `NUCLEI_KERNEL_DEV_ORIGINS` (comma list) in `kernel/auth.py` so vite on 4173 is accepted — honoured **only when the DEV flag is set**, accepting only `http://localhost:<port>` and `http://127.0.0.1:<port>` patterns (any other host rejected), and `configure_kernel_env` (R-C) removes it in release builds; tests in G2's own `kernel/tests/test_kernel_auth_dev_origins.py` (ignored without DEV, non-loopback rejected, release env strips it) — `test_kernel_auth.py` stays F-1's.
- The e2e fixture registry becomes glob-based (`src/platform/e2eFixtures/index.ts`: `import.meta.glob('../../tests/e2e/fixtures/*/**', {query: '?raw', eager: true})`), so FE units add fixture files without editing the registry.
- The **17** non-bridge `@tauri-apps/*` importers (`App.tsx`, `diracStore`, `EnvironmentPanel`, `FrameworkSetup`, `UpdateBanner`, `useDiracAgent`, `environment.ts`, `experimentFs.ts`, `qecStudyFs.ts`, …) are shimmed behind the bridge by **F-3 in Wave 1a** (the shim list, with the owner F-3 for every file, lives in `docs/research/PRD_15/R_EXECUTION_MODEL.md` §G2); G2 only consumes them.
- Playwright project `real-kernel` (`playwright.config.ts`): global setup picks a free port, spawns `python -m kernel.server` from the chosen venv (`NUCLEI_E2E_VENV` ∈ `dev`, `app-env`, `minimal`), waits for the ready line, exposes port + token, kills on teardown. Specs tagged `@real`, each asserting visible RUNNING → result/error states.
- `?e2eOpen=<fixture path>` in the fixture bridge loads a fixture file into the editor target so Lab specs run on the fixture, not the default Bell buffer.
- CI: two jobs in a new `.github/workflows/lab-e2e.yml` (created by G2, later lists appended by X): `lab-e2e-stub` (every non-`@qec`, non-`@real` spec, both viewport projects — `trainability.spec.ts` and `discovery.spec.ts` never ran in CI before) and `real-kernel-e2e` (`dev` and `minimal` venvs). Both are §5.3 gates from Wave 1 on.
- Owned files: `src/platform/e2eFixtureBridge.ts`, `src/platform/e2eFixtures/{index,labProject,qecProject}.ts`, `src/config/kernel.ts`, `kernel/auth.py` (dev origins only), `kernel/tests/test_kernel_auth_dev_origins.py`, `playwright.config.ts`, `tests/e2e/support/realKernel.ts`, `tests/e2e/support/fixtureServer.ts`, `tests/e2e/real/*.spec.ts` (audit list 1–6), `.github/workflows/lab-e2e.yml`.

### 5.3 CI gates (release blockers)

| Gate | Job | Passes when |
|---|---|---|
| Kernel full | `pytest` (3.12 / Qiskit 1.x) + `pytest-qiskit2` (3.13 / Qiskit 2.x) | whole suite green incl. `physics` markers |
| Kernel minimal | `pytest-minimal-venv` | whole `kernel/tests` green with only `requirements.txt` |
| Corpus | `corpus-minimal`, `corpus-app-env`, `corpus-full` | zero unexpected statuses; `xfail(strict)` ledger empty at release |
| Frontend | `npm test`, `tsc -b`, `eslint` (0 errors) | — |
| Playwright stub | `lab-e2e-stub` (chromium + chromium-laptop; every non-`@qec`, non-`@real` spec) + `qec-frontend.yml` (`@qec`) | every PRD 15 spec green; screenshots within 3 % |
| Playwright real | `real-kernel-e2e` (`dev` and `minimal` venvs; app-env venv nightly) | `@real` specs green incl. one per idea (§6, deterministic paths) — gate from Wave 1 on |
| Coverage | pytest-cov `--cov-fail-under=80` per new kernel package (R-D's workflow); vitest `coverage.thresholds` per new `src/` directory (X) | ≥ 80 % |
| Ownership | `scripts/check-wave-ownership.py` on §7 and the spec ownership tables | no two units in a wave share a file; no spec table contradicts §7 |
| Packaged smoke (G3) | nightly + pre-tag `packaged-app-smoke` (installs the **`release.yml` artifact**, which is built on `ubuntu-22.04`, onto `ubuntu-24.04` — the same `.deb` users get, not a separate 24.04 build; `.deb` into a clean `$HOME`, `xvfb-run` + `tauri-driver`) | managed venv created, `environment_report.healthy`, kernel ready < 20 s, Bell + lab ansatz run, `nuclei.log` has startup lines, `nuclei --version` exits 0 |
| Owner-env | `scripts/check-app-env.sh` at release | corpus green against the freshly built bundle's `kernel/` with the shell's exact pip lists |

---

## 6. Traceability matrix

Every idea and every acceptance item of every spec maps to a unit (§7) and a test. Nothing from ideas 1–8 is dropped. Acceptance ids: `01-Ax` = spec 01 §8 item x, `02-3.x` / `02-4.x` / `02-X.x` = spec 02 §8 (idea 3 / idea 4 / cross-cutting), `03-Sx` / `03-Dx` / `03-X` = spec 03 §8, `04-7.x` / `04-8.x` = spec 04 §12, `R-n` = audit.

### Idea 1 — Quantumness certificate

| Acceptance | Unit(s) | Test(s) |
|---|---|---|
| 01-A1 `surrogates` partial with 7 reports + non-null `quantumness` ≤ 60 s on `lab-project/ansatz/hardware_efficient.py` (verdict `simulable` or `brute_force_simulable` at n ≤ 20) | Q1, Q2, Q3 | `test_trainability_jobs_integration.py::test_surrogates_job`, real e2e `quantumness.real.spec.ts` |
| 01-A2 no new required dependency; scipy opportunistic | Q1–Q3 | `test_discovery_optional_deps.py::test_surrogates_import_without_scipy` (`_expm` fallback path marked) |
| 01-A3 cross-validation vs statevector/other winners; injected lie → `suite_inconsistent` | Q1 | `test_surrogates_suite.py::test_consistency_{pass,fail}` |
| 01-A4 MPS rigorous bound zero violations; heuristic labelled | Q2, FE-Q | `test_surrogates_mps.py::test_rigorous_bound_contains_truth` (1000 seeds, 20 s subset in CI), vitest `SurrogateTable.test.tsx` |
| 01-A5 𝔤-sim computes expectations to 1e-8; `not_applicable` with residual | Q2 | `test_surrogates_gsim.py` |
| 01-A6 Fourier/RFF `not_applicable` without data params + hint; empirical labels | Q3, FE-Q | `test_surrogates_fourier.py`, vitest row hint |
| 01-A7 `resists` only for n > 20 with ≥ 3 distinct class-A families, no budget exhaustion, non-trivial target; `brute_force` never a win; class B/C never set `simulable`; claim texts verbatim | Q1, Q3 | `test_surrogates_quantumness.py::test_claim_snapshot`, `::test_brute_force_never_simulable`, `::test_families_quorum`, `test_surrogates_fourier.py::test_fourier_only_win_not_simulable` |
| 01-A8 evidence level always shown as bp / no-BP-detected / unknown (never "trainable"); single-size decides on interval endpoints; `NO_BP_CAVEAT` rendered | Q1, FE-Q | `test_surrogates_quantumness.py::test_single_size_intervals`, `::test_no_trainable_token`, `quantumness.test.ts` |
| 01-A9 certificate JSON/MD include `quantumness`, suite table, version, fingerprint; bit-for-bit reproducibility | Q1, FE-Q | `test_trainability_provenance.py`, `certificate.test.ts` snapshot, `test_surrogates_suite.py::test_determinism` |
| 01-A10 catalog message; `lab_capabilities` gating; old kernel → "kernel too old" banner | F-1, Q1, FE-Q | `test_lab_protocol.py::test_lab_capabilities`, `test_trainability_handlers.py::test_surrogate_catalog`, `client.test.ts`, e2e `quantumness.spec.ts` (5) |
| 01-A11 every §5.3 state has a jsdom test; Playwright path; palette commands | FE-Q | `QuantumnessTab.test.tsx`, `tests/e2e/quantumness.spec.ts` (1–7) |
| 01-A12 goldilocks listed, template, guardrail cheats, seed score, `suite_attack` flips | G1, FE-Q | see idea 2 |
| 01-A13 conjecture features; `resistance >= 0.5` runs suite on held-out circuits | G1 | `test_discovery_conjecture_*.py` extensions |
| 01-A14 docs + CLAUDE.md v1.4 | X | `test_docs_lab_fixtures.py` replay |
| 01-A15 minimal-venv CI green | Q1–Q3, R-E | CI |

### Idea 2 — Goldilocks evaluator (Red Queen with the suite)

| Acceptance | Unit(s) | Test(s) |
|---|---|---|
| Listed by `discovery_evaluators` with objectives/descriptors/config schema/stages/availability | G1 | `test_discovery_evaluators.py` |
| Each guardrail 1–10 rejects its cheating candidate by exactly that guardrail | G1 | `test_discovery_goldilocks.py::test_guardrail_*` |
| Scoring: r at the largest scored n only, circuit-derived h (rigorous error at the cap / frontier lower bound), censored → capped 0.7, < 3 families → capped 0.5, monotonicity penalty, fragility, fitness formula; config rejects any scored n ≤ 20 | G1 | `test_discovery_goldilocks.py::test_scoring_*`, `::test_config_qubits_above_statevector_cap` |
| Seed (HEA) at n = 24: light cone genuinely wins ⇒ r = 0, fitness ≈ trainability term | G1 | `test_discovery_seeds.py` |
| Red Queen `suite_attack` (4× budgets, 3 MPS orderings, Clifford pre-conjugation, doubled points) flips a fake-resistant record; `resistance_recheck` thresholds; exploit fixtures replayed | G1 | `test_discovery_goldilocks_audit.py`, `test_discovery_exploits.py` |
| Conjecture features/predictions | G1 | `test_discovery_conjecture_tester.py` |
| Wizard template, evaluator chip, drawer "Surrogate suite" section, Red Queen prompt paragraph, archive categorical descriptor | FE-Q | vitest in `src/components/discovery/`, `redQueenPrompt` snapshot, e2e `discovery.spec.ts` additions |
| Isolation consent on `process`-only hosts (R-19); `landlock` tier on the owner's box; pre-screen for Red Queen candidates | R-F, F-3 | `test_discovery_isolation.py::test_landlock_denies_rmtree`, `test_discovery_prescreen.py`, e2e consent dialog |
| Real path (deterministic, no Claude key): `discovery_evaluate` of the seed at `screen` + `discovery_audit` | FE-Q | `tests/e2e/real/goldilocks.real.spec.ts` |

### Idea 3 — Device-noise-aware trainability

| Acceptance | Unit(s) | Test(s) |
|---|---|---|
| 02-3.1 noisy intervals + `noiseless` block + equal-accuracy cost card + §2.9 claim (model-scoped, never "trainable on") ≤ 30 s | N1, N2, N3+N4 | `test_noise_analyses.py`, integration job test, real e2e `noise.real.spec.ts` (bundled snapshot) |
| 02-3.2 noisy PPE ≡ density matrix (twirled 1e-10; exact non-unital 1e-10) incl. readout in the measurement frame with trailing H/CX + X/Y observables and noise-aware finalisation; variances inside MC CI; ledger 0 violations; `channel_step=None` path bit-identical to PRD 14 | N1, N2 | `test_noise_ppe.py`, `test_noise_compile.py::test_readout_frame`, `::test_finalisation_damped`, `::test_hooks_none_identical`, `test_noise_physics.py` |
| 02-3.3 twirl labelled everywhere; `twirl_gap_expectation` next to expectations and `twirl_gap_variance` next to variances; observed gaps ≤ bounds for both; weight-cut labelled heuristic; NIBP Thm. 1 constants pinned and placement-gated | N1, N2, FE-N | `test_noise_bounds.py`, vitest `TWIRL_NOTE` presence + bound/quantity pairing test |
| Forbidden strings: no "trainable on {device}" / "trainable under noise" in kernel claim, certificate section, pill, e2e | N3+N4, FE-N | `test_noise_analyses.py::test_claim_no_trainable_on`, `certificateSection.test.ts` snapshot grep |
| 02-3.4 `not_modelled` in UI and certificate | N4, FE-N | `certificate.test.ts`, `NoiseModelCard.test.tsx` |
| 02-3.5 IBM/IonQ calibration (recorded fakes) through `get_manager()` with a 20 s timeout; others `calibration_unavailable`; bundled labelled; `trainability_start` rejects unresolved calibrations | N3+N4, F-1 | `test_noise_calibration.py`, `test_server_hardware_calibration.py`, `test_trainability_handlers.py::test_start_rejects_unresolved_calibration` |
| 02-3.6 schema-2 YAML round trip; schema-1 untouched | FE-N | `noiseModel.test.ts` |
| 02-3.7 `scaling_noisy` reproduces NIBP; reference line labelled | N4, FE-N | `test_noise_analyses.py::test_nibp_family`, vitest `NIBP_REFERENCE` |
| 02-3.8 `noisy_ppe` via `SUITE_EXTENSIONS`, excluded from noiseless axis, "noisy cost" line | N4, Q1, FE-Q | `test_noise_surrogate.py`, `test_surrogates_quantumness.py::test_class_n` |
| 02-3.9 every state has jsdom test; e2e 1–5, 10, 11; palette | FE-N | `NoiseTab.test.tsx`, `tests/e2e/noise.spec.ts` |
| gate-error → Pauli constants p = 3r/2 (1q), p = 5r/4 (2q) verified by Haar integration of explicit Kraus maps; gate-time decoherence policy | N1 | `test_noise_channels.py::test_fidelity_conversion`, `test_noise_schedule.py::test_gate_time_policy` |

### Idea 4 — Quantum-kernel power of data

| Acceptance | Unit(s) | Test(s) |
|---|---|---|
| 02-4.1 full pipeline streams every stage; verdict `scope`; claim snapshot | K1, K2, K3 | `test_qkernel_analysis.py`, `test_qkernel_verdict.py`, real e2e `qkernel.real.spec.ts` |
| 02-4.2 fidelity refused > 20 qubits; projected via PPE (N ≤ 128, program compiled once) with containing intervals and a perturbation bound on g/s; `inconclusive` when the bound spans the threshold; explicit 512 MiB Gram guard | K1 | `test_qkernel_gram.py`, `test_qkernel_geometry.py::test_perturbation_bound` |
| 02-4.3 g at the λ grid in mean-eigenvalue units; λ_C by the training-error condition; "matches geometric power" only at every λ; s_Q vs s_C on labels; thresholds labelled heuristic; nested paired CV with Nadeau–Bengio; `winner_on_split` consistent | K1 | `test_qkernel_geometry.py`, `test_qkernel_krr.py::test_nested_paired`, `test_qkernel_verdict.py` |
| 02-4.4 datasets outside project / oversized / pickled / non-numeric / zip-bomb `.npz` rejected, never loaded; `O_NOFOLLOW` + fd realpath; inspect never parses data | F-1 (`dataset.py`), K2+K3 | `test_trainability_dataset.py` (traversal, symlink TOCTOU, pickle, header caps, npz member caps) |
| 02-4.5 demos deterministic; `huang_engineered` by the eigenvector construction (s_Q = 1, s_C = g²); `ENGINEERED` label | K2+K3, FE-K | `test_qkernel_demo.py`, vitest |
| 02-4.6 QK001–QK006 fire inside the lint budget; markers in the editor; QK001 quick-fix through the code-action registry | K2+K3, FE-K, F-3 | `test_qkernel_lint.py`, `lintMarkers.test.ts`, `codeActions/registry.test.ts`, e2e `qkernel.spec.ts` (8) |
| 02-4.7 every state has jsdom test; e2e 6–9 | FE-K | `QKernelTab.test.tsx`, `tests/e2e/qkernel.spec.ts` |
| 02-X.1 no scipy import in `kernel/noise`, `kernel/qkernel` (and every new package); minimal-venv green | N*, K*, R-E | `test_discovery_optional_deps.py` `sys.modules['scipy'] = None` blocked-import test over every new package |
| 02-X.2 provenance fields + dataset/calibration sha256; bit-for-bit for all four analyses | N4, K3 | `test_trainability_provenance.py`, determinism tests |
| 02-X.3 docs pages, `messages-lab.mdx`, `messages-hardware.mdx`, changelog, CLAUDE.md | X | fixture replay |

### Idea 5 — Symmetry compiler

| Acceptance | Unit(s) | Test(s) |
|---|---|---|
| 03-S1 presets + custom kinds parse/validate/compile; `invalid_symmetry` with position | S1 | `test_symmetry_spec.py`, `test_symmetry_compile.py` |
| 03-S2 twirl ≡ dense projector 1e-10 (finite, Lie, composite) | S1 | `test_symmetry_physics.py` |
| 03-S3 `exact` certificates pass dense (n ≤ 5) and statevector (n ≤ 12) checks; centraliser regressions (SWAP under `s_n`, CZ under `z2_flip`, ring CX under `cyclic`) are `failed` | S1 | `test_symmetry_verify.py::test_centralizer_regressions`, `::test_dense_exact_cross_check` |
| Symmetry sector: `u1_charge` + \|0…0⟩ refused (`trivial_symmetry_sector`); Néel runs; polynomial sector → simulability warning (Anschuetz et al. 2023) | S1, FE-S | `test_symmetry_compile.py::test_sector_*`, vitest refusal copy |
| 03-S4 Trotterised never `exact`; residual shown | S1, FE-S | `test_symmetry_synth.py`, `CertificateCard.test.tsx` |
| 03-S5 before/after Lie + gradients with intervals; ratios are intervals; simulability warning | S1 (`compare.py`), S3 | `test_symmetry_compare.py`, integration |
| 03-S6 emitted Qiskit/Cirq round-trip; PennyLane labelled unverified; injection fuzz (adversarial names) passes; stems validated | S2+S3, FE-S | `test_symmetry_emit.py::test_injection_fuzz`, `test_symmetry_roundtrip.py`, vitest |
| 03-S7 Insert creates sibling file via exclusive creation + overwrite confirmation, accepted as a Lab target | FE-S | e2e `symmetry.spec.ts` (1), real e2e `symmetry.real.spec.ts` |
| 03-S8 cancel, busy, owner release, wall limit as trainability | S3, F-1 | `test_symmetry_handlers.py`, `test_lab_job_robustness.py` (parametrized over managers) |
| 03-S9 minimal venv | S1–S3 | CI |
| `symmetry_detect` suggestion engine | S1 | `test_symmetry_detect.py` |
| `symmetry_propose` for idea 8 (emits through `emit.py`) | S2+S3 | `test_symmetry_propose.py` |

### Idea 6 — Train quantum, deploy classical

| Acceptance | Unit(s) | Test(s) |
|---|---|---|
| 03-D1 `deploy_inspect` snippet; inserting makes the file inspectable | D3, FE-D | `test_deploy_handlers.py`, e2e `deploy.spec.ts` (5) |
| 03-D2 route feasibility with reason for every route on every fixture | D1 | `test_deploy_routes.py` |
| 03-D3 DFT-exact surrogate < 1e-9; verdict `exact`; simulability honesty note | Q3 (`fourier.py`), D1 | `test_surrogates_fourier.py::test_dft_exact`, `test_deploy_validate.py` |
| 03-D4 PPE-route coefficient intervals contain exact values; Lebesgue-constant prediction bound contains the error and is tighter; CRX spectrum `{0, ±1/2, ±1}`; grid-feasibility refusal | Q3, D1+D2 | `test_deploy_fourier_intervals.py`, `test_surrogates_spectrum.py::test_crx` |
| 03-D5 shadow `(ε, δ)` from the actual `(T, K, M, k)` with HKP Thm. 1 constants pinned (`K = 2 ln(2M/δ)`); never `certified` with δ ≥ 1; input box required; imported snapshots → `certified_ideal_measurement` without readout; coverage test; snapshot files read from `project_root` | Q3 (`shadow.py`), D1+D2, D3 | `test_surrogates_shadow.py::test_hkp_constants`, `::test_k10_vacuous`, `test_deploy_validate.py` |
| 03-D6 Route C labelled regression everywhere | D1, FE-D | `test_deploy_validate.py`, vitest honesty |
| 03-D7 `.surrogate.py` runs in `python -I` with numpy only and self-checks; loads weights via json only; literal-safe; JSON provenance + `linked` | D3 | `test_deploy_export.py` (subprocess + AST assertions) |
| 03-D8 ONNX absence is a message; presence passes `onnx.checker` | D3 | `test_deploy_export.py` (`importorskip`) |
| 03-D9 training deterministic, cancellable, refuses n > 20 | D2 | `test_deploy_train.py` |
| 03-D10 e2e 1–7; coverage ≥ 80 % | FE-S, FE-D | `tests/e2e/{symmetry,deploy}.spec.ts`, coverage gate |
| 03-X protocol 1.4, docs, no new required dependency | F-1, X | — |
| `exportable` ref from a winning Fourier surrogate → Deploy pre-selects the route (`EXPORTABLE_KINDS = {fourier}`; others show "no export route in v1") | Q1, D3, FE-D | `test_deploy_from_surrogate.py`, e2e "Export winning surrogate" |

### Idea 7 — Learned QEC decoders + decoder evolution

| Acceptance | Unit(s) | Test(s) |
|---|---|---|
| 04-7.1 stock venv: bundled DEM (rep d=3 and d=5 exact-ML-applicable by the manifest test; F2 convolution, n_D + n_L ≤ 24) → Exact ML, weighted UF, MLP rows with Wilson, Holm-adjusted Newcombe paired verdicts, ML excess labelled conservative; MWPM/Transformer show install card | L1+L2, L3+L4, FE-L | `test_qec_learned_jobs.py::test_bundled_stock_venv`, `test_qec_learned_bundled.py::test_two_exact_ml_sources`, e2e `qec-learned-decoders.spec.ts`, real e2e on the minimal venv |
| 04-7.2 Stim → circuit/campaign sources (paths, kernel reads); `^` components kept, XOR sampling; PyMatching → MWPM identical to PyMatching on a Stim surface-code DEM with UF applicable | L3+L4, L1+L2 | `test_qec_learned_sources.py` (`importorskip`), `test_qec_learned_dem_text.py::test_caret_components`, `test_qec_learned_decoders_classical.py::test_mwpm_surface_identity` |
| 04-7.3 every number has interval + method or reason; paired interval is Newcombe-10/Tango/Agresti–Min and agrees with McNemar; ranking only by separated intervals; "better than exact_ml" → `suspect` | L1+L2, FE-L | `test_qec_learned_stats.py`, vitest `ResultsTable.test.tsx` |
| Test split fixed before decoding; use counter; "Confirm on a fresh test split"; champion from confirm seeds only; audit uses the unpaired Newcombe interval | L1+L2, L3+L4, FE-L | `test_qec_learned_splits.py`, `test_qec_learned_jobs.py::test_confirm_split`, `test_discovery_decoder_architecture.py::test_champion_confirm_only` |
| Real path (deterministic): evaluate the seed `decoder_mlp` spec on the bundled DEM | FE-L | `tests/e2e/real/decoder-architecture.real.spec.ts` |
| 04-7.4 bit-for-bit reproducibility (kernel + UI reproduce block) | L3, FE-L | `test_qec_learned_jobs.py::test_determinism`, `report.test.ts` |
| 04-7.5 report JSON/MD with leakage ledger + provenance | L1, FE-L | `test_qec_learned_splits.py`, `report.test.ts` snapshot |
| 04-7.6 `decoder_architecture` in the catalogue; bundled source in stock venv; guardrail cheats; "candidate never sees data" statement | L4, FE-L | `test_discovery_decoder_architecture.py`, `DefinitionPanel.test.tsx` |
| 04-7.7 cancel at every phase; crash → `failed`, never a hung spinner | L3, FE-L | `test_qec_learned_jobs.py::test_cancel_*`, e2e (3) |
| Bundled DEM manifest sha256 asserted; pinned Stim generator script | L1 | `test_qec_learned_bundled.py` |
| Red Queen audit for `decoder_architecture` | L4 | `test_discovery_decoder_architecture.py::test_audit` |

### Idea 8 — Physics-verified Dirac suggestions

| Acceptance | Unit(s) | Test(s) |
|---|---|---|
| 04-8.1 lightbulb (registry), palette, `/suggest`, ⌘⇧E, Lab rail → cards with baseline → candidate numbers + diff; Apply via `executeEdits` + undo stops; one ⌘Z restores the exact baseline; shortcut-collision test | FE-V, F-3 | `tests/e2e/verified-suggestions.spec.ts`, `shortcuts.test.ts`, real e2e `suggestions.real.spec.ts` (AST proposer with a fixed seed; asserts cards render with any verdict and Apply/⌘Z works) |
| 04-8.2 `verified` only when intervals separated per §6.2 **and** DLA non-decreasing; expressivity collapse → `improvement_by_reduced_expressivity`; observable frozen (`observable_changed` rejects); overlaps `inconclusive` | V1 | `test_trainability_verify.py::test_rules_table`, `::test_observable_changed_rejected`, `::test_expressivity_collapse_labelled` |
| 04-8.3 rejected proposals visible with reasons | FE-V | vitest cards |
| 04-8.4 no API key → AST proposals + explanation; web → `LabDesktopRequired` | FE-V | `orchestrator.test.ts`, e2e |
| 04-8.5 LLM code never runs outside the sandbox (`import subprocess` / `os.system` / `import socket` → `sandbox:`; `shutil.rmtree` / `open(..., 'w')` → `prescreen:`; `os.path.join` verifies); candidates as edits; oversized request → `too_large`; cancel leaves no candidate process | V1, R-F, L3+L4 (`module_circuit`) | `test_trainability_verify.py::test_sandbox_reject`, `::test_prescreen`, `::test_cancel_no_orphans`, `test_candidate_worker_tasks.py` |
| 04-8.6 P95 ≤ 30 s for 4 proposals at n ≤ 12 (recorded in the PR) | V1, FE-V | `test_trainability_verify_perf.py` (marker `slow`) + PR record |
| 04-8.7 protocol docs with replayed fixtures; CLAUDE.md | X | fixture replay |
| Proposers: Claude (`claude-haiku-5-5` / `claude-sonnet-5-5`), AST, symmetry (`symmetry_propose`) | FE-V, S1 | `proposers.test.ts` |
| Optional checks `certificate` (`certificate_cheap` with `brute_force` status, mandatory for goal trainability when available), `noisy_ppe`, `scaling` ("Verify harder" with a fixed seed per attempt) | V1 | `test_trainability_verify.py::test_optional_checks` |
| Isolation consent on `process`-only hosts | R-F, FE-V | e2e consent |

### Track R (every R-id)

R-1 R-A · R-2 R-A · R-3 R-B · R-4 R-A + R-B + R-G · R-5 R-F · R-6 R-B + R-G · R-7 R-B + R-C (shell health check) · R-8 R-B · R-9 R-B + F-1 (Lab job workers) + R-G (experimentRunner) · R-10 R-B · R-11 R-B + F-1 (Lab RSS ceiling) + R-G · R-12 R-B + R-C + R-G · R-13 R-A · R-14 R-C · R-15 R-G · R-16 R-C + R-G · R-17 R-C · R-18 R-C · R-19 R-F + F-3 (consent UI) · R-20 R-B · R-21 R-E · R-22 R-B · R-23 R-B (messages) — each with the audit's named regression test and a corpus entry in the unit's own `research_corpus/<unit>/` directory (loader: R-D).

### Review-driven acceptance tests (physics + engineering review, §10)

| Finding | Test (RED in the owning unit's wave) | Unit |
|---|---|---|
| P-1 brute force is not a win | `test_surrogates_quantumness.py::test_brute_force_never_simulable`, `::test_resists_needs_n_above_20`, per-surrogate `brute_force` status tests | Q1, Q2 |
| P-2 centraliser, not normaliser | `test_symmetry_verify.py::test_centralizer_regressions`, `::test_dense_exact_cross_check` | S1 |
| P-3 HKP constants | `test_surrogates_shadow.py::test_hkp_constants`, `::test_k10_vacuous` | Q3 |
| P-4 1q gate-error constant | `test_noise_channels.py::test_fidelity_conversion` (Haar integration of Kraus maps) | N1 |
| P-6 class B/C never decide | `test_surrogates_fourier.py::test_fourier_only_win_not_simulable` | Q3 |
| P-8 MPS mixed-canonical | `test_surrogates_mps.py::test_canonical_center_adversarial` | Q2 |
| P-10 no "trainable on" | `test_noise_analyses.py::test_claim_no_trainable_on`, certificate snapshot grep | N3+N4, FE-N |
| P-12/E-21 readout frame | `test_noise_compile.py::test_readout_frame` | N2 |
| P-14 symmetry sector | `test_symmetry_compile.py::test_sector_*` | S1 |
| P-15 DEM `^` | `test_qec_learned_dem_text.py::test_caret_components`, `::test_mwpm_surface_identity` | L1+L2 |
| P-16 paired statistics | `test_qec_learned_stats.py::test_newcombe_tango_examples`, `::test_holm_family`, `::test_better_than_ml_suspect` | L1+L2 |
| P-17/E-14 verifier observable + expressivity | `test_trainability_verify.py::test_observable_changed_rejected`, `::test_expressivity_collapse_labelled` | V1 |
| E-1 exec paths in workers | `test_run_worker.py::test_every_exec_path_survives[*]` (corpus program per path) | R-B |
| E-2 landlock + pre-screen | `test_discovery_isolation.py::test_landlock_denies_rmtree`, `test_discovery_prescreen.py` | R-F |
| E-3 RSS ceiling, no RLIMIT_AS | `test_run_worker.py::test_rss_ceiling_worker_died`, `test_lab_job_robustness.py::test_rss_ceiling` | R-B, F-1 |
| E-4 single exec per code version | `test_executor_run_path.py::test_single_exec_with_lab_open` | R-B |
| E-10 noise-aware finalisation + hooks identical | `test_noise_compile.py::test_finalisation_damped`, `::test_hooks_none_identical` | N2 |
| E-13 exact ML applicability | `test_qec_learned_bundled.py::test_two_exact_ml_sources` | L1+L2 |
| E-15 frame cap | `test_lab_protocol.py::test_oversized_request_error_envelope`, `labSession.test.ts` 1 MiB guard | F-1, R-G |
| E-18 shortcuts + code actions | `shortcuts.test.ts`, `codeActions/registry.test.ts` | F-3 |
| E-19 sys.path shadowing | `test_run_worker.py::test_sibling_module_wins[kernel,noise,models,symmetry]` | R-B |
| E-7 job hooks | `test_trainability_jobs.py::test_registries_agree`, `::test_partials_cumulative_on_cancel`, `::test_result_hook_on_cancel` | F-1 |

---

## 7. Consolidated implementation plan — waves

Rules: each wave is split into **runs of at most 4 implementers**, each unit one Sonnet agent in its own git worktree off the wave's base, plus **2 batched Opus reviewers per run** (one reviewer per two diffs: physics + security + UI), so a run never exceeds 6 agents (10 with retries — the owner's workflow cap). Fable orchestrates. **Explicit file ownership — no two units in a run touch the same file** (`scripts/check-wave-ownership.py`, R-D, Wave 0a, checks every run below and every spec ownership table); shared foundations land before anything that needs them; every unit lands RED tests first, with its corpus programs in its own `kernel/tests/research_corpus/<unit>/` directory and its own docs fixtures. Merge order within a run is the listed order. Each wave ends with the verification gate below before the next wave branches.

**Per-wave verification gate (all waves):** `cd kernel && pytest` (dev venv) · `pytest` on the `minimal` and `qk2` venvs from `scripts/make-test-venvs.sh` (touched suites; whole suite on `minimal`) · `npm test` · `tsc -b` · `eslint .` (0 errors) · `npx playwright test` (stub; from Wave 1 the `lab-e2e-stub` list) · `npx playwright test --project real-kernel` (`@real`; **from Wave 1 on**, when G2 exists) · corpus golden in `min`/`qk2`/`full` · `cargo test --lib` (when Rust changed) · `scripts/check-wave-ownership.py` · Opus review of every diff · the wave's own exit criteria.

### Wave 0 — Track R kernel (release blocker)

**Run 0a** (4 implementers)

| Unit | Scope | Owned files |
|---|---|---|
| **R-D** Corpus golden + wave tooling | scout corpus + glob loader (per-unit directories), `make-test-venvs.sh`, `check-wave-ownership.py`, sole owner of `kernel-tests.yml` this wave (R-C/R-E hand their lines), pytest-cov gates | §5.1 |
| **R-C** Environment & shell | Qiskit range, ruff, logs, `--version`, shell health check (R-7), dev-origins strip, catalog entries | §5.1 |
| **R-E** Test hygiene | importorskip everywhere, minimal-venv whole suite, cargo isolation | §5.1 |
| **R-F** Lab prerequisites + sandbox | composite decomposition; `landlock` tier, probe, consent handling, `prescreen.py`, SIGTERM-then-SIGKILL | §5.1 |

**Run 0b** (2 implementers; after 0a so the corpus loader and venvs exist)

| Unit | Scope | Owned files |
|---|---|---|
| **R-A** Adapters | no-measure results, library gates, `adapters/binding.py`, total adapter | §5.1 |
| **R-B** Execution model | design note `docs/research/PRD_15/R_EXECUTION_MODEL.md` first (time-boxed; carries the exec-path list and the 17-importer shim list for F-3), then the warm worker pool for every user-code path, cache, limits, `sys.path`, env, memory policy, `run_id` | §5.1 |

Gate: audit items R-1…R-14, R-16…R-22 closed on the kernel side; corpus ledger shows only R-15 (frontend, Wave 1) open; `check-wave-ownership.py` green on this plan and every spec table.

### Wave 1 — Foundations + reliability frontend

**Run 1a** (4 implementers)

| Unit | Scope | Owned files |
|---|---|---|
| **F-1** Kernel protocol foundations | `lab_routes.py` with **all five prefixes** (lazy, `family_unavailable`); `lab_protocol.py` v1.4 catalog + `lab_capabilities` + `project_root`/`file_path` resolution + per-handler payload caps / `too_large` + `max_size` backstop + `unknown_message` echoing `request_id`; `lab_proc.register_manager/total_running` (Discovery pool slots, nested sandboxes), **group-RSS ceiling and `project_root` cwd/`sys.path` in `LabJobManager._spawn`**; `provenance.PROTOCOL_VERSION = "1.4"` + fingerprint registry + scoped `analyses_fingerprint` + ledger/constants version imports; `_settings.register_section`; **`jobs.py` hooks** (`register_analysis` with partial emitter + real cancel + width/needs-parameters fields, `register_result_hook`, cumulative partials, `register_job_message`) and `pkgutil` discovery of `analyses_*.py` in `handlers.py` and `job_worker.main`; `handlers.register_sync`; `server.py` lab routing + `hardware_calibration` branch + `-m` launch; `kernel/hardware/manager.get_manager()`; `declarations.py`; `dataset.py` (header/zip checks, `O_NOFOLLOW`, inspect-stats-only); `discovery/diff_apply.py`; prefix-parametrized auth/isolation tests | `kernel/lab_routes.py`, `kernel/lab_protocol.py`, `kernel/lab_proc.py`, `kernel/server.py` (lab/hardware branches), `kernel/trainability/{provenance,_settings,jobs,job_worker,handlers,declarations,dataset}.py`, `kernel/hardware/{base,manager}.py`, `kernel/discovery/{diff_apply,constants}.py`, `kernel/discovery/conjecture/ledger.py` (version import), `kernel/tests/test_lab_routes.py`, `test_lab_protocol.py`, `test_trainability_jobs.py`, `test_trainability_declarations.py`, `test_trainability_dataset.py`, `test_lab_token_isolation.py`, `test_kernel_auth.py`, `test_lab_job_robustness.py` |
| **F-2** Shared TS types | every file in §2.6 with zod schemas and type tests; fixtures skeletons per feature (`src/services/<feature>/fixtures.ts`) | `src/types/{trainability,quantumness,noise,noiseModel,qkernel,hardware,symmetry,deploy,qecLearned,suggestions,discovery,conjecture,quantum}.ts`, `src/types/*.test.ts`, `src/services/{quantumness,noise,qkernel,symmetry,deploy,qecLearned,suggestions}/fixtures.ts` |
| **F-3** Frontend registries + shims | `labModes.ts`, `labAnalyses.ts` (picker + tab + verdict card + rail-slot + certificate section + settings slice per analysis), `TargetBar` slots, `labRegistry` wiring in `TrainabilityLab/AnalysisTabs/VerdictRail/TargetBar/certificate.ts`; `featureCommands.ts` palette registry + parity test; `contextProviders.ts` Dirac registry + `useDirac.ts` call; `jobRegistry.ts` + `LabStatusChips`/`ModeSwitchGuard`; `evaluatorDefinitions/` registry; `qecPanelRegistry` placeholder; **`codeActions/registry.ts`** + one `registerCodeActionProvider` in `QuantumEditor.tsx` (wire or delete `quantumCodeActions.ts`); **`src/config/models.ts`** model registry + migration of the four hard-coded id sites + no-hard-coded-id test; **`LabHeatmap`/`LabLineChart`/`IntervalBars`** in `charts.tsx`; the **17 Tauri shims** behind the bridge (incl. `App.tsx`, `EnvironmentPanel.tsx`, `FrameworkSetup.tsx` imports — files themselves stay with R-G where listed; F-3 owns the shim modules and the import lines in `App.tsx`); shortcut-collision test; the isolation-consent dialog + `runner.ts`/`kernelEval.ts` consent plumbing; settings-field registry for feature settings | `src/components/trainability/{labModes,labAnalyses,TrainabilityLab,AnalysisTabs,VerdictRail,TargetBar}.tsx/.ts`, `src/services/trainability/certificate.ts` (+ snapshot), `src/components/commandPalette/{featureCommands.ts,CommandPalette.tsx,CommandPalette.test.ts}`, `src/services/dirac/contextProviders.ts`, `src/hooks/useDirac.ts`, `src/services/lab/jobRegistry.ts`, `src/components/discovery/{LabStatusChips,ModeSwitchGuard,DefinitionPanel,NewDiscoveryWizard,CandidateDrawer,drawerSections,IsolationConsentDialog}.tsx`, `src/services/discovery/evaluatorDefinitions/{index,frontier,qecMemory,stateSynthesis,vqe}.ts`, `src/services/discovery/{runner,kernelEval,models}.ts`, `src/layout/qecPanelRegistry.ts`, `src/App.tsx`, `src/components/editor/codeActions/{registry,quantumCodeActions}.ts`, `src/components/editor/QuantumEditor.tsx`, `src/config/{models,dirac}.ts`, `src/services/{ghostCompletions,claudeClient}.ts`, `src/components/lab/charts.tsx`, `src/platform/tauriShims/**`, `src/stores/settingsStore.ts` (settings registry), `src/config/settingsRegistry.ts`, `tests/unit/shortcuts.test.ts` |
| **N1** Noise core | spec 02 N1 (frozen r ↔ p table, measurement-frame readout substitution, two twirl bounds, NIBP Thm. 1, gate-time policy) | `kernel/noise/{__init__,model,channels,schedule,densitymatrix,bounds}.py`, `kernel/tests/test_noise_{model,channels,schedule,densitymatrix,bounds}.py`, `kernel/tests/_noise_helpers.py` |

**Run 1b** (2 implementers)

| Unit | Scope | Owned files |
|---|---|---|
| **G2** Real-kernel harness | §5.2 (on-disk fixture copies, glob fixture registry, dev origins, `lab-e2e.yml`) | §5.2 list |
| **R-G** Reliability frontend | §5.1 (existing `missingDependencyStore`, `EditorTabs`, settings/onboarding files, QEC state components, `EvaluatorUnavailable`, 1 MiB guard) | §5.1 list |

Gate: audit R-15 closed; real-kernel specs 1–6 green on `dev` and `minimal` venvs; `lab-e2e-stub` runs every existing non-@qec spec; registries have a parity test each; PRD 14 suites unchanged; `tsc`/vitest green with the full v1.4 type surface; `test_trainability_jobs.py::test_registries_agree` green.

### Wave 2 — Kernel cores I

**Run 2a** (4 implementers)

| Unit | Scope (spec units) | Owned files |
|---|---|---|
| **Q1** Surrogate backbone | 01 U1 + U5: base (`brute_force`, families, `SurrogateContext.noise_model`), registry (`EXPORTABLE_KINDS = {fourier}`), oracle, suite (`target_trivial`, families, `surrogate_scaling`), quantumness (new axis/verdict tokens), quick, `lightcone.py` move (`strip` + exact Heisenberg cone), S1/S3/S5, `analyses_surrogates.py` (settings, analysis, result hook, catalog), provenance fingerprint, docs fixtures | `kernel/surrogates/{__init__,base,registry,oracle,suite,quantumness,quick}.py`, `kernel/surrogates/methods/{__init__,ppe,stabilizer,light_cone}.py`, `kernel/trainability/{lightcone,analyses_surrogates}.py`, `kernel/discovery/evaluators/_frontier_structure.py` (re-export lines), `kernel/tests/test_surrogates_{base,suite,quantumness,quick,ppe,stabilizer,light_cone}.py`, `test_trainability_lightcone.py`, `kernel/tests/research_corpus/q1/**`, `docs-site/fixtures/lab_trainability_surrogate_catalog.*`, `docs-site/fixtures/lab/trainability_surrogates.stream.json` |
| **Q2** MPS + 𝔤-sim | 01 U2 + U3 (mixed-canonical contract, `brute_force` rules) | `kernel/surrogates/{mps,gsim,_expm}.py`, `kernel/surrogates/methods/{mps,gsim}.py`, `kernel/tests/test_surrogates_{mps,gsim,expm}.py` |
| **Q3** Spectrum, Fourier, RFF, shadow | 01 U4 + the pure fitters of 03 D1 (`spectrum` incl. CRX, `fourier` DFT-exact/LS/interval + Lebesgue bound, `rff`, `shadow` simulate/load/`plan`/`guarantee`/predict with HKP Thm. 1 constants, readout-mitigated inverse channel); `inspect` `data_params` via `declarations.py` | `kernel/surrogates/{spectrum,fourier,rff,shadow}.py`, `kernel/surrogates/methods/{fourier,rff}.py`, `kernel/trainability/inspect.py`, `kernel/tests/test_surrogates_{spectrum,fourier,rff,shadow}.py`, `test_trainability_inspect.py` |
| **N2** Noisy PPE | 02 N2 (readout-first compile, `channel_step`/`finalize` hooks in `ppe_core` with byte-identical default, noise-aware finalisation, non-unital exact) | `kernel/noise/{compile,ppe_noisy}.py`, `kernel/trainability/ppe_core.py` (hooks, extend-only), `kernel/tests/test_noise_{compile,ppe,physics}.py` |

**Run 2b** (2 implementers)

| Unit | Scope | Owned files |
|---|---|---|
| **K1** Kernel math | 02 K1 (declarations-only resolver, 512 MiB guard, PPE route N ≤ 128 + perturbation bound, regularised Huang g with λ_C, nested paired CV, renamed verdicts, heuristic labels) | `kernel/qkernel/{__init__,featuremap,gram,classical,geometry,concentration,krr,bandwidth,verdict}.py`, `kernel/tests/test_qkernel_{featuremap,gram,geometry,concentration,krr,verdict,physics}.py`, `kernel/tests/_qkernel_helpers.py` |
| **S1** Symmetry core | 03 S1 + `detect.py` (centraliser verification, sector check) — **`propose.py` moves to S2+S3** | `kernel/symmetry/{__init__,spec,groups,twirl,synth,compile,verify,detect,compare}.py`, `kernel/tests/test_symmetry_{spec,groups,twirl,synth,compile,verify,detect,compare,physics}.py`, `kernel/tests/_symmetry_helpers.py` |

Gate: spec 01 §7.2 physics table (surrogates incl. the brute-force rows), spec 02 §7.2 noise rows (readout frame, finalisation, constants), spec 03 §7.2 twirl/equivariance/sector rows green; `test_surrogates_*` on the minimal venv with scipy blocked; PRD 14 suites unchanged and bit-identical through the `ppe_core` hooks.

### Wave 3 — Kernel cores II

**Run 3a** (4 implementers)

| Unit | Scope | Owned files |
|---|---|---|
| **N3+N4** Calibration + noise analyses | 02 N3 + N4 (providers via `get_manager()`, 20 s timeout, bundled snapshots + script, `calibration_to_noise_model`, analyses incl. equal-accuracy cost, `scaling.variance_fn`, `noisy_ppe` in `SUITE_EXTENSIONS`, presets/calibration sync handlers, settings section, model-scoped claim, docs fixtures) | `kernel/noise/{calibration,analyses,surrogate}.py`, `kernel/noise/bundled/**`, `scripts/snapshot_calibration.py`, `kernel/hardware/{ibm_provider,ionq_provider}.py` (extend-only), `kernel/trainability/{scaling,analyses_noise}.py`, `kernel/surrogates/registry.py` (`SUITE_EXTENSIONS` entry line), `kernel/tests/test_noise_{calibration,analyses,surrogate}.py`, `test_server_hardware_calibration.py`, `kernel/tests/hardware/fixtures/calibration/**`, docs fixtures |
| **K2+K3** Datasets, lint, analysis | 02 K2 + K3 (eigenvector-engineered demo, QK rules, lint hook, orchestrator with per-stage partials, settings section, analysis registration, docs fixtures) | `kernel/qkernel/{demo,lint,analysis}.py`, `kernel/qkernel/dataset.py` (re-export), `kernel/trainability/{lint,analyses_qkernel}.py`, `kernel/tests/test_qkernel_{demo,lint,analysis}.py`, docs fixtures |
| **S2+S3** Symmetry emit + protocol + propose | 03 S2 + S3 + `propose.py` (literal-safe emit, roundtrip, `symmetry_propose`, settings, handlers, jobs, worker; no `lab_routes.py` edit) | `kernel/symmetry/{emit,roundtrip,propose,_settings,handlers,jobs,job_worker}.py`, `kernel/tests/test_symmetry_{emit,roundtrip,propose,handlers}.py`, `docs-site/fixtures/lab_symmetry_*.json`, `docs-site/fixtures/lab/symmetry_compile.stream.json` |
| **D1+D2** Deploy core + trainer | 03 D1 (model/dataset re-export/evaluate with per-eval timing/validate with the revised verdict table; imports fitters from `kernel/surrogates`) + D2 | `kernel/deploy/{__init__,model,dataset,spectrum,evaluate,validate,train}.py`, `kernel/deploy/surrogates/__init__.py` (re-exports), `kernel/tests/test_deploy_{model,routes,fourier_intervals,validate,train,physics}.py`, `kernel/tests/_deploy_helpers.py` |

**Run 3b** (2 implementers)

| Unit | Scope | Owned files |
|---|---|---|
| **L1+L2** DEM core, classical decoders, stats, neural decoders | 04 U1 + U2 + U3 (`^` components, XOR sampler, `splits.derive_seed` + fixed test split + use counter, F2-convolution exact ML, HNB weighted UF, MWPM from canonical text, Newcombe/Tango/Agresti–Min + Holm + suspect + tie-group ranking, bundled DEMs with the two-exact-ML-sources manifest test) | `kernel/qec/learned/{__init__,dem_text,dem_sampler,splits,provenance,arch_spec,stats}.py`, `kernel/qec/learned/decoders/{__init__,base,exact_ml,union_find,mwpm,nn_numpy,nn_torch,registry}.py`, `kernel/qec/learned/bundled/**`, `scripts/gen_bundled_dems.py`, `kernel/tests/test_qec_learned_{dem_text,sampler,splits,bundled,decoders_classical,decoders_nn,arch_spec,stats}.py` |
| **G1** Goldilocks evaluator + audit + conjecture | 01 U7 + U8 (qubits > 20 config rule, r at the largest n from circuit-derived h, censoring flag, monotonicity, honesty text, audit, conjecture features) | `kernel/discovery/evaluators/{goldilocks,_goldilocks_config,_goldilocks_resistance,_goldilocks_fitness}.py`, `kernel/discovery/evaluators/{__init__,availability}.py` (entries), `kernel/discovery/seeds/{goldilocks,__init__}.py`, `kernel/discovery/audits/{goldilocks,_frontier_shared,trainability_frontier}.py`, `kernel/discovery/conjecture/{predicate,spec,tester,semantics}.py`, `kernel/tests/test_discovery_goldilocks*.py`, `test_discovery_seeds.py`, `test_discovery_evaluators.py`, `test_discovery_conjecture_*.py`, `test_discovery_exploits.py`, `kernel/tests/fixtures/exploits/goldilocks-*.json` |

Gate: spec 02 §7.4, 03 §7.4 (symmetry), 04 §11.1 (U1–U3) integration tests green; spec 01 §6.8 seed scores at n = 24; minimal-venv whole suite green; app-env corpus green.

### Wave 4 — Kernel protocol tails + frontend I

**Run 4a** (4 implementers)

| Unit | Scope | Owned files |
|---|---|---|
| **D3** Deploy export + protocol | 03 D3 + `exportable` resolution (Fourier only); no `lab_routes.py` edit | `kernel/deploy/{export_numpy,export_json,export_onnx,provenance,_settings,handlers,jobs,job_worker,from_surrogate}.py`, `kernel/tests/test_deploy_{export,provenance,handlers,from_surrogate}.py`, `docs-site/fixtures/lab_deploy_*.json`, `docs-site/fixtures/lab/deploy_train.stream.json`, `docs-site/fixtures/lab/deploy_export.stream.json` |
| **L3+L4** Learned jobs + decoder evaluator | 04 U4 + U5 (sources by path, jobs with confirm splits, handlers; evaluator with champion-from-confirm, unpaired-Newcombe audit, seed; `decoder_spec` + `module_circuit` tasks); no `lab_routes.py` edit | `kernel/qec/learned/{sources,job_worker,jobs,handlers}.py`, `kernel/discovery/evaluators/decoder_architecture.py`, `kernel/discovery/audits/decoder_architecture.py`, `kernel/discovery/seeds/decoder_mlp.py`, `kernel/discovery/candidate_worker.py`, evaluator registry entry lines, `kernel/tests/test_qec_learned_{sources,jobs}.py`, `test_discovery_decoder_architecture.py`, `test_candidate_worker_tasks.py`, `docs-site/fixtures/lab_qec_learned_*`, `docs-site/fixtures/lab/qec_learned_start.stream.json` |
| **V1** Verify kernel | 04 U6 (edits applied kernel-side, pre-screen, frozen observable, expressivity rule, sandbox hygiene with parallelism 2, `register_job_message`; fake sandbox until L3+L4 merges) | `kernel/trainability/{verify,verify_rules,verify_cache,verify_handlers,analyses_verify}.py`, `kernel/tests/test_trainability_verify*.py`, `docs-site/fixtures/lab_trainability_verify_*`, `docs-site/fixtures/lab/trainability_verify.stream.json` |
| **FE-Q** Quantumness + Goldilocks UI | 01 U6 + U9 (on registries; brute-force and model-surrogate states; TRN003 code action; Goldilocks definition; `@real` specs incl. the deterministic Goldilocks path) | `src/components/trainability/analyses/quantumness/**`, `src/services/quantumness/{client,view,copy,context,certificateSection}.ts` (+ tests), `src/stores/quantumnessStore.ts`, `src/services/discovery/evaluatorDefinitions/goldilocks.ts`, `src/services/discovery/{templates,honesty,redQueenPrompt}.ts` (goldilocks blocks), `src/components/discovery/goldilocks/**`, `src/components/trainability/features/quantumnessCommands.ts`, `src/components/editor/codeActions/quantumnessActions.ts`, `tests/e2e/quantumness.spec.ts`, `tests/e2e/real/{quantumness,goldilocks}.real.spec.ts`, `tests/e2e/fixtures/lab-project/models/data_model.py` |

**Run 4b** (2 implementers)

| Unit | Scope | Owned files |
|---|---|---|
| **FE-N** Noise UI | 02 F1 (on registries; "No BP under noise model" pill, bound/quantity pairing, equal-accuracy card, conversion table; bundled-snapshot `@real` spec) | `src/components/trainability/analyses/noise/**`, `src/components/trainability/noise/{NoisePicker,CalibrationDrawer,NoiseModelCard,LayoutEditor}.tsx`, `src/services/noise/{client,view,copy,context,yaml,certificateSection}.ts` (+ tests), `src/stores/noiseStore.ts`, `src/components/experiments/NoiseModelLibrary.tsx` (circuit-noise chip), `src/components/trainability/features/noiseCommands.ts`, `tests/e2e/noise.spec.ts`, `tests/e2e/real/noise.real.spec.ts`, `tests/e2e/fixtures/lab-project/noise/**`, `tests/e2e/fixtures/lab-project/ansatz/t_gate_14.py` |
| **FE-S** Symmetry UI | 03 S4 + S5 (on `labModes`; sector refusal state; exclusive-create Insert) | `src/components/symmetry/**`, `src/services/symmetry/**`, `src/stores/symmetryStore.ts`, `src/components/trainability/features/symmetryCommands.ts`, `tests/e2e/symmetry.spec.ts`, `tests/e2e/real/symmetry.real.spec.ts`, `tests/e2e/fixtures/lab-project/ansatz/tfim_ring.py` |

Gate: all kernel families answer every v1.4 message with docs fixtures replayed; three feature specs green stub + real; screenshots reviewed.

### Wave 5 — Frontend II

**Run 5a** (4 implementers)

| Unit | Scope | Owned files |
|---|---|---|
| **FE-K** Kernel power-of-data UI | 02 F2 (renamed verdicts, heuristic-threshold line, paired CV table, perturbation-bound column, QK001 action file) | `src/components/trainability/analyses/qkernel/**`, `src/components/trainability/qkernel/{DatasetPicker,GramHeatmaps,GeometryTable,SpectrumChart,CvTable,BandwidthCurve,KernelVerdictCell}.tsx`, `src/services/qkernel/{client,view,copy,datasets,context,certificateSection}.ts` (+ tests), `src/stores/qkernelStore.ts`, `src/services/trainability/{lintMarkers,useTrainabilityLint}.ts` (QK widening), `src/components/editor/codeActions/qkernelActions.ts`, `src/components/trainability/features/qkernelCommands.ts`, `tests/e2e/qkernel.spec.ts`, `tests/e2e/real/qkernel.real.spec.ts`, `tests/e2e/fixtures/lab-project/{models/feature_map_2d.py,data/moons.csv}` |
| **FE-D** Deploy UI | 03 D4 + D5 (input-box field, derived K read-only, ideal-measurement verdict copy, grid-feasibility reason) | `src/components/deploy/**`, `src/services/deploy/**`, `src/stores/deployStore.ts`, `src/components/trainability/features/deployCommands.ts`, `tests/e2e/deploy.spec.ts`, `tests/e2e/real/deploy.real.spec.ts`, `tests/e2e/fixtures/lab-project/{models/fourier_2d.py,models/flipped_demo.py,experiments/fourier_2d.training.json}` |
| **FE-L** Learned decoders UI + decoder evaluator UI | 04 U8 + U10 (adjusted intervals, tie groups, use counter, confirm button, suspect pill; deterministic evaluator `@real` spec) | `src/components/qec/learned/**`, `src/services/qecLearned/**`, `src/stores/qecLearnedStore.ts`, `src/components/qec/DecoderWorkbench.tsx` (header button), `src/services/discovery/evaluatorDefinitions/decoderArchitecture.ts`, `src/services/discovery/prompt.ts` (GUARDRAILS entry), `src/components/qec/learned/commands.ts`, `tests/e2e/qec-learned-decoders.spec.ts`, `tests/e2e/real/{qec-learned,decoder-architecture}.real.spec.ts`, `tests/e2e/fixtures/qec-project/circuits/rep_d3.dem` |
| **FE-V** Verified suggestions UI | 04 U9 (edits-based verify client, `executeEdits` Apply command, ⌘⇧E, provider file on the registry, settings fields via the registry; AST-seeded `@real` spec) | `src/components/suggestions/**`, `src/services/suggestions/**`, `src/stores/suggestionStore.ts`, `src/components/editor/codeActions/verifiedSuggestionActions.ts`, `src/components/editor/commands/applyVerifiedEdit.ts`, `src/components/dirac/DiracSidePanel.tsx` (`/suggest`, `/decoders`), `src/components/trainability/analyses/verdictRailSuggestButton.tsx`, `src/components/suggestions/{commands,settingsFields}.ts`, `tests/e2e/verified-suggestions.spec.ts`, `tests/e2e/real/suggestions.real.spec.ts` |

**Run 5b** (2 implementers)

| Unit | Scope | Owned files |
|---|---|---|
| **X** Docs, CI, CLAUDE.md | docs-site pages (`quantumness-certificate`, `noise-aware-trainability`, `quantum-kernels`, `symmetry-compiler`, `classical-deploy`, `learned-decoders`, `verified-suggestions`, `sandboxing`), `messages-lab.mdx`/`messages-hardware.mdx` v1.4 sections, `messages-execution.mdx` Track R additions, protocol changelog, CLAUDE.md ("Kernel Protocol v1.4", "Quantumness Lab", Track R run model), `scripts/smoke_prd15.md`, CI job lists for every new test glob and e2e spec (appending to R-D's `kernel-tests.yml` and G2's `lab-e2e.yml`), vitest coverage thresholds per new `src/` directory; regenerates every docs example (incl. spec 04 Appendix B) from the real handlers | `docs-site/src/**`, `CLAUDE.md`, `.github/workflows/**` (job lists), `scripts/smoke_prd15.md`, `vitest.config.ts` (coverage thresholds) |
| **E** Real-kernel feature matrix | runs every unit's `@real` spec on `dev`, `app-env` and `minimal` venvs (install-card paths on `minimal`) through one matrix harness; perf record for 04-8.6; owner-env script run. The per-idea `@real` specs themselves are owned by the FE units (quantumness, goldilocks: FE-Q; noise with the bundled snapshot: FE-N; qkernel: FE-K; symmetry: FE-S; deploy: FE-D; qec-learned, decoder-architecture: FE-L; suggestions with the AST proposer at a fixed seed: FE-V) — none needs a Claude key or live hardware | `tests/e2e/real/matrix.spec.ts`, `tests/e2e/support/realKernelMatrix.ts`, `docs/research/PRD_15/REAL_KERNEL_RESULTS.md` |

Gate: every spec's Playwright list green (stub + real); vitest coverage ≥ 80 % for every new `src/` directory and pytest coverage ≥ 80 % for every new kernel package; palette parity; screenshots.

### Wave 6 — Integration, adversarial review, release hardening

| Unit | Scope |
|---|---|
| **REV-P** Physics review (Opus) | adversarial review of every verdict copy and formula, with the §10 findings as **explicit exit criteria**: brute-force status and the n ≤ 20 rule (01 §2.1/§2.9); trainability tokens never "trainable" (01, 02); class B/C excluded from the verdict (01); S1/S3 one family (01); MPS mixed-canonical contract (01 §2.5); Goldilocks r at the largest n, circuit-derived, censoring flagged (01 §6.4); 1q p = 3r/2 and 2q p = 5r/4 and the gate-time policy (02 §4.2); readout in the measurement frame before the Clifford push (02 §2.4); noise-aware finalisation and byte-identical hooks (02 §2.3); the two twirl-gap bounds shown next to their quantities (02 §2.6); weight-cut labelled heuristic; NIBP Thm. 1 constants and placement gate (02 §2.6); no "trainable on {device}" (02); g regularisation, λ_C condition, every-λ rule, s_Q vs s_C, heuristic thresholds, nested paired CV (02 §3.5–3.6); centraliser equality, not normaliser (03 §2.6); symmetry-sector refusal (03 §2.5); HKP K = 2 ln(2M/δ), input box, δ < 1 for `certified`, ideal-measurement label (03 §3.3); Lebesgue prediction bound and CRX spectrum (03 §3.2); sampled ratio coverage ≥ 90 % (03 §2.8); DEM `^` components + XOR (04 §2.1); exact ML F2 convolution gated on n_D + n_L (04 §2.2); Newcombe/Tango paired intervals, Holm, fixed test split, use counter, suspect rule (04 §2.3–2.4); frozen observable, DLA non-decreasing, expressivity-collapse label (04 §6.1–6.2); HNB UF weights (04 §2.2). Findings become units in a Wave 6b. |
| **REV-S** Security review (Opus) | sandbox tiers (`landlock` on the owner's box, pre-screen, consent), idea 2 Red Queen, idea 7 evaluator, idea 8 `module_circuit` + nested-process cancellation, dataset/DEM/shadow/snapshot file parsing (header caps, `O_NOFOLLOW`), `project_root` validation, frame-size caps, emitted-code literal rendering + fuzz, `.surrogate.py` json-only loading + self-check, dev-origins gating, `sys.path` shadowing. |
| **REV-U** UI review | every §5.3/§6.3/§10 state table against the running app; no blank boxes; honesty strings present; the forbidden-string greps (`trainable on`, `(lo + hi) / 2`). |
| **REL** Release hardening | `npm run tauri dev` smoke on the Linux box (owner's go-ahead, window on `:1`), packaged `.deb` smoke (G3, the `release.yml` artifact on `ubuntu-24.04`), `scripts/check-app-env.sh`, `tauri build` npm/crate version check, PR with CI green, version bump to 0.15.0, release notes. |

---

## 8. Definition of done

PRD 15 is done when **all** of the following hold on the release candidate:

1. **Track R closed.** Every R-1…R-22 regression test green; the corpus golden passes in `min`, `qk2` and `full` with an empty `xfail` ledger; the minimal-venv job runs the whole kernel suite; `cargo test` is isolated from `~/.nuclei`.
2. **Every feature exercised end to end in the running app via Playwright** — stub-kernel spec *and* `@real` spec per idea 1–8, each walking trigger → running/progress → cancel → result and the error/unavailable states, on the `dev` venv and on a `minimal` venv (where optional-package paths must show install cards, never errors).
3. **Smoke-tested in a Linux dev build** (`npm run tauri dev` on this box, then the packaged `.deb` under `xvfb-run`): fresh managed venv provisions, kernel ready < 20 s, Bell template and the lab ansatz run, each PRD 15 feature's happy path driven by hand per `scripts/smoke_prd15.md`, screenshots attached to the PR, `nuclei.log` has the startup lines.
4. **Honesty invariants hold mechanically:** no `(lo + hi) / 2` in components; no "trainable" verdict token and no "trainable on {device}" string anywhere (greps); `brute_force` never rendered as a win; every kernel number has method + interval/reason; claim texts snapshot-tested; `not_implemented`/`not_modelled`/scope/heuristic-threshold sentences rendered wherever the corresponding verdict is.
5. **Determinism:** bit-identical JSON (minus `elapsed_ms`) for every job family on repeated requests, asserted by tests.
6. **No new required dependency**; `torch`/`onnx` catalog entries lazy and labelled; scipy never imported at module import.
7. **Protocol v1.4** documented with every example replayed against the real handlers; CLAUDE.md updated; palette↔registry parity test green.
8. **Coverage** ≥ 80 % on every new kernel package and `src/` directory (enforced by pytest-cov and vitest thresholds in CI); Opus physics, security and UI reviews signed off with findings fixed and every §10 review-log item at `resolved`; `scripts/check-wave-ownership.py` green.
9. **CI green** on every gate in §5.3, including the Qiskit-2 leg, app-env corpus, real-kernel e2e and the packaged smoke; release only on the owner's explicit go-ahead.

---

## 9. Top risks

1. **Track R changes the run path for everyone.** The warm run-worker pool (R-B) now carries every user-code path, not only the editor. Mitigation: design note first with the explicit path list, latency budgets with perf tests, the corpus golden in three envs before and after, Experiments sweeps and Q#/Stim paths in the corpus, real-kernel e2e, and the packaged smoke.
2. **Shared-file contention across 30+ units.** Mitigation: registries in Wave 1; runs of ≤ 4 implementers; the ownership tables in §7 **and the spec ownership tables** are checked by `scripts/check-wave-ownership.py` (R-D, Wave 0a, run on this plan before Wave 0 branches) which fails a wave plan if two units in a run name the same file or a spec contradicts the master.
3. **Physics mistakes in verdict copy and constants.** The first draft had four critical ones (brute force counted as a win; normaliser instead of centraliser; HKP's K dropped a factor 2; 1q p = 2r instead of 3r/2) and sixteen high ones, all fixed in v2 with named unit tests (§6 review-driven table) and REV-P exit criteria. Mitigation: those tests land RED in the owning unit's wave, not only at the late review; `[verify]` markers resolved or removed from shipped strings.
4. **Candidate code on Ubuntu 24.04** (R-19). Ideas 2 and 8 execute LLM-written code; `bwrap` is blocked there and `process` isolation leaves `open()`, `os.remove`, `shutil` and `pathlib` writes available to a prompt-injected proposal. Mitigation: the `landlock` tier (ABI 8 on the owner's box, unprivileged), the mandatory AST pre-screen for LLM-origin candidates and on `process` hosts, per-session consent with exact capability text, nested-process cancellation, and the UI label driven by the kernel's `isolation_detail`; "document the AppArmor profile" is not a mitigation (needs root, changes bwrap system-wide) and is dropped.
5. **Qiskit 1.x vs 2.x drift.** The owner runs 2.6; CI tested 1.4. Mitigation: dual CI legs, `errorRewrite` migration hints, order-insensitive symbolic comparisons, app-env corpus.
6. **Budgets and latency.** Suite default 60 s, Gram O(N³) single-threaded (`max_rows` 1024, PPE route N ≤ 128), deploy grid feasibility check, Fourier oracle feasibility check, pure-Python union-find, verify P95 ≤ 30 s, parse p50 ≤ 150 ms over program time. Mitigation: everything streams partials and cancels; estimates shown before Run assuming single-thread BLAS; `surrogates` off by default; perf tests with recorded numbers.
7. **Loose rigorous bounds** (MPS triangle bound, PPE-propagated Fourier intervals, twirl gap) read as "conservative". By design; both numbers shown with labels. Not negotiable.
8. **Optional-dependency UX regressions** on the stock venv. Mitigation: `minimal` venv real-kernel run per feature (E), the dependency store, install cards everywhere.
9. **Scope.** Eight ideas plus Track R is large. The waves are ordered so that a release after Wave 4 would already ship Track R + ideas 1, 2, 3, 5 end to end; nothing is dropped, but the order protects the owner's "it won't run" problem first.

---

## 10. Review log (v1 → v2)

Every finding of the adversarial physics review (P-*) and the engineering/plan review (E-*) with its severity and resolution. "Resolved" means the master and/or the named spec section now states the fix and the §6 review-driven table names the test; "answered" means the finding is addressed by a decision recorded here.

| Id | Severity | Finding (short) | Resolution |
|---|---|---|---|
| P-1 | critical | Brute force counted as a surrogate win; every n ≤ 20 circuit "simulable" | Resolved: `brute_force` status per surrogate with binding bounds (01 §2.1), `brute_force_simulable` axis value and `resists` only for n > 20 (01 §2.9), claim text "at n = N", `surrogate_scaling` mode, S5 rule unambiguous (01 §2.6), `certificate_cheap` carries the status (§2.3), 01 §7.2 rows fixed |
| P-2 | critical | Fixed-gate equivariance tested the normaliser, not the centraliser | Resolved: equality check `U R(g) U† = e^{iφ} R(g)` with sign-aware frame comparison, regression tests (SWAP/s_n, CZ/z2_flip, ring CX/cyclic), dense n ≤ 5 cross-check (03 §2.3, §2.6, §7) |
| P-3 | critical | HKP guarantee dropped the factor 2 in K and let `mom_groups` float | Resolved: `shadow.plan`/`guarantee` compute (ε, δ) from the actual (T, K, M, k) with K = ⌈2 ln(2M/δ)⌉, δ = min(1, 2M e^{−K/2}); `mom_groups` read-only; never `certified` with δ ≥ 1; constants test; Thm. 1 / Lemma 3 cited by number (03 §3.3, §3.5, §4.3, §6.4) |
| P-4 | critical | 1q gate-error conversion p = 2r (should be 3r/2); 64r/45 bracket wrong; double counting | Resolved: frozen table p = r(d+1)/d (3r/2, 5r/4) with Nielsen derivation, bracket deleted, gate-time decoherence policy, Haar-integration test from Kraus maps, table in UI and certificate (02 §4.2) |
| P-5 | high | "trainable" tokens assert trainability; single_size used a point value and unnormalised thresholds | Resolved: axis `bp | no_bp_evidence | unknown`, verdict tokens renamed, `NO_BP_CAVEAT` (Anschuetz & Kiani 2022), single_size on interval endpoints of Var/‖O‖₁² with labelled heuristic thresholds (01 §2.9, §5.4) |
| P-6 | high | Class B/C heuristic wins could set `simulable` | Resolved: simulability axis from class-A rigorous/exact only; `model_surrogate` line; consistency pairs class A; test that a Fourier-only win cannot produce `simulable` (01 §1.2, §2.7–2.9, §3.3) |
| P-7 | high | S3 mislabelled as stabilizer rank | Resolved: renamed "Clifford-dominated exact Pauli-path enumeration (2^t)", Bravyi–Gosset moved to NOT_IMPLEMENTED, S1/S3 one family in the ≥ 3-families quorum (01 §1.1, §2.4, §2.9) |
| P-8 | high | MPS truncation bound needs the orthogonality centre on the cut | Resolved: mixed-canonical contract with QR sweeps before every two-site SVD, centre assertion, adversarial property tests; fidelity-product bound only with a written proof (01 §2.5, §7.1, §11) |
| P-9 | high | Goldilocks r degenerate (min over n, settings-derived h, light cone always wins); Cerezo misframed | Resolved: r at the largest scored n, every scored n > 20, circuit-derived h (rigorous error at the cap / frontier lower bound), censoring flag capping r at 0.7, monotonicity check, rewritten motivation and honesty text, quantum-enhanced surrogates in NOT_IMPLEMENTED, Cerezo citation updated (01 §0, §6) |
| P-10 | high | "trainable on {device}" claims a device property | Resolved: "no barren plateau detected under a Pauli-twirled model built from the {provider}/{backend} calibration fetched {fetched_at}"; pill "No BP under noise model"; forbidden-substring snapshot test (02 §0, §2.9, §6.1, §6.4, §8) |
| P-11 | high | Twirl gap was an expectation bound shown next to variances; derivation not rigorous | Resolved: hybrid-argument `twirl_gap_expectation = min(2‖O‖_op, Σγ_j‖O‖_op)` and `twirl_gap_variance = min(f²‖O‖_op², 2 f ‖O‖_op δ_f)`, each shown next to its quantity, both tested (02 §2.6, §5.2) |
| P-12 | high | Readout substitution applied after the Clifford push | Resolved: substitution on O in the measurement frame before `compile_noisy_program`, every letter, stated measurement model, trailing H/CX + X/Y test (02 §2.4) |
| P-13 | high | `classical_kernels_suffice` biased: λ ∝ N, thresholds misattributed, no s_C vs s_Q, wrong error relation, engineered demo not Huang's | Resolved: regularised Huang definition with the training-error condition and λ in mean-eigenvalue units, "matches geometric power" only at every λ, c·√N with c shown, s_Q < s_C on labels, O(√(s/N)), eigenvector-constructed `huang_engineered`, verdict renamed, thresholds labelled heuristic (02 §3.5, §3.8, §3.9) |
| P-14 | high | 1-dimensional symmetry sectors (u1_charge/su2_spin from \|0…0⟩) make the cost constant | Resolved: `sector_dimension` check, `trivial_symmetry_sector` refusal with suggested preparations, polynomial sector → simulability warning citing Anschuetz et al. 2023 + Schatzki 2024, tests (03 §2.5, §5.2, §7) |
| P-15 | high | DEM `^` components merged by union | Resolved: components stored, XOR sampling, graph decoders use components, merge only on identical full symptoms, MWPM from canonical text / file loader, Stim surface-code identity test (04 §2.1, §2.2, §3.2, App. C) |
| P-16 | high | Paired verdict from an exact-conditional Wilson mapping, no multiplicity, optional stopping, point-estimate ranking, "better than exact_ml" | Resolved: Newcombe-10 / Tango / Agresti–Min, verdict from one interval consistent with McNemar, Holm–Bonferroni, test split fixed before decoding, tie-group ranking, `suspect` rule (04 §1.2, §2.3, §2.4, §8.1) |
| P-17 | high | Verifier rewards expressivity collapse; light-cone invariant ill-defined | Resolved: DLA non-decreasing required for goal trainability, `improvement_by_reduced_expressivity` verdict with the Cerezo caveat, `certificate_cheap` mandatory when available, invariant = support/coefficients of O + n_qubits, per-parameter variance and parameter-count flag (04 §6.1, §6.2, §8.2) |
| P-18 | high | Master headline device claim; `EXPORTABLE_KINDS` without routes; REV-P checklist incomplete | Resolved: headline reworded (§1.2), `EXPORTABLE_KINDS = {fourier}` (§2.3, 01 §10, 03 §10), REV-P exit criteria enumerate every finding and the tests land in Waves 2–4 (§7 Wave 6, §6) |
| P-19 | medium | ε unrelated to the cost's spread; oracle bound not propagated; K-point scope | Resolved: ε/std_𝒟(C), constant-predictor baseline → `target_trivial`, oracle bound added to B/C accuracy, `SIMULABLE_NOTE` carries K and n (01 §2.1, §2.7, §5.4) |
| P-20 | medium | S5 misattributed to BGM; Angrisani scope; [verify] tags | Resolved: "standard backward-light-cone restriction", BGM in NOT_IMPLEMENTED, Angrisani PRL 135, 170602 (2025) with the published scope, Cerezo/Larocca/LOWESA/Anschuetz & Kiani references resolved (01 §1.1, §2.6, §12) |
| P-21 | medium | Weight-cut "bound" is average-case, vacuous at λ = 1 | Resolved: `weight_cut_estimate`, `bound_kind: heuristic`, λ_max over non-identity Paulis, `not_applicable` at λ_max = 1, test asserts only the rigorous ledger (02 §2.6, §7.1) |
| P-22 | medium | NIBP constants wrong | Resolved: Wang et al. Thm. 1 verbatim (√(8 ln 2), c = 1/(2 ln 2), q = max λ), placement gate, clipped and labelled, direct formula test (02 §2.6) |
| P-23 | medium | RC overstated; "23× cheaper" compared peaks at equal threshold | Resolved: `TWIRL_NOTE` reworded, equal-accuracy frontier comparison with both D values, property test states its truncation precondition (02 §2.2, §5.2, §6.4, §7.1) |
| P-24 | medium | Projected-kernel "statistics on bounds" not rigorous; CV selection bias; alignment normalisation | Resolved: kept Gram + perturbation bound (Weyl / resolvent), `inconclusive` when uninformative, nested CV with paired per-example bootstrap and Nadeau–Bengio, ‖y‖² alignment, bandwidth note (02 §3.2, §3.6) |
| P-25 | medium | Shadow guarantee "for all inputs"; imported shadows; bootstrap on max\|error\|; ratio coverage | Resolved: declared input box, `certified_ideal_measurement` without readout mitigation, max\|error\| observed-only / order-statistic bound, sampled ratios "≥ 90 % joint coverage" and lo = 0 handling (03 §2.8, §3.3, §3.5) |
| P-26 | medium | Test-split reuse; audit pairing; invented Appendix B numbers; ML memory formula | Resolved: use counter + "Confirm on a fresh test split", champion from confirm seeds, unpaired Newcombe in the audit, Appendix B marked illustrative with consistent shapes and regenerated by X, `2^{n_D}·2^{n_L}` (04 §2.3, §4.1, §13, App. B) |
| P-27 | low | UF weights/citation; ML ratio pairing; "Verify harder" optional stopping | Resolved: `ln((1−p)/p)` weights clamped at p ≥ 0.5, Huang–Newman–Brown 2020, "conservative (ignores pairing)" label, fixed seed per attempt + attempt count + new family (04 §2.2, §2.4, §6.2) |
| P-28 | low | Prediction bound loose; CRX spectrum garbled; references | Resolved: Lebesgue-constant prediction bound, CRX eigenvalues {0, 0, ±1/2} → frequencies {0, ±1/2, ±1} with least-common-unit rescaling, [8]/Sauvage verified, Anschuetz et al. 2023 added (03 §3.2, §12) |
| E-1 | critical | Only editor parse/execute moved to a worker; Lab sync handlers and other paths still exec in-process without project_root | Resolved: R-B scope is the explicit list of every user-code message, warm pool with cwd/sys.path, `LabJobManager._spawn` applies project_root (F-1), corpus program per path, list in `R_EXECUTION_MODEL.md` (§2.1 item 7, §5.1 R-B, §7) |
| E-2 | critical | LLM code runs with `process` isolation on the owner's box; file deletion possible | Resolved: `landlock` tier (ABI 8), mandatory AST pre-screen (`prescreen.py`), per-session consent with capability text, rmtree test per tier (§5.1 R-F, §4.8, §9 risk 4, 04 §0, §6.4, §7.1) |
| E-3 | high | `RLIMIT_AS` breaks numpy/rustworkx and macOS | Resolved: group-RSS ceiling via `procrun` for the run worker and `LabJobManager`, never `RLIMIT_AS`/`RLIMIT_NPROC`, per-OS behaviour, macOS test leg (§2.5, §5.1 R-B, F-1) |
| E-4 | high | Fresh interpreter per run costs 1.2 s; 3–5 execs per edit pause | Resolved: warm worker pool, latency budgets, code-hash loaded-circuit cache shared by parse/inspect/lint/detect/deploy_inspect, single-exec perf test (§2.1 item 7, §5.1 R-B) |
| E-5 | high | Same-wave ownership collisions (Wave 0 CI/corpus/executor; Wave 1 App.tsx/settings/onboarding/auth tests; Wave 4 lab_routes/labProject) | Resolved: runs of ≤ 4; R-D sole owner of `kernel-tests.yml` in Wave 0 with a glob corpus loader and per-unit directories; `adapters/binding.py` so R-A never touches executor/server; F-3 owns the 17 shims + `App.tsx`, R-G the settings/onboarding files; G2 has `test_kernel_auth_dev_origins.py`; F-1 populates all `LAB_ROUTES` prefixes; glob fixture registry; `check-wave-ownership.py` in Wave 0a (§5, §7) |
| E-6 | high | Spec ownership tables contradicted the master | Resolved: 01 §9, 02 §9, 03 §9, 04 §13 rewritten to name exactly the master's units and files, every shared-edit/marked-block instruction deleted, stale paths/test names/copy paths fixed, checker covers spec tables (§4.9) |
| E-7 | high | F-1 registries lacked the hooks features need; `jobs.py` unowned | Resolved: F-1 owns `jobs.py`: `register_analysis` (runner with partial emitter + cancel, width/needs-parameters), `register_result_hook` in `_terminal_message`, cumulative partials, `register_job_message`, `pkgutil` discovery in both processes with an agreement test (§2.5, §7 F-1) |
| E-8 | high | Real-kernel harness incompatible with the in-memory fixture root; Playwright not in CI; 13 vs 17 importers | Resolved: on-disk temp copies with a node fixture server reporting a real `project_root`; `lab-e2e-stub` + `real-kernel-e2e` jobs in `lab-e2e.yml` as gates from Wave 1; 17 shims owned by F-3 with the list in `R_EXECUTION_MODEL.md` (§5.2, §5.3) |
| E-9 | high | 1q constant wrong | Resolved with P-4 (02 §4.2) |
| E-10 | high | `ppe_noisy` reused `_filter_exact` early exits that ignore remaining channels; hook-vs-fork undecided | Resolved: noise-aware finalisation with suffix products + readout, union_before disabled under nonunital exact after the first damping, decision (b): default-None `channel_step`/`finalize` hooks in `ppe_core` gated by byte-identical PRD 14 tests (02 §2.3, §4.3) |
| E-11 | high | Light cone always wins at n ≤ 20; Goldilocks defaults scored at 8 | Resolved with P-1/P-9: `brute_force`, qubits [24, 32, 48] with screen at 24, config rejects n ≤ 20, exact Heisenberg cone (01 §2.6, §6) |
| E-12 | high | Joint verdict counted B/C; consistency paired f(x) with C(θ); quorum by near-duplicates | Resolved with P-6/P-7 (01 §2.9, §3.4) |
| E-13 | high | m ≤ 22 exact-ML cap excluded every bundled DEM | Resolved: F2 convolution over 2^{n_D+n_L}, gate n_D + n_L ≤ 24, manifest test for two applicable bundled DEMs, Appendix B fixed (04 §1.2, §2.2, §2.6, App. B) |
| E-14 | high | Verifier did not freeze the observable; physics test rewarded the global→local cheat | Resolved with P-17: observable resolved once, `observable_changed`, reversed test plus a real-improvement case (04 §6.1, §11.1) |
| E-15 | high | 1 MiB frame cap disconnects the Lab socket on large requests | Resolved: no files over the socket (kernel reads from `project_root`), candidates as edits with a 900 KB cap, inline datasets capped, client-side 1 MiB guard, handler-side `too_large` envelope with `max_size` backstop (§2.1 item 8, §4, 04 §7.3, 02 §3.1, 03 §5.5) |
| E-16 | high | `{calibration}` in `trainability_start` cannot work (singleton, `python -I` workers, pure normalisers, circular import, no timeout) | Resolved: jobs accept only fully resolved models; fetches only via the sync messages through `get_manager()` with a 20 s timeout and response cap; provenance records the frontend's sha256 (§2.4, 02 §5.1, §5.3) |
| E-17 | high | 12+ agents per wave exceed the 10-agent cap; Wave 0 gate needed venvs and G2 | Resolved: runs of ≤ 4 implementers + 2 batched reviewers; `make-test-venvs.sh` in Wave 0a; real-kernel gate from Wave 1 (§7) |
| E-18 | high | ⌘⇧S collides with Save As; lightbulb provider never registered; no code-action registry | Resolved: ⌘⇧E, shortcut-collision test, `codeActions/registry.ts` with one registration (F-3), per-feature provider files, wire-or-delete `quantumCodeActions.ts` (§2.7, 04 §10.2) |
| E-19 | high | `kernel/` script dir on `sys.path` shadows user modules | Resolved: `python -m kernel.server` / script-dir strip, worker `sys.path = [project_root, stdlib, site-packages]` with Nuclei modules purged from `sys.modules`, sibling-module corpus tests (§5.1 R-B) |
| E-20 | high | S1 owned `propose.py` which needs S2's `emit.py` | Resolved: `propose.py` + its test moved to S2+S3 (Wave 3a); §6 row and §4.5/§4.9 updated (03 §9) |
| E-21 | medium | Readout substitution frame; abstract observables | Resolved with P-12 (02 §2.4) |
| E-22 | medium | Twirl bound category and tightness | Resolved with P-11 (02 §2.6) |
| E-23 | medium | HKP factor 2 | Resolved with P-3 (03 §3.3) |
| E-24 | medium | MPS canonical form; single_size point value | Resolved with P-8/P-5 (01 §2.5, §2.9) |
| E-25 | medium | `import os` sandbox test is wrong | Resolved: `import subprocess` / `os.system` / `import socket` + pre-screen cases; `os.path.join` must still verify (04 §11.1, §12; §6) |
| E-26 | medium | Verify sandboxes orphaned on cancel; not counted; consent not passed; project reads | Resolved: `own_group=False`/pgid tracking, SIGTERM-then-SIGKILL, nested sandboxes counted, parallelism 2, isolation + consent in the job spec, project root read-only bind or `unverifiable: needs project files`, cancel test (04 §6.4) |
| E-27 | medium | Dataset loading: npz bombs, inspect parsing in-server, symlink TOCTOU, wrong memory guard | Resolved: header/zip checks before load, inspect stats only, `O_NOFOLLOW` + fd realpath, explicit 512 MiB Gram guard, Lab RSS ceiling (02 §3.1, §3.7, §4.4; F-1) |
| E-28 | medium | Emitted code injection; artifact stems; overwrite | Resolved: `repr`/`json.dumps` literals, safe identifiers, stem validation, `createFileExclusive` + confirmation, json-only weight loading, fuzz tests (03 §2.7, §3.7, §6.2, §7.1) |
| E-29 | medium | `NUCLEI_KERNEL_DEV_ORIGINS` widens origins from the environment | Resolved: DEV-flag-gated, loopback-only patterns, stripped in release by `configure_kernel_env`, tests in G2's own file (§5.2, §5.1 R-C) |
| E-30 | medium | Plan named a non-existent `dependencyStore`/banner; R-G lacked ownership of the files it must touch | Resolved: existing `missingDependencyStore.ts` + `onboarding/MissingDependencyBanner.tsx` extended; `EditorTabs.tsx`, QEC state components, `EvaluatorUnavailable.tsx`, settings/onboarding files added to R-G (§2.7, §5.1 R-G) |
| E-31 | medium | Bare `cancel {}` races; result field names disagreed; R-1 self-contradictory | Resolved: `run_id` on parse/execute, `run_cancel {run_id}` ignoring stale ids, one field set `measurements_source ∈ {sampled, sampled_from_statevector, none}` + `probabilities_exact` in §2.6 and §4.2, R-1 = `{}` / `none` / exact probabilities |
| E-32 | medium | Fixed qubit-count policy refuses legitimate 23–28-qubit sampled runs | Resolved: memory-estimate policy vs min(25 % RAM, setting), state vectors never above 16 qubits, `too_many_qubits` with estimate + Aer MPS action, corpus entries at 24 (ok) and 30 (refused) (§5.1 R-B, §4.2) |
| E-33 | medium | `SurrogateContext` lacked the noise model for `noisy_ppe` | Resolved: `noise_model`, `all_settings`, `n_qubits` on `SurrogateContext`; suite populates from `settings.noise`; job test for `quantumness.noise` (§2.3, 01 §3.2, §10) |
| E-34 | medium | Code pins 4-5 / 4-6 / 4-7 model ids; no migration unit | Resolved: `src/config/models.ts` registry with bare 5-5 aliases, F-3 migrates the four sites, no-hard-coded-id test (§2.7, §7 F-3) |
| E-35 | medium | Lab-wide cap undefined for Discovery; consent work unowned | Resolved: Discovery pool concurrency registers as slots in `total_running()`; kernel consent handling R-F, frontend runner + dialog F-3; `isolation_consent_required {run_id, candidate_id}` test (§2.5, §4.8) |
| E-36 | medium | "One @real spec per idea" needed Claude keys / hardware / missing fixtures | Resolved: deterministic real paths (seed evaluate + audit; seed decoder spec; AST proposer at a fixed seed; bundled snapshot; `t_gate_14.py` fixture owned by FE-N), each spec assigned to a named FE unit, E runs the matrix (§6, §7 Wave 5b) |
| E-37 | medium | Unrealistic default budgets (N = 4096 Gram, 3nN PPE calls, 65 536-point grids, Fourier oracle) | Resolved: `max_rows` 1024, PPE route N ≤ 128 subsampled with one compiled program, eigh once per kernel, deploy grid feasibility check with estimate, S6 oracle feasibility check, single-thread estimates, perf tests (02 §3.7, 03 §4.4, 01 §2.7) |
| E-38 | low | Old-kernel detection via timeouts; `unknown_message` lacks `request_id` | Resolved: `lab_capabilities` sync message (F-1) called once per session, 3 s fallback; `unknown_message` echoes `request_id` (§4, §4.3, 01 §4.3) |
| E-39 | low | Paths/names that do not exist (`ansatz.py`, `qec/NoiseModelLibrary*`, Rust file paths, `LabHeatmap`/`LabLine`, `gradient_map.py`, `light_cone_width(Stripped)`, `qec_stats.derive_seed`) | Resolved: every path corrected in the master and specs; F-3 adds `LabHeatmap`/`LabLineChart`/`IntervalBars` to `charts.tsx`; `strip()` moves with `light_cone_width`; `splits.derive_seed(seed, domain, distance, p)` defined (§2.7, §5.1, §7; 01, 02, 04) |
| E-40 | low | Coverage/minimal-venv/G3 gates had no mechanism | Resolved: pytest-cov `--cov-fail-under` (R-D) and vitest thresholds (X); `sys.modules['scipy'] = None` blocker over every new package; G3 installs the `release.yml` artifact on 24.04 (§3, §5.3) |
| E-41 | low | Run-worker env unspecified; R-7 shell restart missing | Resolved: full user env minus `KERNEL_SECRET_ENV` + `MPLBACKEND=Agg` + thread caps; shell health check with backoff + "kernel restarted" toast + cargo test (§5.1 R-B, R-C, R-G) |
| E-42 | low | Apply via `setCode` may not keep undo history | Resolved: `executeEdits` with `pushUndoStop` before/after through a `QuantumEditor`-registered command; e2e asserts one ⌘Z restores the exact baseline (04 §10.2, §11.4) |
| E-43 | low | `analyses_fingerprint` over all of `kernel/trainability/`; duplicated protocol versions; worker protocol unbumped | Resolved: explicit PRD 14 module list + per-feature fingerprints; ledger imports from provenance; `discovery/constants.PROTOCOL_VERSION = 2` with a worker check (§2.5) |
| E-44 | low | `featuremap.resolve` kept a second declaration reader depending on a later wave | Resolved: depends only on `kernel.trainability.declarations`; fallback reader and `load_model` dependency deleted (02 §4.3, §10) |
| E-45 | — | Citations: all checked ones exist; three misused (Wang constants, BGM for S5, Bravyi–Gosset for S3); four missing | Resolved: misuses corrected (P-7, P-20, P-22); Anschuetz & Kiani 2022, Anschuetz et al. 2023, Huang–Newman–Brown 2020, Newcombe 1998 added; every resolvable [verify] tag resolved (Cerezo, Larocca, Angrisani, Schuster, Thanasilp, Shaydulin & Wild, Nielsen, Varsamopoulos, Google 2025, Mele, LOWESA authors, Sauvage, Schuld PRA) |
| E-46 | — | Track R audit (00) prescribes `RLIMIT_AS` and a narrower worker scope | Answered: the audit is a scout report and is left as written with a supersession note at its top; the master's §5.1 is binding |
