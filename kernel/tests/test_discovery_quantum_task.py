"""The quantum_circuit branch of the candidate worker: line tracing and converter verdicts."""

from __future__ import annotations

import pytest

pytest.importorskip("qiskit")

from kernel.discovery.sandbox import default_request, run_candidate  # noqa: E402
from kernel.trainability.ir import ParamCircuit  # noqa: E402

PROGRAM = """\
from qiskit import QuantumCircuit
from qiskit.circuit import ParameterVector


def helper(qc, theta):
    qc.ry(theta, 0)


def build(n):
    qc = QuantumCircuit(n)
    t = ParameterVector("t", 2)
    qc.h(0)
    helper(qc, t[0])
    for q in range(n - 1):
        qc.cx(q, q + 1)
    qc.rz(t[1], n - 1)
    return qc
"""


def run(program: str, n: int = 3, calls=None, isolation=None):
    request = default_request("quantum_circuit", program, "build", calls or [{"args": [n], "kwargs": {}}])
    return run_candidate(request, wall_seconds=60, isolation=isolation)


def test_gates_carry_one_based_candidate_source_lines():
    response = run(PROGRAM)
    assert response["status"] == "ok", response
    artifact = response["artifacts"][0]["artifact"]
    assert artifact["framework"] == "qiskit"
    circuit = ParamCircuit.from_json(artifact["ir"])
    lines = [(g.name, g.source_line) for g in circuit.gates]
    # `helper`'s ry is attributed to the line inside the candidate that appended it (line 6).
    assert lines == [("H", 12), ("RY", 6), ("CX", 15), ("CX", 15), ("RZ", 16)]


def test_every_call_is_traced():
    response = run(PROGRAM, calls=[{"args": [2], "kwargs": {}}, {"args": [3], "kwargs": {}}])
    assert response["status"] == "ok"
    for item in response["artifacts"]:
        circuit = ParamCircuit.from_json(item["artifact"]["ir"])
        assert all(g.source_line is not None for g in circuit.gates)


def test_cirq_gate_lines_are_recovered_best_effort():
    pytest.importorskip("cirq")
    program = (
        "import cirq\n"
        "def build(n):\n"
        "    qs = cirq.LineQubit.range(n)\n"
        "    c = cirq.Circuit()\n"
        "    c.append(cirq.H(qs[0]))\n"
        "    c.append(cirq.CNOT(qs[0], qs[1]))\n"
        "    return c\n"
    )
    response = run(program, 2)
    assert response["status"] == "ok", response
    circuit = ParamCircuit.from_json(response["artifacts"][0]["artifact"]["ir"])
    assert [(g.name, g.source_line) for g in circuit.gates] == [("H", 5), ("CX", 6)]


def test_unsupported_gate_becomes_ir_error_artifact_not_a_sandbox_failure():
    program = (
        "import numpy as np\nfrom qiskit import QuantumCircuit\n"
        "def build(n):\n    qc = QuantumCircuit(n)\n    qc.unitary(np.eye(2**n), range(n))\n    return qc\n"
    )
    response = run(program, 2)
    assert response["status"] == "ok"
    artifact = response["artifacts"][0]["artifact"]
    assert artifact["ir"] is None
    assert artifact["ir_error"]["code"] == "unsupported_gate"
    assert artifact["framework"] == "qiskit"


def test_mid_circuit_measurement_becomes_ir_error_artifact():
    program = (
        "from qiskit import QuantumCircuit\n"
        "def build(n):\n    qc = QuantumCircuit(n, n)\n    qc.measure(0, 0)\n    qc.x(0)\n    return qc\n"
    )
    artifact = run(program, 2)["artifacts"][0]["artifact"]
    assert artifact["ir_error"]["code"] == "mid_circuit_measurement"


def test_trailing_measurement_is_kept_with_a_note():
    program = (
        "from qiskit import QuantumCircuit\n"
        "def build(n):\n    qc = QuantumCircuit(n, n)\n    qc.h(0)\n    qc.measure(0, 0)\n    return qc\n"
    )
    artifact = run(program, 1)["artifacts"][0]["artifact"]
    assert artifact["ir"]["notes"] == ["dropped 1 measurement"]


def test_wrong_return_type_is_still_a_bad_return_type_failure():
    response = run("def build(n):\n    return 3\n", 2)
    assert response["status"] == "error" and response["error"]["code"] == "bad_return_type"


def test_entry_exception_reports_candidate_line_for_quantum_tasks():
    response = run("def build(n):\n    raise RuntimeError('boom')\n", 2)
    assert response["error"]["code"] == "entry_raised" and "candidate line 2" in response["error"]["message"]
