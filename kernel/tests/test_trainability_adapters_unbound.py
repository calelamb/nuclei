"""Adapters build snapshots for unbound circuits; bound output is unchanged."""

import json

import pytest

from kernel.executor import Executor
from kernel.models.snapshot import UNBOUND_PARAMETERS_MESSAGE, Gate

SPEC_MESSAGE = "bind circuit parameters before simulating (Trainability Lab analyzes free parameters)"

QISKIT_UNBOUND = """
from qiskit import QuantumCircuit
from qiskit.circuit import Parameter, ParameterVector
th = Parameter("theta")
v = ParameterVector("v", 2)

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.rx(th, 0)
qc.ry(2 * th + 0.3, 1)
qc.cx(0, 1)
qc.rz(v[0], 1)
qc.rz(0.5, 0)
qc.measure([0, 1], [0, 1])
"""

CIRQ_UNBOUND = """
import cirq, sympy
t = sympy.Symbol("t")
q = cirq.LineQubit.range(2)
circuit = cirq.Circuit(
    cirq.H(q[0]),
    cirq.rx(t).on(q[0]),
    cirq.ry(0.5).on(q[1]),
    (cirq.CZ(q[0], q[1]) ** t),
)
"""


def test_message_constant_is_the_spec_text():
    assert UNBOUND_PARAMETERS_MESSAGE == SPEC_MESSAGE


def test_gate_to_dict_omits_symbols_unless_present():
    assert "symbols" not in Gate("H", [0]).to_dict()
    assert "symbols" not in Gate("RX", [0], params=[0.1], symbols=None).to_dict()
    assert "symbols" not in Gate("RX", [0], params=[0.1], symbols=[None]).to_dict()
    d = Gate("RX", [0], params=[0.0], symbols=["t"]).to_dict()
    assert d["symbols"] == ["t"]
    assert list(Gate("H", [0]).to_dict()) == ["type", "targets", "controls", "params", "layer"]


def test_qiskit_unbound_snapshot():
    pytest.importorskip("qiskit")
    snap, _, _, err = Executor().parse(QISKIT_UNBOUND)
    assert err is None
    d = snap.to_dict()
    by_idx = d["gates"]
    assert [g["type"] for g in by_idx] == ["H", "RX", "RY", "CNOT", "RZ", "RZ", "Measure", "Measure"]
    assert by_idx[1]["params"] == [0.0] and by_idx[1]["symbols"] == ["theta"]
    assert by_idx[2]["params"] == [0.0] and by_idx[2]["symbols"] == ["2*theta + 0.3"]
    assert by_idx[4]["symbols"] == ["v[0]"]
    assert by_idx[5]["params"] == [0.5] and "symbols" not in by_idx[5]
    assert "symbols" not in by_idx[0] and "symbols" not in by_idx[3]
    json.dumps(d)


def test_qiskit_bound_snapshot_has_no_symbols_key():
    pytest.importorskip("qiskit")
    code = QISKIT_UNBOUND.replace(
        "qc.measure", "qc = qc.assign_parameters({th: 0.2, v[0]: 0.1})\nqc.measure"
    )
    snap, _, _, err = Executor().parse(code)
    assert err is None
    assert all("symbols" not in g for g in snap.to_dict()["gates"])
    assert snap.to_dict()["gates"][1]["params"] == [0.2]


def test_qiskit_simulating_unbound_is_simulation_error_with_spec_message():
    pytest.importorskip("qiskit_aer")
    result, snap, _, _, err = Executor().execute(QISKIT_UNBOUND, 10)
    assert result is None and snap is not None
    assert err.code == "simulation_error"
    assert err.message.endswith(SPEC_MESSAGE)


def test_cirq_unbound_snapshot():
    pytest.importorskip("cirq")
    snap, _, _, err = Executor().parse(CIRQ_UNBOUND)
    assert err is None
    gates = snap.to_dict()["gates"]
    # Cirq packs moments: [H q0, RY q1], [RX q0], [CZ**t]
    assert [g["type"] for g in gates[:3]] == ["H", "RY", "RX"]
    assert "symbols" not in gates[0]
    assert gates[1]["params"] == [0.5] and "symbols" not in gates[1]
    assert gates[2]["params"] == [0.0] and gates[2]["symbols"] == ["t"]
    assert gates[3]["params"] == [0.0] and gates[3]["symbols"] == ["t"]


def test_cirq_simulating_unbound_is_simulation_error_with_spec_message():
    pytest.importorskip("cirq")
    result, snap, _, _, err = Executor().execute(CIRQ_UNBOUND, 10)
    assert result is None and snap is not None
    assert err.code == "simulation_error"
    assert err.message.endswith(SPEC_MESSAGE)


def test_cirq_numeric_rotation_names_are_rx_ry_rz():
    pytest.importorskip("cirq")
    code = (
        "import cirq\nq = cirq.LineQubit.range(1)\n"
        "circuit = cirq.Circuit(cirq.rx(0.3).on(q[0]), cirq.ry(0.2).on(q[0]), cirq.rz(0.1).on(q[0]))\n"
    )
    snap, _, _, err = Executor().parse(code)
    assert err is None
    assert [g.type for g in snap.gates] == ["RX", "RY", "RZ"]
