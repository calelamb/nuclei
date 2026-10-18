"""Sandboxed candidate worker (PRD 14 spec 6.1).

Launched as ``sys.executable -I candidate_worker.py`` in its own session with a
minimal environment. It reads ONE strict-JSON request from stdin, execs the
candidate program in a fresh namespace, calls the entry point once per call and
writes ONE JSON line to a private duplicate of stdout.

Everything here is defense in depth and cooperative: a hostile program can
bypass an import blocker. The real boundary is the process (rlimits, the
supervisor's process-group kill and, when available, OS isolation). The worker
only ever returns an *artifact* (Stim text or IR JSON); a separate trusted
scorer re-parses it and computes every number.
"""

from __future__ import annotations

import builtins
import importlib
import importlib.util
import json
import os
import re
import sys
import traceback
from typing import Any

os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"
os.environ["RAYON_NUM_THREADS"] = "1"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from kernel.agent_limits import WorkerLimits, apply_worker_limits  # noqa: E402
from kernel.discovery.constants import (  # noqa: E402
    CANDIDATE_CPU_DEFAULT,
    CANDIDATE_CPU_MAX,
    CANDIDATE_CPU_MIN,
    MAX_CALLS,
    MAX_REQUEST_BYTES,
    MAX_RESPONSE_BYTES,
    PROTOCOL_VERSION,
    STREAM_CAP_BYTES,
    TRUNCATION_MARKER,
)

# The disposable-agent-worker list, then the discovery additions (spec 6.1).
_BLOCKED_IMPORTS = (
    "keyring",
    "kernel.server",
    "kernel.hardware",
    "qiskit_ibm_runtime",
    "braket",
    "azure.quantum",
    "qiskit_ionq",
    "pytket",
    "cudaq",
    "kernel.discovery",
    "socket",
    "ssl",
    "http",
    "urllib",
    "requests",
    "subprocess",
    "multiprocessing",
    "ctypes",
    "cffi",
    "webbrowser",
    "smtplib",
    "ftplib",
)
_BLOCKED_OS_ATTRS = (
    "system", "popen", "fork", "forkpty", "posix_spawn", "posix_spawnp",
    "execl", "execle", "execlp", "execlpe", "execv", "execve", "execvp", "execvpe",
    "spawnl", "spawnle", "spawnlp", "spawnlpe", "spawnv", "spawnve", "spawnvp", "spawnvpe",
)
_ENTRY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_MESSAGE_CAP = 2000


class WorkerFailure(Exception):
    def __init__(self, code: str, message: str, call_index: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.call_index = call_index


class BoundedCapture:
    """Text sink that keeps the first ``limit`` bytes and notes truncation."""

    def __init__(self, limit: int):
        self._limit = limit
        self._data = bytearray()
        self.truncated = False

    def write(self, text: Any) -> int:
        if not isinstance(text, str):
            text = str(text)
        if self.truncated:
            return len(text)
        encoded = text.encode("utf-8", errors="replace")
        room = self._limit - len(self._data)
        if len(encoded) > room:
            self.truncated = True
            encoded = encoded[:max(room, 0)]
        self._data.extend(encoded)
        return len(text)

    def flush(self) -> None:
        return None

    def isatty(self) -> bool:
        return False

    def getvalue(self) -> str:
        text = self._data.decode("utf-8", errors="ignore")
        return text + TRUNCATION_MARKER if self.truncated else text


def _is_blocked_import(name: str) -> bool:
    return any(name == b or name.startswith(b + ".") for b in _BLOCKED_IMPORTS)


class _BlockedImportFinder:
    def find_spec(self, fullname: str, path=None, target=None):
        if _is_blocked_import(fullname):
            raise ImportError(f"Import of {fullname} is blocked in the candidate sandbox.")
        return None


def install_import_blocker() -> None:
    for name in tuple(sys.modules):
        if _is_blocked_import(name):
            del sys.modules[name]
    sys.meta_path.insert(0, _BlockedImportFinder())

    def _raiser(name: str):
        def blocked(*_args, **_kwargs):
            raise PermissionError(f"os.{name} is blocked in the candidate sandbox.")
        blocked.__name__ = name
        return blocked

    for attr in _BLOCKED_OS_ATTRS:
        if hasattr(os, attr):
            setattr(os, attr, _raiser(attr))


def _preimport(task: str) -> None:
    """Import heavy dependencies BEFORE the blocker so their internal imports work."""
    for name in ("numpy", "stim"):
        try:
            importlib.import_module(name)
        except ImportError:
            pass
    if task == "quantum_circuit":
        for name in ("qiskit", "cirq", "kernel.trainability.convert"):
            if importlib.util.find_spec(name.split(".")[0]) is None:
                continue
            try:
                importlib.import_module(name)
            except Exception:  # surfaced as conversion_failed later if needed
                pass


def parse_request(raw: bytes) -> dict[str, Any]:
    if len(raw) > MAX_REQUEST_BYTES:
        raise WorkerFailure("protocol_error", f"Request exceeds {MAX_REQUEST_BYTES} bytes.")
    try:
        request = json.loads(raw.decode("utf-8"), parse_constant=_reject_constant)
    except (ValueError, UnicodeDecodeError) as exc:
        raise WorkerFailure("protocol_error", f"Request is not strict JSON: {exc}")
    if not isinstance(request, dict):
        raise WorkerFailure("protocol_error", "Request must be a JSON object.")
    if request.get("protocol_version") != PROTOCOL_VERSION:
        raise WorkerFailure("protocol_error", "Unsupported protocol_version.")
    if request.get("task") not in ("stim_circuit", "quantum_circuit"):
        raise WorkerFailure("protocol_error", "task must be 'stim_circuit' or 'quantum_circuit'.")
    if not isinstance(request.get("program"), str):
        raise WorkerFailure("protocol_error", "program must be a string.")
    entry = request.get("entry")
    if not isinstance(entry, str) or not _ENTRY_RE.match(entry):
        raise WorkerFailure("protocol_error", "entry must be an identifier.")
    calls = request.get("calls")
    if not isinstance(calls, list) or not 1 <= len(calls) <= MAX_CALLS:
        raise WorkerFailure("protocol_error", f"calls must be a list of 1..{MAX_CALLS} items.")
    for call in calls:
        if not (
            isinstance(call, dict)
            and isinstance(call.get("args", []), list)
            and isinstance(call.get("kwargs", {}), dict)
        ):
            raise WorkerFailure("protocol_error", "each call needs list args and dict kwargs.")
    cpu = request.get("cpu_seconds", CANDIDATE_CPU_DEFAULT)
    if isinstance(cpu, bool) or not isinstance(cpu, (int, float)):
        raise WorkerFailure("protocol_error", "cpu_seconds must be a number.")
    return request


def _reject_constant(token: str):
    raise ValueError(f"non-finite JSON constant {token}")


def clamp_cpu(value: Any) -> int:
    try:
        cpu = int(value)
    except (TypeError, ValueError):
        cpu = CANDIDATE_CPU_DEFAULT
    return max(CANDIDATE_CPU_MIN, min(CANDIDATE_CPU_MAX, cpu))


def _describe_exception(exc: BaseException) -> str:
    message = f"{type(exc).__name__}: {exc}"
    line = None
    for frame in traceback.extract_tb(exc.__traceback__):
        if frame.filename == "<candidate>":
            line = frame.lineno
    if line is not None:
        message += f" (candidate line {line})"
    return message[:_MESSAGE_CAP]


def _load_entry(request: dict[str, Any]):
    try:
        code = compile(request["program"], "<candidate>", "exec")
    except (SyntaxError, ValueError, RecursionError, MemoryError) as exc:
        raise WorkerFailure("compile_error", f"{type(exc).__name__}: {exc}"[:_MESSAGE_CAP])
    namespace: dict[str, Any] = {"__name__": "nuclei_candidate", "__builtins__": builtins}
    try:
        exec(code, namespace)
    except BaseException as exc:  # noqa: BLE001 - candidate code may raise anything
        raise WorkerFailure("entry_raised", "While running the program: " + _describe_exception(exc))
    entry = namespace.get(request["entry"])
    if not callable(entry):
        raise WorkerFailure("entry_missing", f"Entry point '{request['entry']}' is not defined.")
    return entry


def _to_artifact(task: str, value: Any, index: int) -> dict[str, Any]:
    if task == "stim_circuit":
        import stim

        if not isinstance(value, stim.Circuit):
            raise WorkerFailure(
                "bad_return_type",
                f"Expected stim.Circuit, got {type(value).__name__}.",
                index,
            )
        return {"circuit_text": str(value)}
    return _quantum_artifact(value, index)


def _quantum_artifact(value: Any, index: int) -> dict[str, Any]:
    framework = None
    qiskit = sys.modules.get("qiskit")
    cirq = sys.modules.get("cirq")
    if qiskit is not None and isinstance(value, qiskit.QuantumCircuit):
        framework = "qiskit"
    elif cirq is not None and isinstance(value, cirq.Circuit):
        framework = "cirq"
    if framework is None:
        raise WorkerFailure(
            "bad_return_type",
            f"Expected a Qiskit QuantumCircuit or cirq.Circuit, got {type(value).__name__}.",
            index,
        )
    try:
        from kernel.trainability.convert import from_object  # lazy: owned by another module

        ir = from_object(value).to_json()
        if isinstance(ir, str):
            ir = json.loads(ir)
        json.dumps(ir, allow_nan=False)
    except Exception as exc:  # noqa: BLE001
        raise WorkerFailure("conversion_failed", _describe_exception(exc), index)
    return {"ir": ir, "framework": framework}


def run_calls(request: dict[str, Any], entry) -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    for index, call in enumerate(request["calls"]):
        try:
            value = entry(*call.get("args", []), **call.get("kwargs", {}))
        except BaseException as exc:  # noqa: BLE001
            raise WorkerFailure("entry_raised", _describe_exception(exc), index)
        artifacts.append({"call_index": index, "artifact": _to_artifact(request["task"], value, index)})
    return artifacts


def build_response(
    artifacts: list[dict[str, Any]],
    stdout: str,
    stderr: str,
    error: dict[str, Any] | None,
) -> bytes:
    body = {
        "protocol_version": PROTOCOL_VERSION,
        "status": "error" if error else "ok",
        "artifacts": artifacts,
        "stdout": stdout,
        "stderr": stderr,
        "error": error,
    }
    encoded = json.dumps(body, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(encoded) < MAX_RESPONSE_BYTES:
        return encoded + b"\n"
    return build_response(
        [],
        stdout[:1024],
        stderr[:1024],
        {"code": "response_too_large", "message": "Worker response exceeded the byte limit."},
    )


def _private_stdout() -> int:
    """Move the response channel to a private fd; fd 1 and 2 go to /dev/null."""
    out_fd = os.dup(1)
    null_fd = os.open(os.devnull, os.O_RDWR)
    os.dup2(null_fd, 1)
    os.dup2(null_fd, 2)
    os.close(null_fd)
    return out_fd


def main() -> int:
    out_fd = _private_stdout()
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    stdout_cap = BoundedCapture(STREAM_CAP_BYTES)
    stderr_cap = BoundedCapture(STREAM_CAP_BYTES)
    artifacts: list[dict[str, Any]] = []
    error: dict[str, Any] | None = None
    try:
        request = parse_request(raw)
        apply_worker_limits(WorkerLimits(cpu_seconds=clamp_cpu(request.get("cpu_seconds"))))
        _preimport(request["task"])
        install_import_blocker()
        real_out, real_err = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = stdout_cap, stderr_cap
        try:
            entry = _load_entry(request)
            artifacts = run_calls(request, entry)
        finally:
            sys.stdout, sys.stderr = real_out, real_err
    except WorkerFailure as exc:
        error = {"code": exc.code, "message": exc.message}
        if exc.call_index is not None:
            error["call_index"] = exc.call_index
    except BaseException as exc:  # noqa: BLE001
        error = {"code": "protocol_error", "message": f"Worker failure: {type(exc).__name__}"}
    data = build_response(artifacts, stdout_cap.getvalue(), stderr_cap.getvalue(), error)
    view = memoryview(data)
    while view:
        written = os.write(out_fd, view)
        view = view[written:]
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
