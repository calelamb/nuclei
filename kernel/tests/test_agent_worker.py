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
MAX_RESPONSE_BYTES = 1_048_576
BLOCKED_MODULES = (
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
    completed = run_worker_process(raw, timeout)
    assert completed.stdout.count(b"\n") == 1
    response = json.loads(completed.stdout)
    assert isinstance(response, dict)
    return completed, response


def run_worker_process(
    raw: bytes, timeout: float = 15
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [sys.executable, "-I", str(WORKER), "--test-limits"],
        input=raw,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=worker_env(),
        cwd=ROOT,
        timeout=timeout,
        check=False,
    )


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
    # Configuration calls are all a unit test can prove here. Later OS boundary
    # qualification must verify that each limit is enforced by the real worker.
    # RLIMIT_AS is applied on Linux but skipped on macOS, where a finite value
    # is rejected with EINVAL (see apply_worker_limits).
    calls: list[tuple[int, tuple[int, int]]] = []
    monkeypatch.setattr(resource, "setrlimit", lambda key, value: calls.append((key, value)))

    limits = WorkerLimits()
    apply_worker_limits(limits)

    expected = [(resource.RLIMIT_CPU, (limits.cpu_seconds, limits.cpu_seconds))]
    if not sys.platform.startswith("darwin"):
        expected.append(
            (resource.RLIMIT_AS, (limits.address_space_bytes, limits.address_space_bytes))
        )
    expected.extend(
        [
            (resource.RLIMIT_FSIZE, (limits.file_bytes, limits.file_bytes)),
            (resource.RLIMIT_NOFILE, (limits.open_files, limits.open_files)),
            (resource.RLIMIT_NPROC, (limits.processes, limits.processes)),
            (resource.RLIMIT_CORE, (0, 0)),
        ]
    )
    assert calls == expected


def test_apply_worker_limits_skips_address_space_on_macos(monkeypatch) -> None:
    # Regression guard for the Darwin EINVAL bug that made the original OS-sandbox
    # runtime unspawnable on macOS: a finite RLIMIT_AS must never be requested there.
    calls: list[tuple[int, tuple[int, int]]] = []
    monkeypatch.setattr(resource, "setrlimit", lambda key, value: calls.append((key, value)))
    monkeypatch.setattr(sys, "platform", "darwin")

    apply_worker_limits(WorkerLimits())

    assert resource.RLIMIT_AS not in [key for key, _ in calls]
    assert resource.RLIMIT_CPU in [key for key, _ in calls]


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


def test_cooperative_print_flood_returns_one_capped_response() -> None:
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


def test_raw_fd_write_proves_worker_framing_is_not_authoritative() -> None:
    code = (
        "import os\n"
        "os.write(1, b'INJECTED\\n')\n"
        "import cirq\n"
        "circuit = cirq.Circuit()\n"
    )

    completed = run_worker_process(
        json.dumps(
            make_request(code, framework="cirq", language="python")
        ).encode("utf-8")
    )

    assert completed.stdout.startswith(b"INJECTED\n")
    assert completed.stdout.count(b"\n") == 2
    with pytest.raises(json.JSONDecodeError):
        json.loads(completed.stdout)
    assert json.loads(completed.stdout.splitlines()[1])["status"] == "ok"


def test_worker_rejects_adapter_selection_mismatch_before_source_side_effect(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "executed"
    code = (
        f"from pathlib import Path\nPath({str(marker)!r}).write_text('ran')\n"
        "from qiskit import QuantumCircuit\n"
        "circuit = QuantumCircuit(1)\n"
    )

    _, response = run_worker(
        make_request(code, framework="cirq", language="python")
    )

    assert response["status"] == "error"
    assert response["error"]["code"] == "framework_mismatch"
    assert response["error"]["framework"] == "qiskit"
    assert not marker.exists()


def test_worker_replaces_oversized_serialized_response() -> None:
    code = (
        "import cirq\n"
        "raise RuntimeError('é' * 250_000)\n"
        "circuit = cirq.Circuit()\n"
    )

    completed, response = run_worker(
        make_request(code, framework="cirq", language="python")
    )

    assert len(completed.stdout) < MAX_RESPONSE_BYTES
    assert response["status"] == "error"
    assert response["error"] == {
        "code": "response_too_large",
        "message": "Worker response exceeded the byte limit.",
    }


def test_worker_rejects_malformed_input_without_loading_executor() -> None:
    completed, response = run_worker_raw(b"{bad", timeout=5)

    assert completed.returncode == 0
    assert completed.stderr == b""
    assert response["request_id"] == "invalid"
    assert response["error"]["code"] == "protocol_error"
    assert response["error"]["message"] == "malformed_json"


def test_generated_python_imports_are_blocked_for_sensitive_modules() -> None:
    code = """\
import importlib
import sys
import types
azure = types.ModuleType("azure")
azure.__path__ = []
sys.modules["azure"] = azure
blocked = (
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
for name in blocked:
    try:
        importlib.import_module(name)
    except ImportError as exc:
        print(f"{name}:{exc}")
    else:
        print(f"{name}:LOADED")
import cirq
circuit = cirq.Circuit()
"""

    _, response = run_worker(
        make_request(
            code,
            framework="cirq",
            language="python",
        )
    )

    assert response["status"] == "ok"
    assert response["stdout"].splitlines() == [
        f"{name}:Import of {name} is blocked in the disposable agent worker."
        for name in BLOCKED_MODULES
    ]


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
