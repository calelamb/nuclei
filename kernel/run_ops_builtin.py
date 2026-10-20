"""The editor's built-in worker ops (design note section 1, rows 1-10).

Each op runs inside a run worker (``kernel.run_worker_main``) with a live ``WorkerRuntime`` and
returns ``(reply, error)``: ``reply`` is a JSON-able dict the server turns into the same frames the
in-process handlers used to send, ``error`` is a ``KernelError.to_dict()`` or ``None``.  User
stdout/stderr are *not* returned: they flow on the worker's own streams and the pool forwards them.
"""

from __future__ import annotations

import sys
from typing import Any

from kernel import preview_static, run_hardware
from kernel.executor import Executor
from kernel.models import KernelError
from kernel.run_ops import PREVIEW, RUN, worker_op

SLOW_PARSE_MS = 500.0
MAX_STIM_TEXT_CHARS = 4_000_000


def _emit(stdout: str, stderr: str) -> None:
    """Source-mode adapters return their output as strings; put it on the streams the pool reads."""
    if stdout:
        sys.stdout.write(stdout)
    if stderr:
        sys.stderr.write(stderr)


def _wire(error: KernelError | None) -> dict | None:
    return error.to_dict() if error is not None else None


def _preview_fields(runtime: Any) -> dict:
    exec_ms = runtime.stats.exec_ms
    return {
        "preview": "cache" if runtime.stats.cache == "hit" else "exec",
        "elapsed_ms": round(exec_ms, 1),
        "slow": exec_ms > SLOW_PARSE_MS,
    }


def _qec_sidecar(executor: Executor) -> dict:
    """The detector-graph payload and the circuit text the connection remembers (stim circuits only)."""
    payload, error = executor.qec_snapshot_payload()
    sidecar: dict[str, Any] = {"qec": payload if error is None else None}
    circuit = executor._last_qec_circuit
    text = str(circuit) if circuit is not None else None
    sidecar["stim_text"] = text if text is not None and len(text) <= MAX_STIM_TEXT_CHARS else None
    return sidecar


def _static_snapshot(runtime: Any, code: str, language: str | None) -> dict | None:
    """R-8 d: the diagram of a straight-line program without running it; ``None`` to run it instead."""
    if runtime.request is None or runtime.request.cache != "use" or language in ("qsharp", "stim"):
        return None
    static = preview_static.try_static(code)
    if static is None:
        return None
    executor = Executor()
    spec = executor._spec_named(static.framework)
    adapter, load_error = executor._load_adapter(spec) if spec is not None else (None, None)
    if adapter is None or load_error is not None:
        return None
    try:
        snapshot = adapter.extract_snapshot(static.circuit)
    except Exception:  # noqa: BLE001 - the real run will report it properly
        return None
    runtime.stats.cache = "static"
    return {"snapshot": snapshot.to_dict(), "preview": "static", "elapsed_ms": 0.0, "slow": False}


@worker_op("parse", lane=PREVIEW, cached=True, wall_s=10.0, takes_runtime=True)
def parse_op(runtime: Any, args: dict) -> tuple[dict, dict | None]:
    static = _static_snapshot(runtime, args.get("code", ""), args.get("language"))
    if static is not None:
        return static, None
    executor = Executor()
    snapshot, stdout, stderr, error = executor.parse(args.get("code", ""), language=args.get("language"))
    _emit(stdout, stderr)
    reply: dict[str, Any] = {"snapshot": snapshot.to_dict() if snapshot else None, **_preview_fields(runtime)}
    if executor.snapshot_error:
        reply["snapshot_error"] = executor.snapshot_error
    if snapshot is not None and snapshot.framework == "stim":
        reply.update(_qec_sidecar(executor))
    return reply, _wire(error)


@worker_op("execute", lane=RUN, wall_s=600.0, takes_runtime=True)
def execute_op(runtime: Any, args: dict) -> tuple[dict, dict | None]:
    executor = Executor()
    limits = args.get("limits") or {}
    result, snapshot, stdout, stderr, error = executor.execute(
        args.get("code", ""), int(args.get("shots", 1024)), language=args.get("language"),
        params=args.get("params"), seed=args.get("seed"), parameter_values=args.get("parameter_values"),
        simulation_method=args.get("simulation_method"), memory_limit_mb=limits.get("memory_mb"),
    )
    _emit(stdout, stderr)
    data = result.to_dict() if result is not None else None
    program = executor.program
    if data is not None:
        if program is not None and program.figures:
            data["figures"] = program.figures
            if program.figures_dropped:
                data["figures_truncated"] = program.figures_dropped
    reply: dict[str, Any] = {
        "snapshot": snapshot.to_dict() if snapshot else None, "result": data,
        "run_dir": runtime.request.run_dir if runtime.request else None,
    }
    if executor.snapshot_error:
        reply["snapshot_error"] = executor.snapshot_error
    if snapshot is not None and snapshot.framework == "stim" and error is None:
        reply.update(_qec_sidecar(executor))
    return reply, _wire(error)


@worker_op("run_python", lane=RUN, wall_s=600.0, takes_runtime=True)
def run_python_op(runtime: Any, args: dict) -> tuple[dict, dict | None]:
    executor = Executor()
    stdout, stderr, error = executor.run_python(args.get("code", ""))
    _emit(stdout, stderr)
    program = executor.program
    reply: dict[str, Any] = {}
    if program is not None and program.figures:
        reply["figures"] = program.figures
    return reply, _wire(error)


@worker_op("transpile", lane=PREVIEW, cached=True, wall_s=60.0, takes_runtime=True)
def transpile_op(runtime: Any, args: dict) -> tuple[dict, dict | None]:
    payload, stdout, stderr, error = Executor().transpile_explore(
        args.get("code", ""), basis_gates=args.get("basis_gates"), coupling_map=args.get("coupling_map"),
        optimization_level=args.get("optimization_level", 1), language=args.get("language"),
    )
    _emit(stdout, stderr)
    return {"data": payload}, _wire(error)


@worker_op("debug_trace", lane=PREVIEW, cached=True, wall_s=30.0, takes_runtime=True)
def debug_trace_op(runtime: Any, args: dict) -> tuple[dict, dict | None]:
    payload, stdout, stderr, error = Executor().debug_trace(args.get("code", ""), language=args.get("language"))
    _emit(stdout, stderr)
    return {"data": payload}, _wire(error)


@worker_op("qec_snapshot", lane=PREVIEW, cached=True, wall_s=30.0, takes_runtime=True)
def qec_snapshot_op(runtime: Any, args: dict) -> tuple[dict, dict | None]:
    payload, error = Executor().qec_snapshot_payload(
        code=args.get("code"), language=args.get("language"), max_edges=args.get("max_edges")
    )
    return {"data": payload}, _wire(error)


@worker_op("qec_snapshot_text", lane=PREVIEW, wall_s=30.0, takes_runtime=True)
def qec_snapshot_text_op(runtime: Any, args: dict) -> tuple[dict, dict | None]:
    payload, error = Executor().qec_snapshot_payload(
        circuit_text=args.get("circuit_text", ""), max_edges=args.get("max_edges")
    )
    return {"data": payload}, _wire(error)


@worker_op("qec_materialize", lane=PREVIEW, cached=True, wall_s=60.0, takes_runtime=True)
def qec_materialize_op(runtime: Any, args: dict) -> tuple[dict, dict | None]:
    from kernel.qec.materialize import materialize_circuits

    circuits, stdout, stderr, error = materialize_circuits(Executor(), args.get("code", ""), args.get("noise"))
    _emit(stdout, stderr)
    return {"circuits": circuits}, _wire(error)


@worker_op("qec_estimate", lane=RUN, wall_s=600.0, takes_runtime=True)
def qec_estimate_op(runtime: Any, args: dict) -> tuple[dict, dict | None]:
    from kernel.qec.estimate import estimate_resources

    payload, error = estimate_resources(args.get("code", ""), args.get("language", "qsharp"), args.get("options"))
    return {"data": payload}, _wire(error)


@worker_op("hardware_prepare", lane=RUN, wall_s=120.0, takes_runtime=True)
def hardware_prepare_op(runtime: Any, args: dict) -> tuple[dict, dict | None]:
    """Run the program and return its circuit, serialized, for ``provider.submit_job``."""
    executor = Executor()
    stdout, stderr, error = executor.run_python(args.get("code", ""))
    _emit(stdout, stderr)
    if error is not None:
        return {}, _wire(error)
    circuit = run_hardware.extract_circuit_for_provider(executor._namespace, args.get("provider", "simulator"))
    if circuit is None:
        return {}, _wire(KernelError(
            code="no_circuit",
            message="No circuit object found in the code. Your code must define a Qiskit QuantumCircuit, Cirq Circuit, or CUDA-Q kernel.",
        ))
    wire = run_hardware.serialize_circuit(circuit)
    if wire is None:
        return {}, _wire(KernelError(
            code="hardware_payload_unsupported",
            message="This circuit type cannot be sent to hardware from the editor (CUDA-Q kernels stay inside their worker).",
        ))
    return {"circuit": wire}, None
