# Brief — PRD 15 unit R-C

Plan: docs/research/PRD_15_QUANTUMNESS_LAB.md (master). Specs: docs/research/PRD_15/*.md. This brief is your requirements; values in it are binding verbatim.

## Your unit (master plan rows — §5.1 Track R table and/or §7 wave table)

| **R-C Environment & shell** (Wave 0a) | R-14 one Qiskit range (`>=1.2,<3`) in catalog + requirements, `errorRewrite` migration hints for removed 1.x APIs, order-insensitive symbolic comparison; R-16 `ruff` in `KERNEL_CORE_DEPS`; R-17 Info-level rotating file log + startup environment report + "Open logs"; R-18 `--version/--help` before Tauri init; **R-7 shell-side kernel health check**: if `try_wait` reports exit or the port stops listening, auto-restart with backoff and a "kernel restarted" event for the toast; `scipy` declared optional in docs; `torch`/`onnx` catalog entries; `configure_kernel_env` strips `NUCLEI_KERNEL_DEV_ORIGINS` in release builds. Hands its CI matrix lines (Qiskit-2 leg) to R-D | `src-tauri/src/commands/frameworks.rs`, `src-tauri/src/commands/kernel.rs` (`configure_kernel_env`: `MPLBACKEND`, dev-origins strip; health check), `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`, `kernel/requirements.txt`, `kernel/agent-requirements.txt`, `kernel/discovery/_optional.py` (`CATALOG_IDS`), `src/services/errorRewrite*.ts` (Qiskit-2 table) | cargo tests for catalog pins, version flag, health-check restart; `pytest-qiskit2` job green (R-D's workflow); `lint` on a ruff-less interpreter returns `available: false`; `nuclei --version` exits 0 without a window (packaged smoke) |
| **R-C** Environment & shell | Qiskit range, ruff, logs, `--version`, shell health check (R-7), dev-origins strip, catalog entries | §5.1 |

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


## Audit items you close (docs/research/PRD_15/00_RELIABILITY_AUDIT.md)

### R-14 (Med-High) Qiskit 2.x installed, Qiskit <2 pinned and tested
- Symptom: the owner runs Qiskit 2.6.0. `kernel/requirements.txt` and `agent-requirements.txt` pin `qiskit>=1.2,<2.0`; CI (`kernel-tests.yml`, python 3.12) installs only that. Programs using removed 1.x APIs fail in the owner env but pass in CI: `from qiskit.primitives import Sampler/Estimator` (V1) -> `ImportError`, `.c_if()` -> `AttributeError`, `bind_parameters` -> `AttributeError` (`q16`, `q17`, `q18`, `q19`; `min` passes q16/q17/q19). The kernel suite on a Qiskit-2.6 venv (`pytest_qk2.out`: 2074 passed, 7 failed, 11 errors) shows one real incompatibility: `test_trainability_adapters_unbound::test_qiskit_unbound_snapshot` (symbolic string ordering `"0.3 + 2*theta"` vs `"2*theta + 0.3"`), plus the optional-dependency failures in R-21.
- Root cause: `frameworks.rs:37` catalog `pip_name: "qiskit qiskit-aer"` has no bound; the catalog and `requirements.txt` disagree.
- Fix: choose and enforce one range. Either pin the catalog to the tested range, or (preferred, because the owner is already on 2.x and new users will be) test and support 2.x: add a CI matrix leg for `qiskit>=2`, route removed-API errors through `errorRewrite` with the migration, and make symbolic-string comparisons order-insensitive. PRD 15 code that touches Qiskit APIs must run on both.
- Regression tests: CI matrix; kernel corpus golden per Qiskit major.


### R-16 (Med) ruff is not provisioned; lint is silently empty
- Symptom (owner env): `lint` returns `{"diagnostics": []}` (an unused `import os` is not flagged) and `format` returns `format_failed: The formatter (ruff) is not available.` The editor shows a clean file with no indication that linting is off.
- Root cause: `KERNEL_CORE_DEPS` (`frameworks.rs:373-376`) omits `ruff`, though `kernel/requirements.txt` lists it and `executor.py:30-60` documents "the bundled managed venv installs it there".
- Fix: add `ruff>=0.6,<1.0` to `KERNEL_CORE_DEPS` and the import probe, or have `lint` return `available:false` so the UI can say "Linting off (ruff not installed) [Install]".
- Regression test: `lint` on a ruff-less interpreter returns an explicit unavailable marker.


### R-17 (Med) Release logging hides provisioning and start-up
- Symptom: `nuclei.log` is 0 bytes after a full first launch (venv creation, pip installs, kernel start). Failures at those stages would also be invisible until they reach WARN. The Mac log only had content because the kernel stderr is WARN.
- Root cause: `lib.rs:55-58` sets `LevelFilter::Warn` for release.
- Fix: log at Info to the file (rotating), keep Warn for stderr; add an "Open logs" action; include the environment report (`environment_report`) at start.


### R-18 (Low) `nuclei --version` starts the full GUI and a kernel
- Symptom: `ps` shows `nuclei --version` (pid 2587203) as a running GUI with its kernel child on 9742. A packaged-app smoke test or a user script probing the version would spawn the app.
- Fix: handle `--version/-V/--help` before building the Tauri app in `main.rs`.


### R-7 (High) `sys.exit()` / `exit()` kills the kernel's listener but not the process
- Symptom: after `sys.exit(0)` in user code the kernel process stays alive (`kill -0` succeeds), `ss` shows no listener on its port, the existing socket never answers, and reconnects get `ConnectionRefused`. The editor shows "kernel disconnected" and retries forever; the shell sees a live child and does not restart it, so only quitting the app recovers.
- Repro: `sysexit2.py` -> `proc alive: True`, `listening after: NO LISTENER`, `reconnect: ConnectionRefusedError`. Corpus `e06-sys-exit` (owner/min/dev) times out on parse and execute and wedges every later program in that run.
- Root cause: `executor.py:369` `_run_code` catches only `Exception`; `SystemExit` (a `BaseException`) escapes the worker thread, propagates through `asyncio.to_thread` into the connection task and stops the event loop (`asyncio.run` in `server.py:1214`), while the process lingers during interpreter shutdown.
- Fix: subsumed by R-6 (subprocess worker). Immediate patch: `except (SystemExit, KeyboardInterrupt)` -> `KernelError(code="user_exit", message="Your code called sys.exit(); the run was ended.")`, and make the shell restart a kernel whose port stops listening.
- Regression tests: `sys.exit`, `exit()`, `quit()`, `os._exit(0)` (worker death must return `worker_died`, kernel stays up).


## Controller rulings for this unit (binding)
- Do NOT edit .github/** (R-D owns kernel-tests.yml this wave and adds your Qiskit-2 CI leg). Put the CI lines you need in your report.
- Every Rust test you add must set NUCLEI_RUNTIME_DIR to a tempdir and never touch ~/.nuclei/runtime (the owner`s running app uses it).
- The R-7 kernel-side part (sys.exit surviving) belongs to R-B (Wave 0b); you own only the SHELL-side health check + auto-restart with backoff + the kernel-restarted event.
- Learn mode is being deprecated: no Learn-mode changes. errorRewrite Qiskit-2 hints apply to research code.
