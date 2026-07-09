from __future__ import annotations

import argparse
import os
import sys


os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["OMP_NUM_THREADS"] = "1"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kernel.agent_limits import WorkerLimits, apply_worker_limits
from kernel.agent_protocol import ProtocolError, parse_request, response_bytes


def truncate_utf8(value: str, limit: int) -> str:
    encoded = value.encode("utf-8", errors="replace")
    return encoded[:limit].decode("utf-8", errors="ignore")


def configure_disposable_qsharp() -> None:
    from kernel.adapters import qsharp_adapter

    qsharp_adapter._on_interpreter_thread = lambda function, timeout=None: function()


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

        from kernel.executor import Executor

        executor = Executor(capture_limit_bytes=limits.output_bytes)
        if request.framework == "qsharp":
            configure_disposable_qsharp()
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

        output = response_bytes(
            request_id,
            "error" if error else "ok",
            snapshot.to_dict() if snapshot else None,
            result.to_dict() if result else None,
            truncate_utf8(stdout, limits.output_bytes),
            truncate_utf8(stderr, limits.output_bytes),
            error.to_dict() if error else None,
        )
    except ProtocolError as exc:
        output = response_bytes(
            request_id,
            "error",
            None,
            None,
            "",
            "",
            {"code": "protocol_error", "message": str(exc)},
        )
    except BaseException as exc:
        output = response_bytes(
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
