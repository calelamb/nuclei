"""R-5: library / composite blocks are decomposed (bounded) before conversion to the IR.

``EfficientSU2`` / ``TwoLocal`` / ``ZZFeatureMap`` / ``QFT`` / ``PauliEvolutionGate`` used to fail with
``unsupported_gate`` because the converter lowered by gate name only. Genuinely unsupported operations
must still fail, naming the operation.
"""

from __future__ import annotations

import asyncio

import numpy as np
import pytest

qiskit = pytest.importorskip("qiskit")
cirq = pytest.importorskip("cirq")
sympy = pytest.importorskip("sympy")

from qiskit import QuantumCircuit  # noqa: E402
from qiskit.circuit import Gate, Parameter  # noqa: E402
from qiskit.circuit.library import (  # noqa: E402
    QFT,
    EfficientSU2,
    PauliEvolutionGate,
    PauliFeatureMap,
    TwoLocal,
    ZZFeatureMap,
)
from qiskit.quantum_info import SparsePauliOp, Statevector  # noqa: E402

from kernel.tests._trainability_job_helpers import connection  # noqa: E402
from kernel.trainability._decompose import DECOMPOSE_ENV, MAX_DECOMPOSE_LEVELS  # noqa: E402
from kernel.trainability._usercode import load_circuit  # noqa: E402
from kernel.trainability.convert import from_cirq, from_object, from_qiskit  # noqa: E402
from kernel.trainability.inspect import inspect_code, source_lines  # noqa: E402
from kernel.trainability.ir import IrError  # noqa: E402
from kernel.trainability.reference import reference_state  # noqa: E402


# Qiskit marks its n_local / feature-map circuits "pending deprecation"; they are exactly what users write.
pytestmark = pytest.mark.filterwarnings("ignore::PendingDeprecationWarning")


def same_up_to_phase(a, b, tol=1e-9):
    return abs(abs(np.vdot(a, b)) - 1.0) < tol


def assert_matches_statevector(qc, seed=3):
    """The IR reproduces Qiskit's own statevector (up to global phase) at random parameter values."""
    ir = from_qiskit(qc)
    rng = np.random.default_rng(seed)
    names = [p.name for p in qc.parameters]
    assert ir.parameters == names
    values = rng.uniform(-np.pi, np.pi, len(names))
    bound = qc.assign_parameters(dict(zip(qc.parameters, values))) if names else qc
    assert same_up_to_phase(reference_state(ir, values), Statevector(bound).data)
    return ir


# --------------------------------------------------------------- library circuits, directly


@pytest.mark.parametrize(
    "factory,n_params",
    [
        (lambda: EfficientSU2(3, reps=2), 18),
        (lambda: TwoLocal(3, "ry", "cz", reps=2), 9),
        (lambda: PauliFeatureMap(3, reps=2, paulis=["Z"]), 3),
        (lambda: QFT(3), 0),
    ],
    ids=["EfficientSU2", "TwoLocal", "PauliFeatureMap-Z", "QFT"],
)
def test_library_circuit_parameter_counts_and_semantics(factory, n_params):
    circuit = factory()
    ir = assert_matches_statevector(circuit)
    assert len(ir.parameters) == n_params == circuit.num_parameters
    assert ir.gates, "decomposition must produce elementary gates"


def test_entangling_zz_feature_map_decomposes_once_its_data_is_bound():
    """The data-encoding angle 2(pi-x_i)(pi-x_j) is bilinear: with x bound (how a kernel evaluates it) it converts."""
    feature_map = ZZFeatureMap(3, reps=2)
    bound = feature_map.assign_parameters([0.3, -1.1, 0.8])
    ir = from_qiskit(bound)
    assert ir.parameters == [] and ir.gates
    assert same_up_to_phase(reference_state(ir, np.zeros(0)), Statevector(bound).data)


def test_entangling_zz_feature_map_with_free_data_keeps_the_nonlinear_parameter_error():
    """Unbound, the product angle is not affine in one parameter; the IR says so (spec 03 section on encodings)."""
    with pytest.raises(IrError) as err:
        from_qiskit(ZZFeatureMap(3))
    assert err.value.code == "nonlinear_parameter"


def test_pauli_evolution_gate_with_a_symbolic_time():
    t = Parameter("t")
    qc = QuantumCircuit(3)
    qc.append(PauliEvolutionGate(SparsePauliOp(["ZZI", "IXX", "YIZ"], [0.5, -0.3, 0.2]), time=t), [0, 1, 2])
    ir = assert_matches_statevector(qc)
    assert ir.parameters == ["t"]


def test_decomposition_level_is_reported_in_notes():
    ir = from_qiskit(EfficientSU2(3, reps=1))
    notes = [n for n in ir.notes if "EfficientSU2" in n]
    assert len(notes) == 1
    assert notes[0].startswith("decomposed composite 'EfficientSU2'") and "level 1" in notes[0]


def test_plain_circuits_get_no_decomposition_note():
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    assert not any("decomposed" in n for n in from_qiskit(qc).notes)


# ------------------------------------------------------------------ composites inside circuits


def test_composites_appended_into_a_larger_circuit_share_their_source_index():
    qc = QuantumCircuit(4)
    qc.h(3)
    qc.append(EfficientSU2(3, reps=1), [0, 1, 2])
    qc.cx(2, 3)
    ir = assert_matches_statevector(qc)
    by_source = {}
    for gate in ir.gates:
        by_source.setdefault(gate.source_index, []).append(gate)
    assert sorted(by_source) == [0, 1, 2]
    assert len(by_source[1]) > 1, "one composite instruction expands to many IR gates under ONE source index"
    assert by_source[0][0].name == "H" and by_source[2][0].name == "CX"


def test_user_defined_sub_circuit_blocks_are_decomposed_with_their_level():
    inner = QuantumCircuit(2, name="inner")
    theta = Parameter("theta")
    inner.ry(theta, 0)
    inner.cx(0, 1)
    middle = QuantumCircuit(2, name="middle")
    middle.append(inner.to_gate(), [0, 1])
    middle.h(1)
    qc = QuantumCircuit(2)
    qc.append(middle.to_gate(), [0, 1])
    ir = assert_matches_statevector(qc)
    assert ir.parameters == ["theta"]
    assert any("'middle'" in n and "level 2" in n for n in ir.notes), ir.notes


def test_qubit_mapping_follows_the_instruction_operands():
    sub = QuantumCircuit(2, name="blk")
    sub.h(0)
    sub.cx(0, 1)
    qc = QuantumCircuit(3)
    qc.append(sub.to_gate(), [2, 0])
    ir = from_qiskit(qc)
    assert [(g.name, g.qubits) for g in ir.gates] == [("H", (2,)), ("CX", (2, 0))]


def test_decomposition_is_bounded_and_names_the_operation():
    circuit = QuantumCircuit(1)
    circuit.h(0)
    for depth in range(MAX_DECOMPOSE_LEVELS + 1):
        wrapper = QuantumCircuit(1, name=f"level{depth}")
        wrapper.append(circuit.to_gate(), [0])
        circuit = wrapper
    outer = QuantumCircuit(1)
    outer.append(circuit.to_gate(), [0])
    with pytest.raises(IrError) as err:
        from_qiskit(outer)
    assert err.value.code == "unsupported_gate"
    assert f"{MAX_DECOMPOSE_LEVELS} decomposition levels" in str(err.value)


# ------------------------------------------------------------ genuinely unsupported stays unsupported


def test_opaque_gate_without_a_definition_is_still_unsupported_and_named():
    qc = QuantumCircuit(2)
    qc.append(Gate("mystery_gate", 2, []), [0, 1])
    with pytest.raises(IrError) as err:
        from_qiskit(qc)
    assert err.value.code == "unsupported_gate"
    assert "mystery_gate" in str(err.value)


def test_opaque_gate_inside_a_composite_names_the_inner_operation():
    block = QuantumCircuit(2, name="wrapper_block")
    block.append(Gate("inner_mystery", 2, []), [0, 1])
    qc = QuantumCircuit(2)
    qc.append(block.to_gate(), [0, 1])
    with pytest.raises(IrError) as err:
        from_qiskit(qc)
    assert err.value.code == "unsupported_gate"
    assert "inner_mystery" in str(err.value)


def test_standard_gates_without_ir_support_are_not_decomposed_behind_the_users_back():
    qc = QuantumCircuit(2)
    qc.ecr(0, 1)
    with pytest.raises(IrError) as err:
        from_qiskit(qc)
    assert err.value.code == "unsupported_gate" and "ecr" in str(err.value)


def test_unitary_matrices_are_not_synthesised():
    qc = QuantumCircuit(1)
    qc.unitary([[0, 1], [1, 0]], [0])
    with pytest.raises(IrError) as err:
        from_qiskit(qc)
    assert err.value.code == "unsupported_gate" and "unitary" in str(err.value)


def test_measurement_inside_a_composite_is_rejected():
    block = QuantumCircuit(1, 1, name="measuring_block")
    block.h(0)
    block.measure(0, 0)
    qc = QuantumCircuit(1, 1)
    qc.append(block.to_instruction(), [0], [0])
    with pytest.raises(IrError) as err:
        from_qiskit(qc)
    assert err.value.code == "unsupported_gate" and "measuring_block" in str(err.value)


def test_non_numeric_nested_parameters_keep_their_existing_error():
    a, b = Parameter("a"), Parameter("b")
    block = QuantumCircuit(1, name="two_params")
    block.rx(a * b, 0)
    qc = QuantumCircuit(1)
    qc.append(block.to_gate(), [0])
    with pytest.raises(IrError) as err:
        from_qiskit(qc)
    assert err.value.code == "nonlinear_parameter"


# --------------------------------------------------------- the user-code pipeline (inspect / lines)

LIBRARY_CODE = """\
from qiskit import QuantumCircuit
from qiskit.circuit.library import EfficientSU2, PauliFeatureMap

qc = QuantumCircuit(3)
qc.append(PauliFeatureMap(3, reps=1, paulis=["Z"]), [0, 1, 2])
qc.append(EfficientSU2(3, reps=1), [0, 1, 2])
"""


def test_inspect_reports_parameter_counts_and_notes_for_library_blocks():
    out = inspect_code(LIBRARY_CODE)
    assert out["n_qubits"] == 3
    assert len(out["parameters"]) == 3 + 12
    assert out["gate_count"] > 2
    assert any("PauliFeatureMap" in n for n in out["notes"]) and any("EfficientSU2" in n for n in out["notes"])
    assert {g["parameter"] for g in out["param_gates"]} == set(out["parameters"])


def test_source_lines_are_preserved_through_decomposition():
    lines = source_lines(load_circuit(LIBRARY_CODE, {}).circuit)
    assert lines == {0: 5, 1: 6}


def test_trainability_inspect_over_the_socket_accepts_library_blocks():
    async def scenario():
        async with connection() as ws:
            ws.push({"type": "trainability_inspect", "code": LIBRARY_CODE})
            return (await ws.wait_for(lambda m: m.get("type") in ("trainability_inspected", "error"), 120))[0]

    message = asyncio.run(scenario())
    assert message["type"] == "trainability_inspected", message
    assert len(message["parameters"]) == 15


def test_lint_and_start_over_the_socket_accept_library_blocks():
    code = (
        "from qiskit import QuantumCircuit\nfrom qiskit.circuit.library import EfficientSU2\n"
        "qc = QuantumCircuit(3)\nqc.append(EfficientSU2(3, reps=1), [0, 1, 2])\n"
    )

    async def scenario():
        async with connection() as ws:
            ws.push({"type": "trainability_lint", "code": code, "observable": "Z0*Z1"})
            lint = (await ws.wait_for(lambda m: m.get("type") in ("trainability_lint_result", "error"), 120))[0]
            ws.push({
                "type": "trainability_start", "job_id": "r5-start", "code": code, "observable": "Z0*Z1",
                "analyses": ["gradients"], "settings": {"samples": 8, "seed": 1, "method": "sampling"},
            })
            result = await ws.wait_type("trainability_result", timeout=240)
            return lint, result

    lint, result = asyncio.run(scenario())
    assert lint["type"] == "trainability_lint_result", lint
    assert result["status"] == "complete", result["errors"]
    assert result["results"]["gradients"]["samples"] >= 8


def test_trainability_inspect_over_the_socket_still_names_unsupported_ops():
    code = (
        "from qiskit import QuantumCircuit\nfrom qiskit.circuit import Gate\n"
        "qc = QuantumCircuit(2)\nqc.append(Gate('mystery_gate', 2, []), [0, 1])\n"
    )

    async def scenario():
        async with connection() as ws:
            ws.push({"type": "trainability_inspect", "code": code})
            return (await ws.wait_for(lambda m: m.get("type") in ("trainability_inspected", "error"), 120))[0]

    message = asyncio.run(scenario())
    assert message["type"] == "error" and message["code"] == "unsupported_gate"
    assert "mystery_gate" in message["message"]


# ----------------------------------------------------------------------------------------- Cirq


def test_cirq_circuit_operation_and_parallel_gate_are_decomposed():
    a, b = cirq.LineQubit.range(2)
    t = sympy.Symbol("t")
    inner = cirq.FrozenCircuit(cirq.H(a), cirq.rx(t)(b), cirq.CNOT(a, b))
    circuit = cirq.Circuit(cirq.CircuitOperation(inner), cirq.ParallelGate(cirq.H, 2).on(a, b))
    ir = from_cirq(circuit)
    assert ir.parameters == ["t"]
    assert [g.name for g in ir.gates] == ["H", "RX", "CX", "H", "H"]
    assert [g.source_index for g in ir.gates] == [0, 0, 0, 1, 1]
    assert any("CircuitOperation" in n and "level 1" in n for n in ir.notes), ir.notes


def test_cirq_qft_matches_the_unitary():
    qubits = cirq.LineQubit.range(3)
    circuit = cirq.Circuit(cirq.X(qubits[1]), cirq.qft(*qubits))
    ir = from_cirq(circuit)
    state = cirq.Simulator(dtype=np.complex128).simulate(circuit, qubit_order=qubits).final_state_vector
    little_endian = state.reshape((2,) * 3).transpose(2, 1, 0).reshape(-1)
    assert same_up_to_phase(reference_state(ir, np.zeros(0)), little_endian)


def test_cirq_unsupported_gates_stay_unsupported():
    q = cirq.LineQubit.range(2)
    t = sympy.Symbol("t")
    for gate_op in (cirq.MatrixGate(np.eye(2)).on(q[0]), (cirq.SWAP ** t).on(q[0], q[1])):
        with pytest.raises(IrError) as err:
            from_cirq(cirq.Circuit(gate_op))
        assert err.value.code == "unsupported_gate"


# ------------------------------------------------------- the PRD 14 candidate contract is unchanged


def test_decomposition_can_be_switched_off_per_call_and_per_process(monkeypatch):
    block = QuantumCircuit(2, name="cheap")
    block.cx(0, 1)
    qc = QuantumCircuit(2)
    qc.append(block.to_gate(), [0, 1])
    for convert in (from_qiskit, from_object):
        with pytest.raises(IrError) as err:
            convert(qc, decompose=False)
        assert err.value.code == "unsupported_gate" and "cheap" in str(err.value)
    monkeypatch.setenv(DECOMPOSE_ENV, "0")
    with pytest.raises(IrError):
        from_qiskit(qc)
    assert [g.name for g in from_qiskit(qc, decompose=True).gates] == ["CX"], "an explicit flag beats the environment"
    monkeypatch.delenv(DECOMPOSE_ENV)
    assert [g.name for g in from_qiskit(qc).gates] == ["CX"]


def test_cirq_decomposition_can_be_switched_off():
    a, b = cirq.LineQubit.range(2)
    circuit = cirq.Circuit(cirq.ParallelGate(cirq.H, 2).on(a, b))
    with pytest.raises(IrError) as err:
        from_cirq(circuit, decompose=False)
    assert err.value.code == "unsupported_gate"


def test_the_discovery_sandbox_pins_the_switch_the_converter_reads():
    from kernel.discovery import sandbox

    assert sandbox.IR_DECOMPOSE_ENV == DECOMPOSE_ENV
