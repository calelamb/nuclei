"""One-request agent worker with cooperative in-process defenses.

Python stdout redirection and the import blocker reduce accidental leakage,
but generated code can bypass or mutate both (for example with os.write or
sys.meta_path). The Rust supervisor's raw-byte cap, exact-one-JSON validation,
and OS sandbox are the authoritative security and framing boundaries. Lexical
adapter selection is only a correctness check; every framework package in the
runtime must independently pass the supervisor's common boundary matrix.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any


os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["OMP_NUM_THREADS"] = "1"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kernel.agent_limits import WorkerLimits, apply_worker_limits
from kernel.agent_protocol import ProtocolError, parse_request, response_bytes


MAX_RESPONSE_BYTES = 1_048_576
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
)


def truncate_utf8(value: str, limit: int) -> str:
    encoded = value.encode("utf-8", errors="replace")
    return encoded[:limit].decode("utf-8", errors="ignore")


def _is_blocked_import(name: str) -> bool:
    return any(
        name == blocked or name.startswith(f"{blocked}.")
        for blocked in _BLOCKED_IMPORTS
    )


class _BlockedImportFinder:
    def find_spec(self, fullname: str, path=None, target=None):
        if _is_blocked_import(fullname):
            raise ImportError(
                f"Import of {fullname} is blocked in the disposable agent worker."
            )
        return None


def install_import_blocker() -> None:
    # A cached module bypasses meta_path, so remove blocked entries first.
    for name in tuple(sys.modules):
        if _is_blocked_import(name):
            del sys.modules[name]
    sys.meta_path.insert(0, _BlockedImportFinder())


def bounded_response(
    request_id: str,
    status: str,
    snapshot: dict[str, Any] | None,
    result: dict[str, Any] | None,
    stdout: str,
    stderr: str,
    error: dict[str, Any] | None,
) -> bytes:
    candidate = response_bytes(
        request_id,
        status,
        snapshot,
        result,
        stdout,
        stderr,
        error,
    )
    if len(candidate) < MAX_RESPONSE_BYTES:
        return candidate

    replacement = response_bytes(
        request_id,
        "error",
        None,
        None,
        "",
        "",
        {
            "code": "response_too_large",
            "message": "Worker response exceeded the byte limit.",
        },
    )
    if len(replacement) >= MAX_RESPONSE_BYTES:
        raise RuntimeError("Minimal worker response exceeds the byte limit.")
    return replacement


def execute_request(request, limits: WorkerLimits) -> bytes:
    from kernel.executor import Executor

    executor = Executor(capture_limit_bytes=limits.output_bytes)
    selected_framework = executor.resolve_framework(
        request.code,
        language=request.language,
    )
    # The lexical selection check catches ordinary routing mistakes before
    # execution. It cannot confine imports: comments and importlib can differ.
    if selected_framework != request.framework:
        return bounded_response(
            request.request_id,
            "error",
            None,
            None,
            "",
            "",
            {
                "code": "framework_mismatch",
                "message": (
                    f"Declared framework {request.framework} does not match "
                    f"selected adapter {selected_framework or 'none'}."
                ),
                "framework": selected_framework,
            },
        )

    if request.language == "python":
        install_import_blocker()
    if request.framework == "qsharp":
        from kernel.adapters.qsharp_adapter import configure_disposable_worker

        configure_disposable_worker()

    if request.action == "parse":
        snapshot, stdout, stderr, error = executor.parse(
            request.code,
            language=request.language,
        )
        result = None
    else:
        result, snapshot, stdout, stderr, error = executor.execute(
            request.code,
            request.shots,
            language=request.language,
        )

    return bounded_response(
        request.request_id,
        "error" if error else "ok",
        snapshot.to_dict() if snapshot else None,
        result.to_dict() if result else None,
        truncate_utf8(stdout, limits.output_bytes),
        truncate_utf8(stderr, limits.output_bytes),
        error.to_dict() if error else None,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test-limits", action="store_true")
    args = parser.parse_args()
    limits = WorkerLimits.testing() if args.test_limits else WorkerLimits()

    apply_worker_limits(limits)
    raw = sys.stdin.buffer.read(270_001)
    request_id = "invalid"

    try:
        request = parse_request(raw)
        request_id = request.request_id
        output = execute_request(request, limits)
    except ProtocolError as exc:
        output = bounded_response(
            request_id,
            "error",
            None,
            None,
            "",
            "",
            {"code": "protocol_error", "message": str(exc)},
        )
    except BaseException as exc:
        output = bounded_response(
            request_id,
            "error",
            None,
            None,
            "",
            "",
            {"code": "worker_error", "message": type(exc).__name__},
        )

    sys.stdout.buffer.write(output)
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
