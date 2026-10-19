# PRD 15, Doc 00: Research-Workspace Reliability Audit

Status: scout report, 2026-10-19 (Linux dev box, Ubuntu 24.04, 16 cores, X11 `:1`).
Branch `feat/prd15-quantumness-lab` on origin/main 797da4b (released v0.14.1). Product code was NOT modified.
Scope: the Research workspace and the run paths the quantum-ML features (PRD 15 ideas 1-8) will use. Learn mode is deprecated and excluded.

Owner symptom: "anytime I try to run something in nuclei there's bugs, it won't run."

> **Master-plan supersession (2026-10-19, master v2).** This document is the scout report and is left as written. Where it prescribes mechanisms, `docs/research/PRD_15_QUANTUMNESS_LAB.md` §5.1 is binding and differs in three places: (1) the R-6/R-11 worker uses a **group-RSS ceiling via `procrun`**, never `RLIMIT_AS` (which `kernel/agent_limits.py` records as breaking numpy/BLAS and rustworkx, and which macOS rejects) and never `RLIMIT_NPROC`; the R-11 regression test reads "RSS ceiling exceeded → `worker_died`/`too_much_memory`, kernel alive"; (2) the worker's scope is **every message that executes user code** (parse, execute, transpile, debug_trace, run_python, hardware_submit, qec_materialize, trainability_inspect/lint, symmetry_detect/propose, deploy_inspect, qec_learned_sources), as a warm pool with one code-hash-keyed loaded-circuit cache, not a fresh interpreter per run; (3) the R-11 qubit policy is a memory estimate against `min(25 % of RAM, setting)`, not a fixed qubit count. The G2 harness copies fixture projects to disk so a real kernel accepts `project_root` (master §5.2).

## 0. Executive summary

The kernel is healthy for the narrow path it was tested on: a Bell-style Qiskit/Cirq circuit that ends in measurements. Almost every other thing a researcher does hits one of eleven reproducible high-severity defects (R-1 to R-11). All are in the kernel run path (`kernel/executor.py`, `kernel/server.py`, `kernel/adapters/*`, `kernel/trainability/convert.py`) or in how the Tauri shell provisions and launches it (`src-tauri/src/commands/{frameworks,kernel}.rs`). None is caught by CI, because every Playwright e2e uses a stubbed WebSocket and the kernel suites only exercise Qiskit 1.x with circuits that were written to pass.

The main things that explain "it won't run", in priority order:

1. A circuit with no `measure` cannot be run (Qiskit: `No counts for experiment "0"`; Cirq: `Circuit has no measurements to sample.`). Statevector/expectation-style research code never measures. Experiment sweeps over such code fail every point. (R-1)
2. Composite and library gates cannot be simulated: `QFT`, `EfficientSU2`, `TwoLocal`, `RealAmplitudes`, `ZZFeatureMap`, `PauliEvolutionGate`, even `iswap` (`AerError: unknown instruction`). The Trainability Lab rejects the same circuits with `unsupported_gate`. These are the building blocks of every QML ansatz and feature map. (R-2, R-5)
3. A file whose only qiskit import is `from qiskit.circuit.library import X` is "No supported quantum framework detected". (R-3)
4. Cmd+Enter on any parameterized ansatz fails (the shipped lab fixtures included). (R-4)
5. Runaway code cannot be stopped. The 30 s execution timeout is dead code, there is no interrupt message and no Stop button for editor runs, and the spinning thread burns a core until the app quits. (R-6)
6. `sys.exit()` in user code leaves the kernel process alive but with its listening socket closed. The editor says disconnected and retries forever. (R-7)
7. The editor sends `parse` on every keystroke (300 ms debounce) and the kernel executes the entire user program for each one, serially per connection. A 2 s program plus five edits delays the next Run by 10.8 s. (R-8)
8. The kernel has no project working directory or `sys.path`. In the installed `.deb` its cwd is the read-only `/usr/lib/nuclei`, so multi-file projects, data files and output writes fail. (R-9)
9. `if __name__ == "__main__":` blocks never run (`__name__` is `builtins`), so scripts structured the normal way produce `no_circuit`. (R-10)
10. No resource guard: a 24-qubit GHZ run takes 26 s, 7.8 GB RSS and a 403 MB JSON frame to the webview; 26 qubits took ~22 GB RSS per kernel and pushed this 62 GB box to 59 GB used. (R-11)

Environment facts that matter for the owner specifically: the installed v0.14.1 managed venv runs Python 3.13.15, Qiskit 2.6.0 and Aer 0.17.2 while `kernel/requirements.txt` and CI pin `qiskit<2` (R-14). It has no `stim`, `sinter`, `pymatching`, `ruff`, `pyarrow`, `duckdb` or `jsonschema` (R-15, R-16). The Mac scout's "No module named 'stim' then opening handshake failed" was a stale dev bundle; the v0.14.1 kernel boots cleanly without stim and reports it as `missing_dependency` (verified).

Baseline suites on this box: vitest 2099/2099, `tsc -b` clean, eslint 0 errors / 5 warnings, kernel pytest (dev venv, `-m "not slow"`) 2702 passed / 13 skipped, `cargo test --lib` 210 passed / 1 ignored, Playwright 26 passed / 3 skipped / 1 failed (the failure is environmental, R-21).

## 1. Method and evidence locations

Everything below was reproduced against a REAL kernel (`kernel/server.py` from this worktree), authenticated exactly like `src/services/kernelSocket.ts` (token on stdin or env, `authenticate` frame with nonce, HMAC proof check, Origin `tauri://localhost`).

Three Python environments, so a bug can be attributed to the environment or to the code:

| name | what it is | python / qiskit / cirq | extras |
|------|-----------|------------------------|--------|
| `owner` | the owner's installed managed venv `~/.local/share/com.nuclei.app/venv`, used read-only | 3.13.15 / 2.6.0 (Aer 0.17.2) / 1.7.0 | qdk 1.33.1, scipy, matplotlib; NO stim/sinter/pymatching/ruff/pyarrow/duckdb/jsonschema |
| `min` | `uv venv` + `pip install -r kernel/requirements.txt` + pytest (mirrors the CI `pytest-minimal-venv` job) | 3.12.14 / 1.4.6 / 1.7.0 | ruff; NO qdk, stim, ... |
| `dev` | the repo `.venv` | 3.12.14 / 1.4.6 / 1.7.0 | stim 1.16, sinter, pymatching, qdk |

Harness (kept, not part of the repo): `~/nuclei-handoff/scout-linux/`
- `kclient.py` kernel spawn + authenticated client (isolates `NUCLEI_RUNTIME_DIR` so it never touches the owner's live runtime files; `KAS_GB=n` wraps the kernel in `prlimit --as`).
- `corpus.py` 78 research-style programs (Qiskit 40, Cirq 15, Stim 3, Q# 6, edge cases 14); `run_corpus.py` runs `parse` then `execute` for each in an env and writes `log_<env>.txt` / `sum_<env>.txt`.
- `one.py <python> <id>[,<id>] [timeout]` single-program repro; `lab2.py`, `run_lab.py`, `qec.py`, `iso.py`, `exp.py`, `mem.py`, `backlog.py`, `race.py`, `sysexit2.py`, `cwdtest.py`, `libvar.py`, `misc.py`, `tpl.py` are the other repros named below.
- `e2e-poc/` real-kernel Playwright proof of concept (section 7).
- Raw baseline logs: `vitest.out`, `tsc.out`, `eslint.out`, `pytest_dev.out`, `pytest_qk2.out`, `playwright.out`, `cargo-test.out`.

Not driven: the installed GUI itself (a screenshot grab of the X root returned black under the compositor, and no WebKitWebDriver is installed). UI behavior claims that come from code reading rather than from driving the app are marked "(code)".

## 2. The installed Linux app (what the owner actually runs)

- `dpkg`: `nuclei 0.14.1` (`/usr/bin/nuclei`, kernel and resources in `/usr/lib/nuclei`). `diff -r kernel /usr/lib/nuclei/kernel` shows the same kernel sources as this worktree.
- Managed venv `~/.local/share/com.nuclei.app/venv` was created 12:23 today by the app: `python3.13 -m venv`, base interpreter is a uv-managed CPython 3.13.15 reached through `~/.local/bin/python3.13`. `find_best_python` (`frameworks.rs:269-291`) prefers `python3.13` first.
- Packages present: websockets 16.1.1, numpy 2.5.4, keyring, qiskit 2.6.0, qiskit-aer 0.17.2, cirq 1.7.0 (the full `cirq` meta-package including cirq-google/-aqt/-ionq/-pasqal/-web and grpc), qdk 1.33.1, scipy 1.18.1, matplotlib 3.11.2, pandas, sympy, pyqir. Absent: ruff, stim, sinter, pymatching, fusion-blossom, pyarrow, duckdb, jsonschema.
- How it got there: `ensure_kernel_runtime` (`frameworks.rs:427-450`) creates the venv and installs only `KERNEL_CORE_DEPS = websockets, numpy, keyring` (`frameworks.rs:373-376`). Everything else comes from the in-app framework catalog: `qiskit` -> pip `qiskit qiskit-aer` UNPINNED (`frameworks.rs:37`), `cirq` -> `cirq` (`:47`), `qsharp` -> `qdk` (`:68`), research group `stim>=1.14,<2` etc. (`:137-177`). `ruff` is in `kernel/requirements.txt` but not in the catalog or core deps.
- When packages are missing: the kernel itself degrades correctly (`missing_dependency` with `dependency` and `framework`; `discovery_evaluators` reports `qec_memory available:false missing:[stim,pymatching]`; `qec_generate` returns `missing_dependency`). This was verified on `owner`. The editor shows a one-click install banner (`useKernel.ts:245`, `MissingDependencyBanner.tsx`). The Lab/QEC/Discovery sessions do not (R-15).
- Logs: `~/.local/share/com.nuclei.app/logs/nuclei.log` is 0 bytes. Release builds log at WARN (`src-tauri/src/lib.rs:55-58`), so venv creation, package installs and the kernel start line are invisible; only kernel stderr (warn) would show (R-17).
- Settings (`settings.json`): `onboarding_path: research`, `last_framework: qiskit`. No secrets were read or printed.
- Process facts: a `nuclei --version` process (pid 2587203, started 13:01, not by this scout) is a full GUI instance with window "Nuclei" 1400x900 and its kernel child on 9742 (R-18). The app boots, the kernel starts, and nothing is logged, i.e. the installed app's startup is healthy. The failures are all at run time.

## 3. Re-verification of the Mac scout's core findings

| Mac finding | Linux result | Root cause | Ref |
|---|---|---|---|
| Qiskit circuit without measurements: `No counts for experiment "0"` | REPRODUCED on owner, min, dev | `qiskit_adapter.py:156-157` unconditional `sim_qasm.run(...).get_counts()` | R-1 |
| Aer rejects `IQFT`/`QFT` library gates | REPRODUCED, also `EfficientSU2`, `TwoLocal`, `RealAmplitudes`, `ZZFeatureMap`, `PauliEvolution`, `iswap` | `qiskit_adapter.py:142-143,156` runs circuits on Aer without `transpile` | R-2 |
| `initialize()` / `unitary()` adapter TypeErrors | REPRODUCED; `if_test` also | `qiskit_adapter.py:52` `float(p)` | R-13 |
| `Circuit has no measurements to sample` (Cirq) | REPRODUCED (3 programs) | `cirq_adapter.py:169` | R-1 |
| Qiskit noise-model usage error | User-code error (`depolarizing_error(0.01)` missing `num_qubits`); the kernel reports it correctly as `execution_error`, no product bug. (On the Mac it showed as `unsupported_framework` because the sample's imports defeated detection, R-3.) | n/a | R-3 |
| `'_new_creg'` AttributeError | Learn capstone content using a private Qiskit API; ignored per directive | n/a | n/a |
| Mac venv lacked stim, kernel stderr `No module named 'stim'`, then `opening handshake failed` | NOT reproducible on 0.14.1. Mac bundle was a stale `kernel-auth-0141` dev build whose `qec_guardrails` imported stim eagerly. v0.14.1 on a stim-less venv boots, answers, and reports `missing_dependency`. | fixed | n/a |
| Mac minimal-venv pytest collection errors | REPRODUCED on a Qiskit-2/no-optional-deps venv: 11 collection errors + 6 docs-fixture failures (R-21) | tests do not `importorskip` | R-21 |

## 4. Bug list

Severity: High = blocks a normal research workflow or damages the machine; Med = real but has a workaround or limited blast radius; Low = polish/test hygiene.
"Repro" lines use the scout harness: `P=<python of env>; cd ~/nuclei-handoff/scout-linux; $P one.py $P <corpus id> [timeout]`. Wire-level messages are the same ones the editor sends (`parse`, `execute` with `language:"python"`).

### R-1 (High) Circuits with no measurements cannot be run (Qiskit and Cirq); sweeps lose their metrics
- Symptom: Run prints `QiskitError: 'No counts for experiment "0"'` (Qiskit) or `ValueError: Circuit has no measurements to sample.` (Cirq). The statevector, Bloch spheres and histogram never appear. `record_metric(...)` values are discarded because the whole `result` is `null` on any error.
- Repro (all three envs): `q02-bell-NO-measure`, `q05-param-bound-nomeasure`, `q14-Statevector-only`, `q15-Estimator-V2-energy`, `q36-experiment-no-measure-metrics` (with `params`/`seed`), `c02-bell-NO-measure`, `c08-user-simulate-print`, `c14-cirq-pauli-sum-expectation`. Minimal: `qc = QuantumCircuit(2); qc.h(0); qc.cx(0,1)`.
- Evidence: `sum_*.txt`; `q36` returns `error`, `metrics=None` while the same program with a measurement returns `metrics={'theta_used':1.1}, seed_honored=True`. Bell-without-measure is also what a statevector/expectation program (VQE, kernels, surrogates) naturally looks like.
- Root cause: `kernel/adapters/qiskit_adapter.py:156-157` (`sim_qasm.run(circuit_obj, shots).result().get_counts()` raises when the circuit has no measure) and `kernel/adapters/cirq_adapter.py:169` (`sim.run(circuit_obj, repetitions=shots)` raises). The statevector half (`qiskit_adapter.py:141-146`, Cirq `:149-166`) already succeeded before the failure.
- Fix: detect "no measurement ops" (Qiskit: no `measure` instruction; Cirq: `not any(cirq.is_measurement(op) ...)`). Return the statevector, probabilities and Bloch data and set `measurements = {}` plus an explicit `sampled: false` / `note` field; optionally sample from the exact probabilities with the requested seed, labelled `source: "statevector"` so nothing is passed off as hardware-style shots. The histogram panel needs an honest "no measurements in this circuit; showing exact probabilities" state. Never auto-add `measure_all` silently.
- Regression tests: kernel `test_execute_no_measurements_{qiskit,cirq}` asserting `error is None`, `probabilities` present, `measurements == {}` or labelled; a record_metric sweep point over a no-measure circuit; vitest for the histogram empty-sample state; add `q02/q14/c02/c08/q36` to the corpus golden (section 6).

### R-2 (High) Composite/library gates cannot be simulated; the diagram shows one opaque box
- Symptom: `AerError: 'unknown instruction: QFT'` (also `IQFT`, `EfficientSU2`, `TwoLocal`, `RealAmplitudes`, `ZZFeatureMap`, `PauliEvolution`, `iswap`). The circuit diagram shows a single `QFT`/`EFFICIENTSU2` box with no gate-level structure.
- Repro (owner, min, dev identical): `q06-QFT-append-measure`, `q07-QFT-inverse-NO-measure`, `q27-PauliEvolution-trotter`, `q28-gate-zoo-snapshot` (`iswap`); with detection worked around (`libvar.py`): `q09`, `q11`, `q12`, `q13` all end `unknown instruction: <name>`, and `q08` (manually `.decompose(reps=2)`) passes.
- Evidence: the `transpile` message succeeds on the same QFT circuit (`misc.py`, `transpile-QFT -> transpile_result`), so the decomposition machinery exists; the Run path just does not use it.
- Root cause: `qiskit_adapter.py:142-143` and `:155-156` call `AerSimulator.run(circuit)` on the user's circuit without `transpile(circuit, backend)` (Aer only accepts its basis). `extract_snapshot` (`:60-100`) maps by `type(op).__name__`, so composite blocks stay one gate.
- Fix: `transpile(circuit, backend, optimization_level=0)` (or `circuit.decompose()` until Aer-native) before both Aer runs; keep the original circuit for the snapshot but add an opt-in "expand blocks" (decompose one level) so the diagram can show gate structure; cap expansion size. Fall back with a clear `unsupported_instruction` error naming the gate, not an AerError.
- Regression tests: parametrized kernel test over `QFT, EfficientSU2, TwoLocal, RealAmplitudes, ZZFeatureMap, PauliEvolutionGate, iswap, rzz, rxx, cswap` asserting a result; snapshot test that a composite block expands when requested.

### R-3 (High) Framework detection misses sub-module imports
- Symptom: `No supported quantum framework detected in code.` for a program whose only qiskit import is `from qiskit.circuit.library import EfficientSU2` (also `from qiskit.quantum_info import ...`, `from qiskit_aer import AerSimulator`, `from cirq.contrib...`).
- Repro: `q09`..`q13` (owner/min/dev) `parse` and `execute` both error `unsupported_framework`; adding `import qiskit` makes detection pass (then R-2 hits).
- Root cause: `kernel/executor.py:87` `from\s+qiskit\s+import|import\s+qiskit` and `:94` `import\s+cirq|from\s+cirq\s+import`. `from qiskit.x import y` and `from qiskit_aer import` match neither. (Note `import qiskit_aer` happens to match via the `import\s+qiskit` prefix; `from qiskit_aer import` does not.)
- Fix: `^\s*(?:from|import)\s+qiskit(?:_aer|_ibm_runtime)?\b` (multiline, same for cirq/cirq_google/stim); also prefer the circuit-type scan after exec when detection fails but the namespace contains `QuantumCircuit`/`cirq.Circuit`. The trainability `_usercode` path already finds circuits by type and is unaffected (verified: `qiskit-efficientsu2-only-import` reaches `unsupported_gate`, not detection failure).
- Regression tests: table-driven `resolve_framework` test with each import form.

### R-4 (High) Run on a parameterized circuit fails, and the message sends the user to another panel
- Symptom: `ValueError: bind circuit parameters before simulating (Trainability Lab analyzes free parameters)`. The shipped Lab fixtures `ansatz/hardware_efficient.py` and `tfim_hva.py` fail on plain Cmd+Enter with this error, as does any `ParameterVector`/`sympy` ansatz.
- Repro: `q04-param-unbound-ansatz`, `q10-EfficientSU2-unbound`, `c03-param-sympy-unresolved`; `run_lab.py` (`plain-execute ... ERR simulation_error`).
- Root cause: `qiskit_adapter.py:127-128`, `cirq_adapter.py:136-137` raise `UNBOUND_PARAMETERS_MESSAGE` and `server.py` classifies it as `simulation_error`. There is no way to supply values on the Run path (experiments inject `params`, but the circuit has `Parameter` objects, not `params["theta"]`).
- Fix: unbound parameters are not an error for the editor: keep the snapshot, show "N free parameters; nothing to simulate" as an info state with a "Run at point..." affordance (zeros, a user-set point, or seeded random), and have the kernel accept `parameter_values` (name -> float, or `random_seed`) on `execute`, reporting `bound_at` in the result. Do not word a core run error around another panel.
- Regression tests: execute with `parameter_values`; execute without them returns an `info`/`unbound_parameters` code distinct from `simulation_error`; Playwright (real kernel) running the lab fixture.

### R-5 (High, PRD 15 critical) Trainability Lab rejects library/composite blocks
- Symptom: `unsupported_gate: gate 'EfficientSU2' is not supported by the Trainability Lab` for `EfficientSU2`, `TwoLocal`, `ZZFeatureMap`, `QFT`, `PauliEvolution` on `trainability_inspect`, `_lint`, `_start` (all three envs, `lab2.py`). Plain `rzz/rxx/ry`, `cry/u/ccx`, mid-file measure and Cirq grid ansatz all analyze fine (`status=complete`).
- Root cause: `kernel/trainability/convert.py:130,199` name-based lowering with no `decompose()` of `BlueprintCircuit`/composite instructions.
- Fix: before conversion, decompose composite instructions to a fixed point (bounded, e.g. 4 levels) using `QuantumCircuit.decompose`/Cirq `cirq.decompose`, preserving `source_line` tracing for the lint; report the decomposition level in `notes`. This is a hard prerequisite for PRD 15 idea 4 (`ZZFeatureMap` kernels) and for every ansatz built from library circuits.
- Regression tests: lab fixtures with `EfficientSU2`/`TwoLocal`/`ZZFeatureMap` produce `trainability_inspected` with correct parameter counts; `unsupported_gate` still returned for genuinely unsupported ops with the op named.

### R-6 (High) Runaway code can never be stopped; the 30 s timeout is dead code
- Symptom: `while True: pass` never returns, burns 95%+ of a core indefinitely (observed 3:44 CPU minutes on each of three kernels), and the connection is dead for further messages (`z04-infinite-loop-timeout` -> `__timeout__` for both `parse` and `execute`). The UI has no Stop for editor runs (code: no `interrupt/cancel` in `useKernel.ts` or `server.py`; Stop exists only for Discovery runs and Dirac agent runs).
- Root cause: `executor.py:16` `EXECUTION_TIMEOUT_SECONDS = 30` is enforced with `SIGALRM`, which only works on the main thread (`executor.py:337-346`). `server.py:361,419,469` run every `parse/execute/run_python` through `asyncio.to_thread`, so `use_signal_timeout` is always False. Python threads cannot be killed.
- Fix: run user code in a worker SUBPROCESS (the trainability `job_worker.py` and discovery `candidate_worker.py` already prove the pattern) with: wall-clock timeout, `RLIMIT_AS`/`RLIMIT_CPU`, a cancel message (`cancel` -> SIGTERM/SIGKILL the worker), stdout/stderr size caps, a fresh interpreter state per run, and `cwd`/`sys.path` set from the project (also fixes R-9). Add a Stop/cancel button and a `Running... (12 s) Stop` state to the editor and Experiments sweeps.
- Regression tests: kernel test that `while True` returns `timeout` within N s and a later request on the same connection succeeds; cancel test; vitest for the Stop affordance; corpus entry `z04`.

### R-7 (High) `sys.exit()` / `exit()` kills the kernel's listener but not the process
- Symptom: after `sys.exit(0)` in user code the kernel process stays alive (`kill -0` succeeds), `ss` shows no listener on its port, the existing socket never answers, and reconnects get `ConnectionRefused`. The editor shows "kernel disconnected" and retries forever; the shell sees a live child and does not restart it, so only quitting the app recovers.
- Repro: `sysexit2.py` -> `proc alive: True`, `listening after: NO LISTENER`, `reconnect: ConnectionRefusedError`. Corpus `e06-sys-exit` (owner/min/dev) times out on parse and execute and wedges every later program in that run.
- Root cause: `executor.py:369` `_run_code` catches only `Exception`; `SystemExit` (a `BaseException`) escapes the worker thread, propagates through `asyncio.to_thread` into the connection task and stops the event loop (`asyncio.run` in `server.py:1214`), while the process lingers during interpreter shutdown.
- Fix: subsumed by R-6 (subprocess worker). Immediate patch: `except (SystemExit, KeyboardInterrupt)` -> `KernelError(code="user_exit", message="Your code called sys.exit(); the run was ended.")`, and make the shell restart a kernel whose port stops listening.
- Regression tests: `sys.exit`, `exit()`, `quit()`, `os._exit(0)` (worker death must return `worker_died`, kernel stays up).

### R-8 (High) `parse` executes the full program on every keystroke, serially, with no cancellation
- Symptom: with a program that takes 2 s (e.g. a classical optimisation loop), five edits 300 ms apart queue five parses; Cmd+Enter then returns 10.8 s after being pressed (`backlog.py`). During that time the editor is unresponsive to Run. The same applies to side effects: file writes, network calls, `print` spam, `plt.show()` run at every pause in typing.
- Root cause: `useKernel.ts:638-653` sends `parse` per debounce; `server.py:358-470` awaits each message in the single per-connection loop (`server.py:339` also creates one `Executor` per connection); `executor.parse` (`:380-420`) calls `_run_code`, i.e. a full `exec` of the user file. `execute` then runs the code a second time.
- Fix: (a) coalesce: drop superseded `parse` requests; (b) run a parse on a time budget and cache by code hash so Run reuses the circuit instead of exec-ing twice; (c) make "live circuit preview" opt-in for programs that exceed 500 ms; (d) static AST fast path for the common straight-line case; (e) all of it in the R-6 worker so a stale parse can be killed.
- Regression tests: kernel test that N queued `parse` with a slow program leaves Run latency <= 1 program time; vitest for debounce supersession.

### R-9 (High) The kernel has no project working directory or `sys.path`
- Symptom (installed layout, `cwdtest.py` with cwd `/usr/lib/nuclei/kernel`): `np.save('result.npy', ...)` -> `PermissionError`; `from ansatz_lib import build` -> `ModuleNotFoundError`; `open('hamiltonian.json')` -> `FileNotFoundError`; `os.getcwd()` prints the install dir. The release shell launches the kernel with cwd `resource_dir` (`kernel.rs:213-218`), `/usr/lib/nuclei` for the `.deb`, read-only.
- Root cause: `execute`/`parse`/`trainability_*` messages carry only `code` (no project root); `executor._reset_namespace` (`:178`) and `exec` use the kernel's own cwd/`sys.path`. The experiment runner reads the entry file and sends its text only (`experimentRunner.ts:230`).
- Fix: add `project_root` (and `file_path`) to execute/parse/trainability/discovery messages, validated server-side as an existing directory; the R-6 worker sets cwd, prepends the root to `sys.path`, sets `__file__`, and provides a per-run scratch output dir for results (experiments already own `experiments/<name>/runs/<id>/`; surface that path as `params`/an env var). Never `chdir` the shared server process.
- Regression tests: execute with `project_root` importing a sibling module and reading a data file; a write into the run dir; traversal/relative-path refusal.

### R-10 (High) `if __name__ == "__main__":` code never runs
- Symptom: `No quantum circuit found in code.` for any script using the standard main guard (`r01-main-guard`; owner env).
- Root cause: `executor.py:179` `self._namespace = {"__builtins__": __builtins__}` defines neither `__name__` nor `__file__`, so `__name__` resolves to `builtins`.
- Fix: `{"__name__": "__main__", "__file__": <abs path or "<nuclei>">, "__builtins__": ...}`. Pair with the R-9 worker.
- Regression tests: main-guard program builds and runs; `__file__`-relative path program.

### R-11 (High, machine safety) No memory/size guard; huge frames to the webview
- Symptom: GHZ on n qubits (`mem.py`, kernel under a 24 GB `prlimit`): n=16 0.4 s/0.1 GB/1.6 MB frame; n=20 1.7 s/0.6 GB/25 MB; n=22 6.4 s/2.1 GB/101 MB; n=24 26.4 s/7.8 GB/403 MB. Unlimited 26-qubit runs on two kernels reached ~22 GB RSS each (59 of 62 GB used) on the owner's shared gaming PC and had to be killed by hand. With a limit they surface as `MemoryError`, which is the only guard.
- Root cause: no qubit cap anywhere on the editor path (`qiskit_adapter.simulate` makes a statevector copy, runs a second Aer pass, converts all 2^n amplitudes into a Python list of `{re, im}` dicts, then `json.dumps` the lot over the WebSocket: `qiskit_adapter.py:141-152`, `cirq_adapter.py:149-166`, `server.py` result send). `MAX_DEBUG_QUBITS`/`REFERENCE_MAX_QUBITS` exist only for debug/reference paths.
- Fix: a policy constant (e.g. full statevector payload <= 16 qubits; <= 22 with probabilities only; refuse above a memory estimate computed BEFORE simulating with a plain-language error and an "estimate only / use MPS or the Lab" option), `RLIMIT_AS` in the R-6 worker, and cap/truncate `state_vector` and `probabilities` in the result with an explicit `truncated` field (no silent trimming). PRD 15's surrogate suite must never enter this path for n above the cap.
- Regression tests: n=30 returns `too_many_qubits` in <1 s without allocating; n=22 frame size bound; worker `RLIMIT_AS` death reported as `worker_died`.

### R-12 (Med) `plt.show()` hangs the kernel; no inline plot support
- Symptom: with the default Matplotlib backend and `DISPLAY` set, `plt.show()` in user code blocks the worker thread forever (execute timed out at 20 s); with `MPLBACKEND=Agg` it returns in 0.4 s with "FigureCanvasAgg is non-interactive". Plots are never shown to the user either way. VQE convergence plots are standard research code.
- Root cause: `kernel.rs:62-73` `configure_kernel_env` inherits the GUI environment and sets nothing for Matplotlib; the kernel never sets a backend (`grep MPLBACKEND kernel src-tauri/src` is empty). First use also builds the font cache (observed "Matplotlib is building the font cache" during the first Lab inspect), a multi-second stall.
- Fix: set `MPLBACKEND=Agg` in `configure_kernel_env` and in `server.py` (`os.environ.setdefault`); capture figures at end of run and ship them as PNG to an Output panel (a feature, but it removes the hang regardless); pre-warm the font cache at venv provisioning.
- Regression test: execute program with `plt.show()` returns <2 s with `DISPLAY` set.

### R-13 (Med) Adapter TypeErrors for `initialize`, `unitary`, `if_test` (no snapshot at all)
- Symptom: `adapter_error: TypeError: float() argument must be a string or a real number, not 'complex'` (`initialize`), `only 0-dimensional arrays can be converted to Python scalars` (`unitary`), `... not 'QuantumCircuit'` (`if_test` block param). The whole snapshot is lost, so the diagram is blank.
- Repro: `q25-initialize`, `q26-unitary-gate`, `q20-if_test-dynamic` (all envs).
- Root cause: `qiskit_adapter.py:52` `params.append(float(p))` on non-real params.
- Fix: non-real/array/circuit params -> emit `0.0` with a descriptive symbol label (`"<complex[2]>"`, `"<unitary 4x4>"`, `"<block>"`) rather than raising; unit-test each. Keep the adapter total: a snapshot failure must degrade to "snapshot unavailable" and still allow Run.
- Regression tests: snapshot of each special instruction.

### R-14 (Med-High) Qiskit 2.x installed, Qiskit <2 pinned and tested
- Symptom: the owner runs Qiskit 2.6.0. `kernel/requirements.txt` and `agent-requirements.txt` pin `qiskit>=1.2,<2.0`; CI (`kernel-tests.yml`, python 3.12) installs only that. Programs using removed 1.x APIs fail in the owner env but pass in CI: `from qiskit.primitives import Sampler/Estimator` (V1) -> `ImportError`, `.c_if()` -> `AttributeError`, `bind_parameters` -> `AttributeError` (`q16`, `q17`, `q18`, `q19`; `min` passes q16/q17/q19). The kernel suite on a Qiskit-2.6 venv (`pytest_qk2.out`: 2074 passed, 7 failed, 11 errors) shows one real incompatibility: `test_trainability_adapters_unbound::test_qiskit_unbound_snapshot` (symbolic string ordering `"0.3 + 2*theta"` vs `"2*theta + 0.3"`), plus the optional-dependency failures in R-21.
- Root cause: `frameworks.rs:37` catalog `pip_name: "qiskit qiskit-aer"` has no bound; the catalog and `requirements.txt` disagree.
- Fix: choose and enforce one range. Either pin the catalog to the tested range, or (preferred, because the owner is already on 2.x and new users will be) test and support 2.x: add a CI matrix leg for `qiskit>=2`, route removed-API errors through `errorRewrite` with the migration, and make symbolic-string comparisons order-insensitive. PRD 15 code that touches Qiskit APIs must run on both.
- Regression tests: CI matrix; kernel corpus golden per Qiskit major.

### R-15 (Med) Missing-dependency UX is only wired for the editor
- Symptom (code): `useKernel.ts:245-247` reports `missing_dependency` to `MissingDependencyBanner`. Lab, Discovery, QEC campaign/generate and Estimator sessions use other sockets (`kernelSession.ts`, `lab/labSession.ts`) and surface the same error as an opaque message string (`grep -rn missing_dependency src` finds no other consumer). The owner's venv lacks stim/sinter/pymatching, so QEC Studio and the `qec_memory` Discovery evaluator are unavailable; the kernel messages are correct (verified), the discoverability is not. PRD 15 ideas 7/8 add more optional dependencies.
- Fix: route `missing_dependency` from every kernel session into the shared store, and give each panel an "unavailable: needs stim, pymatching [Install]" state with the catalog entry resolved via `framework_resolve`. Add the Research catalog group (stim, sinter, pymatching) to onboarding for `onboarding_path: research`.
- Regression tests: Playwright against a stub that returns `missing_dependency` from each panel; real-kernel test on the `min` venv.

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

### R-19 (Med) Discovery sandbox is unavailable on this OS; falls back to unrestricted
- Symptom: `bwrap --ro-bind / / true` fails with `setting up uid map: Permission denied` (`kernel.apparmor_restrict_unprivileged_userns=1` on Ubuntu 24.04). Discovery evaluations report `isolation: "process"`, `isolation_detail.reads: "unrestricted"` (`iso.py`). This is honest (the UI label comes from the kernel) but it means candidate code runs with full user file access on the owner's box.
- Root cause: `kernel/discovery/isolation.py:224` selects bwrap whenever the binary exists; the verification step correctly downgrades. No fix needed in the label; a product decision is needed for PRD 15 idea 2 (Red Queen adversary running generated candidates) on Ubuntu 24.04 (AppArmor profile for bwrap, or require explicit user consent per run when isolation is `process`).

### R-20 (Low) `multiprocessing` and user-defined picklables fail
- Symptom: `Pool.map` on a function defined in the editor: `PicklingError: Can't pickle <function f>: attribute lookup f on __main__ failed` (`r03`). Parallel parameter sweeps are common in research code.
- Fix: falls out of the R-6/R-10 worker (a real `__main__` module with the file contents, spawn-safe). Document `fork` limits.

### R-21 (Low-Med) Test-infrastructure gaps that hide the above
- `tests/e2e/qec-import.spec.ts` fails on this box: `Real QEC Data Engine exited before readiness ... No module named 'websockets'`; `support/qecDataEngine.ts:75` defaults to system `python3` unless `NUCLEI_E2E_PYTHON` is set. Default it to the repo `.venv` or skip with an explicit reason.
- On a managed-venv-like env (no pyarrow/duckdb/jsonschema/stim), `pytest kernel/tests` has 11 collection errors (`kernel/tests/qec_data/*`, `test_qec_data_schemas.py`, `test_qec_import_chunk_schemas.py`: `ModuleNotFoundError: duckdb|pyarrow|jsonschema`) and 6 docs-fixture failures (`test_docs_fixtures.py`: `environment`, `qec_generate`, `qec_decode_sample`, `qec_studio`, `lab_discovery_evaluators`, `qec_campaign_start_invalid` assume stim is installed). The `pytest-minimal-venv` CI job hides this by running only `test_discovery_optional_deps.py` + `test_trainability_*.py`.
- `cargo test --lib` appears to touch the real `~/.nuclei/runtime`: after I ran it, `kernel-owner.json` (the shell's ownership record for the owner's running app, which also had pid 2587203) was gone while `kernel.json` was unchanged. I could not confirm which test; `kernel_ownership::runtime_dir()` (`kernel_ownership.rs:31-41`) falls back to `$HOME/.nuclei/runtime` in debug builds when `NUCLEI_RUNTIME_DIR` is unset, and `kernel_legacy::tests::live::*` exercise it. Tests must set `NUCLEI_RUNTIME_DIR` to a tempdir. Side effect on the owner: that app instance can no longer prove it owns its kernel for stale-kernel reaping; restarting the app rewrites it. I tried to restore the 27-byte file and was blocked by the permission guard, so I left it as is.

### R-22 (Low) Unbounded stdout
- A program printing 100 k lines sends one ~1.2 MB `output` frame (`r04`). Cap per-run output (e.g. 256 KB with a visible "output truncated" line).

### R-23 (Low) Misc
- `qc.draw('mpl')` needs `pylatexenc` (clear `MissingOptionalLibraryError`; `q33`).
- User code that itself calls `qc.save_statevector()` then runs Aer (`q39`) errors with "select a circuit" (user-code issue; note only).
- `input()` raises `EOFError` (acceptable; message could say "interactive input is not supported").

## 5. What already works (so PRD 15 can rely on it)

- Kernel boot, v2 auth handshake with mutual proof, Origin/Host checks, `environment`, `transpile`, `debug_trace`, `lint`/`format` when ruff exists.
- Plain Qiskit/Cirq circuits ending in measurements; GridQubit/LineQubit, fractional gates, noise via `with_noise`, `MatrixGate`, custom gates, Cirq `qft`.
- Q# (owner env): Bell, parameterized `Rotate` (not named `Main`), `DumpMachine`; compiler errors map to `compile_error`. Experiments: `params`, `seed`, `record_metric`, `seed_honored` are returned correctly for qiskit, cirq and Q# when the circuit measures (`exp.py`).
- Trainability: `inspect/lint/start` complete in ~1.5 s on plain parameterized Qiskit/Cirq circuits including `rzz/rxx/cry/u/ccx`, with `status=complete` on `owner`, `min` and `dev` alike (the Lab does not need stim or ruff). Missing optional packages are reported honestly (`qec_memory available:false missing:[stim,pymatching]`).
- Discovery `state_synthesis` evaluates the lab fixture in ~2 s on `owner`; QEC `qec_generate` + sinter campaign + pymatching complete in 0.7 s on `dev`.
- Q# parameterized `Main` is correctly rejected by qdk (`entry point cannot have parameters`).

## 6. Systemic causes

1. The Run path was built and tested for "a measured Bell circuit". Every adapter assumption (measured, bound, basis gates only, real params, qubits small, one framework import) is an unchecked precondition, and each fails with a framework traceback instead of a handled state.
2. The kernel runs user code on a thread inside the server process. That one decision causes R-6, R-7, R-8, R-10, R-11 and R-12 (no kill, no limits, shared event loop, shared GUI/env) and constrains R-9. The Trainability and Discovery paths already use subprocess workers with limits; the editor/experiments path is the outlier.
3. The kernel and the shell do not share a model of the environment: the Rust catalog (unpinned qiskit, no ruff, no scipy declaration), `kernel/requirements.txt` (`<2`) and CI (Python 3.12, Qiskit 1.x) describe three different installs, and the installed app matches none of CI's. `scipy`, which `trainability/lie_core.py:367` and `discovery/hamiltonians.py` import lazily, is not declared anywhere (it arrives transitively with qiskit/cirq).
4. Tests mock the boundary that fails. All Playwright specs install a `StubKernelSocket` or a stub bridge with canned results (`tests/e2e/*.spec.ts`), so UI-to-kernel contracts (what the Lab sends, what the editor does with `error` frames, Run on the open file) are never exercised. Kernel tests use hand-written circuits that already measure and bind.
5. Optional dependencies are handled well in the kernel and poorly at the edges: only the editor path surfaces `missing_dependency` as an actionable state; test suites and docs fixtures assume the full package set.
6. Diagnostics are invisible in release builds (WARN-only logging, no environment panel at the moment of failure), so "it won't run" reports lose their evidence.

## 7. Proposed reliability gates

Tiered so each PRD 15 wave can use them as an exit criterion.

### G0. Research corpus golden (kernel-level, ~1 minute, run in 3 envs)
- Promote `~/nuclei-handoff/scout-linux/corpus.py` into `kernel/tests/research_corpus/` with a committed `expected.yaml` (id -> `{parse, execute, error_code}` per env: `min` Qiskit<2 + ruff, `qk2` = what the app installs (Python 3.13, unpinned qiskit/qiskit-aer/cirq/qdk), `full`). Drive it through the real WebSocket server with the auth client (the harness `kclient.py` is the template) so it covers the server, executor and adapters together.
- Known failures are recorded as `xfail(strict=True)` entries with the R-id, so fixing one flips the build until the golden is updated. Each PRD 15 feature adds its own programs (surrogate suite, kernel diagnostics, decoders) before implementation (RED), per the TDD rule.
- New CI jobs in `kernel-tests.yml`: `corpus-minimal` (requirements.txt only), `corpus-app-env` (installs exactly the catalog packages by running the same pip lists as `frameworks.rs` against a fresh `python -m venv`, Python 3.13, no pins), `corpus-full`. Extend `pytest-minimal-venv` to run the whole `kernel/tests` with `--continue-on-collection-errors=false` after adding `pytest.importorskip` to the 11 test modules and the stim-dependent docs fixtures (R-21).
- Resource gates in the same suite: infinite loop returns `timeout`, `sys.exit` survives, 30-qubit refusal, 22-qubit frame size, `plt.show()` with `DISPLAY` set, queued parses.

### G1. Real-kernel Playwright, Tier A (no product change; build now)
Proof of concept (kept in `~/nuclei-handoff/scout-linux/e2e-poc/`, run with `npx playwright test -c <config>`): the spec starts the owner-env kernel with `NUCLEI_KERNEL_TOKEN` (32+ chars) and `NUCLEI_KERNEL_DEV=1`, serves the vite dev server on port 5173, opens `/?e2eProject=lab-project&workspace=research&labKernel=ws://127.0.0.1:<port>&labKernelToken=<token>` and drives the Trainability Lab. Observed on the wire: `authenticate` -> `authenticated` with proof, then `trainability_inspect`/`trainability_inspected` for the editor buffer. Findings that shape the harness:
- The kernel's dev Origin allowlist is exactly `http://localhost:5173` and `http://127.0.0.1:5173` (`auth.py:75-78`). Serving vite on 4173 (the Playwright config's port) is refused ("Could not connect to the kernel"). Add `NUCLEI_KERNEL_DEV_ORIGINS` (comma list, dev only) or run the real-kernel project on 5173.
- The web build's editor kernel is Pyodide (`platform.getPlatform() === 'web'` in `useKernel.ts:96`), so the Run button shows "Loading kernel..." and the editor cannot talk to a socket kernel through `labKernel`; the Lab uses the editor buffer (a default Bell state), not the fixture file, so "Run analyses" stays disabled ("no free parameters"). The fixture explorer click path did not load the fixture file into the editor within the time I allowed; the existing stub specs hide this because the stub answers regardless of the code sent.
- First Lab/Cirq use stalls on "Inspecting the circuit..." while Matplotlib builds its font cache (R-12).
- Result: connection and auth from a real browser origin work; a complete "open fixture file -> Run analyses -> verdict" real-kernel spec still needs the editor buffer to hold the fixture (set it through the store in `page.evaluate`, or expose `?e2eOpen=ansatz/hardware_efficient.py` in `e2eFixtureBridge`).

### G2. Real-kernel Playwright, Tier B (small product change, recommended design)
Add a DEV-only `?realKernel=ws://127.0.0.1:<port>&realKernelToken=<t>` branch to `createE2eFixtureBridge` that returns `{...base, getPlatform: () => 'desktop', startKernel: async () => 'ok', stopKernel: async () => 'ok', getKernelAuthToken: async () => token}` and makes `src/config/kernel.ts` read the port from that query in DEV (today `VITE_KERNEL_PORT` is build-time only). With the platform reported as `desktop`, `useKernel` connects through `openKernelConnection` exactly like the shell does, and the fixture bridge already supplies the fs/storage methods. 13 non-bridge files import `@tauri-apps/*` directly (App.tsx, `environment.ts`, `experimentFs.ts`, `qecStudyFs.ts`, ...); a one-day spike should list which of those throw in a browser and shim them behind the bridge.
Playwright fixture (global setup): pick a free port, spawn the kernel from the chosen venv (`owner-like`, `minimal`), wait for the ready line, expose port+token as env to the web server and tests, kill in teardown. Real-kernel specs (tag `@real`), each asserting visible RUNNING -> result/error states:
1. Open `ansatz/hardware_efficient.py`, Cmd+Enter: expect the "unbound parameters" info state (R-4), not a red error.
2. A no-measure statevector file runs and shows exact probabilities (R-1).
3. `EfficientSU2`/`ZZFeatureMap` file: Run and Lab inspect (R-2, R-5).
4. Infinite loop: Stop works, next Run succeeds (R-6); `sys.exit` survives (R-7).
5. Experiment sweep over a no-measure program with `params` and `seed`, runs table rows all `ok`, reproducible rerun.
6. Missing dependency: run with the `min` venv, QEC panel shows "Install stim" state (R-15).
7. Each PRD 15 feature: one `@real` spec per idea (certificate run -> verdict with intervals, kernel diagnostics, symmetry compile, export, decoder benchmark, verified suggestion apply).
CI: Linux job `real-kernel-e2e` using `actions/setup-python` 3.13 + the app-env venv recipe from G0.

### G3. Packaged-app smoke (nightly and release gate)
Can `tauri dev` run on this X11 box? Build prerequisites are present (`webkit2gtk-4.1` 2.52.6, GTK 3.24, rustc/cargo, `cargo test --lib` built and passed 210 tests here in ~10 minutes cold), and the installed `.deb` launches (window present on `:1`). Automation prerequisites are NOT present: `WebKitWebDriver`/`webkit2gtk-driver`, `tauri-driver`, and `xvfb` are not installed (`sudo apt install webkit2gtk-driver xvfb` plus `cargo install tauri-driver`). `npm run tauri dev` would open a window on the owner's live desktop, so do not run it here without asking. Gate design (GitHub `ubuntu-24.04`): build the `.deb`, install it into a clean `$HOME`, run under `xvfb-run` with `tauri-driver`, and assert (a) the managed venv is created and `environment_report.healthy`, (b) kernel ready line within 20 s, (c) run the Bell template and the lab ansatz, (d) `nuclei.log` contains start-up lines (R-17), (e) `nuclei --version` exits 0 (R-18). Because `tauri build` refuses npm/crate major.minor mismatches, run it as the pre-tag job.

### G4. Release-time "owner-env" check
A script `scripts/check-app-env.sh` that creates a venv exactly as the shell does on the release OS image (system Python, `KERNEL_CORE_DEPS`, then each catalog `pip_name` unpinned), runs the G0 corpus against the freshly built bundle's `kernel/` directory, and fails on any unexpected status. This is what would have caught Qiskit 2.x drift (R-14) and the missing ruff (R-16).

## 8. What PRD 15 needs from the reliability track (Wave 0 ordering)

| PRD 15 item | blocked by | minimum fix before the feature is usable |
|---|---|---|
| 1 Quantumness certificate (surrogate suite on the user's circuit) | R-5, R-3, R-4, R-9, R-11 | decompose composite blocks, accept unbound ansatz, project root, size policy |
| 2 Goldilocks evaluator / Red Queen | R-19, R-6 | sandbox decision on Ubuntu 24.04, killable workers |
| 3 Noisy trainability | R-1, R-14 | noise runs without measure, Qiskit 2.x |
| 4 Quantum-kernel diagnostics | R-5 (`ZZFeatureMap`), R-2, R-9 (datasets in the project) | feature maps decompose; data loading from project |
| 5 Symmetry compiler | R-5, R-13 | composite expansion, total adapter |
| 6 Train quantum, deploy classical | R-9 (exports into project), R-10, R-12 | project cwd/outputs, main guard, plot capture |
| 7 Learned decoders vs MWPM | R-15 (stim/sinter/pymatching + a training dependency), R-6, R-11 | dependency UX, cancellable training, memory limits |
| 8 Verified Dirac suggestions | R-6, R-8 | cancellable verification jobs, no per-keystroke exec |

Recommended Wave 0 (sequential small waves, Sonnet implements, Opus reviews, each item lands with its corpus entry):
1. W0a adapters: R-1, R-2, R-3, R-4, R-13 (one adapter PR per framework, corpus first).
2. W0b execution model: R-6, R-7, R-8, R-9, R-10, R-11, R-12 as ONE design (subprocess worker + cancel + limits + project root), because the pieces share the same seam; time-box a design note first.
3. W0c environment: R-14, R-15, R-16, R-17, R-18, R-21 (catalog/pins, banner everywhere, ruff, logging, test hygiene).
4. W0d gates: G0, then G2 (G1 is already feasible), G3 as a nightly.

## 9. Appendix: raw results

- Corpus tables: `~/nuclei-handoff/scout-linux/sum_owner.txt`, `sum_min.txt`, `sum_dev.txt` (65 programs each ran before the `sys.exit` wedge stopped the first pass; `e07`-`e09` and `r01`-`r05` were re-run singly). Differences between envs: `q16/q17/q19` (Qiskit 2 removed APIs), Q# (needs qdk), Stim (needs stim); everything else is identical, which is why most bugs here are code bugs, not environment bugs.
- Lab/Discovery/QEC: `lab2_*.txt` (inspect/lint/start for 17 circuits x 3 envs, identical), `lab_owner.json`, `lab_dev.json`, `qec.py` output (owner: `missing_dependency`; dev: campaign result in 0.7 s).
- Memory curve: `mem.py` (24 GB cap) as in R-11. Backlog: `backlog.py` (10.8 s). sys.exit: `sysexit2.py`.
- Baselines (this worktree, Node 24.21 / vitest / tsc / eslint, Python 3.12 dev venv, cargo, Playwright chromium 1228): vitest `Tests 2099 passed`; `tsc -b` exit 0; `eslint .` 0 errors 5 warnings; pytest dev `2702 passed, 13 skipped, 3 deselected`; pytest Qiskit-2.6/no-optional-deps `7 failed, 2074 passed, 42 skipped, 11 errors`; cargo `210 passed; 0 failed; 1 ignored`; Playwright `26 passed, 3 skipped, 1 failed (qec-import, R-21)` in 1.6 min with 3 workers.
