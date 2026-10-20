# R-B review, round 1

Unit: R-B Execution model (Wave 0b). Branch `prd15/r-b`, base `ba46f42`, head `dec9682` (8 commits, 71 files, +7880/-668).
Package: `reviews/R-B-r1.diff` (read once). Outside-diff checks, each tied to a named risk:
- `kernel/discovery/procrun.py`: does `group_rss_bytes` exist? It does, so the "RSS via procrun" requirement is checkable.
- `kernel/tests/conftest.py` and `kernel-tests.yml`: are `slow` perf tests deselected in CI? No, they run by default.
- `executor._capability_error`: does it pass adapter error codes through? It does not.
- R-A worktree `kernel/adapters/{errors,binding}.py`: R-A raises typed `UnboundParametersError` with `code`, `severity` and `parameters`. `bind_parameters` handles the `{"random_seed": n}` dict itself. R-A does not touch `executor.py`.
- grep for `cpu_s` producers: is RLIMIT_CPU ever armed? It never is.
- grep for remaining server-process exec callers: tripwire coverage is complete for the listed paths.
- Adapter `find_circuit` vs `preview_static._find`.

## Verdict

- **Spec compliant: no.**
- **Quality: needs fixes.**

The core design is implemented and substantial:
- a warm spawned-worker pool with two lanes;
- coalescing, `run_id` / `run_cancel` and stale-cancel handling;
- `__main__` / `sys.path` / cwd isolation with the kernel package hidden from user code;
- the loaded-circuit cache with file deps, and the static AST fast path;
- the R-11 estimate and refusal;
- figures, the output cap, the tripwire, and AST detection.

The tests are broad and mostly assert real behaviour against a real kernel process. However:
- one mandated limit (RLIMIT_CPU) is dead code;
- the group-RSS mechanism duplicates `procrun` instead of using it;
- the `unbound_parameters` wire shape cannot be produced by R-B's executor;
- the >16-qubit lean path breaks CUDA-Q and reintroduces R-2 and an R-11-style Python-object blowup;
- part of the every-path acceptance test asserts nothing.

## Spec compliance (file by file vs the brief and controller rulings)

Owned and touched as required:
- `executor.py`, `run_worker.py`, `framework_detect.py`, `server.py`, `trainability/_usercode.py`;
- `tests/test_run_worker.py`, `tests/test_framework_detect.py`, `tests/test_executor_run_path.py`;
- `research_corpus/r_b/**`;
- `docs/research/PRD_15/R_EXECUTION_MODEL.md` (first commit; D13-D24 recorded; carries the exec-path list and the 17-importer shim list);
- D11 files: `trainability/handlers.py` (sync paths only), `qec/materialize.py`, `qec/estimate.py`, `hardware/simulator_provider.py`, `models/errors.py`;
- `kernel-tests.yml` (append-only macOS job).

No listed file is untouched.

Done (verified in the diff):
- **R-3:** AST detection, table test, post-exec type scan.
- **R-6:** pool, wall clock, `run_cancel` and the stale-cancel rule.
- **R-7:** `user_exit` / `worker_died`.
- **R-8:** coalescing, static path, `slow` / `elapsed_ms`; queued parses sit on a separate lane from Run.
- **R-9:** `project_paths` with traversal and symlink refusal, plus run dir.
- **R-10:** real `__main__`.
- **R-11:** estimate and refusal with the MPS action, `truncated`, state vector withheld above 16 qubits.
- **R-12:** Agg, figures.
- **R-20:** spawn-safe `__main__`.
- **R-22:** 256 KiB cap with an `output_truncated` note.
- `lint_result.available`.
- The latent `transpile` `spec` NameError is fixed.
- Tripwire in `server.main()`.
- Corpus flips go through `r_b/overrides.yaml` only.

Missing / misunderstood: Important findings 1-3 below.

Extra / outside ownership: Minor finding 8.

## Findings

### Important

1. **RLIMIT_CPU is never applied (dead limit).**
   - **Where:** `kernel/run_context.py:572` (`_set_cpu_limit` returns early when `request.cpu_s is None`), `kernel/run_routes.py:151` (`_limits` keeps only `wall_s` / `memory_mb`), `kernel/run_worker.py` (`call_op` and `_supervise` add no `cpu_s`).
   - **What:** Nothing ever puts `limits.cpu_s` into a request's ctx, so `RLIMIT_CPU` is never set. `CPU_HEADROOM_SECONDS` is unused, and the SIGXCPU → `timeout(reason=cpu)` branch in `_died` is unreachable.
   - **Why it matters:**
     - The brief lists `RLIMIT_CPU` among the mandatory limits.
     - The design note (§2.7 "wall + 60 s"; risk 8) relies on it to bound an orphaned macOS worker, which has no PDEATHSIG and does not read its control socket while user code spins.
     - No test covers it.
   - **Fix:** in `RunPool._supervise`, set `ctx["limits"]["cpu_s"] = ceil(wall) + CPU_HEADROOM_SECONDS` for every request. Add a pool test with a tiny wall override and `cpu_s` that asserts `timeout` with reason `cpu`.

2. **The group-RSS ceiling does not use `procrun`, and the macOS scan is a verbatim copy of it.**
   - **Where:** `kernel/run_worker_proc.py:394` (`scan_group`) and `:421` (`_ps_scan`) vs `kernel/discovery/procrun.py:82` (`group_rss_bytes`).
   - **What:** The brief says "group-RSS ceiling via `procrun`", and master §2.1-1 says one mechanism per concern. `_ps_scan` is the same `ps -ax -o pgid=,rss=` parse, line for line. Decision D19 (a /proc fast path) does not justify a second copy.
   - **Why it matters:** two RSS mechanisms will drift. A fix to one, for example a cgroup-aware or Windows path, will not reach the other.
   - **Fix:** extend `procrun` with the /proc fast path and a `(count, rss)` variant (`group_scan(pgid)`), and import it from the pool. Delete `_ps_scan`.

3. **`unbound_parameters` / `unsupported_instruction` cannot reach the wire in the ruled shape.**
   - **Where:** `kernel/executor.py:556` (`_bind_parameters`: `except Exception` → `_capability_error(None, exc, "adapter_error")`), `:574` (`_simulate`: `except Exception` → `simulation_error`). Binding is skipped entirely when `parameter_values` is empty.
   - **What:** R-A raises typed errors (`kernel/adapters/errors.py`: `code`, `severity`, `parameters` / `instruction`) and does not own `executor.py`. R-B's executor maps every exception to `adapter_error` or `simulation_error`, so `code`, `severity: "info"` and `parameters` are dropped.
   - **Why it matters:**
     - The wire-shape ruling and global constraint 3 require `{type: "error", code: "unbound_parameters", severity: "info", parameters: [...]}`.
     - Design note §6.1 says "R-B passes them through".
     - After merge, q10 stays `simulation_error`; R-B's own override already records this.
   - **Fix:**
     - In `_bind_parameters`, always call `bind_parameters(circuit, parameter_values or None)`.
     - In both catch sites, if `getattr(exc, "code", None) in {"unbound_parameters", "unsupported_instruction"}`, build `KernelError(code=exc.code, message=str(exc), framework=..., extra={"severity": exc.severity, "parameters"|"instruction": ...})`.
     - Add executor tests with a stub raising such an error, and an execute-route test that checks the frame shape.

4. **The >16-qubit lean path breaks CUDA-Q and any non-Qiskit/Cirq adapter.**
   - **Where:** `kernel/run_memory.py:35` (`NATIVE_FRAMEWORKS = {"stim", "qsharp"}`), `:104` (`plan_simulation`), `:235` (`simulate_lean` dispatches every non-`qiskit` framework to `_cirq_sampled` / `_cirq_exact`).
   - **What:** A `cuda-q` circuit (or a third-party adapter's circuit) above 16 qubits is planned as `lean` and handed to `cirq.Simulator`. That raises, and the user gets `simulation_error`. Before R-B the same run went through `CudaqAdapter.simulate`. Large circuits are the reason CUDA-Q (GPU) is supported, so this is a functional regression.
   - **Fix:** use the lean path only for `qiskit` and `cirq`. For other frameworks, apply the estimate only if meaningful, then call `adapter.simulate`, and shape or truncate its result. Add a test with a fake third-party adapter spec over 16 qubits.

5. **The lean path bypasses the adapter's simulation pipeline (reintroduces R-2 above 16 qubits).**
   - **Where:** `kernel/run_memory.py` `_qiskit_sampled` / `_qiskit_exact` call `AerSimulator.run` directly, with no transpile and no library-gate expansion.
   - **What:** R-A's fix for R-2 (`_qiskit_expand.py` / `_qiskit_aer.py` in the adapter) never runs for n > 16. Once R-A merges:
     - `EfficientSU2(20)`, `TwoLocal`, `RealAmplitudes` and other library ansätze with measurements still fail with Aer's unknown-instruction error;
     - the same circuits at 16 qubits or fewer succeed.

     This is design risk 12 materialising as a behaviour split at the 16-qubit line.
   - **Fix:** route the lean path through an adapter hook (for example `adapter.simulate(..., lean=True, max_probabilities=...)`) or call R-A's expansion helper before Aer. Add a corpus program, `EfficientSU2(18)` measured, in `r_b/` as an expected xfail until merge.

6. **The lean exact path materialises every amplitude as Python objects (an R-11 hazard inside the guard).**
   - **Where:** `kernel/run_memory.py:225` (`_exact_payload`: a `{bitstring: float}` dict over all nonzero probabilities), `:166` (`top_probabilities` sorts all of them before cutting to 65,536).
   - **What:** For a dense state, for example H on every qubit with no measurements:
     - n = 24 builds about 16.7 M dict entries plus a 16.7 M-tuple sort, several GB;
     - the admission estimate is `3 × 2^24 × 16 B` = 0.8 GB.

     The estimate understates the peak by roughly 5-10×. On a 16 GB machine (budget 4 GB) this is admitted, then either thrashes or is killed by the 40 % RSS ceiling as `too_much_memory` after a long run. That is exactly the Python-list blowup R-11 set out to prevent.
   - **Fix:**
     - select the top K on the numpy array (`np.argpartition(probs, -K)[-K:]`) and only then format bitstrings;
     - count the `probs` and index arrays in `COPIES_EXACT`;
     - add a test asserting peak RSS is less than or equal to the estimate plus a margin for a dense n = 20 state.

7. **The every-path acceptance test asserts nothing for several path × hazard cells.**
   - **Where:** `kernel/tests/test_run_worker.py:544-561` and `_verdict` at `:532`.
   - **What:**
     - `hardware_submit_device` × {`sibling`, `data`}: the submit always fails at the provider ("not connected") with an error frame that has no `code`, so `codes & BAD_CODES` is empty whether or not the program's sibling import or data read worked. A `ModuleNotFoundError` would pass too.
     - `hardware_submit_simulator` × {`sibling`, `data`}: the job status is never checked, so a `failed` job passes.
     - `qec_estimate` × {`sibling`, `data`}: explicitly exempted (`or path in ("qec_estimate",)`).
   - **Why it matters:** the brief's acceptance item is "for every path in the list (one corpus program per path: sibling import, relative data read, …)". Six cells pass vacuously.
   - **Fix:**
     - simulator: assert `job.status == "complete"`;
     - device: assert the error message is the provider-connection failure and does not mention the module or file name (or register a fake provider);
     - `qec_estimate`: when `qdk` is present, require no `execution_error` or `compile_error`.

### Minor

8. **Files outside ownership.**
   - Modified existing tests not in the brief or D11: `kernel/tests/test_executor.py` (an assertion inverted for the new detection semantics) and `kernel/tests/test_trainability_handlers.py` (the `inprocess_mode` fixture).
   - New modules not in the design note's §9 list: `run_worker_proc.py`, `run_ipc.py`, `run_hardware.py`. `run_ops_builtin.py` is sanctioned by §9.
   - New test helpers: `_pool_test_ops.py`, `_run_pool_fixtures.py`, `_run_server_helpers.py`, `_fake_lab_ops.py`.

   No overlap with R-A was found. The controller must ratify these and add them to `check-wave-ownership.py` (D18 asks for this).

9. **Insecure, unbounded default run dirs.**
   - **Where:** `kernel/run_routes.py:275` (`_default_run_dir`).
   - **What:**
     - It creates `<tmp>/nuclei-runs/<owner>-<run_id|ms>` for every execute, run_python and hardware submit that has no `run_dir`, under a world-shared, predictable parent, with `exist_ok=True`. That follows a pre-planted symlink on multi-user Linux.
     - The directories are never removed.
   - **Fix:** use a per-user `0700` base (`mkdtemp` under the user cache dir) and reap old run dirs.

10. **The report overstates the single-exec evidence.**
    - **Where:** `test_executor_run_path.py:260`.
    - **What:** `test_single_exec_with_lab_open` covers parse + `trainability_inspect` + `trainability_lint` only. The report says "(+ fake symmetry/deploy/learned ops)". `test_future_lab_ops_inherit_every_guarantee` checks the hazards, not single exec.
    - **Fix:** add the fake `symmetry_detect` / `deploy_inspect` ops to the exec-log assertion, as design note §7 specifies.

11. **`test_n30_too_many_qubits_fast` depends on host RAM.**
    - **Where:** `test_executor_run_path.py:344`.
    - **What:** It sets no `NUCLEI_SIM_MEMORY_LIMIT_MB` (the design note says 2048). On a host with more than about 137 GB, n = 30 sampled is admitted and allocates.
    - **Fix:** start that kernel with the env var.

12. **Clients without `run_id` (today's `useKernel`) are blocked for up to 600 s.**
    - **Where:** `run_routes.dispatch` awaits them inline, and the run-lane default wall is 600 s (D17).
    - **What:** A `while True` in the editor wedges that connection for 10 minutes, and it cannot be cancelled because there is no `run_id`. This is consistent with D14/D17, but the R-6 symptom persists for current clients until R-G ships.
    - **Fix:** either a shorter wall default for clients without `run_id`, or record this in the R-G hand-off.

13. **Lab error codes are collapsed.**
    - **Where:** `trainability/_usercode.py:58` (`_worker_namespace`).
    - **What:** It maps `user_exit` and `too_much_memory` to `execution_error`.
    - **Fix:** preserve them.

14. **`call_user` blanks the user file's source lines.**
    - **Where:** `run_context.py:677`.
    - **What:** It enters `user_context(main, "")`. That overwrites the `linecache` entry for the user file with empty content, so a traceback raised inside `nuclei_circuits` loses its source lines. If the file exists, it also writes an empty spawn file.
    - **Fix:** pass the program's code, or skip the linecache and spawn-file steps for `call_user`.

15. **Static preview picks the circuit differently from the executor.**
    - **Where:** `preview_static.py:253` (`_find`).
    - **What:** `_find` picks the last circuit of either framework, while the executor picks by detection order. A program importing cirq then qiskit and building both previews the Qiskit circuit statically but the Cirq circuit on exec.
    - **Fix:** select with `framework_detect.detect(code).candidates`.
    - Also: `QuantumCircuit.from_qasm_file` and similar classmethods pass `_allowed_function` (any classmethod of an allowed class). The static path then reads a file without recording it as a cache dep.

16. **Small leak.**
    - **Where:** `run_worker.py:257`.
    - **What:** `RunPool._threads` keeps every per-run thread forever, which grows without bound over long sweeps.

17. **Dead or stale code.**
    - `run_worker.pool_for_ctx` (`:713`) is unused.
    - `Executor._unsupported_framework(loc)` has an unused parameter.
    - The `parameter_binding_unavailable` error code (`executor.py:564`) is not in §4.2.
    - The `trainability/handlers.py` module docstring (line 5) still says sync ops use `asyncio.to_thread`.
    - `_send_result` splices `"timing"` into serialized JSON by string surgery.

18. **Size guidance.** `executor.py` grew from 974 to 1031 lines, already over the 800 guideline. `server.py` (896, down from 1214), `run_worker.py` (745) and `run_context.py` (705) are near or over it. `run_context.user_context` and `RunPool._supervise` exceed about 50 lines.

19. **TDD process gap.** The report admits that the in-process executor changes and some pool tests were written alongside the code. RED evidence exists for the corpus and for the two new-module tests only.

20. **Misleading corpus name.** `rb20-efficientsu2-only-import` does not import `EfficientSU2` (it uses `from qiskit.circuit import QuantumCircuit`).

## Cannot verify from the diff

- The macOS (`ps` scans, no PDEATHSIG) and Windows (Job Object, loopback control channel) paths are unexercised. The macOS CI job is added but has not run.
- The reported suite and corpus numbers:
  - full, min and qk2 corpora at zero unexpected statuses;
  - 3164 passed;
  - perf budgets met.

  These are not re-run. The reported output shows no warnings, but the full logs were not provided.
- Qiskit 2.x behaviour of QPY round-trips and of the lean Aer calls (reported via the qk2 corpus only).
- Post-merge interaction with R-A's `SimulationResult` fields (`measurements_source` / `probabilities_exact` on the 16-qubit-or-smaller path) and R-A's docs-fixture edits against R-B's unchanged frame sequence for clients without `run_id`.
