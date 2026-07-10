"""End-to-end tests for the server's disposable-agent-worker execution path.

These spawn the real kernel/agent_worker.py subprocess (via
server.run_agent_worker) so they prove the isolated execution path works, not
just that a mock was called. cirq is installed in the kernel test env.
"""

import asyncio

import pytest

from kernel import server

BELL_CIRQ = """import cirq

q0, q1 = cirq.LineQubit.range(2)
circuit = cirq.Circuit([
    cirq.H(q0),
    cirq.CNOT(q0, q1),
    cirq.measure(q0, q1, key='result'),
])
"""


def _run(request: dict) -> dict:
    return asyncio.run(server.run_agent_worker(request))


def _base(action: str, code: str, framework: str = "cirq") -> dict:
    return {
        "protocol_version": 1,
        "request_id": "req-1",
        "action": action,
        "framework": framework,
        "language": "python",
        "code": code,
    }


def test_agent_worker_parse_returns_snapshot() -> None:
    response = _run(_base("parse", BELL_CIRQ))
    assert response["status"] == "ok"
    assert response["error"] is None
    snapshot = response["snapshot"]
    assert snapshot is not None
    assert snapshot["qubit_count"] == 2
    assert snapshot["framework"] == "cirq"
    assert response["result"] is None


def test_agent_worker_simulate_returns_result() -> None:
    request = _base("simulate", BELL_CIRQ)
    request["shots"] = 256
    response = _run(request)
    assert response["status"] == "ok"
    result = response["result"]
    assert result is not None
    probabilities = result["probabilities"]
    # Bell state collapses to |00> and |11> only.
    assert set(probabilities) <= {"00", "11"}
    assert abs(sum(probabilities.values()) - 1.0) < 1e-6


def test_agent_worker_rejects_unknown_framework() -> None:
    response = _run(_base("parse", "print('hi')", framework="fortran"))
    assert response["status"] == "error"
    assert response["error"]["code"] == "protocol_error"


def test_agent_worker_blocks_credential_import() -> None:
    # The worker's import denylist must stop generated code from importing the
    # credential store even though keyring is installed in the env.
    code = "import keyring\nimport cirq\ncircuit = cirq.Circuit()\n"
    request = _base("simulate", code)
    request["shots"] = 16
    response = _run(request)
    assert response["status"] == "error"


def test_agent_worker_response_preserves_request_id() -> None:
    request = _base("parse", BELL_CIRQ)
    request["request_id"] = "corr-42"
    response = _run(request)
    assert response["request_id"] == "corr-42"


@pytest.mark.parametrize("bad", [{}, {"request_id": "x"}, {"action": "parse"}])
def test_agent_worker_handles_incomplete_requests(bad: dict) -> None:
    bad.setdefault("protocol_version", 1)
    response = _run(bad)
    assert response["status"] == "error"
    assert response["error"] is not None
