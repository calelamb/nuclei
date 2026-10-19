"""PRD 15 R-A: adapter-side behaviour for the research paths.

R-1  circuits with no measurements return exact probabilities, never a silent
     ``measure_all`` and never an error.
R-2  library / composite gates simulate (transpiled before Aer); an instruction
     nothing can simulate raises ``UnsupportedInstructionError`` naming it;
     snapshots can opt in to one level of block expansion.
R-4  ``bind_parameters`` + the ``unbound_parameters`` info-class error.
R-13 the snapshot adapter is total (``<complex[N]>``, ``<unitary RxC>``,
     ``<block>`` labels; a failure degrades instead of raising).
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable

import numpy as np
import pytest

from kernel.adapters.binding import bind_parameters, free_parameter_names
from kernel.adapters.errors import UnboundParametersError, UnsupportedInstructionError
from kernel.executor import Executor
from kernel.models.snapshot import CircuitSnapshot, SimulationResult

SHOTS = 128

# Users still write the class forms (QFT(3), EfficientSU2(...)) the audit hit; Qiskit 1.3+
# marks them pending-deprecation and Aer 0.15 reads a deprecated Instruction.condition.
# Neither is behaviour under test here.
pytestmark = pytest.mark.filterwarnings(
    "ignore::DeprecationWarning", "ignore::PendingDeprecationWarning"
)


# -- helpers ------------------------------------------------------------------


def _qiskit():
    pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")
    from kernel.adapters.qiskit_adapter import QiskitAdapter

    return QiskitAdapter()


def _cirq():
    pytest.importorskip("cirq")
    from kernel.adapters.cirq_adapter import CirqAdapter

    return CirqAdapter()


def _exact_probabilities(circuit) -> dict[str, float]:
    """Independent oracle: Qiskit's own Statevector on the fully decomposed circuit.

    Decomposed (not Statevector(circuit) directly) because Qiskit 2.x evolves a bare
    PauliEvolutionGate exactly, while the circuit it stands for (what Aer and hardware
    run) is its one-rep Lie-Trotter synthesis.
    """
    from qiskit.quantum_info import Statevector

    n = circuit.num_qubits
    return {
        format(i, f"0{n}b"): float(p)
        for i, p in enumerate(Statevector(circuit.decompose(reps=8)).probabilities())
        if p > 1e-10
    }


def _assert_probabilities_close(got: dict[str, float], want: dict[str, float]) -> None:
    # 1e-6: Cirq's default simulator is complex64.
    assert set(got) == set(want)
    for key, value in want.items():
        assert got[key] == pytest.approx(value, abs=1e-6)


# -- R-1: no-measurement circuits ---------------------------------------------

QISKIT_BELL_NO_MEASURE = """
from qiskit import QuantumCircuit
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
"""

CIRQ_BELL_NO_MEASURE = """
import cirq
q = cirq.LineQubit.range(2)
circuit = cirq.Circuit(cirq.H(q[0]), cirq.CNOT(q[0], q[1]))
"""


def _assert_bell_exact(result: SimulationResult) -> None:
    assert result.measurements == {}
    assert result.measurements_source == "none"
    assert result.probabilities_exact is True
    _assert_probabilities_close(result.probabilities, {"00": 0.5, "11": 0.5})
    assert len(result.state_vector) == 4
    assert len(result.bloch_coords) == 2


def test_execute_no_measurements_qiskit():
    pytest.importorskip("qiskit_aer")
    result, snapshot, _, _, error = Executor().execute(QISKIT_BELL_NO_MEASURE, SHOTS)
    assert error is None
    assert snapshot is not None and len(snapshot.gates) == 2
    _assert_bell_exact(result)
    assert "measurements_source" in result.to_dict()


def test_execute_no_measurements_cirq():
    pytest.importorskip("cirq")
    result, _, _, _, error = Executor().execute(CIRQ_BELL_NO_MEASURE, SHOTS)
    assert error is None
    _assert_bell_exact(result)


def test_no_measure_circuit_never_gains_a_silent_measure_all():
    adapter = _qiskit()
    from qiskit import QuantumCircuit

    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    adapter.simulate(qc, SHOTS)
    assert [i.operation.name for i in qc.data] == ["h", "cx"]
    assert adapter.extract_snapshot(qc).classical_bit_count == 0


def test_clbits_without_a_measure_op_still_count_as_no_measurements():
    from qiskit import QuantumCircuit

    qc = QuantumCircuit(2, 2)
    qc.h(0)
    result = _qiskit().simulate(qc, SHOTS)
    assert result.measurements == {} and result.measurements_source == "none"


def test_measured_circuit_is_still_sampled_and_labelled():
    from qiskit import QuantumCircuit

    qc = QuantumCircuit(2, 2)
    qc.h(0)
    qc.cx(0, 1)
    qc.measure([0, 1], [0, 1])
    result = _qiskit().simulate(qc, SHOTS, seed=3)
    assert result.measurements_source == "sampled"
    assert sum(result.measurements.values()) == SHOTS
    assert result.probabilities_exact is True
    assert result.seed_honored is True


def test_cirq_measured_circuit_is_sampled_and_labelled():
    import cirq

    q = cirq.LineQubit.range(2)
    circuit = cirq.Circuit(cirq.H(q[0]), cirq.CNOT(q[0], q[1]), cirq.measure(*q, key="m"))
    result = _cirq().simulate(circuit, SHOTS, seed=3)
    assert result.measurements_source == "sampled"
    assert sum(result.measurements.values()) == SHOTS
    assert result.probabilities_exact is True


def test_mid_circuit_reset_is_not_reported_as_exact():
    from qiskit import QuantumCircuit

    qc = QuantumCircuit(2, 2)
    qc.h(0)
    qc.cx(0, 1)
    qc.reset(0)
    qc.measure([0, 1], [0, 1])
    assert _qiskit().simulate(qc, SHOTS).probabilities_exact is False


def test_cirq_noise_channel_is_not_reported_as_exact():
    import cirq

    q = cirq.LineQubit.range(1)
    circuit = cirq.Circuit(cirq.H(q[0]), cirq.depolarize(0.1)(q[0]))
    result = _cirq().simulate(circuit, SHOTS, seed=1)
    assert result.probabilities_exact is False
    assert result.measurements_source == "none"


def test_no_measure_sweep_point_keeps_record_metric_values():
    pytest.importorskip("qiskit_aer")
    code = (
        "from qiskit import QuantumCircuit\n"
        "qc = QuantumCircuit(1)\n"
        "qc.ry(params.get('theta', 0.3), 0)\n"
        "record_metric('theta_used', params.get('theta', 0.3))\n"
    )
    result, _, _, _, error = Executor().execute(code, SHOTS, params={"theta": 1.1}, seed=7)
    assert error is None
    assert result.metrics == {"theta_used": 1.1}
    assert result.seed_honored is True
    assert result.measurements_source == "none"


def test_new_result_fields_are_omitted_from_the_wire_when_unset():
    bare = SimulationResult([], {}, {}, [], 0.0, 1)
    assert not {"measurements_source", "probabilities_exact", "bound_at"} & set(bare.to_dict())
    full = SimulationResult(
        [], {}, {}, [], 0.0, 1,
        measurements_source="none", probabilities_exact=True, bound_at={"a": 0.5},
    ).to_dict()
    assert full["measurements_source"] == "none"
    assert full["probabilities_exact"] is True
    assert full["bound_at"] == {"a": 0.5}


# -- R-2: library / composite gates -------------------------------------------


def _append_library(name: str):
    """A circuit holding one opaque library block (the shape that used to hit Aer raw)."""
    from qiskit import QuantumCircuit
    from qiskit.circuit.library import (
        QFT,
        EfficientSU2,
        PauliEvolutionGate,
        RealAmplitudes,
        TwoLocal,
        ZZFeatureMap,
    )
    from qiskit.quantum_info import SparsePauliOp

    if name == "cswap":
        qc = QuantumCircuit(3)
        qc.h(0)
        qc.h(1)
        qc.cswap(0, 1, 2)
        return qc
    if name in ("iswap", "rzz", "rxx"):
        qc = QuantumCircuit(2)
        qc.h(0)
        qc.h(1)
        {"iswap": lambda: qc.iswap(0, 1), "rzz": lambda: qc.rzz(0.7, 0, 1), "rxx": lambda: qc.rxx(0.4, 0, 1)}[name]()
        return qc
    blocks: dict[str, Callable[[], object]] = {
        "QFT": lambda: QFT(3),
        "EfficientSU2": lambda: EfficientSU2(3, reps=1),
        "TwoLocal": lambda: TwoLocal(3, "ry", "cz", reps=1),
        "RealAmplitudes": lambda: RealAmplitudes(3, reps=1),
        "ZZFeatureMap": lambda: ZZFeatureMap(3, reps=1),
        "PauliEvolutionGate": lambda: PauliEvolutionGate(
            SparsePauliOp.from_list([("ZZI", 1.0), ("IZZ", 1.0), ("XII", 0.7)]), time=0.5
        ),
    }
    block = blocks[name]()
    qc = QuantumCircuit(3)
    qc.h(0)
    qc.x(2)
    qc.append(block, range(3))
    if qc.num_parameters:
        qc, _ = bind_parameters(qc, {"random_seed": 11})
    return qc


LIBRARY_GATES = [
    "QFT",
    "EfficientSU2",
    "TwoLocal",
    "RealAmplitudes",
    "ZZFeatureMap",
    "PauliEvolutionGate",
    "iswap",
    "rzz",
    "rxx",
    "cswap",
]


@pytest.mark.parametrize("name", LIBRARY_GATES)
def test_library_gate_simulates_without_measurements(name):
    qc = _append_library(name)
    result = _qiskit().simulate(qc, SHOTS, seed=5)
    assert result.measurements == {} and result.measurements_source == "none"
    _assert_probabilities_close(result.probabilities, _exact_probabilities(qc))
    assert sum(result.probabilities.values()) == pytest.approx(1.0, abs=1e-8)


@pytest.mark.parametrize("name", LIBRARY_GATES)
def test_library_gate_simulates_with_measurements(name):
    qc = _append_library(name)
    expected = _exact_probabilities(qc)
    qc.measure_all()
    result = _qiskit().simulate(qc, SHOTS, seed=5)
    assert result.measurements_source == "sampled"
    assert sum(result.measurements.values()) == SHOTS
    _assert_probabilities_close(result.probabilities, expected)


FUNCTION_FORMS = ["QFTGate", "efficient_su2", "real_amplitudes", "zz_feature_map", "n_local"]


@pytest.mark.parametrize("name", FUNCTION_FORMS)
def test_current_qiskit_library_functions_simulate_too(name):
    """Qiskit 1.3+/2.x spell the library as gates and plain-circuit functions."""
    from qiskit import QuantumCircuit
    from qiskit.circuit import library

    factory = getattr(library, name, None)
    if factory is None:
        pytest.skip(f"qiskit.circuit.library.{name} is not in this Qiskit")
    block = factory(3) if name != "n_local" else factory(3, "ry", "cz", reps=1)
    qc = QuantumCircuit(3)
    qc.h(0)
    qc.append(block, range(3))
    if qc.num_parameters:
        qc, _ = bind_parameters(qc, {"random_seed": 2})
    result = _qiskit().simulate(qc, SHOTS)
    _assert_probabilities_close(result.probabilities, _exact_probabilities(qc))
    assert _qiskit().extract_snapshot(qc, expand_blocks=True).gates


def test_unsupported_instruction_names_the_gate():
    from qiskit import QuantumCircuit
    from qiskit.circuit import Instruction

    qc = QuantumCircuit(1)
    qc.append(Instruction("mystery_gate", 1, 0, []), [0])
    with pytest.raises(UnsupportedInstructionError) as caught:
        _qiskit().simulate(qc, SHOTS)
    assert caught.value.instruction == "mystery_gate"
    assert caught.value.code == "unsupported_instruction"
    assert "mystery_gate" in str(caught.value)


def test_executor_reports_unsupported_instruction_distinctly_from_an_aer_error():
    pytest.importorskip("qiskit_aer")
    code = (
        "from qiskit import QuantumCircuit\n"
        "from qiskit.circuit import Instruction\n"
        "qc = QuantumCircuit(1)\n"
        "qc.append(Instruction('mystery_gate', 1, 0, []), [0])\n"
    )
    _, snapshot, _, _, error = Executor().execute(code, SHOTS)
    assert snapshot is not None
    assert error is not None and "mystery_gate" in error.message
    assert "unknown instruction" not in error.message


def test_cirq_circuit_operation_and_matrix_gates_simulate():
    import cirq

    q = cirq.LineQubit.range(2)
    circuit = cirq.Circuit(cirq.H(q[0]), cirq.MatrixGate(cirq.unitary(cirq.CNOT)).on(*q), cirq.ISWAP(*q) ** 0.5)
    result = _cirq().simulate(circuit, SHOTS)
    assert sum(result.probabilities.values()) == pytest.approx(1.0)


# -- R-2: opt-in block expansion in snapshots ----------------------------------


def _qft_circuit():
    from qiskit import QuantumCircuit
    from qiskit.circuit.library import QFT

    qc = QuantumCircuit(3)
    qc.h(0)
    qc.append(QFT(3), range(3))
    return qc


def test_snapshot_keeps_a_composite_block_by_default():
    snapshot = _qiskit().extract_snapshot(_qft_circuit())
    assert [g.type for g in snapshot.gates] == ["H", "QFT"]
    assert snapshot.notes == []
    assert "notes" not in snapshot.to_dict()


def test_snapshot_expands_one_level_when_requested():
    snapshot = _qiskit().extract_snapshot(_qft_circuit(), expand_blocks=True)
    types = [g.type for g in snapshot.gates]
    assert "QFT" not in types
    assert types[0] == "H" and types.count("CP") == 3  # QFT(3) = 3 H, 3 CP, 1 SWAP
    assert snapshot.qubit_count == 3
    json.dumps(snapshot.to_dict())


def test_snapshot_expansion_leaves_primitive_gates_alone():
    from qiskit import QuantumCircuit

    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    qc.t(1)
    plain = _qiskit().extract_snapshot(qc)
    expanded = _qiskit().extract_snapshot(qc, expand_blocks=True)
    assert [g.type for g in expanded.gates] == [g.type for g in plain.gates] == ["H", "CNOT", "T"]


def test_snapshot_expansion_is_capped_and_says_so(monkeypatch):
    import kernel.adapters.qiskit_adapter as module

    monkeypatch.setattr(module, "MAX_EXPANDED_GATES", 2)
    snapshot = _qiskit().extract_snapshot(_qft_circuit(), expand_blocks=True)
    assert [g.type for g in snapshot.gates] == ["H", "QFT"]
    assert len(snapshot.notes) == 1 and "expan" in snapshot.notes[0].lower()
    assert snapshot.to_dict()["notes"] == snapshot.notes


# -- R-4: parameter binding ----------------------------------------------------


def _qiskit_ansatz():
    from qiskit import QuantumCircuit
    from qiskit.circuit import Parameter, ParameterVector

    theta = Parameter("theta")
    v = ParameterVector("v", 2)
    qc = QuantumCircuit(2)
    qc.rx(theta, 0)
    qc.ry(v[0], 1)
    qc.rz(v[1], 0)
    qc.cx(0, 1)
    return qc


def _cirq_ansatz():
    import cirq
    import sympy

    q = cirq.LineQubit.range(2)
    a, b = sympy.Symbol("a"), sympy.Symbol("b")
    return cirq.Circuit(cirq.rx(a).on(q[0]), cirq.ry(b).on(q[1]), cirq.CNOT(q[0], q[1]))


@pytest.mark.parametrize("make", [_qiskit_ansatz, _cirq_ansatz], ids=["qiskit", "cirq"])
def test_free_parameter_names_are_sorted(make):
    pytest.importorskip("qiskit" if make is _qiskit_ansatz else "cirq")
    names = free_parameter_names(make())
    assert names == sorted(names) and len(names) >= 2


def test_free_parameter_names_use_natural_order_for_vectors():
    from qiskit import QuantumCircuit
    from qiskit.circuit import ParameterVector

    v = ParameterVector("w", 12)
    qc = QuantumCircuit(1)
    for p in v:
        qc.rx(p, 0)
    assert free_parameter_names(qc)[:4] == ["w[0]", "w[1]", "w[2]", "w[3]"]
    assert free_parameter_names(qc)[-1] == "w[11]"


def test_bind_parameters_binds_qiskit_by_name_and_reports_bound_at():
    qc = _qiskit_ansatz()
    bound, bound_at = bind_parameters(qc, {"theta": 0.5, "v[0]": 1.0, "v[1]": -0.25})
    assert bound_at == {"theta": 0.5, "v[0]": 1.0, "v[1]": -0.25}
    assert bound.num_parameters == 0
    assert qc.num_parameters == 3  # the caller's circuit is never mutated
    result = _qiskit().simulate(bound, SHOTS)
    assert result.probabilities_exact is True


def test_bind_parameters_binds_cirq_by_name():
    circuit = _cirq_ansatz()
    bound, bound_at = bind_parameters(circuit, {"a": 0.1, "b": 0.2})
    assert bound_at == {"a": 0.1, "b": 0.2}
    assert free_parameter_names(bound) == []
    assert free_parameter_names(circuit) == ["a", "b"]
    assert sum(_cirq().simulate(bound, SHOTS).probabilities.values()) == pytest.approx(1.0)


@pytest.mark.parametrize("make", [_qiskit_ansatz, _cirq_ansatz], ids=["qiskit", "cirq"])
def test_partial_values_raise_unbound_parameters_naming_the_rest(make):
    pytest.importorskip("qiskit" if make is _qiskit_ansatz else "cirq")
    circuit = make()
    names = free_parameter_names(circuit)
    with pytest.raises(UnboundParametersError) as caught:
        bind_parameters(circuit, {names[0]: 0.5})
    assert caught.value.parameters == names[1:]


@pytest.mark.parametrize("make", [_qiskit_ansatz, _cirq_ansatz], ids=["qiskit", "cirq"])
def test_random_seed_is_deterministic_and_covers_every_parameter(make):
    pytest.importorskip("qiskit" if make is _qiskit_ansatz else "cirq")
    circuit = make()
    _, first = bind_parameters(circuit, {"random_seed": 4})
    _, again = bind_parameters(circuit, random_seed=4)
    _, other = bind_parameters(circuit, {"random_seed": 5})
    assert first == again and first != other
    assert sorted(first) == free_parameter_names(circuit)
    assert all(0.0 <= v < 2 * math.pi for v in first.values())


def test_a_parameter_literally_named_random_seed_is_a_value_not_a_seed():
    from qiskit import QuantumCircuit
    from qiskit.circuit import Parameter

    qc = QuantumCircuit(1)
    qc.rx(Parameter("random_seed"), 0)
    _, bound_at = bind_parameters(qc, {"random_seed": 3})
    assert bound_at == {"random_seed": 3.0}


def test_binding_a_circuit_without_parameters_is_a_no_op():
    from qiskit import QuantumCircuit

    qc = QuantumCircuit(1)
    qc.h(0)
    same, bound_at = bind_parameters(qc, {"x": 1.0})
    assert same is qc and bound_at == {}
    same, bound_at = bind_parameters(qc, None)
    assert same is qc and bound_at == {}


def test_unknown_names_are_ignored_so_a_stored_point_survives_edits():
    qc = _qiskit_ansatz()
    _, bound_at = bind_parameters(qc, {"theta": 0.1, "v[0]": 0.2, "v[1]": 0.3, "gone": 9.0})
    assert "gone" not in bound_at


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), "0.5", True, None])
def test_non_finite_or_non_numeric_values_are_rejected(bad):
    with pytest.raises(ValueError, match="theta"):
        bind_parameters(_qiskit_ansatz(), {"theta": bad, "v[0]": 0.0, "v[1]": 0.0})


def test_no_values_and_no_seed_leaves_everything_unbound():
    qc = _qiskit_ansatz()
    with pytest.raises(UnboundParametersError) as caught:
        bind_parameters(qc, None)
    assert caught.value.parameters == free_parameter_names(qc)


@pytest.mark.parametrize("make", [_qiskit_ansatz, _cirq_ansatz], ids=["qiskit", "cirq"])
def test_simulating_unbound_circuits_raises_the_info_class_error(make):
    adapter = _qiskit() if make is _qiskit_ansatz else _cirq()
    circuit = make()
    with pytest.raises(UnboundParametersError) as caught:
        adapter.simulate(circuit, SHOTS)
    error = caught.value
    assert isinstance(error, ValueError)
    assert error.code == "unbound_parameters" and error.severity == "info"
    assert error.parameters == free_parameter_names(circuit)
    assert "Trainability" not in str(error)
    assert str(len(error.parameters)) in str(error)


def test_unbound_parameters_message_truncates_long_lists():
    names = [f"p{i:02d}" for i in range(30)]
    message = str(UnboundParametersError(names))
    assert "p00" in message and "p29" not in message and "22 more" in message


# -- R-13: the snapshot adapter is total ---------------------------------------


def _snapshot_of(build: Callable[[], object]) -> CircuitSnapshot:
    snapshot = _qiskit().extract_snapshot(build())
    json.dumps(snapshot.to_dict())
    return snapshot


def test_snapshot_of_initialize_labels_the_amplitudes():
    from qiskit import QuantumCircuit

    def build():
        qc = QuantumCircuit(2, 2)
        qc.initialize(np.array([1, 1j, 0, 0]) / np.sqrt(2), [0, 1])
        qc.measure([0, 1], [0, 1])
        return qc

    snapshot = _snapshot_of(build)
    gate = snapshot.gates[0]
    assert gate.type == "INITIALIZE"
    assert gate.targets == [0, 1]
    assert gate.params == [0.0] and gate.symbols == ["<complex[4]>"]
    assert [g.type for g in snapshot.gates[1:]] == ["Measure", "Measure"]


def test_snapshot_of_basis_state_initialize_does_not_pretend_to_have_angles():
    from qiskit import QuantumCircuit

    qc = QuantumCircuit(2)
    qc.initialize("01", [0, 1])
    gate = _qiskit().extract_snapshot(qc).gates[0]
    assert gate.params == [0.0] and gate.symbols == ["<'01'>"]


def test_snapshot_of_unitary_labels_the_matrix_size():
    from qiskit import QuantumCircuit
    from qiskit.quantum_info import random_unitary

    qc = QuantumCircuit(2, 2)
    qc.unitary(random_unitary(4, seed=3), [0, 1])
    qc.measure([0, 1], [0, 1])
    gate = _qiskit().extract_snapshot(qc).gates[0]
    assert gate.type == "UNITARY"
    assert gate.params == [0.0] and gate.symbols == ["<unitary 4x4>"]


def test_snapshot_of_if_test_labels_the_block():
    from qiskit import QuantumCircuit

    qc = QuantumCircuit(2, 2)
    qc.h(0)
    qc.measure(0, 0)
    with qc.if_test((qc.clbits[0], 1)):
        qc.x(1)
    qc.measure(1, 1)
    snapshot = _qiskit().extract_snapshot(qc)
    block = next(g for g in snapshot.gates if g.type == "IF_ELSE")
    assert block.params == [0.0] and block.symbols == ["<block>"]
    assert block.targets == [1]
    json.dumps(snapshot.to_dict())


def test_snapshot_mixes_real_and_labelled_params_without_misaligning():
    from qiskit import QuantumCircuit
    from qiskit.quantum_info import random_unitary

    qc = QuantumCircuit(2)
    qc.rx(0.25, 0)
    qc.unitary(random_unitary(4, seed=1), [0, 1])
    snapshot = _qiskit().extract_snapshot(qc)
    assert snapshot.gates[0].params == [0.25] and snapshot.gates[0].symbols is None
    assert "symbols" not in snapshot.gates[0].to_dict()
    assert len(snapshot.gates[1].params) == len(snapshot.gates[1].symbols)


@pytest.mark.parametrize("program", ["q20-if_test-dynamic", "q25-initialize", "q26-unitary-gate"])
def test_the_audit_programs_parse_and_run(program):
    pytest.importorskip("qiskit_aer")
    from pathlib import Path

    code = (
        Path(__file__).parent / "research_corpus" / "scout" / "programs" / f"{program}.py"
    ).read_text(encoding="utf-8")
    snapshot, _, _, error = Executor().parse(code)
    assert error is None and snapshot is not None and snapshot.gates
    result, _, _, _, error = Executor().execute(code, SHOTS)
    assert error is None and result is not None


def test_a_single_unreadable_instruction_degrades_to_a_placeholder_gate(monkeypatch):
    from qiskit import QuantumCircuit

    import kernel.adapters.qiskit_adapter as module

    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    real = module._params_and_symbols

    def flaky(op):
        if op.name == "cx":
            raise RuntimeError("cannot read params")
        return real(op)

    monkeypatch.setattr(module, "_params_and_symbols", flaky)
    snapshot = _qiskit().extract_snapshot(qc)
    assert [g.type for g in snapshot.gates] == ["H", "CNOT"]
    assert snapshot.gates[1].symbols == ["<unavailable>"]
    assert any("cx" in note for note in snapshot.notes)


def test_try_extract_snapshot_degrades_to_snapshot_unavailable():
    adapter = _qiskit()

    def broken(_circuit):
        raise RuntimeError("kaput")

    adapter.extract_snapshot = broken  # type: ignore[method-assign]
    snapshot, reason = adapter.try_extract_snapshot(object())
    assert snapshot is None
    assert reason is not None and reason.startswith("snapshot unavailable") and "kaput" in reason


def test_try_extract_snapshot_passes_a_good_snapshot_through():
    from qiskit import QuantumCircuit

    qc = QuantumCircuit(1)
    qc.h(0)
    snapshot, reason = _qiskit().try_extract_snapshot(qc)
    assert reason is None and snapshot is not None and len(snapshot.gates) == 1


def test_cirq_snapshot_is_total_for_gates_without_exponents():
    import cirq

    q = cirq.LineQubit.range(2)
    circuit = cirq.Circuit(cirq.MatrixGate(cirq.unitary(cirq.CNOT)).on(*q), cirq.ISWAP(*q))
    snapshot, reason = _cirq().try_extract_snapshot(circuit)
    assert reason is None and snapshot is not None and len(snapshot.gates) == 2
    json.dumps(snapshot.to_dict())
