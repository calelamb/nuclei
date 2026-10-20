# R-B report: warm run-worker pool (Wave 0b)

Branch `prd15/r-b` (worktree `.worktrees/prd15-u/r-b`), base `ba46f42`, head `dec9682`.

## What was implemented
Design note committed first as `docs/research/PRD_15/R_EXECUTION_MODEL.md` (with a new "Implementation decisions" block, D13-D24), then its section 11 order:

1. Corpus `kernel/tests/research_corpus/r_b/` (rb01-rb23) landed RED as strict xfails.
2. `kernel/framework_detect.py` (R-3, AST based; post-exec scan by circuit type).
3. `kernel/project_paths.py` (R-9 validation), in-process `user_exit`/real `__main__` (R-7/R-10), `kernel/run_memory.py` (R-11 estimate policy + lean path), `KernelError.extra`.
4. Pool: `run_worker.py` (lanes, spares, coalescing, cancel, wall/RSS/CPU, death classification), `run_worker_proc.py` (spawn, control channel, marker splitting, output cap), `run_worker_main.py` (worker), `run_context.py` (user context, freshness reset, kernel-module hiding, dep recorder), `run_cache.py`, `run_ops.py`, `run_ipc.py`, `run_winjob.py`.
5-9. `run_routes.py` + `server.py`: parse/execute/run_python/transpile/debug_trace/qec_snapshot/qec_materialize/qec_estimate/run_cancel and hardware_submit routed through the pool; `run_ops_builtin.py`, `run_figures.py`, `run_hardware.py`, `preview_static.py`; Lab `trainability_inspect`/`_lint` as worker ops (`call_op`), `lint_result.available`.
10. Tripwire (`run_context.forbid_inprocess_exec()` in `server.main()`), dead SIGALRM code removed, latent `transpile` NameError fixed, macOS CI job appended to `kernel-tests.yml`.

## TDD evidence
- RED corpus: `NUCLEI_CORPUS_ENV=full pytest kernel/tests/test_research_corpus.py -k r_b` -> `22 xfailed, 1 skipped` (every rb program failed as its ledger said: e.g. rb03 timeout + dead connection, rb04 `closed`, rb05-07 `timeout`, rb08 `error:no_circuit`, rb01/rb02/rb09-rb14 `execution_error`/`unsupported_framework`). Expected: none of the hazards were handled.
- RED unit: `test_framework_detect.py` -> `ModuleNotFoundError: No module named 'kernel.framework_detect'` before the module existed; same pattern for `test_project_paths.py`.
- Note: for the in-process executor changes and some pool tests the tests were written alongside the code rather than strictly before it; the corpus RED run is the failing-first evidence for those behaviours.
- GREEN: same command after the work -> `22 passed, 1 skipped` (rb16 needs Xvfb; covered by `test_plt_show_with_display_returns_fast` with `DISPLAY=:99`).

## Results
- Kernel suite (dev venv, qiskit 1.4.6): `3164 passed, 17 skipped` (baseline before the work: all green, ~7 min; now ~10.7 min).
- Corpus, zero unexpected statuses: env `full` `88 passed, 3 skipped, 22 xfailed`; env `min` same; env `qk2` (app-env venv) same. Remaining xfails are R-A's (R-1, R-2, R-4, R-13).
- Minimal venv, new files + executor + docs fixtures: `325 passed, 97 skipped`.
- New tests: `test_run_worker.py` (47 pool + 64 every-path cases), `test_executor_run_path.py` (53), `test_framework_detect.py` (44), `test_run_cache.py`, `test_run_memory.py`, `test_project_paths.py`, `test_preview_static.py` (incl. static-equals-exec over the whole corpus). Perf tests (marked `slow`) pass: parse p50 over program time, static parse, Run overhead <= 300 ms, lint warm <= 0.35 s.

## Acceptance items
while True -> timeout for every path in the list (one case per path x {sibling import, relative data read, while True, os._exit}); run_cancel < 1 s with no spinning descendant; stale cancel ignored (finished/unknown/other owner); sys.exit/exit()/quit() -> user_exit, os._exit -> worker_died, listener alive; 5 queued parses do not delay Run; single exec with parse + inspect + lint (+ fake symmetry/deploy/learned ops); sibling kernel/noise/models/symmetry shadow Nuclei's; run-dir write; traversal refusal (5 cases); main guard; n=30 -> too_many_qubits < 1 s warm; n=24 sampled; RSS ceiling -> too_much_memory; plt.show with DISPLAY; Pool.map on an editor function (saved/unsaved x spawn/default); 100k lines truncated with a note; table-driven detection; macOS job added.

## Files changed
New: `kernel/{framework_detect,project_paths,preview_static,run_cache,run_context,run_figures,run_hardware,run_ipc,run_memory,run_ops,run_ops_builtin,run_routes,run_winjob,run_worker,run_worker_main,run_worker_proc}.py`; tests `kernel/tests/{test_framework_detect,test_project_paths,test_preview_static,test_run_cache,test_run_memory,test_run_worker,test_executor_run_path}.py`, helpers `_pool_test_ops.py`, `_run_pool_fixtures.py`, `_run_server_helpers.py`, `_fake_lab_ops.py`; `kernel/tests/research_corpus/r_b/**` (programs, expected.yaml, overrides.yaml); the design note.
Modified: `kernel/executor.py`, `kernel/server.py`, `kernel/models/errors.py`, `kernel/trainability/{handlers,_usercode}.py`, `kernel/qec/{materialize,estimate}.py`, `kernel/hardware/simulator_provider.py`, `.github/workflows/kernel-tests.yml` (append-only), and two existing tests (below).

## Decision: lines
- Decision: D13-D24 in the design note (memory policy in `Executor.execute`; un-id'd requests answered in order; no bytecode writes in workers; bounded deferred detection; `limits.wall_s` for every op; file split; /proc scans; `extra` on errors; Bloch for exact lean path n<=20; stim text kept server side; Lab ops via `call_op`; figures rendered inside the user context).
- Decision: `test_executor.py::test_resolve_framework_is_lexical_selection...` asserted the old regex behaviour (a comment counted); renamed and changed to `cirq` because the design deliberately makes comments/strings not count.
- Decision: `test_trainability_handlers.py` gets the `inprocess_mode` fixture on its 3 lint tests that inject a fake `kernel.trainability.lint` (design risk 10).
- Decision: scout `z04` is flipped with `limits.wall_s: 3` (default Run wall stays 600 s); `g01`/`rb18` use `max_seconds: 3` for the cold-start case, the strict <1 s bound is `test_n30_too_many_qubits_fast`.
- Decision: `AdapterSpec.detect_pattern` kept (third-party adapters per the docs, existing tests); `Executor._last_qec_circuit` kept for in-process callers.
- Decision: `kernel/models/__init__.py` not touched (R-A may edit it); `error_payload` is imported from `kernel.models.errors`.

## Self-review findings (fixed)
Static preview initially hid `transpile()` results and `draw('mpl')` failures (caught by the corpus-wide equivalence test; fixed); same-second sibling edits were served from stale `.pyc` (fixed with `dont_write_bytecode`); figures were closed before capture (rendered inside the user context); fake-socket replay lost replies (ordered inline replies + drain).

## Concerns (DONE_WITH_CONCERNS)
- File sizes over 800-line guidance: `executor.py` 1031 (was 974), `run_worker.py` 745, `run_context.py` 705, `server.py` 896 (was 1214). Not restructured.
- Integration with R-A: `r_b/overrides.yaml` re-adds an R-2/R-4 ledger for scout q09-q13 (parse now works, execute still R-A's). If R-A's overrides flip those to `xfail: null`, drop my q09-q13 stanza at merge (units apply in sorted order, `r_b` after `r_a`). `Executor._bind_parameters` imports `kernel.adapters.binding.bind_parameters` and is tested only with a stub; R-A's `SimulationResult` should later carry `measurements_source`/`probabilities_exact` (lean path sets them itself; the n<=16 path leaves them to R-A). The lean path should be folded into the adapters after R-A.
- Windows (Job Object, loopback control channel) and macOS (`ps` scans, no PDEATHSIG) paths follow the note but were not exercised here; the macOS CI job is added, Windows has no job.
- `check-wave-ownership.py` must learn the new files (design D11/D18) at the Wave 0b gate.
- docs-site pages (`messages-execution.mdx` still describes the SIGALRM timeout; v1.4 fields, `run_cancel`, new error codes) belong to unit X; `lint_result.available` is implemented kernel side (R-C's acceptance test not run here).
- rb16/g03 need Xvfb and are skipped locally; the same behaviour is asserted by `test_plt_show_with_display_returns_fast`.
- First Run after kernel launch waits ~1.3 s for its warm worker (pool starts after the ready line, per the note); consecutive Runs within ~1.3 s pay a spawn (`timing.spawn_wait_ms`).


## Fix report, review round 1 (head dec9682 -> 9101bd0)

Branch `prd15/r-b`, one commit. Findings 1-7 fixed; the SPEC gaps named in the review are the same items. Tests were written with or just after the fix for items 1-3 (RED was shown only for items 4-6 against the old `run_memory.py`: `unknown instruction: EfficientSU2-164`, `unknown instruction: QFT`, and the peak-RSS test at 1.34 GB growth vs 201 MB estimate).

1. **RLIMIT_CPU armed** (`run_worker.py`): `RunPool._ctx_with_cpu` gives every request `limits.cpu_s = ceil(wall) + CPU_HEADROOM_SECONDS` unless the ctx carries one (copy, the caller's ctx is untouched); `PoolConfig.cpu_headroom_s` exists so tests can make it reachable. Tests: `test_cpu_limit_is_armed_and_kills_a_spinning_program_as_a_cpu_timeout` (a real SIGXCPU -> `timeout`, `reason: cpu`), `test_pool_arms_cpu_as_wall_plus_headroom...`, `test_headroom_override_makes_a_default_cpu_limit_reachable` (no explicit `cpu_s`: the default path).
2. **One group-RSS mechanism**: `procrun.group_scan(pgid) -> (count, rss)` holds the /proc fast path and the only `_ps_scan`; `group_rss_bytes` is its RSS half; `run_worker_proc.scan_group/_ps_scan` deleted, the pool imports `group_scan`. Tests in `test_discovery_procrun.py` (live group, unknown group, pool uses procrun's function).
3. **Typed adapter errors reach the wire** (`executor.py`): `_capability_error` passes any exception with `code in {unbound_parameters, unsupported_instruction}` through with `severity` and `parameters`/`instruction` in `extra` (so every call site benefits, not just the two named); `_bind_parameters` always calls `bind_parameters(circuit, parameter_values or None)` for qiskit/cirq. Tests with stubs mirroring R-A's classes: executor level, simulate level, untyped errors unchanged, and `execute_op` -> `error_payload` frame `{type: error, code: unbound_parameters, severity: info, parameters: [...]}`.
4. **CUDA-Q / third-party adapters above 16 qubits**: `plan_simulation` returns mode `adapter` for any framework outside `{qiskit, cirq}` (and not native): no estimate, `adapter.simulate` runs, `shape_adapter_result` applies the lean wire policy (no state vector, probabilities capped, `truncated`). Tests: plan for `cuda-q`/`my-adapter` with RAM forced tiny, executor `_simulate` with a fake adapter, probability cap.
5. **Lean path no longer bypasses the adapter pipeline**: Aer runs go through R-A's `prepare_for_aer`/`run_on_aer` when present (merge) else `transpile(optimization_level=0)`. Tests: measured `EfficientSU2(18)`, exact `QFT` at 17 qubits; corpus program `rb24-efficientsu2-18-measured` (passes in env full/min, no xfail since the fix lives in R-B's lean path).
6. **Lean exact path memory**: `top_indices` selects the K best with `np.partition` before any Python object exists (ties by index, same order as before); `COPIES_EXACT` 3 -> 4. Test `test_peak_memory_of_a_dense_exact_run_stays_near_the_estimate` (H on 22 qubits in a subprocess): growth 117 MB vs 268 MB estimate, old code 1342 MB vs 201 MB. Plus brute-force equality test of `top_indices` incl. ties.
7. **Every-path acceptance is no longer vacuous**: for the benign hazards every path must now show positive proof the program ran (`SUCCESS_FRAME` per path; simulator job `complete` with no error; device submit must produce exactly `Provider 'ibm' is not connected`, which only appears after the worker prepared the circuit; `qec_estimate` runs a T-gate program and must return `qec_estimate_result`; no frame may mention `ModuleNotFoundError`/`FileNotFoundError`/the sibling or data file). The exemption for `qec_estimate` is gone.

Found by the stronger test and fixed: `transpile` sent through the pool carried `optimization_level=None` (the original server defaulted and validated it), so every transpile without the field failed with `Invalid optimization level None`. `run_routes._transpile_target` restores the boundary validation (tests added).

Also added: `test_future_lab_ops_share_one_execution_per_code_version` (parse + fake symmetry_detect/propose/deploy_inspect/learned_sources execute the program once; review minor 10); `test_n30_too_many_qubits_fast` now runs on a kernel with `NUCLEI_SIM_MEMORY_LIMIT_MB=2048` (minor 11); design note amended (D25, memory section, `group_scan`).

### Commands and output
- `./.venv/bin/python -m pytest kernel/tests -q` -> `3192 passed, 18 skipped` (before: 3164 passed).
- `NUCLEI_CORPUS_ENV=full $(scripts/make-test-venvs.sh path full) -m pytest kernel/tests/test_research_corpus.py -q` -> `89 passed, 3 skipped, 22 xfailed` (rb24 added, zero unexpected statuses).
- same with `NUCLEI_CORPUS_ENV=min` and the minimal venv -> `89 passed, 3 skipped, 22 xfailed`.
- not re-run: the qk2 (app-env) corpus; macOS/Windows legs.

### Not fixed (minor findings, out of the fix scope)
8 ownership ratification (controller), 9 run-dir permissions/reaping, 12 un-id'd clients' 600 s wall (R-G hand-off), 13 Lab error-code collapse (the Lab wire vocabulary is not R-B's), 14 `call_user` blank source, 15 static-preview framework choice, 16 `_threads` growth, 17 dead code, 18 file sizes, 19 TDD gap (acknowledged above), 20 `rb20` name.
