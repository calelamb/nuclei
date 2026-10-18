"""Sandbox abuse tests for the candidate worker + supervisor (PRD 14 spec 6.1)."""

from __future__ import annotations

import json
import threading
import time

import pytest

pytest.importorskip("stim")

from kernel.discovery import isolation as iso  # noqa: E402
from kernel.discovery.constants import MAX_REQUEST_BYTES, STREAM_CAP_BYTES  # noqa: E402
from kernel.discovery.sandbox import default_request, run_candidate  # noqa: E402

PROCESS = iso.IsolationInfo(iso.MODE_PROCESS)
GOOD = "import stim\ndef build(d, r):\n    return stim.Circuit('H 0\\nM 0')\n"


def run(program: str, *, calls=None, entry="build", wall=120, cpu=10, task="stim_circuit", cancel=None):
    request = default_request(task, program, entry, calls or [{"args": [3, 3], "kwargs": {}}], cpu)
    return run_candidate(request, wall_seconds=wall, cancel_event=cancel, isolation=PROCESS)


def code(response) -> str | None:
    return (response.get("error") or {}).get("code")


def test_ok_roundtrip_returns_circuit_text_and_isolation():
    response = run(GOOD, calls=[{"args": [3, 3], "kwargs": {}}, {"args": [5, 5], "kwargs": {}}])
    assert response["status"] == "ok"
    assert [a["call_index"] for a in response["artifacts"]] == [0, 1]
    assert response["artifacts"][0]["artifact"]["circuit_text"] == "H 0\nM 0"
    assert response["isolation"] == "process"
    assert response["error"] is None


def test_prints_are_captured_not_protocol_breaking():
    program = "import stim, sys\nprint('hello')\nsys.stderr.write('warn')\n" + GOOD
    response = run(program)
    assert response["status"] == "ok"
    assert response["stdout"] == "hello\n"
    assert response["stderr"] == "warn"


def test_compile_error():
    response = run("def build(:\n  pass")
    assert code(response) == "compile_error"


def test_missing_entry():
    assert code(run(GOOD, entry="nope")) == "entry_missing"
    assert code(run("build = 3\n")) == "entry_missing"


def test_entry_raises_reports_candidate_line():
    response = run("def build(d, r):\n    raise ValueError('boom')\n")
    assert code(response) == "entry_raised"
    assert "ValueError: boom" in response["error"]["message"]
    assert "line 2" in response["error"]["message"]


def test_module_level_exception_is_entry_raised():
    assert code(run("raise RuntimeError('x')\n")) == "entry_raised"


def test_non_circuit_return_is_bad_return_type():
    response = run("def build(d, r):\n    return object()\n")
    assert code(response) == "bad_return_type"
    assert "object" in response["error"]["message"]


def test_non_json_serializable_return_is_rejected_not_crashing():
    response = run("def build(d, r):\n    return {1, 2, 3}\n")
    assert code(response) == "bad_return_type"


def test_second_call_failure_reports_call_index():
    program = "import stim\ndef build(d, r):\n    if d == 5:\n        raise KeyError('x')\n    return stim.Circuit('H 0')\n"
    response = run(program, calls=[{"args": [3, 3], "kwargs": {}}, {"args": [5, 5], "kwargs": {}}])
    assert code(response) == "entry_raised"
    assert response["error"]["call_index"] == 1
    assert len(response["artifacts"]) == 0 or response["status"] == "error"


@pytest.mark.parametrize("module", ["socket", "subprocess", "ctypes", "multiprocessing", "http.client", "urllib.request", "requests", "_socket", "_posixsubprocess", "_ctypes"])
def test_blocked_imports(module):
    response = run(f"import {module}\n" + GOOD)
    assert code(response) == "entry_raised"
    assert "blocked" in response["error"]["message"]


def test_blocked_import_inside_entry():
    response = run("def build(d, r):\n    import socket\n")
    assert code(response) == "entry_raised"
    assert "blocked" in response["error"]["message"]


@pytest.mark.parametrize("call", ["os.system('echo hi')", "os.fork()", "os.execv('/bin/sh', ['sh'])", "os.popen('echo')", "os.spawnl(os.P_WAIT, '/bin/sh', 'sh')"])
def test_os_process_primitives_raise(call):
    response = run(f"import os\ndef build(d, r):\n    {call}\n")
    assert code(response) == "entry_raised"
    assert "blocked" in response["error"]["message"]


def test_huge_stdout_is_capped_with_marker():
    program = "import stim\nprint('x' * 5_000_000)\n" + GOOD
    response = run(program)
    assert response["status"] == "ok"
    assert len(response["stdout"].encode()) <= STREAM_CAP_BYTES + 100
    assert response["stdout"].endswith("truncated at 65536 bytes]")


def test_direct_fd_write_cannot_break_protocol():
    program = "import os, stim\nos.write(1, b'GARBAGE{{{\\n')\nos.write(2, b'noise')\n" + GOOD
    response = run(program)
    assert response["status"] == "ok"


def test_huge_artifact_is_response_too_large():
    program = (
        "import stim\ndef build(d, r):\n"
        "    return stim.Circuit('H ' + ' '.join(map(str, range(700000))))\n"
    )
    response = run(program)
    assert code(response) == "response_too_large"


def test_wall_timeout_kills_group():
    start = time.monotonic()
    response = run("import time\ntime.sleep(60)\n" + GOOD, wall=1.5)
    assert code(response) == "worker_timeout"
    assert time.monotonic() - start < 90


def test_cpu_limit_kills_worker():
    response = run("while True:\n    pass\n", cpu=1, wall=120)
    assert code(response) == "worker_killed"
    assert "SIGXCPU" in response["error"]["message"] or "signal" in response["error"]["message"]


def test_cancel_event_kills_worker_promptly():
    cancel = threading.Event()
    threading.Timer(0.8, cancel.set).start()
    start = time.monotonic()
    response = run("import time\ntime.sleep(60)\n" + GOOD, wall=120, cancel=cancel)
    assert code(response) == "cancelled"
    assert time.monotonic() - start < 90


def test_oversized_request_is_protocol_error_without_spawning():
    response = run("x = '" + "a" * (MAX_REQUEST_BYTES + 10) + "'\n" + GOOD)
    assert code(response) == "protocol_error"


def test_bad_request_shapes_are_protocol_errors():
    request = default_request("stim_circuit", GOOD, "build", [{"args": [3, 3], "kwargs": {}}])
    request["entry"] = "not valid!"
    response = run_candidate(request, wall_seconds=120, isolation=PROCESS)
    assert code(response) == "protocol_error"
    request = default_request("bogus", GOOD, "build", [{"args": [], "kwargs": {}}])
    assert code(run_candidate(request, wall_seconds=120, isolation=PROCESS)) == "protocol_error"


def test_run_candidate_never_raises_on_unserializable_request():
    request = {"program": object()}
    response = run_candidate(request, wall_seconds=5, isolation=PROCESS)
    assert response["status"] == "error"
    assert code(response) == "protocol_error"


def test_module_namespace_is_nuclei_candidate():
    program = "import stim\nNAME = __name__\ndef build(d, r):\n    return stim.Circuit('H 0' if NAME == 'nuclei_candidate' else 'X 0')\n"
    assert run(program)["artifacts"][0]["artifact"]["circuit_text"] == "H 0"


def test_quantum_circuit_branch_converts_via_trainability_when_present():
    pytest.importorskip("kernel.trainability.convert")
    pytest.importorskip("qiskit")
    program = (
        "from qiskit import QuantumCircuit\n"
        "def build(n):\n    qc = QuantumCircuit(n)\n    qc.h(0)\n    qc.cx(0, 1)\n    return qc\n"
    )
    response = run(program, calls=[{"args": [2], "kwargs": {}}], task="quantum_circuit")
    assert response["status"] == "ok", response
    artifact = response["artifacts"][0]["artifact"]
    assert artifact["framework"] == "qiskit"
    json.dumps(artifact["ir"])


def test_quantum_circuit_branch_rejects_wrong_type():
    pytest.importorskip("qiskit")
    response = run("def build(n):\n    return 3\n", calls=[{"args": [2], "kwargs": {}}], task="quantum_circuit")
    assert code(response) == "bad_return_type"
