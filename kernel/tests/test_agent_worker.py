import importlib.util
import json
import os
from pathlib import Path
import resource
import subprocess
import sys

import pytest

from kernel.agent_limits import BoundedTextCapture, WorkerLimits, apply_worker_limits


ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "kernel" / "agent_worker.py"
OUTPUT_LIMIT = 65_536
QSHARP_SOURCE = """\
operation Main() : Result[] {
    use q = Qubit();
    H(q);
    return [MResetZ(q)];
}
"""


def make_request(
    code: str,
    *,
    action: str = "parse",
    framework: str = "qsharp",
    language: str = "qsharp",
    shots: int | None = None,
) -> dict[str, object]:
    value: dict[str, object] = {
        "protocol_version": 1,
        "request_id": "test-1",
        "action": action,
        "framework": framework,
        "language": language,
        "code": code,
    }
    if shots is not None:
        value["shots"] = shots
    return value


def worker_env() -> dict[str, str]:
    return {
        "PATH": os.environ.get("PATH", ""),
        "LANG": "C.UTF-8",
        "PYTHONNOUSERSITE": "1",
        "QDK_PYTHON_TELEMETRY": "none",
    }


def run_worker_raw(raw: bytes, timeout: float = 15) -> tuple[subprocess.CompletedProcess[bytes], dict]:
    completed = subprocess.run(
        [sys.executable, "-I", str(WORKER), "--test-limits"],
        input=raw,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=worker_env(),
        cwd=ROOT,
        timeout=timeout,
        check=False,
    )
    assert completed.stdout.count(b"\n") == 1
    response = json.loads(completed.stdout)
    assert isinstance(response, dict)
    return completed, response


def run_worker(
    value: dict[str, object], timeout: float = 15
) -> tuple[subprocess.CompletedProcess[bytes], dict]:
    return run_worker_raw(json.dumps(value).encode("utf-8"), timeout)


def require_qdk() -> None:
    if importlib.util.find_spec("qdk") is None:
        pytest.skip("qdk is not installed")


def test_worker_limits_have_production_and_testing_defaults() -> None:
    assert WorkerLimits() == WorkerLimits(
        cpu_seconds=10,
        address_space_bytes=1_073_741_824,
        file_bytes=1_048_576,
        open_files=64,
        processes=4,
        output_bytes=65_536,
    )
    assert WorkerLimits.testing() == WorkerLimits(
        cpu_seconds=2,
        address_space_bytes=536_870_912,
        file_bytes=1_048_576,
        open_files=32,
        processes=4,
        output_bytes=65_536,
    )


def test_apply_worker_limits_sets_every_required_rlimit(monkeypatch) -> None:
    calls: list[tuple[int, tuple[int, int]]] = []
    monkeypatch.setattr(resource, "setrlimit", lambda key, value: calls.append((key, value)))

    limits = WorkerLimits()
    apply_worker_limits(limits)

    assert calls == [
        (resource.RLIMIT_CPU, (limits.cpu_seconds, limits.cpu_seconds)),
        (
            resource.RLIMIT_AS,
            (limits.address_space_bytes, limits.address_space_bytes),
        ),
        (resource.RLIMIT_FSIZE, (limits.file_bytes, limits.file_bytes)),
        (resource.RLIMIT_NOFILE, (limits.open_files, limits.open_files)),
        (resource.RLIMIT_NPROC, (limits.processes, limits.processes)),
        (resource.RLIMIT_CORE, (0, 0)),
    ]


def test_bounded_capture_counts_bytes_and_preserves_text_contract() -> None:
    capture = BoundedTextCapture(5)

    assert capture.write("ééx") == 3
    assert capture.write("ignored") == 7
    assert capture.getvalue() == "ééx"
    assert len(capture.getvalue().encode("utf-8")) == 5


def test_bounded_capture_never_returns_invalid_utf8() -> None:
    capture = BoundedTextCapture(3)

    assert capture.write("éé") == 2

    assert capture.getvalue() == "é"
    capture.getvalue().encode("utf-8", errors="strict")


def test_bounded_capture_does_not_resume_after_partial_utf8_write() -> None:
    capture = BoundedTextCapture(3)

    assert capture.write("éé") == 2
    assert capture.write("x") == 1

    assert capture.getvalue() == "é"


def test_worker_writes_exactly_one_capped_response_for_output_flood() -> None:
    source = "print('é' * 40_000)\nimport cirq\ncircuit = cirq.Circuit()\n"

    completed, response = run_worker(
        make_request(
            source,
            framework="cirq",
            language="python",
        )
    )

    assert completed.returncode == 0
    assert response["status"] == "ok"
    assert len(response["stdout"].encode("utf-8")) == OUTPUT_LIMIT


def test_worker_rejects_malformed_input_without_loading_executor() -> None:
    completed, response = run_worker_raw(b"{bad", timeout=5)

    assert completed.returncode == 0
    assert completed.stderr == b""
    assert response["request_id"] == "invalid"
    assert response["error"]["code"] == "protocol_error"
    assert response["error"]["message"] == "malformed_json"


def test_generated_python_cannot_see_sensitive_or_provider_modules() -> None:
    code = (
        "import sys\n"
        "blocked = ('keyring', 'kernel.server', 'kernel.hardware', "
        "'qiskit_ibm_runtime', 'braket', 'azure.quantum', 'qiskit_ionq', "
        "'pytket', 'cudaq')\n"
        "print(','.join(sorted(name for name in sys.modules "
        "if any(name == prefix or name.startswith(prefix + '.') "
        "for prefix in blocked))))\n"
        "import cirq\n"
        "circuit = cirq.Circuit()\n"
    )

    _, response = run_worker(
        make_request(
            code,
            framework="cirq",
            language="python",
        )
    )

    assert response["status"] == "ok"
    assert response["stdout"].strip() == ""


def test_two_finite_qsharp_workers_are_fresh() -> None:
    require_qdk()
    request = make_request(
        QSHARP_SOURCE,
        action="simulate",
        shots=4,
    )

    first_completed, first = run_worker(request, timeout=30)
    second_completed, second = run_worker(request, timeout=30)

    assert first_completed.returncode == second_completed.returncode == 0
    assert first["status"] == second["status"] == "ok"
    assert first["result"]["shot_count"] == second["result"]["shot_count"] == 4
