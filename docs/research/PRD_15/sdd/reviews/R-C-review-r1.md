# R-C review, round 1 (Environment and shell, Wave 0a)

Range b9e3378..3fcf151 (1 commit, 18 files). Review package: `reviews/R-C-r1.diff`.
Verdict: **spec_compliant = false** (one acceptance test was not delivered because R-B owns the files; this needs routing by the controller, not rework by the implementer). **Quality = Needs fixes** (2 Important findings).

## Spec compliance, file by file

| Brief item / owned file | Status |
|---|---|
| `src-tauri/src/commands/frameworks.rs`: Qiskit range `qiskit>=1.2,<3 qiskit-aer>=0.15,<1`, `ruff>=0.6,<1.0` in `KERNEL_CORE_DEPS` and the import probe, `torch`/`onnx` research entries, `collect_environment_report` | Done, with cargo tests |
| `src-tauri/src/commands/kernel.rs`: `configure_kernel_env` sets `MPLBACKEND=Agg` and strips `NUCLEI_KERNEL_DEV_ORIGINS` in release builds; health check via `start_kernel_inner`/`StartMode`; new submodule `kernel/health.rs` | Done (see Important 2) |
| `src-tauri/src/lib.rs`: Info-level file log, `open_logs`, startup report, monitor spawn | Done |
| `src-tauri/src/main.rs`: `--version/-V/--help` before Tauri init | Done. The `tests/cli_flags.rs` test runs the real binary with no DISPLAY |
| `kernel/requirements.txt`, `kernel/agent-requirements.txt`: one Qiskit range, scipy declared optional | Done |
| `kernel/discovery/_optional.py`: `CATALOG_IDS`/`CATALOG_LABELS` for torch/onnx | Done |
| `src/services/errorRewrite*.ts`: Qiskit-2 table, applied to Research mode only | Done (12 entries; deterministic fallback when there is no API key) |
| R-14 order-insensitive symbolic comparison | Done, in `kernel/tests/test_trainability_adapters_unbound.py`, a file outside the owned list (Minor 1) |
| R-16 regression test: "`lint` on a ruff-less interpreter returns `available: false`" | **Missing.** The marker belongs in `kernel/executor.py`/`server.py`, which R-B owns. The implementer escalated this correctly (Important 3) |
| CI Qiskit-2 leg | Correctly not edited (R-D owns it). The report gives the CI lines for R-D |
| New files `cli.rs`, `logging.rs`, `commands/kernel/health.rs`, `tests/cli_flags.rs`, `kernel/tests/test_env_provisioning.py` | Not in the brief's list, but they are new files and no other Wave 0a unit owns them |

Nothing extra or over-engineered. Learn mode is untouched: the `errorRewrite` change is gated on `mode === 'research'`, and a test checks that Learn mode behaves as before.

Two risks named in the report, checked outside the diff:
- **Token after an automatic restart.** `useKernel.connect()` (`src/hooks/useKernel.ts:447`) calls `getKernelAuthToken` on every connect attempt. The existing reconnect loop therefore picks up the new per-launch token without R-G.
- **Double restarts.** The frontend does not call `start_kernel` on disconnect, only on mount and when `retryNonce` changes. The supervisor and the UI do not both restart the kernel after a crash.

## Important

1. **New Rust tests delete the owner's real `~/.nuclei/runtime/kernel-owner.json`. This violates the controller ruling and global constraint 6.**
   - Where: `src-tauri/src/commands/kernel/health.rs`. The test `state_process_state_tells_running_exited_absent_and_starting_apart` (around new line 618) calls `state.stop()` explicitly. So does `a_kernel_process_that_exits_is_restarted_and_a_wedged_one_too` (around line 673). Both also drop the `KernelState`, and `Drop` calls `stop()` again. The same happens in `src-tauri/src/commands/kernel.rs` in `a_supervisor_restart_is_dropped_when_unwanted_and_an_explicit_start_pauses_supervision` (around line 654), through `Drop`.
   - Why it matters: `KernelState::stop()` calls `ownership::remove_owner_record(&dir)` with `dir = ownership::runtime_dir()`. When `NUCLEI_RUNTIME_DIR` is unset, that falls back to `$HOME/.nuclei/runtime` (`kernel_ownership.rs:31-41`). None of the new tests sets `NUCLEI_RUNTIME_DIR`. Every `cargo test` run therefore deletes the owner record of the owner's running Nuclei. If that app then crashes, its leftover kernel looks foreign, is not reaped, and the next `start_kernel` fails because the port is taken. The ruling says "Every Rust test you add must set NUCLEI_RUNTIME_DIR to a tempdir and never touch ~/.nuclei/runtime". The older `state_with` helper has the same flaw, but that does not excuse the new tests.
   - Fix: give the tests a runtime dir they own. Options:
     - Add a `#[cfg(test)]` constructor such as `KernelState::with_runtime_dir(Option<PathBuf>)`, so `stop()` uses an injected dir instead of the global one.
     - Or have a single `OnceLock` helper set `NUCLEI_RUNTIME_DIR` to a process-wide tempdir before any `KernelState` is built in tests.
   - Add a regression test: create a sentinel file in a fake home, run `stop()`, and assert the sentinel survives.

2. **A `stop_kernel` that runs during an in-flight start leaves supervision on, so the supervisor brings back a kernel the user stopped.**
   - Where: `kernel.rs`. `stop()` clears `supervised` before it takes the process lock (new lines ~780-783). `start_kernel_inner` sets `supervised = true` under the lock after a successful start (~956).
   - The race:
     1. A start (from the frontend or the supervisor) holds the lock while the kernel boots, which takes seconds.
     2. `stop_kernel` is called. It stores `false`, then blocks on the lock.
     3. The start finishes and stores `true`.
     4. `stop()` gets the lock, kills the child and sets the guard to `None`. `supervised` is still `true`.
     5. On the next poll the supervisor sees `Absent` with supervision on, and restarts the kernel the user stopped (`RestartReason::NotRunning`).
   - This is reachable: `useKernel`'s effect cleanup calls `stopKernel()` while a `startKernel()` from the same effect or a `retryNonce` re-run may still be in flight. Both are `#[tauri::command(async)]` and run on separate threads.
   - Fix: in `stop()`, clear the flag again after taking the lock (`self.set_supervised(false)` inside the `if let Ok(mut guard)` block). A stronger fix keeps `supervised` inside the same `Mutex` as `process`.
   - Add a test: hold the process lock on one thread, call `stop()` on another, set `supervised = true` from the "start" side, release the lock, and assert `!is_supervised()`.

3. **R-16 acceptance test not delivered: `lint` on a ruff-less interpreter returns `available: false`. This is plan-mandated, an ownership conflict.**
   - Where: the brief's test column. The required code lives in `kernel/executor.py`/`kernel/server.py`, which R-B owns in Wave 0b.
   - Why it matters: provisioning ruff closes the symptom for new and upgraded venvs. Older or broken environments still get a silent, clean-looking lint, and R-G's "Linting off [Install]" UI has nothing to key on.
   - Fix: the controller should route the report's exact change (Concern 1) and its regression test (`test_lint_format.py`, with `ruff_base_cmd` monkeypatched to `None`) to R-B. This is not rework for R-C.

## Minor

1. **Files edited outside the owned list.**
   - `docs-site/src/content/docs/reference/framework-catalog.mdx`: `docs-site/**` belongs to X in a later wave, so there is no same-wave collision. The scipy note is already in the `requirements.txt` comment.
   - `kernel/tests/test_trainability_adapters_unbound.py`: no unit lists it. The edit is test-only and required by R-14.
   - Both are justified. Record them so X and later units know.
2. **"Qiskit 2 migration" is the wrong label for some hints.** `errorRewrite.ts` `hintAsRewrite` (diff line ~2164) prefixes every hint with "Qiskit 2 migration:". Several table entries cover APIs removed in Qiskit 1.0: `execute`, `Aer`, `opflow`, `algorithms`, `QuantumInstance`. Those errors also appear on the supported 1.x range, where "Qiskit 2" is wrong. Use a neutral prefix ("Removed Qiskit API:") or give each entry a `removedIn` field.
3. **The `c-if` pattern misses some instructions.** The pattern in `errorRewriteQiskit2.ts` (diff ~2374) only matches class names ending in Gate, InstructionSet or Instruction. `Measure(...).c_if` and `Reset().c_if` fail with `'Measure' object has no attribute 'c_if'`, which gets no hint. Match `object has no attribute 'c_if'` for any receiver. The existing test that a `'Circuit'` receiver returns null can be kept by excluding `Circuit` explicitly.
4. **A deterministic fix can be attached to a different diagnosis.** In `errorRewrite.ts` (diff ~2203), when the model returns an explanation but no `fix`, the code attaches `migration.fix`, even if the model diagnosed another cause. Attach it only when the model's explanation is empty, or label it as the known migration.
5. **Port-probe limits.**
   - `health.rs` `port_is_listening` treats any listener on 9742 as healthy. A wedged kernel whose port another process has taken is never restarted.
   - The bind probe briefly owns the kernel port when it succeeds. A kernel that binds in exactly that window fails its strict-port bind; the next poll recovers this.
   - The report verifies bind semantics only on Linux (see cannot_verify).
   - Document the first limit in the module doc.
6. **Misleading warning.** `health.rs` `AppHost::restart` (diff ~1361) logs `warn!("Kernel unhealthy ...; restarting it")` before `begin_start` may skip the restart. Log after the decision.
7. **Release file logs carry more than before.** The file level is Info for every crate (`logging.rs` `.level(FILE_LEVEL)`), with no `level_for` filters. Release logs now hold dependency crates' Info logs and every kernel stdout line (`kernel.rs:394`, token-redacted). Rotation bounds the size. Consider `level_for("tao"|"wry"|..., Warn)`, and confirm that kernel stdout never carries user program output.
8. **`--version` is silent on Windows.** Release builds use `windows_subsystem = "windows"`, so `--version` prints nothing to a console there. This is acknowledged. `AttachConsole(ATTACH_PARENT_PROCESS)` would fix it, or document it in the help and README.
9. **The provisioning test depends on formatting.** `test_env_provisioning.py` extracts catalog entries with a regex that assumes `cargo fmt` layout (`\n    \},`). This is acceptable, but a formatting change produces a confusing "entry not found". Consider an `include_str!`-free check from the Rust side, or a looser regex.
10. **Unreachable branch.** In `start_kernel`, `StartOutcome::Skipped => Err("Kernel start was skipped")` cannot happen for `StartMode::Always`. Use `unreachable!` with a comment, or restructure.

## Test evidence
- The report gives RED then GREEN per area, with concrete counts. The kernel suite passes on Qiskit 1.4.6 and 2.6.0 (2717 passed each). vitest has 2119 passing; tsc, eslint, clippy `-D warnings` and fmt are clean. No warnings are reported.
- The supervisor logic is well tested: a pure state machine with fakes, plus real child processes.
- Not covered by any test:
  - the real `start_kernel_inner(IfUnhealthy)` path under lock contention;
  - the log file's contents;
  - a live restart in the GUI (acknowledged).
