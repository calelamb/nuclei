# Brief — PRD 15 unit R-G

Plan: docs/research/PRD_15_QUANTUMNESS_LAB.md (master). Specs: docs/research/PRD_15/*.md. This brief is your requirements; values in it are binding verbatim.

## Your unit (master plan rows — §5.1 Track R table and/or §7 wave table)

| **R-G Reliability frontend** (Wave 1b) | Stop button + `Running… (12 s)` state for editor runs and Experiment sweeps (`run_cancel {run_id}`); "N free parameters — Run at point…" (zeros / user point / seeded random) instead of a red error; histogram "no measurements in this circuit; showing exact probabilities"; `too_many_qubits` card with the estimate and "Use Aer MPS / run in the Lab"; `truncated` badge; inline Figures panel; "Linting off (ruff not installed) [Install]"; "kernel restarted" toast; R-15 `missing_dependency` routed from **every** kernel session (`kernelSession.ts`, `labSession.ts`) into the **existing** `missingDependencyStore.ts` (extended) + `MissingDependencyCard`; the 1 MiB client-side frame guard in `labSession.ts`; "Open logs" in Settings; Research catalog group offered in research onboarding | `src/hooks/useKernel.ts`, `src/services/kernelSession.ts`, `src/services/lab/labSession.ts`, `src/stores/missingDependencyStore.ts`, `src/stores/runStore.ts` (new), `src/components/common/MissingDependencyCard.tsx`, `src/components/onboarding/MissingDependencyBanner.tsx`, `src/components/onboarding/FrameworkSetup.tsx`, `src/components/editor/RunControls.tsx` (new), `src/components/editor/EditorTabs.tsx` (mounts `RunControls`), `src/components/histogram/**`, `src/components/output/FiguresPanel.tsx` (new), `src/components/qec/**` state components, `src/components/discovery/EvaluatorUnavailable.tsx`, `src/services/experimentRunner.ts` (cancel + project_root + file_path), `src/components/settings/**` (logs, lint-off; `EnvironmentPanel.tsx` consumes F-3's shims), vitest for each | vitest for every state; Playwright stub spec `run-states.spec.ts`; real-kernel specs 1–6 of audit G2; a frame > 1 MiB is refused client-side with a visible error |
| **R-G** Reliability frontend | §5.1 (existing `missingDependencyStore`, `EditorTabs`, settings/onboarding files, QEC state components, `EvaluatorUnavailable`, 1 MiB guard) | §5.1 list |

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


### 4.2 Execute path (Track R; phases `parse` / `execute`)

| Request | Response | Notes |
|---|---|---|
| `parse {run_id, code, language?, project_root?, file_path?}` | `snapshot` (+ `qec_snapshot`) or `error` | superseded parses are dropped (`parse_superseded` is never sent to a stale request; the newest wins); cached by code hash in the loaded-circuit cache shared with inspect/lint/symmetry_detect/deploy_inspect |
| `execute {run_id, code, language?, params?, seed?, parameter_values?: {name: number} \| {"random_seed": int}, project_root?, file_path?}` | `result` gains `measurements_source: "sampled" \| "sampled_from_statevector" \| "none"`, `probabilities_exact: bool`, `bound_at?: {name: value}`, `truncated?: {state_vector: bool, probabilities: bool, reason}`, `figures?: [{png_base64, title}]`, `metrics`, `seed_honored`. R-1 (no measurements): `measurements = {}`, `measurements_source: "none"`, exact probabilities present (`probabilities_exact: true`) | R-1, R-4, R-11, R-12 |
| `run_cancel {run_id}` | `run_cancelled {run_id, accepted}` then the pending `error {code: "cancelled"}` | R-6; kills that run's worker; a cancel for a finished or unknown `run_id` is ignored (`accepted: false`) so Stop clicked as a run finishes never kills the next run |
| `lint` | `lint_result` gains `available: bool, reason?` | R-16 |
| new error codes | `unbound_parameters` (info-class, carries `parameters`), `too_many_qubits` (with the memory estimate and the `method=matrix_product_state` re-run action), `timeout`, `user_exit`, `worker_died`, `too_much_memory`, `unsupported_instruction` (names the gate), `output_truncated` note on `output` frames | R-4, R-11, R-6, R-7, R-2, R-22 |


## Audit items you close (docs/research/PRD_15/00_RELIABILITY_AUDIT.md)

### R-15 (Med) Missing-dependency UX is only wired for the editor
- Symptom (code): `useKernel.ts:245-247` reports `missing_dependency` to `MissingDependencyBanner`. Lab, Discovery, QEC campaign/generate and Estimator sessions use other sockets (`kernelSession.ts`, `lab/labSession.ts`) and surface the same error as an opaque message string (`grep -rn missing_dependency src` finds no other consumer). The owner's venv lacks stim/sinter/pymatching, so QEC Studio and the `qec_memory` Discovery evaluator are unavailable; the kernel messages are correct (verified), the discoverability is not. PRD 15 ideas 7/8 add more optional dependencies.
- Fix: route `missing_dependency` from every kernel session into the shared store, and give each panel an "unavailable: needs stim, pymatching [Install]" state with the catalog entry resolved via `framework_resolve`. Add the Research catalog group (stim, sinter, pymatching) to onboarding for `onboarding_path: research`.
- Regression tests: Playwright against a stub that returns `missing_dependency` from each panel; real-kernel test on the `min` venv.


## Controller rulings for this unit (binding)
- Wave 1 starts from the merged Wave 0 base (Track R kernel done: run-worker pool, adapters, corpus, landlock sandbox). Read docs/research/PRD_15/R_EXECUTION_MODEL.md for the run model.
- Learn mode is deprecated: no Learn-mode work.
- R-C shell contract: listen for Tauri events kernel-restarted / kernel-restart-failed, re-fetch kernel_auth_token after every restart (the token rotates), show the kernel-restarted toast; the open_logs command returns the log folder path.
- unbound_parameters arrives as an error frame with severity 'info' and parameters [...] - render the 'N free parameters - Run at point...' prompt, not a red error.
- Settings: you own src/components/settings/** except src/config/settingsRegistry.ts (F-3).
- snapshot_error: a `snapshot` frame (from `parse` or `execute`) may carry `data: null` plus `snapshot_error: "snapshot unavailable: <why>"` (a string) when the diagram could not be extracted; the run still proceeds and no `error` follows. Render "Diagram unavailable: <message>" instead of a blank diagram (useKernel.ts:105 currently blanks it).
