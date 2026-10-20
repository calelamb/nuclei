# R-B — Execution model (design note)

Status: design note for PRD 15 unit **R-B** (Wave 0b), written by the R-B architect on 2026-10-19 against plan base `b9e3378`. R-B's first commit copies it to `docs/research/PRD_15/R_EXECUTION_MODEL.md`; if implementation proves part of it wrong, amend it in the same commit series and add a `Decision:` line to §0.
Binding sources: master §2.1 item 7, §2.5, §4.2, §5.1 (R-B row); audit R-3, R-6…R-12, R-20, R-22 (+ R-23 message wording). Wire fields this note adds beyond master §4.2 are listed in §6.2 so F-1 (v1.4 TS types) and X (protocol changelog) pick them up.

## 0. Decisions

- **D1 Process model.** Persistent, pre-imported, *spawned* workers (`sys.executable -I -c BOOTSTRAP REPO_ROOT`), one code path on Linux, macOS and Windows. No fork-server (§2.1).
- **D2 Two lanes.** One reusable **preview** worker that owns the loaded-circuit cache; one-shot **run** workers (a fresh process per execute-class op, with one warm spare) (§2.2).
- **D3 Execute never reads the cache.** Run always execs the program fresh, so prints, file writes, metrics, seeds and figures happen on Run. R-8's "Run reuses the circuit" is replaced by lane separation: queued previews can never delay Run (§3.4).
- **D4 IPC.** Length-framed JSON on a private control socket (POSIX `socketpair` + `pass_fds`; Windows loopback listener + 256-bit token). User stdout and stderr stay on the worker's real fds 1 and 2, which the pool reads; run boundaries are marked with per-worker random markers. The server never unpickles anything a worker sends (§2.4, §2.8).
- **D5 Pool shape.** The pool is a process-wide singleton with its own I/O thread and private event loop. `submit()` is thread-safe and returns a `concurrent.futures.Future`. Pooled message handlers run as tasks, so the connection loop keeps reading (it sees `run_cancel` and newer parses) (§2.5).
- **D6 No Rust change.** `server.py` strips its own script dir from `sys.path`, and workers build `sys.path` from scratch under `-I`. `python -m kernel.server` is optional hygiene, specified for R-C (§2.15).
- **D7 `sys.path` and cwd.** `sys.path = [file_dir if ≠ root, project_root, BASE]` and cwd = `project_root`. The file's directory is added so `cd root && python sub/x.py` semantics hold. This refines the brief's `[project_root, stdlib, site-packages]`.
- **D8 Lean path above 16 qubits.** Above 16 qubits the worker never calls the adapter's full `simulate`, which builds a 2ⁿ-entry list of `{re, im}` dicts (≈ 450 B per amplitude, consistent with the scout's 7.8 GB at n = 24). It uses the lean path in `kernel/run_memory.py` instead. Fold that path into the adapters after R-A merges (follow-up; owner R-A or X).
- **D9 Memory limits.** Hard ceiling = group RSS via `procrun.group_rss_bytes` on Linux/macOS and a Job Object on Windows; never `RLIMIT_AS` or `RLIMIT_NPROC`. Ceiling default 40 % of RAM per worker group; simulation budget `min(25 % RAM, setting)` (§2.7, §2.10).
- **D10 New fields only with `run_id`.** v1.4 reply fields (`run_id`, `preview`, `elapsed_ms`, `slow`, `timing`, …) are emitted only when the request carries `run_id`. Requests without one get today's frame sequence (docs fixtures stay byte-stable) plus the new safety error codes.
- **D11 Ownership amendment.** These files are uncontended in Run 0b, since R-A owns only `kernel/adapters/**` and `kernel/models/snapshot.py`. Beyond the brief's list, R-B edits:
  - `kernel/trainability/handlers.py`: `_inspect_sync`, `_lint_sync`, `_run_sync` only;
  - `kernel/qec/materialize.py`;
  - `kernel/qec/estimate.py`: `_qiskit_code_to_qasm3` only;
  - `kernel/hardware/simulator_provider.py`;
  - `kernel/models/errors.py`: an `extra` dict.

  R-B also creates the files in §9, including unit-test files beyond the three named in the brief. The controller must add these to `check-wave-ownership.py`'s view of Run 0b.
- **D12 Tripwire.** In-process exec of user code is forbidden in the server process (§1). It stays legal in Lab job workers, the agent worker and tests.

### Implementation decisions (recorded while building R-B)

- **D13 Memory policy lives in `Executor.execute`.** The R-11 plan and lean path run inside the executor (`kernel/run_memory.py`), not only in the worker op, so the disposable agent worker, the simulator provider and any embedder get the same guard. `Executor.result_extras` carries `bound_at`; figures ride on the worker's `LoadedProgram`.
- **D14 Un-id'd requests are answered in order.** Only a request that carries a `run_id` (v1.4 clients, whose frames echo it) and every `parse` run as concurrent tasks; any other routed request is awaited inline and its reply is drained before the next message is read, so replies keep today's order and the docs fixtures replay unchanged. This narrows risk 9 to v1.4 clients. A stream that merely ends (in-process fakes) lets in-flight tasks finish; a closed connection cancels them.
- **D15 Workers never write bytecode.** `sys.dont_write_bytecode = True`: an imported sibling must not leave a `.pyc` that a same-second, same-size edit would resurrect, and the project is not littered with `__pycache__`. Library bytecode is unaffected (already compiled).
- **D16 Deferred detection is bounded.** A program whose own imports name no framework is still run and scanned by circuit type only when it imports something non-stdlib (`Detection.foreign_imports`). `print('hello')` is still `unsupported_framework` without running anything. Third-party adapters registered in `ADAPTER_SPECS` keep routing through their own `detect_pattern`, ahead of the built-ins.
- **D17 `limits.wall_s` applies to every op.** The request limit (clamped 1..86 400) beats `NUCLEI_RUN_WALL_S`, which beats the op default. Scout `z04` is flipped with `limits.wall_s: 3` in `r_b/overrides.yaml`; the run lane default stays 600 s.
- **D18 File split.** `run_worker.py` (pool) is accompanied by `run_worker_proc.py` (spawn, control channel, marker splitting, output budget, group scans), `run_ipc.py` (framing), `run_ops_builtin.py` (the editor ops), `run_hardware.py` (circuit selection and QPY / Cirq-JSON transport) and `run_winjob.py` (Windows Job Object, untested off Windows). `kernel/tests/_pool_test_ops.py`, `_run_pool_fixtures.py`, `_run_server_helpers.py` and `_fake_lab_ops.py` are test infrastructure.
- **D19 Linux group scans read `/proc`.** One pass yields process count and RSS for the dirty check and the ceiling poll (no `ps` fork); macOS falls back to `ps`.
- **D20 `KernelError.extra`** is merged into the top level of the wire error (`to_dict`, `error_payload`) and omitted when empty; `KernelError.from_dict` is its inverse. `error_payload` moved to `kernel/models/errors.py` (re-imported by `server.py`).
- **D21 Exact lean path returns Bloch coordinates** for n <= 20 (Qiskit little-endian, Cirq big-endian); sampled lean results return none.
- **D22 Server keeps the stim text, not a circuit.** `qec_snapshot` without `code` rebuilds the payload from the connection's last stim text (`qec_snapshot_text` op). `Executor._last_qec_circuit` stays for in-process callers.
- **D23 `kernel.trainability.handlers` ops** are registered as `trainability_inspect` / `trainability_lint` message ops (`@worker_op`, `error_mapper`); a Lab handler awaits `run_worker.call_op`. `run_worker.set_inprocess_ops(True)` (fixture `inprocess_mode`) lets tests that monkeypatch what the op calls keep doing so.
- **D24 Figures are rendered inside the user context** (`RequestState.figures`, true for `execute` / `run_python`), because leaving it closes every figure.
- **D25 (review r1 fixes)** Decision: (a) the pool arms `RLIMIT_CPU` for every request (`limits.cpu_s = ceil(wall) + CPU_HEADROOM_SECONDS` unless the ctx carries one; `PoolConfig.cpu_headroom_s` for tests). (b) The pool's group-RSS scan is `kernel.discovery.procrun.group_scan` (the /proc fast path moved there; `_ps_scan` lives only there). (c) `Executor._capability_error` passes an adapter exception that declares `code in {unbound_parameters, unsupported_instruction}` through as that code with `severity` and `parameters`/`instruction` in `extra`, and `_bind_parameters` always consults `bind_parameters` for Qiskit/Cirq. (d) The lean path is for Qiskit and Cirq only; every other framework above 16 qubits (CUDA-Q, third-party adapters) is planned `adapter`: no 2ⁿ estimate (the adapter owns its memory model), `adapter.simulate` runs, and `shape_adapter_result` applies the same wire policy (no state vector, probabilities capped, `truncated`). (e) The lean Aer path goes through R-A's `prepare_for_aer`/`run_on_aer` when merged (fallback: `transpile(optimization_level=0)`), so library blocks behave the same above and below 16 qubits. (f) The exact lean path selects the top K with numpy (`top_indices`) before formatting anything, and counts four copies (state, Aer result copy, float64 probabilities, selection scratch) instead of three.
- **Open items.** macOS and Windows code paths are written to this note and unexercised here (the macOS CI job is added to `kernel-tests.yml`); docs-site pages that still describe the SIGALRM timeout and the v1.4 fields belong to unit X.

## 1. Every exec path (current → new route)

Walls are defaults (§2.7). "Cached" means the op reads and writes the preview worker's loaded-circuit cache (§3.3).

| # | Message | Today (file:line) | Exec site today | New route (op · lane) | Wall | Terminal frame |
|---|---|---|---|---|---|---|
| 1 | `parse` | `server.py:358-396` → `Executor.parse` `executor.py:380-427` | `_run_code` :405 (`exec` :351) in `asyncio.to_thread` | `parse` (static fast path → cache → exec) · preview, cached | 10 s | `snapshot` / `error` |
| 2 | `execute` | `server.py:398-466` → `Executor.execute` :429-508 | `_run_code` :471 | `execute` · run | 600 s | `result` |
| 3 | `run_python` | `server.py:468-491` → `Executor.run_python` :377 | `_run_code` | `run_python` · run | 600 s | `python_result` |
| 4 | `transpile` | `server.py:493-553` → `transpile_explore` :868 → `_prepare_transpile_circuit` :829 | `_run_code` :848 | `transpile` · preview, cached | 60 s | `transpile_result` |
| 5 | `debug_trace` | `server.py:555-586` → `Executor.debug_trace` :510 | `_run_code` :536 | `debug_trace` · preview, cached | 30 s | `debug_trace_result` |
| 6 | `qec_snapshot` (with `code`, Python stim) | `server.py:673-696` → `qec_snapshot_payload` :675 | `_run_code` :722 | `qec_snapshot` · preview, cached. Without `code`: `qec_snapshot_text` over the connection's last stim text (no Python exec) | 30 s | `qec_snapshot` / `error` |
| 7 | `qec_materialize` | `server.py:698-718` → `qec/materialize.py:29` | `executor._run_code` :50, `fn(noise_dict)` :66 | `qec_materialize` · preview, cached; `nuclei_circuits(noise)` is called inside the user context | 60 s | `qec_circuits` |
| 8 | `qec_estimate` | `server.py:720-740` → `qec/estimate.py:116` | `exec` :93 (language `qiskit`); Q# `qsharp.eval` on the qdk thread | `qec_estimate` · run | 600 s | `qec_estimate_result` |
| 9 | `hardware_submit` (Python → device) | `server.py:901-924` → `_prepare_hardware_payload` `server.py:201-256` | `exec` :249 (to_thread) | `hardware_prepare` · run. Returns a serialized circuit (Qiskit QPY base64, Cirq `cirq.to_json`, Q#→Azure QIR); the server deserializes and calls `provider.submit_job` | 120 s | `hardware_job_submitted` |
| 10 | `hardware_submit` (provider `simulator`) | `server.py:915` → `simulator_provider.py:53-59` `Executor.execute` | exec **on the event-loop thread** (blocks every connection) | `execute` · run → `PrecomputedRun{result, error}` passed to `SimulatorProvider.submit_job` | 600 s | `hardware_job_submitted` |
| 11 | `trainability_inspect` | `trainability/handlers.py:173` → `_run_sync` :112 → `_inspect_sync` :107 → `inspect.py:55` → `_usercode.load_circuit` :94 → `run_namespace` :57 | `exec` :71 | worker op `kernel.trainability.handlers:_inspect_sync` · preview, cached | 30 s | `trainability_inspected` / error envelope |
| 12 | `trainability_lint` | `handlers.py:175` → `_lint_sync` :89 → `inspect.load_for_lint` :80 → `load_circuit` | same | worker op `…:_lint_sync` · preview, cached | 30 s | `trainability_lint_result` |
| 13 | Q# / raw-stim source on rows 1, 2, 8 | `qsharp_adapter.py` `parse_source` :561 / `execute_source` :594 (qdk thread; a runaway wedges it until restart); `stim_adapter.py` :190 / :201 | qdk / stim (not Python) | Same ops. The source-mode branch runs inside the worker; a Q# wedge → `timeout` → worker killed → fresh worker | per op | per op |
| 14 | `symmetry_detect` (S1, future) | `kernel/symmetry/handlers.py` | `load_circuit` | `@worker_op("symmetry_detect", lane="preview", cached=True)` in S1's own module | 30 s | `symmetry_detected` |
| 15 | `symmetry_propose` (S2+S3, future) | `kernel/symmetry/propose.py` | `load_circuit` | preview, cached | 30 s | `symmetry_proposals` |
| 16 | `deploy_inspect` (D3, future) | `kernel/deploy/handlers.py` | `load_circuit` + declarations (`nuclei_model` callables run in the worker) | preview, cached | 30 s | `deploy_inspected` |
| 17 | `qec_learned_sources`, circuit kind (L3+L4, future) | `kernel/qec/learned/handlers.py` | exec of the Python circuit source (the DEM and campaign kinds only read files) | preview, cached (circuit kind only) | 60 s | `qec_learned_sources_result` |

**Extension rule for rows 14-17.** The owning unit:
- decorates a sync function in its own module with `@worker_op(name, lane="preview", cached=True, wall_s=…, error_mapper=…)`;
- calls `await run_worker.call_op(ctx, fn, msg)` from its async handler;
- loads circuits with `kernel.trainability._usercode.load_circuit` (or `run_context.current().load_program`), so it shares the cache with no edit to `run_worker.py`, `run_ops.py` or `server.py`.

`kernel/tests/_fake_lab_ops.py` registers stand-ins for 14-17 so the every-path test exercises the extension point now.

**Not pooled.** These paths are already isolated and R-B leaves them unchanged:
- `agent_execute` (`server.py:1021` → `agent_worker.py`): a disposable subprocess for model-generated code, with its own RLIMITs and import blocker.
- Lab jobs (`trainability_start`, conjecture tests, `trainability_verify`, `deploy_export`, symmetry and qec_learned jobs): LabJobManager subprocesses (`job_worker.py:132,194`). F-1 adds `project_root` and the RSS ceiling there.
- `discovery_evaluate` and audits: candidate sandboxes (R-F).
- `discovery_mutate` and `discovery_program_key`: AST and hash only, no exec.

**No user Python executed.** These stay in-process (to_thread): `lint`/`format` (ruff subprocess), `qec_generate`, `qec_decode_sample` (`qec/campaign.py:453`, stim text) and `qec_campaign_*` (sinter's own processes). `qec_decode_sample` is a later candidate for the preview lane, because a `REPEAT 10^9` circuit can hang it.

**Tripwire (D12).** `server.main()` calls `run_context.forbid_inprocess_exec()`. After that, these raise `InProcessExecForbidden` if reached in the server process:
- `Executor._run_code` (non-worker mode);
- `_usercode.run_namespace` (non-worker mode);
- `estimate._qiskit_code_to_qasm3`;
- the exec branch of `_prepare_hardware_payload`.

`test_run_worker.py::test_server_never_execs_in_process` drives rows 1-12 through a real server and asserts the tripwire never fired (kernel log scan). A missed path fails loudly instead of silently running in the server.

## 2. Warm run-worker pool

### 2.1 Process model (why persistent spawned workers)

Measured on the owner's Linux box (py 3.12 dev venv, 16 cores):
- `python -I -c "import numpy, qiskit, qiskit_aer, cirq"`: **1.32–1.52 s** wall, **272 MB** max RSS.
- A Bell run in a warm process: 37–48 ms.
- Fork from a pre-imported parent + Bell run + exit: 60–64 ms.

Fork-server is rejected:
- **Linux.** `import cirq` starts a `jemalloc_bg_thd` thread (pandas → pyarrow), so the zygote is multi-threaded before any warm-up. CPython 3.12 printed *"This process is multi-threaded, use of fork() may lead to deadlocks in the child"* in the probe. Any rayon/OpenMP pool started by a warm-up would deadlock children.
- **macOS.** Fork after Accelerate/libdispatch/ObjC initialisation is unsafe (the reason CPython defaults to spawn there), and we cannot prove otherwise without a Mac in the loop.
- **Windows.** There is no fork.

Persistent workers give one code path everywhere. The spawn cost stays off the critical path because a spare spawns in the background the moment a worker is taken. The cost moves to sweeps (§10, risk 2).

### 2.2 Lanes, pool size, footprint

| Lane | Workers | Reuse | Ops |
|---|---|---|---|
| preview | exactly 1 | reused after the §2.6 reset; holds the loaded-circuit cache (LRU 4) | rows 1, 4, 5, 6, 7, 11, 12, 14-17 |
| run | 1 warm spare (0 if RAM < 6 GiB); ≤ 2 busy at once; ≤ 2 concurrent spawns overall | one op per process; then the worker exits and its group is killed | rows 2, 3, 8, 9, 10 |

- **Idle footprint** ≈ 2 × 275 MB. The server process no longer imports qiskit or cirq, except lazily for QPY/Cirq-JSON deserialization on hardware submit.
- **Sweep adaptivity.** When two or more executes arrive within one measured spawn time, run spares rise to `min(3, cpu_count // 2)`. They fall back after 60 s without an execute.
- **Idle reaping.** An idle run spare is reaped after 30 min and respawned on the next Run (that Run pays one spawn).
- **Startup.** The pool starts after the server prints its ready line, so it never eats into the shell's 20 s ready timeout. The first parse waits for the preview worker, as the in-process import does today.
- **Package change detection.** Before each request the pool stats the BASE site-packages dirs. An mtime change (a framework install) recycles all workers first.

### 2.3 Worker bootstrap (`kernel/run_worker_main.py`)

1. Read the hello line from stdin (JSON: `worker_id`, `lane`, control fd or port+token, `marker`, `base_sys_path`, `limits`). Then `dup2(devnull, 0)` and `sys.stdin = open(os.devnull)`, so `input()` cannot touch IPC.
2. On Linux, `prctl(PR_SET_PDEATHSIG, SIGKILL)` via ctypes, then exit if `getppid()` changed. Spawn only from the pool's I/O thread, which lives as long as the process: PDEATHSIG is tied to the forking thread.
3. `sys.stdout.reconfigure(line_buffering=True, write_through=True)` (same for stderr, since `-I` ignores `PYTHONUNBUFFERED`). Set `sys.breakpointhook` to a no-op.
4. **Pre-import (stock).**
   - numpy; qiskit (+ `qiskit.qpy`, `qiskit.quantum_info`, `qiskit.transpiler.preset_passmanagers`); qiskit_aer; cirq; matplotlib + pyplot with Agg.
   - `matplotlib.font_manager`, which builds or loads the font cache once (R-12's first-use stall).
   - Nuclei: `executor`, `framework_detect`, `run_context`, `run_cache`, `run_memory`, `run_figures`, `preview_static`, `run_ops`, `models`, `adapters.{qiskit,cirq,stim}_adapter`, `trainability.{_usercode,inspect,handlers,lint,convert,linetrace}`, and `qec.{materialize,dem}` when stim is present.

   Optional frameworks (stim, qdk/qsharp, cudaq) are imported lazily per request. New spares pre-import any framework already used this session (`PoolConfig.session_preimports`). Every import is wrapped in `try/except ImportError`, because the minimal venv may lack some of them.
5. **Warm-up.** Build and simulate a Bell circuit through `QiskitAdapter`, then `plt.figure(); plt.close("all")`. This moves the ≈ 40 ms first-call cost out of the first Run.
6. **Baseline.**
   - Snapshot BASELINE (§2.6) and `os.chdir` to a private scratch dir (`tempfile.mkdtemp("nuclei-worker-")`).
   - Remove `REPO_ROOT` from `sys.path` and install `NucleiKernelFinder`: a meta-path finder that serves `kernel`/`kernel.*` from `REPO_ROOT` only *outside* the user context.
   - Install the dependency audit hook (§3.3, dormant outside the user context) and wrap `multiprocessing.spawn.get_preparation_data` (§2.12).
7. Connect the control channel and send `ready {pid, pgid, lane, import_ms, python, preimported, rlimit_cpu_hard, memory_ceiling: "rss_poll"|"job_object"|"unavailable"}`.
8. **Loop.** Receive a request → dispatch → send `done`. Then reset (preview) or flush and `os._exit(0)` (run).

### 2.4 IPC

- **Channels.**
  - Control socket, bidirectional: requests and replies.
  - fd 1 and fd 2: pipes read by the pool (user output).
  - stdin: the hello line only.
- **Framing.** A 4-byte big-endian length, then a UTF-8 JSON object.
  - Caps: server → worker 8 MiB (code is already ≤ 1 MiB at the socket); worker → server 32 MiB (an n ≤ 16 result is ≈ 3 MB, plus ≤ 6 MiB of figures).
  - An oversize length or bad JSON → the pool kills the worker → `worker_died` (reason `protocol`). Nothing is ever pickled.
- **server → worker.**
  - Request: `{"t":"req","seq":n,"op":"parse"|…|"pkg.mod:fn","run_id":s,"ctx":{"language","project_root","file_path","run_dir","params","seed","cache":"use"|"bypass"|"none","limits":{"cpu_s"}},"args":{…}}`.
  - Also `{"t":"ping"}` and `{"t":"exit"}`.
- **worker → server.**
  - `ready` (§2.3).
  - `{"t":"done","seq":n,"reply":{…}|null,"error":{"code","message","traceback"?,"framework"?,"dependency"?, …extra}|null,"stats":{"exec_ms","op_ms","simulate_ms","cache":"hit"|"miss"|"static"|"none","exec_count","rss_bytes","reusable":bool,"dirty_reason"?}}`.
  - Also `{"t":"pong"}` and `{"t":"log","level","msg"}` (forwarded to the kernel log).
- **Op registry** (`kernel/run_ops.py`): `@worker_op(name, lane, cached, wall_s, error_mapper)`. The worker resolves a `"module:function"` ref by importing the module outside the user context. It refuses any function that is not registered (`worker_protocol` error). Built-in ops: `parse`, `execute`, `run_python`, `transpile`, `debug_trace`, `qec_snapshot`, `qec_snapshot_text`, `qec_materialize`, `qec_estimate`, `hardware_prepare`.

### 2.5 Request lifecycle, `run_id`, concurrency, cancel

- **Submission.** `kernel/run_routes.py`:
  - validates the message and resolves paths (§2.13);
  - builds `RunRequest(op, lane, owner, run_id, request_id, ctx, args, wall_s, coalesce)`;
  - calls `pool.submit(req, sink)` and returns at once; the reply is awaited in an `asyncio.create_task` via `asyncio.wrap_future`.

  The connection loop therefore keeps reading. Sinks are thread-safe and schedule `websocket.send` on the connection's loop, as `LabContext.emit_threadsafe` does.
- **`run_id`.** Must match `^[A-Za-z0-9._:-]{1,128}$`, otherwise `invalid_request`. A `run_id` already active for the same owner is also `invalid_request`. When absent, the server assigns an internal `anon-<n>`, which is neither cancellable nor echoed.
- **Run map.**
  - `pool.runs[(owner, run_id)] → RunHandle{state: queued|running, lane, worker, seq, started}`; `worker.current → RunHandle`.
  - A handle is removed the moment its terminal frame is queued, so a later cancel cannot find it.
  - Each handle registers `ctx.on_release(f"run:{run_id}", …)` through `kernel/lab_context.py`. The existing `release_owner` call in `_handle_connection` then cancels or kills a closed socket's requests.
- **Ordering.** Frames of one request are in order. Frames of different requests may interleave; v1.4 clients match them by `run_id` (§10, risk 9).
- **`run_cancel {run_id}`** (R-6).
  - Queued: the request is dropped.
  - Running: the worker group is SIGKILLed (POSIX `killpg(pgid)`; Windows `TerminateJobObject`).
  - The server replies `run_cancelled {run_id, accepted: true}` immediately, then, after the reap (≤ 1 s), `error {phase, code: "cancelled", run_id}` plus the op's null terminal frame (§6.3).
  - Finished, unknown, or another owner's `run_id` → `run_cancelled {run_id, accepted: false}` and nothing else: a stale Stop never touches the run that is current now.
  - Cancelling a running preview request kills the preview worker (its cache is lost). Other owners' queued preview requests then run on the replacement.

### 2.6 Recycle policy and namespace freshness

**Run lane** workers are always recycled (one op per process). **Preview lane** workers are reused only if the request ended `ok`, with a user-level error, or with `user_exit`, **and** every dirty check below passes. Otherwise the worker is recycled before the next request.

**Enter the user context** (`run_context.UserContext`; both lanes):
1. Set `sys.path[:] = [file_dir?, project_root or request scratch] + BASE_SYS_PATH` and `os.chdir(project_root or request scratch)`.
2. Stash and remove `kernel` and every `kernel.*` from `sys.modules`; disable `NucleiKernelFinder`. The user's sibling `kernel.py` now wins.
3. Create a fresh `types.ModuleType("__main__")`:
   - attributes: `__file__`, `__builtins__` (the builtins module), `params`, `record_metric`, `NUCLEI_RUN_DIR`;
   - installed as `sys.modules["__main__"]`, with `sys.argv = [__file__]`;
   - a `linecache` entry for the buffer is added.
4. Set the per-request process state:
   - add `NUCLEI_RUN_DIR` and `NUCLEI_PROJECT_ROOT` to `os.environ`; seed `random` and `np.random` when `seed` is given;
   - replace `builtins.input` with a function raising `EOFError("interactive input() is not supported in Nuclei runs; use params or read a file")` (R-23);
   - replace `pyplot.show` with a capture marker (§2.11); turn the audit hook on.
5. Set `RLIMIT_CPU` soft = CPU used + `cpu_s`. If the hard limit is finite and too low, mark the worker not reusable.

**Exit the user context** (`finally`):
6. **Stash user modules.** Every `sys.modules` key absent from `BASELINE_MODULES` whose `__file__` is missing or not under a BASE_SYS_PATH entry moves into the cache entry (or is dropped). This covers project siblings and user `sys.path.append` dirs. Library modules the user imported (e.g. `scipy.optimize`) stay loaded; that is the warm benefit.
7. **Restore baseline state.**
   - Nuclei's `kernel*` modules and the finder; `__main__`, `argv`, cwd (scratch), `sys.path`.
   - `os.environ` (clear, then update from the snapshot); `builtins` (dict diff).
   - `sys.std{in,out,err}`; display/except/breakpoint hooks; recursion limit; `warnings.filters`.
   - Logging: root handlers and level, `logging.disable(NOTSET)`.
   - `np.seterr`, `np.set_printoptions`, `np.random.seed(None)`, `random.seed()`.
   - `mpl.rcParams` from the snapshot; `plt.close("all")`.
   - Signal handlers (INT, TERM, ALRM, XCPU, USR1, USR2), `signal.alarm(0)`, trace/profile hooks, `threading.settrace(None)`, `os.umask`, `gc.enable()`.
   - User `atexit` callbacks: `atexit._clear()`, then re-register the worker's own.
   - Restore the `RLIMIT_CPU` soft limit.

**Dirty → recycle** (preview only):
- `threading.active_count()` above baseline;
- any process in the worker's pgid other than the worker itself (pool-side `ps` scan; Windows: active processes in the Job);
- open fds above baseline + 64;
- RSS above baseline + 1 GiB (cache entries included);
- 50 requests served;
- qdk interpreter wedged (`qsharp_adapter._interpreter_wedged()`);
- any restore step raised;
- `MemoryError`, timeout, cancel or worker death.

The cache lives only inside the preview worker, and a recycle drops it.

### 2.7 Limits

| Limit | Mechanism | Default | Override |
|---|---|---|---|
| wall | pool timer per request → kill group → `timeout` (reason `wall`) | per op (§1) | env `NUCLEI_RUN_WALL_S` (all ops; tests); request `limits.wall_s` for execute/run_python (clamp 1..86 400) |
| CPU | `RLIMIT_CPU` soft per request; `SIGXCPU` → `timeout` (reason `cpu`). POSIX only | wall + 60 s | — |
| memory (hard) | group RSS: `procrun.group_scan(pgid)` (count, RSS; `group_rss_bytes` is its RSS half) every 0.25 s while busy (Linux/macOS); Windows Job Object with `JOB_OBJECT_LIMIT_JOB_MEMORY` and `KILL_ON_JOB_CLOSE` (ctypes, `kernel/run_winjob.py`) | 40 % of RAM, min 1 GiB; RAM = min(physical, cgroup v2 `memory.max` / v1 `limit_in_bytes`) | env `NUCLEI_RUN_MAX_RSS_MB` |
| memory (estimate) | §2.10, before simulating | min(25 % RAM, setting) | request `limits.memory_mb`; env `NUCLEI_SIM_MEMORY_LIMIT_MB` |
| output | pool-side byte count | 256 KiB per request | env `NUCLEI_RUN_OUTPUT_CAP_KB` |
| reply | framing cap | 32 MiB | — |

`RLIMIT_AS` and `RLIMIT_NPROC` are never set (`kernel/agent_limits.py` records why).
- **Windows** has no CPU limit (wall only). If Job creation fails, `ready.memory_ceiling = "unavailable"`; the pool logs a warning and still enforces the wall.
- **Concurrent groups.** Two heavy groups can each sit just under 40 %, so up to 80 % of RAM together; see §10, risk 6.

### 2.8 Output capture (R-22)

- **Markers.** After every op the worker flushes the Python streams and calls `libc.fflush(NULL)` (ctypes, best effort). It then writes `\x1eNUCLEI-END:<marker>:<seq>\x1e\n` to fd 1 and to fd 2. The marker is 16 random bytes (hex) per worker, sent in the hello. The pool's two reader threads per worker scan for it, keeping a `len(marker) − 1` tail across chunks.
- **Finalising.** A request is finalized once `done` and both markers have arrived. After a 1 s grace it is finalized anyway and the remainder is logged. Bytes between requests are logged and dropped. Spawned and forked children inherit fds 1/2, so `Pool` workers' and subprocesses' prints are captured too.
- **Delivery.**
  - execute and run_python stream `output`/`stderr` frames, flushing every 100 ms or 32 KiB. A run that finishes inside the first window yields exactly one frame, which keeps docs fixtures deterministic.
  - parse buffers and sends output at the end, newest parse only.
  - Lab sync ops discard output (logged at debug).
- **Cap.** 256 KiB per request across both streams. Beyond the cap the pool keeps draining (the program never blocks on a full pipe) and counts the dropped bytes. It then sends one final frame:
  `{"type":"output","text":"\n[output truncated: 1048576 more bytes not shown]\n","output_truncated":true,"dropped_bytes":N}`
  (plus `run_id` for v1.4 clients).

### 2.9 Exit and death classification (R-7)

| What happened | `code` | Message (abridged) | Worker |
|---|---|---|---|
| `SystemExit` from `sys.exit` / `exit()` / `quit()` | `user_exit` (+ `exit_code`) | "Your code called sys.exit(…); the run was ended." A snapshot is still sent if a circuit was already built | preview reusable |
| process exits without `done` (`os._exit(n)`, native abort) | `worker_died` (reason `exited:n`) | "The Python worker running your code exited (os._exit or a native crash). The kernel is fine — run again." | replaced |
| SIGKILL not sent by the pool | `worker_died` (reason `killed_by_os`) | "…was killed by the operating system — usually because the machine ran out of memory." | replaced |
| SIGSEGV / SIGBUS / SIGABRT | `worker_died` (reason = signal name) | "…crashed inside a native library (SIGSEGV)." | replaced |
| pool RSS ceiling | `too_much_memory` (+ `rss_bytes`, `limit_bytes`) | "Your program used more than 6.2 GB (limit 40 % of RAM) and was stopped." | replaced |
| `MemoryError` in user code | `too_much_memory` (reason `allocation_failed`) | | recycled |
| wall or `SIGXCPU` | `timeout` (+ `limit_s`, reason `wall`/`cpu`) | | replaced |
| `run_cancel` | `cancelled` | | replaced |

In every case the server process never sees the exception. The listener stays up, and the next request on the same socket succeeds on a replacement worker.

### 2.10 Memory-estimate policy (R-11) — `kernel/run_memory.py`

After `find_circuit` and before any simulation, the worker takes n from the circuit object (`num_qubits`; `len(all_qubits())`) and plans:

- **n ≤ 16** → the adapter's `simulate` (full result; ≤ 65 536 amplitudes, ≈ 30 MB peak).
- **n > 16, no `simulation_method`** → the lean path. Estimate = **copies × 2ⁿ × 16 B**:
  - copies = 2 when the circuit has measurements: sampled (Aer `run(shots, seed_simulator)` / `cirq.Simulator(seed).run`);
  - copies = 4 when it has none: exact probabilities from a numpy statevector (the state, Aer's result copy, float64 probabilities, selection scratch); top-K is selected in numpy before any bitstring is formatted (D25).
- **`simulation_method: "matrix_product_state"`** (Qiskit only) → Aer MPS sampling. No 2ⁿ estimate; the RSS ceiling still applies.
- **Stabilizer or sparse frameworks** (stim, Q# sparse simulator) → no 2ⁿ estimate; the RSS ceiling applies.
- **Any other framework above 16 qubits** (CUDA-Q, third-party adapters) → mode `adapter`: no estimate, `adapter.simulate` runs, the result is shaped like a lean one; the RSS ceiling applies (D25).
- **Budget** = `min(0.25 × RAM, limits.memory_mb or env)`. An estimate above the budget → `too_many_qubits` *before allocating*. The snapshot frame is still sent first.

```json
{"type":"error","phase":"execute","code":"too_many_qubits","run_id":"r7",
 "message":"Simulating 30 qubits needs about 34.4 GB (2 copies × 2^30 × 16 B); this kernel allows 15.5 GB (25% of RAM).",
 "estimate":{"qubits":30,"copies":2,"bytes":34359738368,"budget_bytes":16642998272,"budget_source":"ram_25pct","method":"statevector"},
 "actions":[{"id":"rerun_mps","label":"Use Aer MPS","request":{"simulation_method":"matrix_product_state"}},
            {"id":"open_lab","label":"Run in the Lab"}]}
```

`rerun_mps` is offered only for Qiskit circuits with measurements.

**Result shaping** (every path; never silent):
- `state_vector` only when n ≤ 16; otherwise `[]`.
- `probabilities` capped at 65 536 entries: the most probable first, ties broken by bitstring.
- `bloch_coords` only for n ≤ 16 or the exact lean path; otherwise `[]`.
- `truncated = {"state_vector": bool, "probabilities": bool, "reason": "…"}` is present whenever anything was withheld.
- Lean results set `measurements_source` (`"sampled"` or `"none"`) and `probabilities_exact` (false for sampled), with the meaning R-A gives them.
- `bound_at` comes from R-4 binding, done before planning: `kernel.adapters.binding.bind_parameters(circuit, parameter_values | {"random_seed": n}) -> (circuit, bound_at)`. Until R-A merges, tests use a local stub.

The module docstring records the copies constants and the scout's n = 16…24 measurements.

### 2.11 Figures (R-12) — `kernel/run_figures.py`

- `MPLBACKEND=Agg` is in the spawn env, before any import (R-C also sets it for the kernel). Inside the user context `pyplot.show` is a no-op that marks figures shown. `DISPLAY` is irrelevant under Agg.
- After execute and run_python, each open figure (at most 8) is rendered with `savefig(BytesIO, format="png", dpi=100, bbox_inches="tight")`.
  - A PNG over 1.5 MiB is re-rendered at dpi 60.
  - Figures beyond 6 MiB total are dropped and counted in `figures_truncated`.
  - Title: suptitle → first axes title → `"Figure N"`.
- Delivery: `result.data.figures = [{"png_base64","title"}]` (execute) and `python_result.figures` (run_python). Preview ops close figures without rendering them.

### 2.12 `__main__`, `__file__`, multiprocessing (R-10, R-20)

- **`__main__`.** User code runs as a real `__main__` module: `__name__ == "__main__"`, `__file__` = the absolute `file_path` or `"<nuclei>"`, `__spec__ = None`. It is compiled with filename = `file_path` or `"<nuclei>"`.
- **Tracebacks** show buffer lines (via `linecache`) and drop worker-internal frames, i.e. frames under `REPO_ROOT/kernel`.
- **Spawn safety.** The worker wraps `multiprocessing.spawn.get_preparation_data` once at bootstrap. While a user main is active, if there is no file or the buffer differs from the file on disk, the wrapper redirects `init_main_from_path` to `<request scratch>/<stem>.py`, which holds the exact buffer. Spawn and forkserver children re-run it as `__mp_main__` (the main guard is false there) and find `f`. Fork children inherit the live module. `concurrent.futures.ProcessPoolExecutor` takes the same path.
- **Children** inherit `sys.path` (project first), cwd and env. They share the worker's process group, so they are killed with it and counted in its RSS.

### 2.13 cwd, `sys.path`, project files (R-9) — `kernel/project_paths.py`

`resolve(project_root, file_path, run_dir) -> ProjectPaths` raises `PathError(field, path, message)`. Rules:
- **`project_root`**: a str, absolute, ≤ 4096 chars, no NUL. Its realpath must be an existing directory that is not a filesystem root.
- **`file_path`**: absolute or root-relative. Its realpath must be inside the root (`os.path.commonpath`). The file may not exist yet (unsaved), but its parent must be inside the root.
- **`run_dir`**: root-relative or absolute.
  - It is created only after its nearest existing ancestor's realpath is checked to be inside the root; the final realpath must also be inside the root.
  - When absent, the run lane uses `<tmp>/nuclei-runs/<owner>-<run_id>/`, reported as `result.data.run_dir`.
- **Violations** → `error {code:"invalid_path", field, path, message}` and no exec. F-1's Wave 1 `lab_protocol` resolution must import this module (one mechanism).
- **Worker.** cwd = root (or a per-request scratch dir when there is no root); `sys.path` per D7; `__file__`; `NUCLEI_RUN_DIR`; the purge in §2.6. Siblings named `kernel.py`, `noise.py`, `models.py` and `symmetry.py` import the user's file; Nuclei's top-level package names never exist in a worker (`test_worker_toplevel_names`).
- **Documented divergence.** Modules the warm worker already loaded (stdlib, numpy, qiskit, cirq, pandas, …) are *not* shadowed by same-named siblings. Plain Python would shadow them; diverging is the safe direction.
- **Server.** It never `chdir`s and strips its own script dir (§2.15).

### 2.14 Environment

- **Start from** `auth.scrubbed_environment()`, which drops `NUCLEI_KERNEL_TOKEN`, `NUCLEI_KERNEL_TOKEN_STDIN` and `NUCLEI_KERNEL_INSECURE_DEV`, a superset of `lab_proc.KERNEL_SECRET_ENV`.
- **Remove** every other `NUCLEI_KERNEL_*` variable and `NUCLEI_RUNTIME_DIR`.
- **Add** `lab_proc.PINNED_ENV` (thread caps), `MPLBACKEND=Agg`, `QDK_PYTHON_TELEMETRY=none` (setdefault) and `NUCLEI_RUN_WORKER=1`.
- **Never use `minimal_env`.** HOME, proxies, `QISKIT_*`, IBM/AWS/Azure provider vars and LANG must survive.
- **Interpreter flags.** `-I` makes the worker interpreter ignore `PYTHON*` variables. `BASE_SYS_PATH` = the server's `sys.path` minus `''`, the server's cwd, `_KERNEL_DIR`, `_REPO_ROOT` and every `PYTHONPATH` entry. That keeps stdlib, site-packages, user site (if the server has it) and `.pth` additions, and deliberately drops `PYTHONPATH` (brief).
- **Trust.** Run workers are not sandboxes: they have the same trust as the user's terminal. The token never enters their environment (tested). The 0600 runtime file stays readable by any process of that user, as before.

### 2.15 Launch: no Rust change required

Today the shell runs `python <kernel_dir>/server.py` with cwd = `resource_dir` (prod) or the repo root (dev), so `sys.path[0]` is `kernel/`. R-B replaces `server.py:11` with:

```python
_KERNEL_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_KERNEL_DIR)
sys.path[:] = [p for p in sys.path if os.path.realpath(p or os.getcwd()) != _KERNEL_DIR]
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
```

This works for both `python kernel/server.py` and `python -m kernel.server`, and workers never inherit the server's `sys.path` beyond BASE. **R-B needs nothing from `kernel.rs`.**

Optional hygiene for R-C or a later unit, as an exact change in `start_kernel`:
- replace `.arg(kernel_script.to_str().unwrap())` with `.args(["-m", "kernel.server"])`;
- keep `.current_dir(&kernel_cwd)`, which is already the parent of `kernel/` in dev and prod;
- keep the canonicalize + `starts_with` check on `kernel_cwd/kernel/server.py`;
- teach the `kernel_ownership` / `kernel_legacy` command-line matchers to accept both forms.

## 3. Parse coalescing, static fast path, live preview, loaded-circuit cache

### 3.1 Coalescing (R-8 a, e)

- Each owner has one pending-parse slot.
- When a newer parse arrives:
  - a queued (not started) parse is dropped silently: no frame, and `parse_superseded` is never sent;
  - a running parse is marked superseded, and all its frames are suppressed;
  - a running parse is also killed once it has run ≥ `SUPERSEDE_KILL_AFTER_S = 2.0` s, since a respawn (≤ 1.5 s) then beats waiting.
- Non-parse preview requests are FIFO and never coalesced.
- Because Run is on another lane, queued parses never delay Run.

### 3.2 Static AST fast path (R-8 d) — `kernel/preview_static.py`

Parse only, inside the preview worker: `try_static(code, framework) -> circuit | None`. It applies only if **every** top-level statement is one of:

- **Imports** whose root is qiskit, qiskit_aer, cirq, numpy or math. These are resolved against `sys.modules`; the fast path never imports anything.
- **Numeric bindings**: `name = <numeric expr>` (int/float constants, `+ - * / **`, unary minus, `np.pi`/`math.pi`, previously bound numeric names).
- **Constructors**: `name = QuantumCircuit(…)`, `QuantumRegister(…)`, `ClassicalRegister(…)`, `cirq.LineQubit.range(…)`, `cirq.LineQubit(…)`, `cirq.GridQubit(…)`, `cirq.NamedQubit(…)`, `cirq.Circuit(ops)`, all with literal arguments.
- **Qiskit gate calls** `circ.<g>(args)` for g ∈ {h, x, y, z, s, sdg, t, tdg, sx, sxdg, id, rx, ry, rz, p, u, cx, cy, cz, ch, swap, iswap, ccx, cswap, crx, cry, crz, cp, rxx, ryy, rzz, measure, measure_all, barrier, reset}. Arguments: numeric exprs, register subscripts, `range(int…)`, list/tuple literals.
- **Cirq ops**: `circ.append(op | [ops])` with ops from {`cirq.H`, `X`, `Y`, `Z`, `S`, `T`, `CNOT`, `CZ`, `SWAP`, `CCX`, `rx/ry/rz(θ)(q)`, `measure(*qs, key=str)`}.
- **Sinks**, skipped and never evaluated: an Expr or Assign in which every Call is one of {print, AerSimulator, Aer.get_backend, transpile, run, result, get_counts, get_statevector, Simulator, simulate, histogram, draw, plot_histogram, show}, and no Call uses a circuit variable as its receiver except `draw`.

Anything else (defs, loops, comprehensions, `if __name__ == "__main__"`, attribute stores, unknown names) → `None` → the exec path. The snapshot comes from the adapter's `extract_snapshot` on the real object (one snapshot mechanism), and the frame says `preview: "static"`. No user code runs, so no side effects happen at keystrokes.

### 3.3 Loaded-circuit cache — `kernel/run_cache.py` (preview worker only)

- **Key:** `sha256("rb1\0" + language + "\0" + code + "\0" + canonical_json(params) + "\0" + realpath(project_root) + "\0" + realpath(file_path) + "\0" + sys.executable)`. `seed` is excluded because no cached op takes one.
- **Entry:** `LoadedProgram{key, namespace, main_module, user_modules, line_map, candidates, error, deps, exec_ms, products}`.
  - `error` holds only deterministic failures: `compile_error`, `execution_error`, `no_circuit`.
  - `deps` is a tuple of `(path, mtime_ns, size, kind)`.
  - The cached exec always runs under `trace_gate_lines(filename)`, so trainability consumers get source lines from the same single exec.
- **Deps (project files changing).** The audit hook records, inside the user context only:
  - `open` events opened read-only under the root;
  - `os.listdir`, `os.scandir` and `glob.glob` directories under the root;
  - user modules whose `__file__` is under the root.

  The list is capped at 512; overflow marks the entry uncacheable.
- **Lookup.** A hit requires a key match **and** an unchanged re-stat of every dep (≤ 512 stats, < 1 ms). Otherwise the entry is evicted and the program re-execs.
- **Eviction.** LRU of 4 entries; everything is cleared on recycle. Timeouts, cancels, worker death, `user_exit` and `MemoryError` are never cached.
- **Consumers.**
  - `parse` (snapshot product), `transpile` and `debug_trace` (adapter `find_circuit` on the cached namespace), `qec_materialize`.
  - `trainability_inspect` and `_lint`: `_usercode.run_namespace` calls `run_context.current().load_program(code, params)` in the worker.
  - S1, S2+S3, D3 and L3+L4 ops, through `load_circuit` / `load_program`.
- **Bypass.** `parse {cache: false}` (manual "Refresh preview").
- **Documented limit.** A program that depends on env, time, network or unseeded randomness is previewed once per code version.

### 3.4 Execute and the cache

`execute` never reads the cache (D3).

### 3.5 Live-preview opt-in (500 ms)

- Every exec-path parse reply carries `elapsed_ms` (exec time) and `slow: elapsed_ms > 500`.
- R-G stops automatic parses for that file when `slow` is true and offers "Preview now / Always preview". Manual previews send `cache: false`.
- The kernel itself never refuses a slow parse; only the 10 s parse wall applies.

## 4. Framework detection (R-3) — `kernel/framework_detect.py`

```python
@dataclass(frozen=True)
class FrameworkRule:
    framework: str              # adapter id in ADAPTER_SPECS
    roots: tuple[str, ...]      # exact top-level import roots
    prefixes: tuple[str, ...]   # root prefixes
    order: int

RULES = (
    FrameworkRule("qiskit", ("qiskit",), ("qiskit_",), 10),   # qiskit_aer, qiskit_ibm_runtime, qiskit_algorithms, …
    FrameworkRule("cirq", ("cirq", "qsimcirq"), ("cirq_",), 20),  # cirq.contrib via root "cirq"; cirq_google
    FrameworkRule("cuda-q", ("cudaq",), (), 30),
    FrameworkRule("stim", ("stim", "sinter"), (), 40),
)

@dataclass(frozen=True)
class Detection:
    framework: str | None; candidates: tuple[str, ...]; source_mode: bool; method: str  # hint|ast|regex|none

def detect(code: str, language: str | None = None) -> Detection: ...
def resolve_framework(code: str, *, language: str | None = None) -> str | None: ...  # Executor compat
def looks_like_qsharp(code: str) -> bool: ...  # the current Q# regex, moved here
```

**Algorithm.**
- Language hints: `qsharp` → qsharp; `stim` → the stim source spec.
- Otherwise parse with `ast.parse`.
  - Collect roots from every `Import`/`ImportFrom` at any depth: function bodies, main guards, `try/except ImportError`. Relative imports are skipped.
  - Also collect constant string arguments of `importlib.import_module(...)` and `__import__(...)`, and treat a `@cudaq.kernel` decorator as cuda-q.
  - Candidates are the matching rules, ordered by first appearance in the source, then by `order`.
- If parsing fails:
  - hint `python` → the multiline regex `^\s*(?:from|import)\s+(qiskit\w*|cirq\w*|cudaq|stim|sinter)\b`, used only to label the `compile_error`;
  - no hint → `looks_like_qsharp`, then the same regex.
- Comments and strings no longer match, a deliberate change from today.

**Post-exec (worker; the audit's second half).**
1. Try each candidate adapter's `find_circuit` in order.
2. If none matches, or there were no candidates, scan the namespace by type across every importable adapter: `QuantumCircuit` → qiskit; `cirq.Circuit`/`FrozenCircuit` → cirq; `stim.Circuit` → stim.
3. Still nothing → `no_circuit` if there were candidates, `unsupported_framework` if not.

**Compat.** `missing_dependency` is reported only when no candidate adapter loads *and* no circuit was found by type. `ADAPTER_SPECS` stays the adapter table (module, class, dependencies, `source_mode`); its `detect_pattern` fields are retired, and `server._QSHARP_SPEC` users switch to `looks_like_qsharp`.

## 5. Latency budgets and how they are measured

| Budget | Definition | Test (`kernel/tests/test_executor_run_path.py`, `@pytest.mark.perf`) |
|---|---|---|
| parse p50 ≤ 150 ms over program time | (reply − send) − worker `exec_ms`, over 20 serial exec-path parses on a warm preview worker. The cache is defeated by a changing trailing comment | `test_latency_parse_p50` (+ `test_latency_parse_static_p50`: ≤ 150 ms absolute on the static path) |
| Run overhead ≤ 300 ms | `timing.total_ms − exec_ms − simulate_ms`, Bell circuit, 10 runs, max, with `timing.spawn_wait_ms == 0` (a warm spare) | `test_latency_run_overhead` |
| lint within 0.35 s | round trip of `trainability_lint` on `tests/e2e/fixtures/lab-project/ansatz/hardware_efficient.py`, after `trainability_inspect` warmed the cache | `test_latency_lint_warm` |

`timing` is message-level and sent only to v1.4 clients: `{queue_ms, spawn_wait_ms, exec_ms, simulate_ms, serialize_ms, total_ms}`. The macOS runner gets ×1.5 tolerance. The perf tests run in the dev-venv CI job.

## 6. Protocol

### 6.1 Master §4.2, verbatim

- `parse {run_id, code, language?, project_root?, file_path?}`.
- `execute {run_id, code, language?, params?, seed?, parameter_values?, project_root?, file_path?}` → `result` gains `measurements_source`, `probabilities_exact`, `bound_at?`, `truncated?`, `figures?`, `metrics` and `seed_honored`.
- `run_cancel {run_id}` → `run_cancelled {run_id, accepted}`, then the pending `error {code: "cancelled"}`.

R-B emits `truncated`, `figures`, `bound_at` and the codes `timeout`, `user_exit`, `worker_died`, `too_much_memory`, `too_many_qubits` and `cancelled`, plus the `output_truncated` note. R-A's adapters raise `unbound_parameters` (with `parameters`) and `unsupported_instruction` (naming the gate); R-B passes them through and still sends the snapshot frame.

### 6.2 Additions implied by §4.2 (record in F-1's v1.4 types and X's changelog)

- **execute:**
  - `simulation_method?: "matrix_product_state"` (the `too_many_qubits` re-run action);
  - `limits?: {wall_s?, memory_mb?}` (the user setting);
  - `run_dir?` (experiments pass `experiments/<name>/runs/<id>`).
- **parse:** `cache?: false`.
- **Replies to v1.4 clients only** (requests that carried `run_id`):
  - every frame of the run carries `run_id`;
  - `snapshot` adds `preview: "static"|"exec"|"cache"`, `elapsed_ms` and `slow`;
  - the `result` frame adds `timing`, and `result.data` adds `run_dir`;
  - `error` may add `estimate`, `actions`, `exit_code`, `reason`, `limit_s`, `rss_bytes`, `limit_bytes`, `field` and `path`.
- **All clients:**
  - `output.output_truncated` and `output.dropped_bytes`;
  - `python_result.figures?`;
  - new error codes `invalid_path` and `invalid_request` (bad or duplicate `run_id`).
- **R-16 hand-off.** If R-C reports it, `lint_result.available: bool, reason?` is a five-line change in R-B's `executor.lint` / server `lint` branch: `available = ruff_base_cmd() is not None`.

### 6.3 Terminal frames on timeout, cancel or death (every client)

| Op | Frames |
|---|---|
| parse | `error` only (the last diagram stays) |
| execute | `error` + `result {data: null}` |
| run_python | `error` + `python_result {success: false}` |
| transpile | `error` + `transpile_result {data: null}` |
| debug_trace | `error` + `debug_trace_result {data: null}` |
| qec_snapshot, qec_materialize, qec_estimate | `error` |
| hardware_submit | `error {message, code}`. A program error during simulator execution stays a failed job handle, as today |
| trainability sync ops | error envelope with `request_id`, `phase: "trainability"` |

### 6.4 Backward compatibility

- Without `run_id`, the frame sequence is identical to today, plus the new error codes. Output may arrive in several frames; every client appends (`useKernel.ts:202`, `experimentRunIo.ts:50`, `challengeExecution.ts:319`).
- Superseded parses are dropped for every client. Parse is fire-and-forget in `useKernel`, and `kernelSession` users await one request at a time.
- `server._prepare_hardware_payload` keeps the Q# routing so `test_server_qsharp_submit.py` stays valid. Its Python → device exec branch moves to the `hardware_prepare` op.

## 7. Test plan

| Acceptance item (brief) | Test |
|---|---|
| `while True` → `timeout` within N s and the next request succeeds, **for every path**; one corpus program per path (sibling import, relative data read, `while True`, `os._exit`) | `test_run_worker.py::test_every_exec_path_survives[path × program]` (master E-1). A real kernel runs with `NUCLEI_RUN_WALL_S=3`; paths = rows 1-12 + fake ops 14-17. Expected: sibling/data → ok; while-True → `timeout` ≤ 4.5 s; `os._exit` → `worker_died`; then a Bell parse+execute on the same socket succeeds. Per-path templates wrap each program (e.g. inside `nuclei_circuits` for `qec_materialize`). stim and qdk paths use `importorskip` |
| `run_cancel` kills within 1 s | `test_executor_run_path.py::test_run_cancel_kills_within_1s`: asserts `run_cancelled` + `cancelled` ≤ 1 s and no live process left in the old pgid |
| stale `run_cancel` ignored | `::test_stale_run_cancel_ignored` (finished, unknown and other-owner ids → `accepted: false`; the concurrent next run completes) |
| `sys.exit` / `exit()` / `quit()` / `os._exit` survive | `test_run_worker.py::test_user_exit_variants[sys_exit,exit,quit]` → `user_exit`; `[os_exit]` → `worker_died`; a fresh socket connects afterwards (listener alive) |
| N queued parses leave Run latency ≤ 1 program time | `test_executor_run_path.py::test_queued_parses_do_not_delay_run`: port of the scout's `backlog.py`. A 2 s program, 5 parses 300 ms apart, then execute; asserts latency ≤ program + 0.3 s + `simulate_ms`. Corpus option `queued_parses: 5` |
| single exec per code version with inspect + lint + detect active | `test_executor_run_path.py::test_single_exec_with_lab_open` (master E-4). The program appends a line to `<project>/exec_log.txt`; parse (editor socket), `trainability_inspect` + `trainability_lint` (Lab socket) and the fake `symmetry_detect` op run with identical code/params/paths; the log has exactly one line |
| sibling `kernel.py` / `noise.py` / `models.py` shadow Nuclei's | `test_run_worker.py::test_sibling_module_wins[kernel,noise,models,symmetry]` (master E-19) |
| write into the run dir; traversal refusal | `test_executor_run_path.py::test_write_into_run_dir`; `::test_path_traversal_refused[file_dotdot,run_dir_dotdot,symlink_escape,relative_root,missing_root]`; unit tests in `test_project_paths.py` |
| main-guard program runs | corpus `rb08`, `::test_main_guard_runs` |
| n = 30 → `too_many_qubits` in < 1 s without allocating | `::test_n30_too_many_qubits_fast` (elapsed < 1 s, `stats.rss_bytes` < baseline + 200 MB, `NUCLEI_SIM_MEMORY_LIMIT_MB=2048`); `test_run_memory.py::test_estimate_formula` |
| n = 24 sampled run ok | `::test_n24_sampled_run_ok` (GHZ-24 with measurements → `measurements_source: "sampled"`, `state_vector: []`, `truncated.state_vector: true`, frame < 4 MB) |
| RSS ceiling exceeded → `worker_died` / `too_much_memory`, kernel alive | `test_run_worker.py::test_rss_ceiling_worker_died` (master E-3): `NUCLEI_RUN_MAX_RSS_MB=1024` and a program touching 2 GiB → `too_much_memory`, then the next request ok |
| `plt.show()` with `DISPLAY` returns < 2 s | `::test_plt_show_with_display_returns_fast` (`DISPLAY=:99` in the kernel env; asserts one entry in `figures`); corpus entry `display: true` |
| `Pool.map` on an editor function works | `test_run_worker.py::test_pool_map_editor_function[saved,unsaved][spawn,default]` |
| 100 k lines → truncated with a note | `::test_output_truncated_100k_lines` (≤ 256 KiB forwarded, plus one `output_truncated` frame) |
| table-driven detection | `test_framework_detect.py::test_detect_import_forms[…]`. Rows: `import qiskit`, `import qiskit as q`, `from qiskit import QuantumCircuit`, `from qiskit.circuit.library import EfficientSU2`, `from qiskit.quantum_info import SparsePauliOp`, `import qiskit.quantum_info as qi`, `from qiskit_aer import AerSimulator`, `import qiskit_aer`, `from qiskit_ibm_runtime import SamplerV2`, `import cirq`, `from cirq.contrib.svg import SVGCircuit`, `import cirq_google`, `import cudaq` / `@cudaq.kernel`, `import stim`, `from stim import Circuit`, `import sinter`, imports inside defs / main guard / try-except, `importlib.import_module("qiskit")`; negatives: `# import qiskit`, `"import qiskit"` in a string, `import qiskitty`; hints `qsharp`/`stim`/`python`; plus `::test_post_exec_type_scan` |
| macOS leg of `test_run_worker.py` | CI job below (hand to the workflow owner; R-B does not own `.github/**`) |

Additional tests:
- `test_run_worker.py`:
  - `::test_server_never_execs_in_process`
  - `::test_worker_env_has_no_token`
  - `::test_worker_sys_path_shape`
  - `::test_worker_toplevel_names`
  - `::test_preview_reuse_freshness` (module globals, an edited sibling re-imported, printoptions, logging handlers and rcParams all reset)
  - `::test_preview_dirty_recycles` (a leftover thread → new pid)
  - `::test_cancel_preview_requeues_others`
- `test_run_cache.py`:
  - `::test_invalidates_on_sibling_edit`
  - `::test_invalidates_on_data_file_change`
  - `::test_dep_cap_uncacheable`
- `test_preview_static.py`:
  - `::test_static_equals_exec[corpus]` (every corpus program on which static applies)
  - `::test_bails_on_unknown`
- `test_executor_run_path.py`:
  - `::test_terminal_frames_on_timeout[op]`
  - `::test_no_run_id_frame_sequence_unchanged`
  - `::test_hardware_simulator_off_event_loop` (a second socket's parse answers while a simulator submit runs `while True`)

**Corpus** `kernel/tests/research_corpus/r_b/` (R-D's loader schema 1; `expected.yaml`; project programs are directories with `main.py`):
- `rb01-sibling-import/` (+ `ansatz_lib.py`), `rb02-relative-data-read/` (+ `hamiltonian.json`)
- `rb03-while-true` (`options.request.limits.wall_s: 3` → both phases `error:timeout`, `healthy_after: true`)
- `rb04-os-exit`, `rb05-sys-exit`, `rb06-exit-builtin`, `rb07-quit-builtin`
- `rb08-main-guard`, `rb09-file-relative/`, `rb10-run-dir-write/`
- `rb11…rb14-sibling-{kernel,noise,models,symmetry}/`
- `rb15-pool-map/`, `rb16-plt-show` (`display: true`), `rb17-print-100k`
- `rb18-ghz-30` (`error:too_many_qubits`), `rb19-ghz-24-sampled`
- `rb20-efficientsu2-only-import`, `rb21-from-qiskit-aer`, `rb22-cirq-contrib`, `rb23-queued-parses` (`queued_parses: 5`)

Land them RED first as `xfail(strict)` with their R-ids, and flip each one as its step lands (§11).

**Test infrastructure.**
- `kernel/tests/_run_pool_fixtures.py`: a session-scoped pool with env overrides, a real-kernel launcher via R-D's `_kernel_client.py`, and an `inprocess_mode` fixture for existing unit tests that monkeypatch adapters. Production `server.main()` forbids in-process mode.
- `kernel/tests/_fake_lab_ops.py`.

**macOS leg** (lines for `kernel-tests.yml`):

```yaml
  run-worker-macos:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: {python-version: "3.12"}
      - run: pip install -r kernel/requirements.txt pytest pytest-asyncio pyyaml
      - run: pytest kernel/tests/test_run_worker.py kernel/tests/test_executor_run_path.py -m "not linux_only and not display" -q
```

`linux_only` marks the PDEATHSIG orphan test and the cgroup RAM test.

## 8. §G2 — non-bridge `@tauri-apps/*` importers (F-3 shims, Wave 1a)

`grep -rln "@tauri-apps/" src | grep -v ^src/platform/` at `b9e3378` finds **17 production files**, matching the plan's count:

| # | File | Imports | Commands / channels | Import-line owner |
|---|---|---|---|---|
| 1 | `src/App.tsx:134` | dynamic `invoke` (`api/core`) | `framework_status` | F-3 |
| 2 | `src/components/experiments/NewExperimentForm.tsx:2` | `mkdir`, `writeTextFile` (`plugin-fs`) | — | F-3 |
| 3 | `src/components/onboarding/FrameworkSetup.tsx:2-3` | `invoke`; `listen`, `UnlistenFn` (`api/event`) | `framework_status`, `framework_install`; event `framework-install` | R-G (file owner; F-3 ships the shim) |
| 4 | `src/components/settings/EnvironmentPanel.tsx:2` | `listen`, `UnlistenFn` | event `framework-install` | R-G (file owner; F-3 ships the shim) |
| 5 | `src/components/UpdateBanner.tsx:40,75,108` | dynamic `check` (`plugin-updater`) ×2, dynamic `relaunch` (`plugin-process`) | — | F-3 |
| 6 | `src/hooks/useDiracAgent.ts:2-3` | `invoke`; `listen`, `UnlistenFn` | `dirac_has_api_key`, `dirac_start_run`, `dirac_cancel_run`; `RUN_EVENT_CHANNEL` | F-3 |
| 7 | `src/hooks/useKeychainKeyMigration.ts:28` | dynamic `invoke` | `dirac_has_api_key`, `dirac_set_api_key` | F-3 |
| 8 | `src/lib/openExternal.ts:8` | dynamic `open` (`plugin-shell`) | — | F-3 |
| 9 | `src/lib/openRunFolder.ts:15` | dynamic `open` (`plugin-shell`) | — | F-3 |
| 10 | `src/plugins/pluginLoader.ts:27-28` | `readTextFile`, `exists` (`plugin-fs`); `join` (`api/path`) | — | F-3 |
| 11 | `src/services/environment.ts:1` | `invoke` | `environment_report`, `python_setup`, `python_install`, `framework_status`, `framework_resolve`, `framework_install`, `framework_uninstall`, `venv_repair` | F-3 |
| 12 | `src/services/experimentFs.ts:1-2` | `invoke`; `mkdir`, `readDir`, `readTextFile`, `writeTextFile`, `exists`, `watch` | `git_project_info` | F-3 |
| 13 | `src/services/noiseModelScaffold.ts:1-2` | `mkdir`, `writeTextFile`, `exists`; `join` | — | F-3 |
| 14 | `src/services/pluginScaffold.ts:9-10` | `mkdir`, `writeTextFile`, `exists`; `join` | — | F-3 |
| 15 | `src/services/qecScaffold.ts:1-2` | `mkdir`, `writeTextFile`, `exists`; `join` | — | F-3 |
| 16 | `src/services/qecStudyFs.ts:1-10` | `exists`, `mkdir`, `readDir`, `readTextFile`, `lstat`, `watch`; `invoke`; `resolve` (`api/path`) | `qec_read_study_manifests`, `qec_create_study_manifest` | F-3 |
| 17 | `src/stores/diracStore.ts:44` | dynamic `invoke` | `dirac_set_api_key` | F-3 |

**Suggested shim modules** (one per Tauri package): `src/platform/tauriShims/{core,event,fs,path,shell,updater,process}.ts`, each delegating through the bridge with web and e2e fallbacks.

**Test files** that `vi.mock('@tauri-apps/…')` must switch to mocking the shims in the same F-3 change: `src/components/experiments/{CompareView,NewExperimentForm,RunDetail}.test.tsx`, `src/hooks/{useDiracAgent,useExperimentRun}.test.tsx` and `src/services/qecStudyFs.test.ts`. `ExperimentsPanel.test.tsx` only mentions the package in a comment.

## 9. Files

**New (R-B):**

| File | Role | Approx. lines |
|---|---|---|
| `kernel/run_worker.py` | `RunPool`: config, lanes, spawn, supervise, limits, output readers, `submit` / `cancel` / `release_owner` / `call_op` | ~400 |
| `kernel/run_worker_main.py` | worker entry | ~250 |
| `kernel/run_context.py` | UserContext, freshness, finder, audit hook, guard, `current()` | ~350 |
| `kernel/run_cache.py` | keys, entries, LRU, dep validation | ~150 |
| `kernel/run_ops.py` | registry + built-in ops; split into `run_ops_builtin.py` if > 400 lines | |
| `kernel/run_routes.py` | server-side pooled handlers, `run_id`, coalescing, frames | ~400 |
| `kernel/run_memory.py` | RAM detection, budget, estimate, lean path, shaping | ~250 |
| `kernel/run_figures.py` | figure capture | ~80 |
| `kernel/run_winjob.py` | Windows Job Object via ctypes | ~100 |
| `kernel/preview_static.py` | static AST fast path | ~250 |
| `kernel/project_paths.py` | path validation | ~100 |
| `kernel/framework_detect.py` | R-3 detection | ~150 |

Plus the tests and corpus in §7.

**Modified (R-B):**
- `kernel/server.py`: strip the script dir; route rows 1-10 to `run_routes`; start the pool after the ready line and shut it down in `finally`; the guard. The moved branches leave, so the file shrinks.
- `kernel/executor.py`:
  - detection via `framework_detect`;
  - `_run_code` → `run_context` (worker mode = full context; other processes = light context with `__name__`/`__file__` and the `SystemExit` → `user_exit` patch);
  - the memory plan hook; delete the dead `SIGALRM` code and `_last_qec_circuit`;
  - fix the latent `NameError` on `spec` in `transpile` (`executor.py:789,807`).
- `kernel/trainability/_usercode.py`, plus the D11 files.

**Not touched:** `kernel/adapters/**`, `kernel/models/snapshot.py` (R-A), `src-tauri/**` (R-C), `kernel/discovery/procrun.py` (imported only), `kernel/lab_proc.py` (imported only).

## 10. Risks

1. **Idle memory.** ≈ 550 MB idle for 2 warm workers. Mitigation: no run spare below 6 GiB RAM, idle reaping, lazy optional frameworks.
2. **Sweep throughput.** Spawn throughput bounds sweeps of sub-second programs (≈ 1.2 s per point with one spare). Mitigation: adaptive spares (§2.2), measured in `test_sweep_throughput` (informational). A Linux forkserver mode is a possible later, opt-in addition, not R-B.
3. **Preview state leakage.** The preview worker can leak state between reuses through library-level globals the reset list misses. Mitigation: the reset list, dirty checks, the 50-request cap and `test_preview_reuse_freshness`. Run lane workers are always fresh.
4. **Cache staleness** for non-file inputs (env, time, network, randomness). Documented; `cache: false` bypasses it; only preview ops are cached.
5. **Output attribution races.** C-level buffered output and late child output: `fflush(NULL)`, markers, a 1 s grace and the no-live-children reuse rule.
6. **Concurrent heavy groups.** Two groups at just under 40 % each, plus Lab jobs under F-1's ceiling, can still pressure RAM. Mitigations: at most 2 busy run workers, and the estimate refuses most large statevector runs first.
7. **Windows.** Job Object code is less tested and has no `RLIMIT_CPU`; `ready` reports `memory_ceiling` honestly.
8. **macOS.** No PDEATHSIG: an orphaned worker is bounded by `RLIMIT_CPU` and exits on control-socket EOF. `ps` polling costs ≈ 5 ms per poll.
9. **Interleaved frames for old clients.** Clients without `run_id` (today's `useKernel` until R-G) may now see frames of a parse and an execute interleave. This is acceptable because `useKernel` already skips parse while running, and experiment and challenge sessions are sequential.
10. **Monkeypatching tests.** Existing unit tests that monkeypatch adapters stop affecting pooled paths. They must use `inprocess_mode`. Expect a sweep of `test_executor.py`, `test_debug_trace.py`, `test_transpile_*`, `test_docs_fixtures.py` and `test_trainability_handlers.py`.
11. **Hardware serialization.** QPY and Cirq JSON round-trips must be faithful. CUDA-Q kernels cannot leave the worker, so `nvidia` submission returns `hardware_payload_unsupported` (a niche regression, documented).
12. **Duplicated simulation logic.** The lean path duplicates part of adapter logic until consolidation (D8).
13. **Static fast path drift** from exec semantics. Mitigation: conservative bail-out plus the corpus equivalence test.
14. **Finite `RLIMIT_CPU` hard limit** (`ulimit -t` set by the user's shell). The soft limit cannot be raised past it; the worker reports this and recycles early.

## 11. Implementation order

Each step lands with the corpus and the existing suite green; switched paths flip their `xfail` entries.

1. Copy this note into the repo. Add `research_corpus/r_b/**` and the test skeletons RED (`xfail(strict)`, R-tagged).
2. `framework_detect.py` (R-3), wired into the in-process `Executor` → `rb20`-`rb22` and scout `q09`-`q13` flip.
3. `project_paths.py` + `run_context` light mode (`__name__`/`__file__`; `SystemExit` → `user_exit`, the audit's immediate R-7 patch) → `rb05`-`rb08` flip in-process.
4. Pool core (`run_worker`, `run_worker_main`, the `run_ops` registry with test-only `echo`/`sleep`/`exit`/`alloc` ops): spawn, IPC, markers, cap, wall, CPU, RSS ceiling, classification, recycle, macOS-safe. Pool-level tests pass; nothing routed yet.
5. `execute` + `run_python` on the run lane via `run_routes` (`run_id`, `run_cancel`, terminal frames, streaming, env, `sys.path`, purge, `__main__`, multiprocessing wrapper, figures).
6. `run_memory` (R-11) on execute.
7. Preview lane: `parse` with coalescing, the static fast path, `slow`/`elapsed_ms` and `run_cache` with deps.
8. `trainability_inspect` / `_lint` as worker ops (`handlers.py` D11 edits) + `test_single_exec_with_lab_open`.
9. One commit each, flipping that path's every-path parametrization: `transpile`, `debug_trace`, `qec_snapshot` (+ `_text`), `qec_materialize`, `qec_estimate`, `hardware_submit` (`hardware_prepare` + simulator `PrecomputedRun`).
10. Turn on the tripwire in `server.main`; remove dead code; `test_server_never_execs_in_process`; check the docs fixtures.
11. Perf tests, the macOS CI lines (in the report), and `Decision:` amendments to this note.
