# Brief — PRD 15 unit R-B

Plan: docs/research/PRD_15_QUANTUMNESS_LAB.md (master). Specs: docs/research/PRD_15/*.md. This brief is your requirements; values in it are binding verbatim.

## Your unit (master plan rows — §5.1 Track R table and/or §7 wave table)

| **R-B Execution model** (Wave 0b) | **Scope: every message that executes user code** — `parse`, `execute`, `transpile`, `debug_trace`, `run_python`, `hardware_submit` (`_prepare_hardware_payload`), `qec_materialize`, `trainability_inspect`, `trainability_lint`, `symmetry_detect`, `symmetry_propose`, `deploy_inspect`, `qec_learned_sources` (circuit kind) — all routed through a **warm run-worker pool** (`kernel/run_worker.py`: a pre-imported fork-server / persistent worker recycled after execute, cancel, timeout or crash; a fresh interpreter costs ≈ 1.2 s and 270 MB just to import numpy/qiskit/aer/cirq, so per-run interpreters are **not** the design). Latency budgets: parse p50 ≤ 150 ms over program time, Run overhead ≤ 300 ms, lint within 0.35 s. One **code-hash-keyed loaded-circuit cache** shared by parse, inspect, lint, symmetry_detect and deploy_inspect so the program executes once per code version with the Lab open (perf test asserts a single exec). Worker sets `cwd`, `sys.path = [project_root, stdlib, site-packages]` (the kernel is launched as `python -m kernel.server` / strips its script dir, and the worker purges Nuclei's top-level modules from `sys.modules` before exec, so a researcher's sibling `kernel.py`, `noise.py`, `models.py`, `symmetry.py` wins — R-9), `__file__`, `__name__ == "__main__"` (R-10), per-run output dir; env = the full user environment minus `KERNEL_SECRET_ENV` (never `lab_proc.minimal_env`, which would strip `HOME`, proxies, `QISKIT_*`, provider env) plus `MPLBACKEND=Agg` and the `PINNED_ENV` thread caps; limits: wall-clock, `RLIMIT_CPU`, **group-RSS ceiling via `procrun`** (never `RLIMIT_AS`/`RLIMIT_NPROC`; per-OS: Linux/macOS RSS polling, Windows Job Object or polling), stdout/stderr caps (R-22); `run_id` on parse/execute, `run_cancel {run_id}` (R-6); `SystemExit`/`os._exit` → `user_exit`/`worker_died`, kernel stays up (R-7); parse coalescing + static AST fast path + 500 ms live-preview opt-in (R-8); R-11 **memory-estimate policy**, not a fixed qubit count: estimated peak = copies × 2ⁿ × 16 B vs `min(25 % of physical RAM, user setting)`; never return state vectors above 16 qubits; above budget → `too_many_qubits` with the estimate and a "Use Aer MPS / run in the Lab" action re-running with `method=matrix_product_state`; `truncated` field; R-12 figure capture → `figures`; R-20 real `__main__` module (spawn-safe); R-3 detection in `kernel/framework_detect.py` | `kernel/executor.py`, `kernel/run_worker.py`, `kernel/framework_detect.py`, `kernel/server.py` (parse/execute/run_cancel branches + `-m` launch), `kernel/trainability/_usercode.py` (`run_namespace` → pool), `kernel/tests/test_run_worker.py`, `kernel/tests/test_framework_detect.py`, `kernel/tests/test_executor_run_path.py`, `kernel/tests/research_corpus/r_b/**`, `docs/research/PRD_15/R_EXECUTION_MODEL.md` (design note first, time-boxed; carries the exec-path list) | `while True` → `timeout` within N s and the next request succeeds, **for every path in the list** (one corpus program per path: sibling import, relative data read, `while True`, `os._exit`); `run_cancel` kills within 1 s; a stale `run_cancel` is ignored; `sys.exit`/`exit()`/`quit()`/`os._exit` survive; N queued parses leave Run latency ≤ 1 program time; single exec per code version with inspect+lint+detect active; sibling `kernel.py`/`noise.py`/`models.py` shadow Nuclei's; write into the run dir; traversal refusal; main-guard program runs; n=30 → `too_many_qubits` in < 1 s without allocating; n=24 sampled run ok; RSS ceiling exceeded → `worker_died`/`too_much_memory`, kernel alive; `plt.show()` with `DISPLAY` returns < 2 s; `Pool.map` on an editor function works; 100 k lines → truncated with a note; table-driven detection; macOS leg of `test_run_worker.py` |
| **R-B** Execution model | design note `docs/research/PRD_15/R_EXECUTION_MODEL.md` first (time-boxed; carries the exec-path list and the 17-importer shim list for F-3), then the warm worker pool for every user-code path, cache, limits, `sys.path`, env, memory policy, `run_id` | §5.1 |

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

### R-3 (High) Framework detection misses sub-module imports
- Symptom: `No supported quantum framework detected in code.` for a program whose only qiskit import is `from qiskit.circuit.library import EfficientSU2` (also `from qiskit.quantum_info import ...`, `from qiskit_aer import AerSimulator`, `from cirq.contrib...`).
- Repro: `q09`..`q13` (owner/min/dev) `parse` and `execute` both error `unsupported_framework`; adding `import qiskit` makes detection pass (then R-2 hits).
- Root cause: `kernel/executor.py:87` `from\s+qiskit\s+import|import\s+qiskit` and `:94` `import\s+cirq|from\s+cirq\s+import`. `from qiskit.x import y` and `from qiskit_aer import` match neither. (Note `import qiskit_aer` happens to match via the `import\s+qiskit` prefix; `from qiskit_aer import` does not.)
- Fix: `^\s*(?:from|import)\s+qiskit(?:_aer|_ibm_runtime)?\b` (multiline, same for cirq/cirq_google/stim); also prefer the circuit-type scan after exec when detection fails but the namespace contains `QuantumCircuit`/`cirq.Circuit`. The trainability `_usercode` path already finds circuits by type and is unaffected (verified: `qiskit-efficientsu2-only-import` reaches `unsupported_gate`, not detection failure).
- Regression tests: table-driven `resolve_framework` test with each import form.


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


### R-20 (Low) `multiprocessing` and user-defined picklables fail
- Symptom: `Pool.map` on a function defined in the editor: `PicklingError: Can't pickle <function f>: attribute lookup f on __main__ failed` (`r03`). Parallel parameter sweeps are common in research code.
- Fix: falls out of the R-6/R-10 worker (a real `__main__` module with the file contents, spawn-safe). Document `fork` limits.


### R-22 (Low) Unbounded stdout
- A program printing 100 k lines sends one ~1.2 MB `output` frame (`r04`). Cap per-run output (e.g. 256 KB with a visible "output truncated" line).


## Controller rulings for this unit (binding)
- The design note docs/research/PRD_15/R_EXECUTION_MODEL.md is pre-written by an Opus architect at .superpowers/sdd/PRD_15_QUANTUMNESS_LAB/R_EXECUTION_MODEL.md: copy it into the repo as your FIRST commit and implement to it. If implementation shows the note is wrong, amend the note in the same commit series and record a Decision: line.
- R-A runs in parallel and owns kernel/adapters/** (incl. binding.py) and kernel/models/snapshot.py: call adapters through their existing interfaces; for parameter binding import kernel.adapters.binding.bind_parameters (R-A creates it; until merge, code against the signature bind_parameters(circuit, parameter_values|random_seed) -> (circuit, bound_at) and test with a local stub).
- The corpus loader from R-D (Wave 0a, merged into your base) picks up kernel/tests/research_corpus/r_b/**: add one program per exec path there (RED first).
- Learn mode deprecated: challenge/lesson execution paths need no special handling beyond not breaking.
- Ownership amendment (design note D11, accepted): you also own kernel/trainability/handlers.py (the exec-path spots only), kernel/qec/materialize.py, kernel/qec/estimate.py, kernel/hardware/simulator_provider.py, kernel/models/errors.py. Route qec_snapshot (python stim), qec_estimate (qiskit), Q#/stim source runs and simulator hardware_submit through the pool too, plus the server.main() tripwire test.
- Lint availability (R-16 kernel side): you implement `lint_result.available: bool, reason?` (ruff missing → available:false with reason) — R-C's acceptance test for it is verified at the Wave 0 gate.
- CI: in Wave 0b no other unit edits .github/**, so you may add the macos-14 job for tests/test_run_worker.py to .github/workflows/kernel-tests.yml (append-only; keep R-D's jobs intact).
- Fix the latent `Executor.transpile` undefined `spec` bug (executor.py:789,807) as part of routing transpile.
- Corpus flips (supersedes any earlier wording about editing scout/expected.yaml): flip the scout/gates xfail(strict) entries for the R-ids you close through YOUR OWN kernel/tests/research_corpus/<unit>/overrides.yaml (supported by R-D's loader; see kernel/tests/research_corpus/README.md). Never edit scout/ or gates/ files.
- Wire shape ruling: `unbound_parameters` is sent as an error frame {type:"error", phase, code:"unbound_parameters", severity:"info", parameters:[names...], message} — info-class means the frontend renders it as a prompt (R-G), not a red error; the corpus classifier sees it as error:unbound_parameters.
- Run the research corpus in the full and minimal envs before reporting: NUCLEI_CORPUS_ENV=full $(scripts/make-test-venvs.sh path full) -m pytest kernel/tests/test_research_corpus.py -q (and NUCLEI_CORPUS_ENV=min with the minimal venv). Zero unexpected statuses.
