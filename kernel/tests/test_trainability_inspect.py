from __future__ import annotations

import pytest

pytest.importorskip("qiskit")
pytest.importorskip("cirq")

from kernel.trainability._errors import TrainabilityError  # noqa: E402
from kernel.trainability._usercode import (  # noqa: E402
    detect_sweepable_params,
    load_circuit,
    resolve_observable,
)
from kernel.trainability.inspect import inspect_code, source_lines  # noqa: E402

QISKIT = """\
from qiskit import QuantumCircuit
from qiskit.circuit import Parameter

theta = params.get("theta", 0.4)
n = int(params.get("n", 3))
phi = Parameter("phi")
qc = QuantumCircuit(n)
qc.h(0)
qc.ry(phi, 1)
qc.rx(theta, 0)
qc.cx(0, 1)
qc.rz(2 * phi, 2)
"""

CIRQ = """\
import cirq
import sympy

a, b = cirq.LineQubit.range(2)
t = sympy.Symbol("t")
circuit = cirq.Circuit([cirq.rx(t)(a), cirq.CNOT(a, b)])
"""


def test_qiskit_inspection_fields():
    out = inspect_code(QISKIT, {"n": 3})
    assert out["framework"] == "qiskit"
    assert out["n_qubits"] == 3
    assert out["parameters"] == ["phi"]
    assert out["gate_count"] == 5
    assert out["sweepable_params"] == ["theta", "n"]
    assert out["observable_declared"] is None
    assert {(g["parameter"], g["gate"]) for g in out["param_gates"]} == {("phi", "RY"), ("phi", "RZ")}
    indices = [g["source_index"] for g in out["param_gates"]]
    assert indices == [1, 4]


def test_params_are_injected():
    assert inspect_code(QISKIT, {"n": 5})["n_qubits"] == 5


def test_qiskit_source_lines_are_populated():
    loaded = load_circuit(QISKIT, {})
    lines = source_lines(loaded.circuit)
    assert lines[1] == 9 and lines[4] == 12 and lines[0] == 8


def test_cirq_inspection():
    out = inspect_code(CIRQ)
    assert out["framework"] == "cirq"
    assert out["parameters"] == ["t"]
    assert out["param_gates"][0]["gate"] == "RX"


def test_no_parameters_is_valid():
    out = inspect_code("from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.h(0)\n")
    assert out["parameters"] == [] and out["param_gates"] == [] and out["sweepable_params"] == []


def test_unsupported_gate_maps_to_ir_code():
    code = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.reset(0)\nqc.unitary([[0,1],[1,0]], [0])\n"
    with pytest.raises(TrainabilityError) as err:
        inspect_code(code)
    assert err.value.code in {"unsupported_gate", "mid_circuit_measurement"}


@pytest.mark.parametrize(
    "code,code_name",
    [
        ("x = 1\n", "no_circuit"),
        ("def broken(:\n", "compile_error"),
        ("raise RuntimeError('boom')\n", "execution_error"),
        ("", "invalid_request"),
    ],
)
def test_error_codes(code, code_name):
    with pytest.raises(TrainabilityError) as err:
        inspect_code(code)
    assert err.value.code == code_name


def test_unsupported_language():
    with pytest.raises(TrainabilityError) as err:
        inspect_code("H q[0];", language="qsharp")
    assert err.value.code == "unsupported_language"


def test_sweepable_detection_forms():
    code = 'a = params.get("x", 1)\nb = params["y"]\nc = params.get(name)\nd = other.get("z")\ne = params.get("x")\n'
    assert detect_sweepable_params(code) == ["x", "y"]
    assert detect_sweepable_params("def broken(:") == []


def test_declared_observable_string_is_returned_verbatim():
    code = QISKIT + 'nuclei_observable = "Z0*Z1 + 0.5*X2"\n'
    assert inspect_code(code)["observable_declared"] == "Z0*Z1 + 0.5*X2"


def test_declared_observable_sparse_pauli_op_uses_little_endian_labels():
    code = QISKIT + (
        "from qiskit.quantum_info import SparsePauliOp\n"
        'nuclei_observable = SparsePauliOp.from_list([("ZIZ", 1.0), ("IIX", 0.5)])\n'
    )
    assert inspect_code(code)["observable_declared"] == "Z0*Z2 + 0.5*X0"


def test_declared_observable_cirq_pauli_sum():
    code = CIRQ + "nuclei_observable = cirq.Z(a) * cirq.Z(b) + 0.5 * cirq.X(a)\n"
    assert inspect_code(code)["observable_declared"] == "Z0*Z1 + 0.5*X0"


def test_bad_declared_observable_carries_column():
    code = QISKIT + 'nuclei_observable = "Z0 + Q1"\n'
    with pytest.raises(TrainabilityError) as err:
        inspect_code(code)
    assert err.value.code == "invalid_observable"
    assert err.value.column == 5


def test_resolution_order_request_then_module_then_preset():
    code = QISKIT + 'nuclei_observable = "X0"\n'
    loaded = load_circuit(code, {})
    assert resolve_observable("Z1", loaded).to_text() == "Z1"
    assert resolve_observable(None, loaded).to_text() == "X0"
    assert resolve_observable("  ", loaded).to_text() == "X0"
    bare = load_circuit(QISKIT, {})
    assert len(resolve_observable(None, bare).terms) == 3  # preset:local_z on 3 qubits
