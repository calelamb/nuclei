"""Conjecture test subprocess.

Launched by :mod:`kernel.discovery.conjecture.jobs` as ``python -I -c <bootstrap>``. Reads one JSON spec
(``{"conjecture", "seed", "sys_path"}``) from stdin and streams JSON lines on the original stdout::

    {"event": "progress", "fraction", "message", "circuit_index"}
    {"event": "evidence", "item"}
    {"event": "result", "result"}
    {"event": "fatal", "code", "message", "path"?}

fd 1 is re-pointed at /dev/null so stray prints cannot corrupt the stream.
"""

from __future__ import annotations

import importlib
import json
import os
import sys
import threading
from typing import Any, Callable

from kernel.discovery.conjecture.errors import SpecError
from kernel.discovery.conjecture.spec import validate_conjecture
from kernel.trainability._analysis_common import AnalysisCancelled
from kernel.trainability._jsonable import to_jsonable

Emit = Callable[[dict], None]

#: Test seam: import ``test_conjecture`` from this module instead of the real tester.
OVERRIDE_ENV = "NUCLEI_CONJECTURE_TESTER_MODULE"


def _tester() -> Callable[..., dict]:
    module = importlib.import_module(os.environ.get(OVERRIDE_ENV) or "kernel.discovery.conjecture.tester")
    return module.test_conjecture


def run(spec: dict[str, Any], emit: Emit) -> None:
    """Run one conjecture test; never raises."""
    try:
        validate_conjecture(spec["conjecture"])
    except SpecError as exc:
        emit({"event": "fatal", "code": "invalid_conjecture", "message": exc.message, "path": exc.path})
        return

    def progress(fraction: float, message: str, circuit_index: int = 0) -> None:
        emit({"event": "progress", "fraction": float(fraction), "message": str(message),
              "circuit_index": int(circuit_index)})

    try:
        result = _tester()(spec["conjecture"], seed=int(spec.get("seed", 0)), progress=progress,
                           cancel=lambda: False, on_evidence=lambda item: emit({"event": "evidence", "item": item}))
    except AnalysisCancelled:
        emit({"event": "fatal", "code": "cancelled", "message": "cancelled"})
        return
    except Exception as exc:  # report instead of dying silently
        emit({"event": "fatal", "code": "conjecture_internal", "message": f"{type(exc).__name__}: {exc}"[:500]})
        return
    emit({"event": "result", "result": result})


def _claim_stdout() -> Emit:
    protocol = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 1)
    os.close(devnull)
    sys.stdout = open(os.devnull, "w", encoding="utf-8")  # noqa: SIM115 - process lifetime
    lock = threading.Lock()

    def emit(event: dict) -> None:
        line = json.dumps(to_jsonable(event), separators=(",", ":"))
        with lock:
            protocol.write(line + "\n")
            protocol.flush()

    return emit


def main() -> int:
    emit = _claim_stdout()
    try:
        spec = json.loads(sys.stdin.readline())
        for extra in reversed(spec.get("sys_path") or []):
            sys.path.insert(0, extra)
        run(spec, emit)
    except BaseException as exc:  # noqa: BLE001
        emit({"event": "fatal", "code": "conjecture_internal", "message": f"{type(exc).__name__}: {exc}"[:500]})
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
