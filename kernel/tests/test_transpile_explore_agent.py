"""End-to-end tests for the `transpile_explore` agent worker action.

Like test_transpile_preview.py, these spawn the real kernel/agent_worker.py
subprocess (via server.run_agent_worker) so they prove the disposable worker
returns the real Transpiler Explorer payload (before/after + pass-by-pass),
not just that a mock was called. Dev tools Phase 2.
"""

import asyncio

from kernel import server

GHZ_QISKIT = """from qiskit import QuantumCircuit

qc = QuantumCircuit(4, 4)
qc.h(0)
for i in range(3):
    qc.cx(0, i + 1)
qc.measure(range(4), range(4))
"""

BELL_CIRQ = """import cirq

q0, q1 = cirq.LineQubit.range(2)
circuit = cirq.Circuit([cirq.H(q0), cirq.CNOT(q0, q1)])
"""


def _run(request: dict) -> dict:
    return asyncio.run(server.run_agent_worker(request))


def _base(code: str, framework: str = "qiskit", **extra: object) -> dict:
    request = {
        "protocol_version": 1,
        "request_id": "req-1",
        "action": "transpile_explore",
        "framework": framework,
        "language": "python",
        "code": code,
    }
    request.update(extra)
    return request


def test_transpile_explore_returns_before_after_and_passes() -> None:
    request = _base(
        GHZ_QISKIT,
        basis_gates=["rz", "sx", "x", "cx"],
        coupling_map=[[0, 1], [1, 2], [2, 3]],
    )

    response = _run(request)

    assert response["status"] == "ok", response.get("error")
    assert response["error"] is None
    payload = response["result"]
    assert payload is not None

    # Before/after are full CircuitSnapshot dicts.
    for key in ("before", "after"):
        assert payload[key]["framework"] == "qiskit"
        assert payload[key]["qubit_count"] == 4

    metrics = payload["metrics"]
    for metric in ("depth", "two_qubit", "gate_count"):
        assert set(metrics[metric]) == {"before", "after"}

    # Routing on a line topology must add SWAPs vs. the all-to-all original, and
    # at least one reported pass must own that addition.
    assert metrics["two_qubit"]["after"] > metrics["two_qubit"]["before"]
    assert any(p["added_gates"].get("swap", 0) > 0 for p in payload["passes"])
    assert payload["target"]["coupling_size"] == 3


def test_transpile_explore_rejects_non_qiskit_framework() -> None:
    request = _base(BELL_CIRQ, framework="cirq")

    response = _run(request)

    assert response["status"] == "error"
    assert response["error"] is not None
