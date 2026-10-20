# Brief — PRD 15 unit N1

Plan: docs/research/PRD_15_QUANTUMNESS_LAB.md (master). Specs: docs/research/PRD_15/*.md. This brief is your requirements; values in it are binding verbatim.

## Your unit (master plan rows — §5.1 Track R table and/or §7 wave table)

| **N1** Noise core | spec 02 N1 (frozen r ↔ p table, measurement-frame readout substitution, two twirl bounds, NIBP Thm. 1, gate-time policy) | `kernel/noise/{__init__,model,channels,schedule,densitymatrix,bounds}.py`, `kernel/tests/test_noise_{model,channels,schedule,densitymatrix,bounds}.py`, `kernel/tests/_noise_helpers.py` |

## Binding principles (master §2.1)
### 2.1 Principles (binding)

1. **One mechanism per concern.** One surrogate registry, one noise-model layer, one dataset loader, one declaration reader, one lab message router, one job counter, one real-kernel e2e harness. Specs that each proposed their own were edited (§4.3).
2. **Registries, not shared edits.** Every file that four specs wanted to append to (`_settings.py`, `job_worker.py`, `handlers.py`, `server.py`, `trainability.ts`, `AnalysisTabs.tsx`, `VerdictRail.tsx`, `TargetBar.tsx`, `CommandPalette.tsx`, `useDirac.ts`, `e2eFixtureBridge.ts`) becomes registry-driven in Wave 1 so later units add *their own* file and never touch a shared one. Two units in the same wave never own the same file (§7).
3. **Kernel computes; frontend renders.** No physics in TypeScript beyond view derivation. Every number crossing the socket carries method + interval/reason.
4. **Honest by construction.** `interval` fields are `[lo, hi]`; the TS lint test that greps components for `(lo + hi) / 2` (spec 03 §7.5) applies to every new component.
5. **Stock-venv first.** Every feature has a working path with `kernel/requirements.txt` only (numpy, websockets, ruff, keyring, qiskit, qiskit-aer, cirq-core). Optional packages widen, never gate (§3).
6. **Usable end to end.** Every feature: trigger → running/progress → cancel → result/error/unavailable states, a stub-kernel Playwright spec, and a real-kernel Playwright spec (§5.4, §8).
7. **User code runs in a worker, once per code version.** Every message that executes user code (§5.1 R-B's list) goes through the warm run-worker pool with `project_root` cwd/`sys.path`, RSS and wall limits; parse, inspect, lint, symmetry detection and deploy inspection share one code-hash-keyed loaded-circuit cache, so an edit pause executes the program once, not 3–5 times.
8. **No files over the socket.** Datasets, `.dem` files, shadow snapshot files and candidate programs are never shipped in a frame: the kernel reads them from the validated `project_root` with size caps, and candidates travel as SEARCH/REPLACE edits. The 1 MiB inbound cap closes the socket with 1009 and cancels every Lab job, so `labSession.ts` refuses to send a frame over 1 MiB with a visible error, and an oversized request yields an error envelope, never a disconnect (handler-side validation, `max_size` raised to 4 MiB as the hard backstop).


### 2.4 The ONE noise-model layer (`kernel/noise/` + `src/types/noiseModel.ts` schema 2)

- Kernel: spec 02 §4 as revised. `NoiseModel.from_json` is the only parser of wire noise models; presets and `*.noise.yaml` files are resolved **by the frontend** to JSON; calibrations are resolved **only** through the sync messages `trainability_calibration_to_model` / `hardware_calibration` (20 s timeout, response cap, strict parsing, via `kernel.hardware.manager.get_manager()`), whose reply the frontend stores and sends back as a fully resolved model with `source.sha256`/`fetched_at`. `trainability_start` **rejects** an unresolved `{"calibration": …}` (`noise_model_invalid`): job workers are `python -I` subprocesses with no provider state and a live fetch inside a job would make provenance non-reproducible.
- Consumers: idea 3 (`gradients_noisy`, `noise_sweep`, `scaling_noisy`, `simulability_under_noise`); idea 1 (`noisy_ppe` via `SUITE_EXTENSIONS`); idea 8 (optional `noisy_ppe` check in `trainability_verify` when the Lab has a model selected — name `kernel.noise.analyses.gradient_variances_noisy`); idea 7 (DEM sources generated through `qec_generate` take the same `noise/*.noise.yaml` library entries — schema 2 files with a `circuit_noise` block are shown with a "circuit noise" chip and hidden from sinter campaigns).
- Frontend: `src/types/noiseModel.ts` becomes a discriminated union on `schema: 1 | 2`; the existing QEC noise library UI lists both; the Trainability Lab's `NoisePicker` reads the same files. No second library.
- Not modelled, stated everywhere a noisy number appears: coherent errors, leakage, crosstalk, correlated errors, drift.


## Controller rulings for this unit (binding)
- Wave 1 starts from the merged Wave 0 base (Track R kernel done: run-worker pool, adapters, corpus, landlock sandbox). Read docs/research/PRD_15/R_EXECUTION_MODEL.md for the run model.
- Learn mode is deprecated: no Learn-mode work.
- Add corpus programs (if your unit executes user code) under kernel/tests/research_corpus/<your-unit>/.
- Your spec is docs/research/PRD_15/02_NOISY_TRAINABILITY_AND_KERNELS.md: read §2.1-§2.9 (math, binding), §4.1-§4.4 (module layout, frozen data structures, pure-function contracts, budgets), §7.1-§7.3 rows for N1 and the §9 N1 unit row; the master §10 review log entries naming spec 02 are binding corrections (1q p = 3r/2, 2q p = 5r/4, readout in the measurement frame, two twirl-gap bounds, NIBP Thm. 1 constants).
- numpy only (no scipy at import time).
