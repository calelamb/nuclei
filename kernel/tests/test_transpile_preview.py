"""End-to-end tests for the `transpile` agent action.

Like test_server_agent_execute.py, these spawn the real
kernel/agent_worker.py subprocess (via server.run_agent_worker) so they
prove the isolated execution path produces real qiskit-transpiler metrics,
not just that a mock was called. qiskit is installed in the kernel test env.
"""

import asyncio

from kernel import server

BELL_QISKIT = """from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])
"""

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


def _base(code: str, framework: str = "qiskit", **extra: object) -> dict:
    request = {
        "protocol_version": 1,
        "request_id": "req-1",
        "action": "transpile",
        "framework": framework,
        "language": "python",
        "code": code,
    }
    request.update(extra)
    return request


def test_transpile_bell_to_basis_gates_returns_real_metrics() -> None:
    request = _base(BELL_QISKIT, basis_gates=["u", "cx"])

    response = _run(request)

    assert response["status"] == "ok"
    assert response["error"] is None
    result = response["result"]
    assert result is not None
    assert isinstance(result["depth"], int)
    assert result["depth"] > 0
    assert isinstance(result["gate_counts"], dict)
    assert sum(result["gate_counts"].values()) > 0
    # Every non-measurement gate in a basis_gates=['u', 'cx'] transpile
    # should be u or cx; `measure` isn't a basis gate and always survives.
    assert set(result["gate_counts"]) <= {"u", "cx", "measure"}
    assert result["gate_counts"].get("measure", 0) == 2
    assert result["two_qubit_count"] >= 1
    assert result["num_qubits"] == 2
    assert result["basis_gates"] == ["u", "cx"]
    assert result["coupling_mapped"] is False


def test_transpile_with_coupling_map_forces_routing() -> None:
    request = _base(
        BELL_QISKIT,
        basis_gates=["u", "cx"],
        coupling_map=[[0, 1], [1, 0]],
    )

    response = _run(request)

    assert response["status"] == "ok"
    result = response["result"]
    assert result is not None
    assert result["coupling_mapped"] is True
    assert isinstance(result["depth"], int)
    assert result["depth"] > 0


def test_transpile_rejects_non_qiskit_framework() -> None:
    request = _base(BELL_CIRQ, framework="cirq")

    response = _run(request)

    assert response["status"] == "error"
    assert response["error"] is not None
    # Blocked at the protocol layer (transpile requires framework=='qiskit')
    # before it ever reaches the executor's own unsupported-framework check.
    assert response["error"]["code"] == "protocol_error"
    assert "qiskit" in response["error"]["message"].lower()


def test_transpile_with_shots_is_a_protocol_error() -> None:
    request = _base(BELL_QISKIT, shots=256)

    response = _run(request)

    assert response["status"] == "error"
    assert response["error"] is not None
    assert response["error"]["code"] == "protocol_error"
