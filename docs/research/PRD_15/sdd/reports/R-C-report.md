# R-C report: Environment and Tauri shell reliability (Wave 0a)

Branch `prd15/r-c`, base b9e3378. One commit: `3fcf151 feat: PRD 15 R-C environment and shell reliability`.
Status: DONE_WITH_CONCERNS (one required item needs files this unit does not own; see Concerns).

## What was implemented

| Item | Where |
|---|---|
| R-14 one Qiskit range `>=1.2,<3` | `frameworks.rs` catalog (`qiskit>=1.2,<3 qiskit-aer>=0.15,<1`), `kernel/requirements.txt`, `kernel/agent-requirements.txt` |
| R-14 migration hints for removed 1.x APIs | new `src/services/errorRewriteQiskit2.ts` (12 entries); `errorRewrite.ts` uses it in Research mode only: the hint is added to the Dirac prompt, and is returned directly when the model call fails, returns nothing or returns bad JSON (so it works without an API key). Learn mode untouched. |
| R-14 order-insensitive symbolic comparison | `kernel/tests/test_trainability_adapters_unbound.py` (`_terms` helper) |
| R-16 `ruff` provisioned | `KERNEL_CORE_DEPS` gains `ruff>=0.6,<1.0`; `KERNEL_CORE_IMPORT_PROBE` imports `ruff`, so an existing venv without ruff is upgraded on the next kernel launch |
| R-17 logging | new `src-tauri/src/logging.rs`: file at Info, rotating (2 MiB x 5 kept), console Warn in release / Info in debug; startup line, log folder and the full `environment_report` JSON logged on each launch (report built on a background thread); `open_logs` command (xdg-open / open / explorer) registered in `lib.rs` |
| R-18 `--version/-V/--help` | new `src-tauri/src/cli.rs`, called first in `main.rs` before `app_lib::run()` |
| R-7 shell side | new `src-tauri/src/commands/kernel/health.rs` (submodule of `kernel.rs`) plus `start_kernel_inner`/`StartMode` refactor in `kernel.rs`, `spawn_monitor` called from `lib.rs` setup |
| `torch` / `onnx` catalog entries | `frameworks.rs` (research group, not recommended); `_optional.py` `CATALOG_IDS`/`CATALOG_LABELS` |
| `configure_kernel_env` | sets `MPLBACKEND=Agg`; removes `NUCLEI_KERNEL_DEV_ORIGINS` in release builds |
| scipy optional in docs | comment block in `kernel/requirements.txt`; paragraph in `docs-site/.../reference/framework-catalog.mdx` (also updated the Qiskit row) |

### Health supervisor design (R-7)
- A pure state machine (`Supervisor<H: Host>`) polls every 2 s. Unhealthy means the child `try_wait` reports exit, there is no child, or the process is alive but the port has no listener for 2 consecutive polls (the `sys.exit()` wedge).
- Port check binds 127.0.0.1 and ::1 and treats `AddrInUse` as "listening". Binding was chosen over connecting because a bare connect-and-close makes the kernel's websocket server print a handshake traceback to stderr on every poll (verified empirically; it would flood `nuclei.log`).
- Restart uses exponential backoff 1, 2, 4, 8, 16, 30 s; attempts reset after 60 s of continuous health (so a crash loop is bounded); 5 consecutive attempts then it gives up and emits a final `will_retry: false` failure, and re-arms when the kernel is healthy again (e.g. manual restart).
- Restart goes through `start_kernel_inner(.., StartMode::IfUnhealthy)`, which re-checks health under the process lock, so it never races a frontend-initiated start. The supervisor uses `try_lock` and treats a held lock as "starting". An explicit `start_kernel` pauses supervision until it succeeds (a failed manual start is not retried behind the user's back); `stop()` clears supervision first, so Quit and `stop_kernel` never trigger a restart.
- Events (for R-G's toast): `kernel-restarted` `{reason: "process_exited"|"port_closed"|"not_running", attempt, pid}` and `kernel-restart-failed` `{reason, attempt, error, will_retry}`. **The auth token changes with every restart**; the frontend must re-fetch `kernel_auth_token` before reconnecting (R-G).

## TDD evidence

RED / GREEN per area (commands run from the worktree).

1. Kernel pins (`.venv/bin/python -m pytest kernel/tests/test_env_provisioning.py -q`)
   RED: `9 failed, 3 passed` (qiskit ranges, ruff in core deps/probe, torch/onnx catalog + `_optional` KeyError 'torch', scipy note). Expected: nothing implemented yet.
   GREEN: all 12 pass after the requirement/catalog edits.
2. Symbolic ordering on Qiskit 2.6.0 (`qk2` venv, python 3.13)
   RED: `test_qiskit_unbound_snapshot` failed with `['0.3 + 2*theta'] == ['2*theta + 0.3']`.
   GREEN: `8 passed` on Qiskit 2.6.0 and on 1.4.6.
3. Rust catalog/core deps (`cargo test --lib frameworks`)
   RED: 3 failed (`ruff>=0.6,<1.0` missing, qiskit specs `["qiskit","qiskit-aer"]` vs pinned, "catalog has no torch entry"). GREEN: 11 passed.
4. `configure_kernel_env`: RED was a compile error (`DEV_ORIGINS_ENV`, `MPLBACKEND_ENV` undefined); GREEN: both new tests pass.
5. Health supervisor: tests written against a stub `tick` returning `Idle`: `10 failed, 4 passed`; GREEN after implementing: `14 passed`. Later added real-process tests (real `KernelState`, real child processes, scripted port probe): exited child restarted on first poll, wedged child restarted after the second miss, no restart after `stop()`.
6. `--version`: `cargo test --test cli_flags` RED: both tests failed with exit status 101 (the binary tried to start the GUI without a display). GREEN: 2 passed. Also `env -u DISPLAY ./target/debug/nuclei --version` prints `nuclei 0.14.1`, exit 0.
7. errorRewrite: RED `3 failed` (missing module + two behaviours); GREEN `25 passed`. Every pattern was also checked against the real error text from Qiskit 2.6.0 and the replacement snippets were executed there (V2 sampler, `if_test`, `assign_parameters`, `qasm2.dumps`, Aer, SparsePauliOp).

## Full-suite results
- Kernel, Qiskit 1.4.6 (`.venv`): `2717 passed, 13 skipped` (10:00).
- Kernel, Qiskit 2.6.0 + all optional packages (`uv` venv, py3.13): `2717 passed, 13 skipped`. The audit baseline on 2.6 was 7 failed / 11 errors; the one real incompatibility is fixed here, the rest are R-21 optional-dep hygiene and pass because the venv had the optionals installed.
- vitest: `231 files, 2119 passed`. `tsc --noEmit` clean. eslint clean on touched TS files.
- cargo: `cargo test` 240 lib + 2 cli + 13 qec_data_lifecycle passed, 0 failed; `cargo clippy --lib --tests --bins -- -D warnings` clean; `cargo fmt --check` clean.

## Files changed
`src-tauri/src/{commands/frameworks.rs, commands/kernel.rs, lib.rs, main.rs}` (owned); new `src-tauri/src/{cli.rs, logging.rs, commands/kernel/health.rs}`, `src-tauri/tests/cli_flags.rs`; `kernel/{requirements.txt, agent-requirements.txt, discovery/_optional.py}`; `src/services/errorRewrite.ts`, `errorRewrite.test.ts`, new `errorRewriteQiskit2.ts` + test; new `kernel/tests/test_env_provisioning.py`; edited `kernel/tests/test_trainability_adapters_unbound.py`; `docs-site/src/content/docs/reference/framework-catalog.mdx`.

## Decision lines
- Decision: the `lint_result.available` marker (R-16 second fix) lives in `kernel/executor.py` and `kernel/server.py`, which R-B owns in Wave 0b; I did not edit them (see Concerns). R-16's first fix (provision ruff) is done.
- Decision: edited `kernel/tests/test_trainability_adapters_unbound.py` (not in my owned list) because the brief requires order-insensitive symbolic comparison and the failing assertion lives there; change is test-only and local.
- Decision: edited `docs-site/.../framework-catalog.mdx` for "scipy declared optional in docs" and the changed Qiskit pip spec; no other unit lists that file.
- Decision: new modules `commands/kernel/health.rs` (declared by `kernel.rs`, so `commands/mod.rs` stays untouched), `logging.rs`, `cli.rs`.
- Decision: port-liveness uses a bind probe (not connect) to avoid kernel handshake tracebacks every poll.
- Decision: Qiskit hints apply only in Research mode; the deterministic hint is also the fallback when the model call fails.
- Decision: `torch` ~200 MB, `onnx` ~20 MB approximate sizes; catalog `qiskit-aer>=0.15,<1` kept from requirements.

## Self-review findings (fixed)
- First draft let a failed explicit `start_kernel` leave supervision on, so the monitor would retry a user-visible failure up to 5 times; now an explicit start pauses supervision until success (`begin_start`, tested).
- First draft of the port-probe test was flaky under parallel tests (an ephemeral port was re-bound by another test); it now accepts the first round in which the port frees up.
- `assertions_on_constants` clippy error in logging test replaced by a `const _` assertion.

## Concerns
1. **`lint_result` `available: bool, reason?` not implemented** (needs `executor.lint`/`server.py` lint branch, R-B-owned). Required change for R-B or the controller: in `executor.py`, when `ruff_base_cmd()` is None return `[]` plus an unavailable marker, and in `server.py`'s `lint` branch send `{"type":"lint_result","diagnostics":[...],"available": <bool>, "reason": "ruff is not installed"}` (omit `reason` when available). Regression test to add in `kernel/tests/test_lint_format.py`: monkeypatch `executor.ruff_base_cmd` to `None` and assert `available is False`. The shell now installs ruff, so new installs and upgraded venvs get real lint; the marker is for older/broken environments and R-G's "Linting off [Install]" UI.
2. **CI lines for R-D (`kernel-tests.yml`, not edited):**
   - The existing `pytest` job installs `"qiskit>=1.2,<2"`; keep that as the Qiskit-1 leg (the file range is now `<3`, so that leg must pin `<2` explicitly).
   - Add job `pytest-qiskit2` (python-version `3.13`): same steps but `pip install "qiskit>=2,<3" "qiskit-aer>=0.17,<1" "cirq-core>=1.4,<2"` then `pytest kernel/tests/ -v`. Verified locally: 2717 passed on 3.13 + Qiskit 2.6.0 + Aer 0.17.
   - `corpus-app-env` should install the catalog pip lists as the shell does: `qiskit>=1.2,<3 qiskit-aer>=0.15,<1`, core deps now include `ruff>=0.6,<1.0`.
   - `test_env_provisioning.py` reads `frameworks.rs` and requirements files directly, so it needs no extra install.
3. **Frontend contract for R-G:** subscribe to `kernel-restarted` / `kernel-restart-failed`; re-fetch `kernel_auth_token` (it changes) and reconnect; call `open_logs` from Settings (returns the log folder path).
4. **Not verified end to end:** the log file contents and the live restart through a real Tauri app (needs a display; running the GUI was out of bounds). The supervisor logic, process-state reading, port probe and the cli binary are covered by tests; `start_kernel_inner` is a refactor exercised only by existing paths plus `begin_start` tests.
5. Windows release builds use `windows_subsystem = "windows"`, so `--version` exits 0 but prints nothing to a console there.
6. `import torch` in the catalog status probe can take a couple of seconds when torch is installed (`installed_frameworks` probes every entry serially); only relevant after a user installs torch.
7. `main.rs` is `app_lib::cli::handle_process_args(); app_lib::run();`; the packaged-app smoke ("`nuclei --version` exits 0 without a window") is covered by `src-tauri/tests/cli_flags.rs` against the built binary, but not yet a CI job.

## Review round 1 fix report

Branch `prd15/r-c`, fix commit on top of reviewed head 3fcf151.

### Important 1: tests deleted the owner's `kernel-owner.json` (fixed)
- `KernelState` now carries an optional `runtime_dir`; `stop()` and `start_kernel_inner` resolve it through `KernelState::runtime_dir()` (falls back to `ownership::runtime_dir()` in production).
- In test builds `KernelState::new()` returns a state with a private, never-created dir under the system temp dir, so no existing or future test can reach `$HOME/.nuclei/runtime`. `#[cfg(test)] with_runtime_dir(dir)` injects a tempdir.
- Tests added: `stop_never_touches_a_runtime_dir_it_was_not_given`, `stop_removes_only_the_owner_record_in_its_own_runtime_dir` (sentinel file survives `stop()` and the `Drop` stop; the state's own record is removed).
- Empirical check: ran the lib test binary with `HOME` set to a scratch dir holding `.nuclei/runtime/kernel-owner.json` and `NUCLEI_RUNTIME_DIR` unset. Before the fix the record was gone after the run; after the fix it survives (243 passed).

### Important 2: stop during an in-flight start (fixed)
- `stop()` clears `supervised` again after taking the process lock, so a start that finished `set_supervised(true)` under that lock cannot outlive the child `stop()` kills.
- Test `stop_during_an_in_flight_start_leaves_supervision_off`: holds the process lock ("start in flight"), runs `stop()` on another thread, waits until stop's first clear is visible, sets `supervised = true` from the start side, releases the lock, joins, asserts `!is_supervised()`. RED with the second clear removed ("the kernel the user stopped would be restarted"), GREEN with it.

### Important 3: R-16 ruff-less lint test (not R-C rework)
Not changed here, per the review and the file ownership: `kernel/executor.py` and `kernel/server.py` belong to R-B. The controller must route Concern 1's change and the `test_lint_format.py` regression test (`ruff_base_cmd` monkeypatched to `None`, expect `available: false`) to R-B.

### Spec verdict
The only spec gap was Important 3 (routing, not R-C rework). Minor findings 1-10 were not addressed in this round (not Critical/Important).

### Commands and output
- `cd src-tauri && cargo test` : lib 243 passed, 1 ignored; cli_flags 2 passed; other integration suites 13 passed; 0 failed.
- `cargo clippy --all-targets -- -D warnings` : clean. `cargo fmt --check` : clean.
- Fake-HOME run of `target/debug/deps/app_lib-*` with `NUCLEI_RUNTIME_DIR` unset: `243 passed`; sentinel `kernel-owner.json` still present.
