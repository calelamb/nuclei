# Brief — PRD 15 unit F-1

Plan: docs/research/PRD_15_QUANTUMNESS_LAB.md (master). Specs: docs/research/PRD_15/*.md. This brief is your requirements; values in it are binding verbatim.

## Your unit (master plan rows — §5.1 Track R table and/or §7 wave table)

| **F-1** Kernel protocol foundations | `lab_routes.py` with **all five prefixes** (lazy, `family_unavailable`); `lab_protocol.py` v1.4 catalog + `lab_capabilities` + `project_root`/`file_path` resolution + per-handler payload caps / `too_large` + `max_size` backstop + `unknown_message` echoing `request_id`; `lab_proc.register_manager/total_running` (Discovery pool slots, nested sandboxes), **group-RSS ceiling and `project_root` cwd/`sys.path` in `LabJobManager._spawn`**; `provenance.PROTOCOL_VERSION = "1.4"` + fingerprint registry + scoped `analyses_fingerprint` + ledger/constants version imports; `_settings.register_section`; **`jobs.py` hooks** (`register_analysis` with partial emitter + real cancel + width/needs-parameters fields, `register_result_hook`, cumulative partials, `register_job_message`) and `pkgutil` discovery of `analyses_*.py` in `handlers.py` and `job_worker.main`; `handlers.register_sync`; `server.py` lab routing + `hardware_calibration` branch + `-m` launch; `kernel/hardware/manager.get_manager()`; `declarations.py`; `dataset.py` (header/zip checks, `O_NOFOLLOW`, inspect-stats-only); `discovery/diff_apply.py`; prefix-parametrized auth/isolation tests | `kernel/lab_routes.py`, `kernel/lab_protocol.py`, `kernel/lab_proc.py`, `kernel/server.py` (lab/hardware branches), `kernel/trainability/{provenance,_settings,jobs,job_worker,handlers,declarations,dataset}.py`, `kernel/hardware/{base,manager}.py`, `kernel/discovery/{diff_apply,constants}.py`, `kernel/discovery/conjecture/ledger.py` (version import), `kernel/tests/test_lab_routes.py`, `test_lab_protocol.py`, `test_trainability_jobs.py`, `test_trainability_declarations.py`, `test_trainability_dataset.py`, `test_lab_token_isolation.py`, `test_kernel_auth.py`, `test_lab_job_robustness.py` |

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


### 2.5 Shared job / progress / cancel / provenance

- Every long operation is a `LabJobManager` subclass job in a subprocess (`python -I`, minimal env, process-group kill, 20-min wall, CPU limit, **and — new, F-1 — a group-RSS memory ceiling** via `procrun.group_rss_bytes` poll-and-kill (`worker_died` / `too_much_memory`), plus `project_root` → cwd / `sys.path` / `__file__` applied in `LabJobManager._spawn` for every Lab job worker so multi-file research projects work in the Lab). Managers: trainability (ideas 1, 3, 4, 8), symmetry (5), deploy (6), qec_learned (7), discovery (2, 7-evaluator). `lab_proc.register_manager(manager)` + `lab_proc.total_running()` enforce the **Lab-wide cap of 4** running jobs, counting nested verify sandboxes; per-manager caps stay (`qec_learned`: 1 per owner, 2 global). **Discovery** is a queue-based `DiscoveryManager` with a pooled sandbox, not a `LabJobManager`: it registers its pool concurrency (default 2) as that many slots in `total_running()` (documented), so the cap is defined across every family.
- Stream shape for every job family: `<family>_started {job_id}` → `<family>_progress {job_id, stage|analysis|decoder, fraction, message}` (≤ 10/s) → `<family>_partial {job_id, ..., result}` → terminal `<family>_result {job_id, status: complete|cancelled|failed, results, errors, elapsed_ms, provenance}`; `<family>_cancel {job_id}` → `<family>_cancelled {job_id, accepted}`. Closing the socket cancels the connection's jobs (`LabContext`).
- Track R brings the **editor run path and every other user-code path** onto the same model: the `run_worker.py` warm pool with `run_cancel {run_id}` → `run_cancelled`, `timeout`, `worker_died`, `too_much_memory` (group-RSS ceiling — **never `RLIMIT_AS`**, which `kernel/agent_limits.py` records as breaking numpy/BLAS and rustworkx and which macOS rejects; **never `RLIMIT_NPROC`**, which breaks rayon).
- Provenance: `build_provenance` (PRD 14 addendum §D) + `nuclei_protocol: "1.4"` + per-feature fingerprints registered through `provenance.register_fingerprint(name, globs)` (`suite_fingerprint`, `noise_fingerprint`, `qkernel_fingerprint`, `symmetry_fingerprint`, `deploy_fingerprint`, `decoders_fingerprint`, `verify_fingerprint`). `analyses_fingerprint()` is **scoped to an explicit list of the PRD 14 analysis modules** so PRD 15 files in `kernel/trainability/` never change the PRD 14 certificate fingerprint; `conjecture/ledger.py` imports `PROTOCOL_VERSION` from `provenance` instead of keeping its own; `discovery/constants.PROTOCOL_VERSION` bumps to 2 with a worker-side check for the new `decoder_spec`/`module_circuit` tasks. Determinism contract everywhere: same inputs + seed → bit-identical JSON except `elapsed_ms`; seeds domain-separated by SHA-256 (each feature defines its own `derive_seed(seed, domain, …)`; `qec_stats.derive_seed(seed, distance)` is not a domain-string API).
- **Job hooks (F-1, `kernel/trainability/jobs.py`)** — the registries features actually need: `register_analysis(name, runner(job, progress, emit_partial, cancel), width_check, needs_parameters)` (today's `_check_width` / `_NEEDS_PARAMETERS` become registry fields and `run_job` passes a real cancel and a partial emitter); `register_result_hook(name, fn(results, request) -> dict)` for top-level fields such as `quantumness` and `quantumness.noise`, assembled in `jobs._terminal_message` so a cancelled (SIGKILLed) job still carries them; **per-analysis cumulative partials** (`job.results[analysis]` keeps the last partial, flagged `complete: false` on cancel — needed by spec 01's "Cancelled after k of N surrogates", qkernel's per-stage partials and verify's per-candidate records); `register_job_message(type, request_builder, result_assembler)` for `trainability_verify`, whose request shape is not `_build_request`'s. Discovery of `kernel/trainability/analyses_*.py` is a `pkgutil` auto-import in both `handlers.py` (server: settings sections, sync handlers) and `job_worker.main` (runners), with a test asserting the two registries agree.
- Frontend: every feature's client wraps the shared `LabSession` (`src/services/lab/labSession.ts`, one authenticated socket per Lab) with `request_id` matching for sync calls and a job event stream for jobs, exactly like `src/services/trainability/client.ts`. Status chips (`LabStatusChips`) and `ModeSwitchGuard` read a **job registry** (`src/services/lab/jobRegistry.ts`, Wave 1) so each feature registers its running-job selector instead of editing the chips.


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


## Controller rulings for this unit (binding)
- Wave 1 starts from the merged Wave 0 base (Track R kernel done: run-worker pool, adapters, corpus, landlock sandbox). Read docs/research/PRD_15/R_EXECUTION_MODEL.md for the run model.
- Learn mode is deprecated: no Learn-mode work.
- Add corpus programs (if your unit executes user code) under kernel/tests/research_corpus/<your-unit>/.
- Read docs/research/PRD_15/02 §5, 01 §4-5, 03 §5, 04 §8 for the per-family message shapes; you build the ROUTER, catalog, registries and hooks they plug into — not the feature handlers themselves.
- server.py: R-B (Wave 0b) rewrote the parse/execute branches; you own only the lab/hardware routing branches and must keep R-B`s pool routing intact.
