"""Entry point of a run worker process (design note section 2.3).

Launched by the pool as ``python -I -c BOOTSTRAP REPO_ROOT``.  Reads one JSON hello line from
stdin, pre-imports the heavy stack once (a fresh interpreter costs ~1.3 s and ~270 MB just to import
numpy / qiskit / aer / cirq), warms it up, then serves requests from the control socket:
``req`` frames in, ``done`` frames out.  User stdout/stderr stay on fds 1 and 2 and every request
ends with a marker on both so the pool knows where its output stops.

The ``run`` lane serves exactly one request and exits; the ``preview`` lane resets its process
state after every request (``WorkerRuntime`` / ``Baseline``) and tells the pool whether it is still
clean enough to reuse.
"""

from __future__ import annotations

import json
import os
import socket
import sys
import time
import traceback

from kernel import run_ipc

PREVIEW_MAX_REQUESTS = 50
PREIMPORTS = (
    "numpy", "qiskit", "qiskit.qpy", "qiskit.quantum_info", "qiskit.transpiler.preset_passmanagers", "qiskit_aer",
    "cirq", "matplotlib", "matplotlib.pyplot", "matplotlib.font_manager",
)
NUCLEI_PREIMPORTS = (
    "kernel.executor", "kernel.framework_detect", "kernel.run_context", "kernel.run_cache", "kernel.run_memory",
    "kernel.run_figures", "kernel.run_ops_builtin", "kernel.models", "kernel.adapters.qiskit_adapter",
    "kernel.adapters.cirq_adapter", "kernel.trainability._usercode", "kernel.trainability.inspect",
    "kernel.trainability.handlers", "kernel.trainability.lint", "kernel.trainability.convert",
    "kernel.trainability.linetrace", "kernel.qec.materialize",
)
OPTIONAL_NUCLEI_PREIMPORTS = ("kernel.adapters.stim_adapter", "kernel.qec.dem")


def _read_hello() -> dict:
    line = sys.stdin.readline()
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)
    os.close(devnull)
    sys.stdin = open(os.devnull, "r", encoding="utf-8")  # noqa: SIM115 - lives for the whole process
    return json.loads(line)


def _die_with_parent(parent_pid: int) -> None:
    """Linux: SIGKILL this worker if the pool's process goes away (``PR_SET_PDEATHSIG``)."""
    if not sys.platform.startswith("linux"):
        return
    try:
        import ctypes
        import signal

        libc = ctypes.CDLL(None, use_errno=True)
        libc.prctl(1, int(signal.SIGKILL), 0, 0, 0)
    except (OSError, AttributeError):
        return
    if os.getppid() != parent_pid:
        os._exit(1)


def _preimport(names: tuple[str, ...], optional: bool = False) -> list[str]:
    import importlib

    loaded: list[str] = []
    for name in names:
        try:
            importlib.import_module(name)
            loaded.append(name)
        except ImportError:
            continue
        except Exception:  # noqa: BLE001 - a broken optional package must not stop the worker
            if not optional:
                continue
    return loaded


def _warm_up() -> None:
    """A Bell circuit through the Qiskit adapter and a figure: moves the first-call costs off Run."""
    try:
        from kernel.adapters.qiskit_adapter import QiskitAdapter
        from qiskit import QuantumCircuit

        qc = QuantumCircuit(2, 2)
        qc.h(0)
        qc.cx(0, 1)
        qc.measure([0, 1], [0, 1])
        adapter = QiskitAdapter()
        adapter.extract_snapshot(qc)
        adapter.simulate(qc, 8)
    except Exception:  # noqa: BLE001 - warm-up is best effort
        pass
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is not None:
        pyplot.figure()
        pyplot.close("all")


def _connect(hello: dict) -> socket.socket:
    if hello.get("control_fd") is not None:
        return socket.socket(fileno=int(hello["control_fd"]))
    sock = socket.create_connection(("127.0.0.1", int(hello["port"])), timeout=10)
    sock.sendall(bytes.fromhex(hello["token"]))
    sock.settimeout(None)
    return sock


def _flush_streams() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.flush()
        except Exception:  # noqa: BLE001
            pass
    try:
        import ctypes

        ctypes.CDLL(None).fflush(None)
    except Exception:  # noqa: BLE001 - best effort: C-level buffers only matter for native code
        pass


def _write_markers(marker: str, seq: int) -> None:
    data = run_ipc.end_marker(marker, seq)
    for fd in (1, 2):
        try:
            os.write(fd, data)
        except OSError:
            pass


def _memory_ceiling_kind() -> str:
    return "job_object" if sys.platform == "win32" else "rss_poll"


def _internal_error(exc: BaseException) -> dict:
    tb = traceback.format_exc()
    return {"code": "worker_internal", "message": f"{type(exc).__name__}: {exc}", "traceback": tb}


def _serve_one(runtime, request: dict, lane: str) -> dict:
    from kernel import run_ops
    from kernel.run_context import RequestState

    state = RequestState.from_wire(request["op"], request.get("run_id", ""), request.get("ctx") or {})
    runtime.begin(state)
    reply, error = None, None
    started = time.perf_counter()
    try:
        spec = run_ops.resolve(request["op"])
        reply, error = spec.invoke(runtime, request.get("args") or {})
    except BaseException as exc:  # noqa: BLE001 - the loop must survive anything an op does
        if isinstance(exc, SystemExit):
            error = {"code": "user_exit", "message": "The run was ended by sys.exit().", "exit_code": exc.code}
        else:
            error = _internal_error(exc)
    op_ms = (time.perf_counter() - started) * 1000
    stats = runtime.stats
    dirty = runtime.end()
    reusable = lane == "preview" and not dirty and runtime.served < PREVIEW_MAX_REQUESTS
    return {
        "t": "done", "seq": request["seq"], "reply": reply, "error": error,
        "stats": {
            "exec_ms": round(stats.exec_ms, 1), "op_ms": round(op_ms, 1), "cache": stats.cache,
            "exec_count": stats.exec_count, "reusable": reusable, "dirty_reason": ",".join(dirty) or None,
            "served": runtime.served,
        },
    }


def main() -> None:
    hello = _read_hello()
    lane = hello["lane"]
    _die_with_parent(int(hello.get("parent_pid", 0)) or os.getppid())
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(line_buffering=True, write_through=True)
    sys.breakpointhook = lambda *a, **k: None
    started = time.perf_counter()
    repo_root = sys.argv[1]
    loaded = _preimport(PREIMPORTS)
    loaded += _preimport(NUCLEI_PREIMPORTS)
    loaded += _preimport(OPTIONAL_NUCLEI_PREIMPORTS, optional=True)
    loaded += _preimport(tuple(hello.get("session_preimports") or ()), optional=True)
    _warm_up()
    import_ms = (time.perf_counter() - started) * 1000

    from kernel import run_context

    runtime = run_context.WorkerRuntime(repo_root, list(hello["base_sys_path"]), lane)
    runtime.install()
    sys.path[:] = [p for p in sys.path if os.path.realpath(p or ".") != os.path.realpath(repo_root)]
    control = _connect(hello)
    rlimit_hard = None
    try:
        import resource

        rlimit_hard = resource.getrlimit(resource.RLIMIT_CPU)[1]
    except (ImportError, ValueError, OSError):
        pass
    run_ipc.send_frame(control, {
        "t": "ready", "pid": os.getpid(), "pgid": os.getpgrp() if hasattr(os, "getpgrp") else os.getpid(),
        "lane": lane, "import_ms": round(import_ms, 1), "python": sys.version.split()[0], "preimported": loaded,
        "rlimit_cpu_hard": rlimit_hard if rlimit_hard not in (-1, None) else None,
        "memory_ceiling": _memory_ceiling_kind(),
    }, run_ipc.FROM_WORKER_MAX_BYTES)
    marker = hello["marker"]
    while True:
        try:
            frame = run_ipc.recv_frame(control, run_ipc.TO_WORKER_MAX_BYTES)
        except run_ipc.FrameError:
            os._exit(2)
        if frame is None or frame.get("t") == "exit":
            os._exit(0)
        if frame.get("t") == "ping":
            run_ipc.send_frame(control, {"t": "pong"}, run_ipc.FROM_WORKER_MAX_BYTES)
            continue
        if frame.get("t") != "req":
            continue
        done = _serve_one(runtime, frame, lane)
        _flush_streams()
        _write_markers(marker, frame["seq"])
        try:
            run_ipc.send_frame(control, done, run_ipc.FROM_WORKER_MAX_BYTES)
        except run_ipc.FrameError as exc:
            run_ipc.send_frame(control, {
                "t": "done", "seq": frame["seq"], "reply": None,
                "error": {"code": "reply_too_large", "message": str(exc)}, "stats": done["stats"],
            }, run_ipc.FROM_WORKER_MAX_BYTES)
        if lane == "run":
            os._exit(0)
