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
import resource
import re
import signal
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
    # C-level twins that would sidestep the blocks above.
    "_socket",
    "_ssl",
    "_ctypes",
    "_posixsubprocess",
    "_multiprocessing",
)
# Blocked on BOTH ``os`` and ``posix`` (``os.fork is posix.fork``; ``import posix`` is a
# trivial way around an ``os``-only patch). ``setsid``/``setpgid``/``setpgrp`` and
# ``kill``/``killpg`` stop a candidate from leaving the supervisor's process group or
# signalling other processes of the same user (``os.kill(-1, 9)``).
_BLOCKED_OS_ATTRS = (
    "system", "popen", "fork", "forkpty", "posix_spawn", "posix_spawnp",
    "execl", "execle", "execlp", "execlpe", "execv", "execve", "execvp", "execvpe",
    "spawnl", "spawnle", "spawnlp", "spawnlpe", "spawnv", "spawnve", "spawnvp", "spawnvpe",
    "setsid", "setpgid", "setpgrp", "kill", "killpg", "fork_exec",
)
_SUBPROCESS_ENTRY_POINTS = (
    "Popen", "run", "call", "check_call", "check_output", "getoutput", "getstatusoutput", "_fork_exec",
)
_ENTRY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_MESSAGE_CAP = 2000
CANDIDATE_FILENAME = "<candidate>"


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


def _raiser(owner: str, name: str):
    def blocked(*_args, **_kwargs):
        raise PermissionError(f"{owner}.{name} is blocked in the candidate sandbox.")
    blocked.__name__ = name
    return blocked


def _neuter_module(module: Any, owner: str, names: tuple[str, ...]) -> None:
    for attr in names:
        if hasattr(module, attr):
            try:
                setattr(module, attr, _raiser(owner, attr))
            except (AttributeError, TypeError):
                pass


def install_import_blocker() -> None:
    # A heavy dependency imported BEFORE the blocker may still hold a reference to
    # ``subprocess``; dropping the sys.modules entry is not enough, so the live
    # module objects are neutered too.
    _neuter_module(sys.modules.get("subprocess"), "subprocess", _SUBPROCESS_ENTRY_POINTS)
    _neuter_module(sys.modules.get("_posixsubprocess"), "_posixsubprocess", ("fork_exec",))
    for name in tuple(sys.modules):
        if _is_blocked_import(name):
            del sys.modules[name]
    sys.meta_path.insert(0, _BlockedImportFinder())
    posix = sys.modules.get("posix")
    for attr in _BLOCKED_OS_ATTRS:
        if hasattr(os, attr):
            setattr(os, attr, _raiser("os", attr))
        if posix is not None and hasattr(posix, attr):
            setattr(posix, attr, _raiser("posix", attr))


def _preimport(task: str) -> None:
    """Import heavy dependencies BEFORE the blocker so their internal imports work."""
    for name in ("numpy", "stim"):
        try:
            importlib.import_module(name)
        except ImportError:
            pass
    if task == "quantum_circuit":
        # Qiskit probes for a writable temp dir at import time, which the write-denying
        # sandbox (macOS sandbox-exec) makes impossible; naming one skips the probe.
        import tempfile

        tempfile.tempdir = tempfile.tempdir or "/tmp"
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
        if frame.filename == CANDIDATE_FILENAME:
            line = frame.lineno
    if line is not None:
        message += f" (candidate line {line})"
    return message[:_MESSAGE_CAP]


def _load_entry(request: dict[str, Any]):
    try:
        code = compile(request["program"], CANDIDATE_FILENAME, "exec")
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


def _to_artifact(task: str, value: Any, index: int, line_map: Any = None) -> dict[str, Any]:
    if task == "stim_circuit":
        import stim

        if not isinstance(value, stim.Circuit):
            raise WorkerFailure(
                "bad_return_type",
                f"Expected stim.Circuit, got {type(value).__name__}.",
                index,
            )
        return {"circuit_text": str(value)}
    return _quantum_artifact(value, index, line_map)


def _quantum_artifact(value: Any, index: int, line_map: Any = None) -> dict[str, Any]:
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
        from kernel.trainability.ir import IrError
    except Exception as exc:  # noqa: BLE001
        raise WorkerFailure("conversion_failed", _describe_exception(exc), index)
    try:
        ir = from_object(value, line_map=line_map).to_json()
        if isinstance(ir, str):
            ir = json.loads(ir)
        json.dumps(ir, allow_nan=False)
    except IrError as exc:
        # A circuit the IR cannot express (opaque initialize/unitary gates, dynamic
        # circuits, ...) is a *candidate* defect, not a sandbox failure: hand the
        # converter's verdict to the trusted scorer so its ``ir_conversion``
        # guardrail rejects it visibly instead of the call failing opaquely.
        return {
            "ir": None,
            "ir_error": {"code": exc.code, "message": exc.message[:_MESSAGE_CAP]},
            "framework": framework,
        }
    except Exception as exc:  # noqa: BLE001
        raise WorkerFailure("conversion_failed", _describe_exception(exc), index)
    return {"ir": ir, "framework": framework}


def run_calls(request: dict[str, Any], entry, line_map: Any = None) -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    for index, call in enumerate(request["calls"]):
        try:
            value = entry(*call.get("args", []), **call.get("kwargs", {}))
        except BaseException as exc:  # noqa: BLE001
            raise WorkerFailure("entry_raised", _describe_exception(exc), index)
        artifacts.append({"call_index": index, "artifact": _to_artifact(request["task"], value, index, line_map)})
    return artifacts


def _run_program(request: dict[str, Any]) -> list[dict[str, Any]]:
    """Load and call the candidate. Quantum tasks run under ``trace_gate_lines`` so
    IR gates carry the candidate line they came from (addendum section C)."""
    if request["task"] != "quantum_circuit":
        return run_calls(request, _load_entry(request))
    try:
        from kernel.trainability.linetrace import trace_gate_lines
    except Exception:  # noqa: BLE001 - line numbers are an optional enrichment
        return run_calls(request, _load_entry(request))
    with trace_gate_lines(CANDIDATE_FILENAME) as line_map:
        entry = _load_entry(request)
        return run_calls(request, entry, line_map)


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


# --- trusted/untrusted split (RT-H1) ---------------------------------------------
#
# The process that owns the response fd NEVER runs candidate code. It forks a child
# BEFORE any candidate code exists; the child runs the program and reports its
# results over a pipe. Whatever arrives on that pipe is untrusted: the parent
# re-validates it (a real ``stim.Circuit`` re-parse, a strict IR parse) and is the
# only writer of the single authoritative response line.

_ERROR_CODE_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def _strict_json(raw: bytes) -> Any:
    """Parse exactly one JSON document (no trailing data, no NaN/Infinity)."""
    text = raw.decode("utf-8")
    value, end = json.JSONDecoder(parse_constant=_reject_constant).raw_decode(text)
    if text[end:].strip():
        raise ValueError("trailing data after the JSON document")
    return value


def _failure(code: str, message: str, index: int | None = None) -> WorkerFailure:
    return WorkerFailure(code, message, index)


def _validate_stim(artifact: Any, index: int) -> dict[str, Any]:
    import stim

    text = artifact.get("circuit_text") if isinstance(artifact, dict) else None
    if not isinstance(text, str):
        raise _failure("bad_return_type", "Expected stim.Circuit.", index)
    try:
        return {"circuit_text": str(stim.Circuit(text))}
    except Exception as exc:  # noqa: BLE001 - stim raises ValueError/others on bad text
        raise _failure("bad_return_type", f"Artifact is not a valid stim circuit: {type(exc).__name__}.", index)


def _validate_quantum(artifact: Any, index: int) -> dict[str, Any]:
    if not isinstance(artifact, dict) or artifact.get("framework") not in ("qiskit", "cirq"):
        raise _failure("bad_return_type", "Expected a Qiskit QuantumCircuit or cirq.Circuit.", index)
    framework = artifact["framework"]
    if artifact.get("ir") is None:
        err = artifact.get("ir_error")
        if not (isinstance(err, dict) and isinstance(err.get("code"), str) and isinstance(err.get("message"), str)):
            raise _failure("conversion_failed", "Artifact carried neither an IR nor an IR error.", index)
        return {
            "ir": None,
            "ir_error": {"code": err["code"][:64], "message": err["message"][:_MESSAGE_CAP]},
            "framework": framework,
        }
    try:
        from kernel.trainability.ir import ParamCircuit

        ir = ParamCircuit.from_json(artifact["ir"]).to_json()
        json.dumps(ir, allow_nan=False)
    except Exception as exc:  # noqa: BLE001
        raise _failure("conversion_failed", f"Artifact IR failed validation: {type(exc).__name__}.", index)
    return {"ir": ir, "framework": framework}


def validate_child_message(request: dict[str, Any], message: Any) -> tuple[list[dict[str, Any]], str, str, dict[str, Any] | None]:
    """Re-validate everything the (untrusted) child reported; raises ``WorkerFailure``."""
    if not isinstance(message, dict):
        raise _failure("protocol_error", "Child report was not an object.")
    stdout, stderr = message.get("stdout", ""), message.get("stderr", "")
    if not isinstance(stdout, str) or not isinstance(stderr, str):
        raise _failure("protocol_error", "Child streams must be strings.")
    stdout, stderr = stdout[: STREAM_CAP_BYTES + 64], stderr[: STREAM_CAP_BYTES + 64]
    error = message.get("error")
    if error is not None:
        if not (
            isinstance(error, dict)
            and isinstance(error.get("code"), str)
            and _ERROR_CODE_RE.match(error["code"])
            and isinstance(error.get("message"), str)
        ):
            raise _failure("protocol_error", "Child error report was malformed.")
        clean: dict[str, Any] = {"code": error["code"], "message": error["message"][:_MESSAGE_CAP]}
        index = error.get("call_index")
        if isinstance(index, int) and not isinstance(index, bool) and 0 <= index < len(request["calls"]):
            clean["call_index"] = index
        return [], stdout, stderr, clean
    raw = message.get("artifacts")
    if not isinstance(raw, list) or len(raw) != len(request["calls"]):
        raise _failure("protocol_error", "Child returned the wrong number of artifacts.")
    validator = _validate_stim if request["task"] == "stim_circuit" else _validate_quantum
    artifacts = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict) or item.get("call_index") != index:
            raise _failure("protocol_error", "Child artifacts were out of order.")
        artifacts.append({"call_index": index, "artifact": validator(item.get("artifact"), index)})
    return artifacts, stdout, stderr, None


def _read_bounded(fd: int, limit: int) -> tuple[bytes, bool]:
    """Read ``fd`` to EOF, stopping at ``limit`` + 1 bytes. Returns (data, overflowed)."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = os.read(fd, 65536)
        if not chunk:
            return b"".join(chunks), False
        total += len(chunk)
        chunks.append(chunk)
        if total > limit:
            return b"".join(chunks), True


# The trusted parent's CPU allowance on top of the candidate's budget. The parent's own
# startup and pre-imports (numpy, stim, qiskit) must never be charged to the candidate:
# on a slow host they alone can exceed a 1 s budget, killing the parent before it reports.
PARENT_CPU_ALLOWANCE_S = 60


def _limit_candidate_cpu(cpu_seconds: int) -> None:
    """Apply the candidate's exact CPU budget in the child (its CPU clock starts at 0 after fork)."""
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    except (ValueError, OSError):
        pass  # the parent's (budget + allowance) limit and the supervisor's wall clock still apply


def _child_run(request: dict[str, Any], report_fd: int) -> None:
    """Runs in the forked child ONLY. Never returns."""
    code = 0
    _limit_candidate_cpu(clamp_cpu(request.get("cpu_seconds")))
    try:
        stdout_cap = BoundedCapture(STREAM_CAP_BYTES)
        stderr_cap = BoundedCapture(STREAM_CAP_BYTES)
        artifacts: list[dict[str, Any]] = []
        error: dict[str, Any] | None = None
        try:
            install_import_blocker()
            real_out, real_err = sys.stdout, sys.stderr
            sys.stdout, sys.stderr = stdout_cap, stderr_cap
            try:
                artifacts = _run_program(request)
            finally:
                sys.stdout, sys.stderr = real_out, real_err
        except WorkerFailure as exc:
            error = {"code": exc.code, "message": exc.message}
            if exc.call_index is not None:
                error["call_index"] = exc.call_index
        except BaseException as exc:  # noqa: BLE001
            error = {"code": "protocol_error", "message": f"Worker failure: {type(exc).__name__}"}
        body = {"artifacts": artifacts, "stdout": stdout_cap.getvalue(), "stderr": stderr_cap.getvalue(), "error": error}
        data = json.dumps(body, separators=(",", ":"), allow_nan=False).encode("utf-8")
        view = memoryview(data)
        while view:
            view = view[os.write(report_fd, view):]
    except BaseException:  # noqa: BLE001 - the parent reports a missing report
        code = 1
    finally:
        os._exit(code)


def _child_death(status: int) -> dict[str, Any] | None:
    """A ``worker_killed`` error when the child died from a signal (CPU limit, OOM kill...).

    The trusted parent reports it explicitly instead of re-raising the signal on itself:
    re-raising does not survive every wrapper (``bwrap`` turns a signal death into a plain
    exit code, and a process that is PID 1 in its namespace ignores signals it sends itself).
    """
    if not os.WIFSIGNALED(status):
        return None
    sig = os.WTERMSIG(status)
    try:
        name = signal.Signals(sig).name
    except ValueError:
        name = f"signal {sig}"
    return {"code": "worker_killed",
            "message": f"Candidate was killed by {name}; this usually means the CPU limit was exceeded."}


def _supervise_child(request: dict[str, Any], read_fd: int, pid: int) -> bytes:
    """Collect and validate the child's single report; always returns response bytes."""
    try:
        raw, overflow = _read_bounded(read_fd, MAX_RESPONSE_BYTES)
    finally:
        os.close(read_fd)
    _, status = os.waitpid(pid, 0)
    killed = _child_death(status)
    if killed is not None:
        return build_response([], "", "", killed)
    if overflow:
        return build_response([], "", "", {"code": "response_too_large", "message": "Worker response exceeded the byte limit."})
    if not raw:
        return build_response([], "", "", {"code": "candidate_exited", "message": "The candidate ended the worker without returning."})
    try:
        artifacts, stdout, stderr, error = validate_child_message(request, _strict_json(raw))
    except WorkerFailure as exc:
        error = {"code": exc.code, "message": exc.message}
        if exc.call_index is not None:
            error["call_index"] = exc.call_index
        return build_response([], "", "", error)
    except (ValueError, UnicodeDecodeError):
        return build_response([], "", "", {"code": "protocol_error", "message": "Child report was not a single JSON document."})
    return build_response(artifacts, stdout, stderr, error)


def _write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        view = view[os.write(fd, view):]


def main() -> int:
    out_fd = _private_stdout()
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    try:
        request = parse_request(raw)
        apply_worker_limits(WorkerLimits(cpu_seconds=clamp_cpu(request.get("cpu_seconds")) + PARENT_CPU_ALLOWANCE_S))
        _preimport(request["task"])
    except WorkerFailure as exc:
        _write_all(out_fd, build_response([], "", "", {"code": exc.code, "message": exc.message}))
        return 0
    except BaseException as exc:  # noqa: BLE001
        _write_all(out_fd, build_response([], "", "", {"code": "protocol_error", "message": f"Worker failure: {type(exc).__name__}"}))
        return 0
    read_fd, write_fd = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(read_fd)
        os.close(out_fd)  # the candidate must never hold the response channel
        null_fd = os.open(os.devnull, os.O_RDONLY)
        os.dup2(null_fd, 0)
        os.close(null_fd)
        _child_run(request, write_fd)
    os.close(write_fd)
    _write_all(out_fd, _supervise_child(request, read_fd, pid))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
