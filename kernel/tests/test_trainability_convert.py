"""Converters: semantics vs framework simulators, source_index alignment, errors."""

import math

import numpy as np
import pytest

from kernel.adapters.cirq_adapter import CirqAdapter
from kernel.adapters.qiskit_adapter import QiskitAdapter
from kernel.trainability.convert import from_cirq, from_object, from_qiskit
from kernel.trainability.ir import IrError, ParamRef
from kernel.trainability.reference import reference_state

qiskit = pytest.importorskip("qiskit")
cirq = pytest.importorskip("cirq")
sympy = pytest.importorskip("sympy")

from qiskit import QuantumCircuit  # noqa: E402
from qiskit.circuit import Parameter, ParameterVector  # noqa: E402
from qiskit.quantum_info import Statevector  # noqa: E402


def same_up_to_phase(a, b, tol=1e-10):
    return abs(abs(np.vdot(a, b)) - 1.0) < tol and np.allclose(np.abs(a), np.abs(b), atol=1e-8)


def bound_state(circ, values):
    return reference_state(circ, np.asarray(values, dtype=float))


# ------------------------------------------------------------------ Qiskit


def make_qiskit_mixed():
    th = ParameterVector("t", 3)
    a = Parameter("a")
    qc = QuantumCircuit(4, 4)
    qc.h(0)
    qc.barrier()
    qc.rx(th[0], 1)
    qc.u(th[1], 0.4, a, 2)
    qc.cx(0, 3)
    qc.crz(2 * th[2] + 0.3, 3, 1)
    qc.cp(0.7, 1, 2)
    qc.rzz(-a, 0, 2)
    qc.ry(0.25, 3)
    qc.barrier()
    qc.measure([0, 1], [0, 1])
    return qc


def test_qiskit_semantics_match_statevector_with_affine_and_u():
    qc = make_qiskit_mixed()
    ir = from_qiskit(qc)
    assert ir.parameters == [p.name for p in qc.parameters] == ["a", "t[0]", "t[1]", "t[2]"]
    vals = np.array([0.31, -0.8, 1.7, 0.45])
    bound = qc.assign_parameters(dict(zip(qc.parameters, vals)))
    bound.remove_final_measurements(inplace=True)
    assert same_up_to_phase(bound_state(ir, vals), Statevector(bound).data)


def test_qiskit_affine_parameter_coefficients():
    th = Parameter("t")
    qc = QuantumCircuit(1)
    qc.rx(2 * th + 0.3, 0)
    qc.rz(-th, 0)
    qc.ry(th / 4, 0)
    qc.rx(0.5, 0)
    ir = from_qiskit(qc)
    assert ir.gates[0].angles == (ParamRef("t", 2.0, 0.3),)
    assert ir.gates[1].angles == (ParamRef("t", -1.0, 0.0),)
    assert ir.gates[2].angles == (ParamRef("t", 0.25, 0.0),)
    assert ir.gates[3].angles == (0.5,)


def test_qiskit_u_gate_shares_source_index_and_decomposes_rz_ry_rz():
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.u(0.1, 0.2, 0.3, 1)
    qc.x(0)
    ir = from_qiskit(qc)
    names = [(g.name, g.source_index) for g in ir.gates]
    assert names == [("H", 0), ("RZ", 1), ("RY", 1), ("RZ", 1), ("X", 2)]
    assert [g.angles[0] for g in ir.gates[1:4]] == [0.3, 0.1, 0.2]  # lambda, theta, phi


@pytest.mark.parametrize("ctor", ["u1", "u2", "u3"])
def test_qiskit_legacy_u_family_semantics(ctor):
    from qiskit.circuit.library import U1Gate, U2Gate, U3Gate

    gate = {"u1": U1Gate(0.7), "u2": U2Gate(0.4, -0.9), "u3": U3Gate(0.3, 1.2, -0.5)}[ctor]
    qc = QuantumCircuit(1)
    qc.h(0)
    qc.append(gate, [0])
    assert same_up_to_phase(bound_state(from_qiskit(qc), []), Statevector(qc).data)


def test_qiskit_source_index_aligns_with_adapter_snapshot_with_barriers_and_measures():
    qc = make_qiskit_mixed()
    snap = QiskitAdapter().extract_snapshot(qc)
    ir = from_qiskit(qc)
    idx = sorted({g.source_index for g in ir.gates})
    # every non-dropped snapshot gate is represented, dropped ones are not
    kept = [i for i, g in enumerate(snap.gates) if g.type not in ("Measure", "barrier", "BARRIER")]
    assert idx == kept
    by_index = {}
    for g in ir.gates:
        by_index.setdefault(g.source_index, []).append(g)
    for i in kept:
        sg = snap.gates[i]
        qubits = set(sg.controls) | set(sg.targets)
        assert qubits == {q for g in by_index[i] for q in g.qubits}, (i, sg)
    assert "dropped 2 measurements" in ir.notes and "dropped 2 barriers" in ir.notes


def test_qiskit_barrier_positions_shift_indices_exactly():
    qc = QuantumCircuit(2)
    qc.barrier()
    qc.h(0)
    qc.barrier()
    qc.cx(0, 1)
    ir = from_qiskit(qc)
    assert [(g.name, g.source_index) for g in ir.gates] == [("H", 1), ("CX", 3)]
    snap = QiskitAdapter().extract_snapshot(qc)
    assert [snap.gates[i].type for i in (1, 3)] == ["H", "CNOT"]


def test_qiskit_errors():
    th, ph = Parameter("t"), Parameter("p")
    qc = QuantumCircuit(1)
    qc.rx(th * th, 0)
    with pytest.raises(IrError) as e:
        from_qiskit(qc)
    assert e.value.code == "nonlinear_parameter"
    qc = QuantumCircuit(1)
    qc.rx(th + ph, 0)
    with pytest.raises(IrError) as e:
        from_qiskit(qc)
    assert e.value.code == "nonlinear_parameter"
    qc = QuantumCircuit(1)
    qc.rx(th.sin(), 0)
    with pytest.raises(IrError) as e:
        from_qiskit(qc)
    assert e.value.code == "nonlinear_parameter"
    qc = QuantumCircuit(1, 1)
    qc.h(0); qc.measure(0, 0); qc.x(0)
    with pytest.raises(IrError) as e:
        from_qiskit(qc)
    assert e.value.code == "mid_circuit_measurement"
    qc = QuantumCircuit(1)
    qc.reset(0)
    with pytest.raises(IrError) as e:
        from_qiskit(qc)
    assert e.value.code == "unsupported_gate"
    qc = QuantumCircuit(2)
    qc.ecr(0, 1)
    with pytest.raises(IrError) as e:
        from_qiskit(qc)
    assert e.value.code == "unsupported_gate"


def test_qiskit_measure_then_barrier_is_fine_and_other_qubit_continues():
    qc = QuantumCircuit(2, 1)
    qc.h(0); qc.measure(0, 0); qc.barrier(); qc.x(1)
    ir = from_qiskit(qc)
    assert [g.name for g in ir.gates] == ["H", "X"]


def test_too_many_qubits():
    with pytest.raises(IrError) as e:
        from_qiskit(QuantumCircuit(300))
    assert e.value.code == "too_many_qubits"


# -------------------------------------------------------------------- Cirq


def cirq_state(circuit):
    qs = sorted(circuit.all_qubits())
    psi = cirq.Simulator(dtype=np.complex128).simulate(circuit, qubit_order=qs).final_state_vector
    n = len(qs)
    return psi.reshape((2,) * n).transpose(*reversed(range(n))).reshape(-1)  # to little-endian


def make_cirq_mixed(t=None, u=None):
    q = cirq.LineQubit.range(3)
    t = 0.37 if t is None else t
    u = 0.81 if u is None else u
    return cirq.Circuit(
        cirq.H(q[0]),
        cirq.rx(t).on(q[1]),
        (cirq.X(q[2]) ** u),
        cirq.CNOT(q[0], q[2]),
        (cirq.CZ(q[1], q[2]) ** u),
        (cirq.CNOT(q[2], q[1]) ** t),
        cirq.ry(0.6).on(q[0]),
        cirq.S(q[1]), cirq.T(q[2]),
        cirq.ZZPowGate(exponent=u).on(q[0], q[1]),
        cirq.XXPowGate(exponent=t).on(q[1], q[2]),
        cirq.YYPowGate(exponent=0.3).on(q[0], q[2]),
        cirq.SWAP(q[0], q[1]), cirq.ISWAP(q[1], q[2]), cirq.CCX(q[0], q[1], q[2]),
        cirq.CCZ(q[0], q[1], q[2]), cirq.CSWAP(q[0], q[1], q[2]),
        cirq.rz(1.1).on(q[2]),
    )


def test_cirq_numeric_semantics_match_simulator():
    c = make_cirq_mixed()
    ir = from_cirq(c)
    assert ir.parameters == [] and ir.framework == "cirq"
    assert same_up_to_phase(bound_state(ir, []), cirq_state(c))


def test_cirq_symbolic_semantics_match_simulator():
    t, u = sympy.Symbol("t"), sympy.Symbol("u")
    sym = make_cirq_mixed(t, 2 * u + 0.5)
    ir = from_cirq(sym)
    assert ir.parameters == ["t", "u"]
    vals = {"t": 0.37, "u": 0.155}
    resolved = cirq.resolve_parameters(sym, vals)
    assert same_up_to_phase(bound_state(ir, [0.37, 0.155]), cirq_state(resolved))


def test_cirq_angle_is_pi_times_exponent_and_names():
    t = sympy.Symbol("t")
    q = cirq.LineQubit.range(2)
    c = cirq.Circuit(
        cirq.XPowGate(exponent=t).on(q[0]),
        cirq.ZPowGate(exponent=0.5).on(q[0]),
        cirq.ZPowGate(exponent=-0.25).on(q[0]),
        cirq.Y(q[1]),
        cirq.ZPowGate(exponent=0.3).on(q[1]),
    )
    ir = from_cirq(c)
    assert ir.gates[0].name == "RX" and ir.gates[0].angles[0] == ParamRef("t", math.pi, 0.0)
    got = [(g.name, g.angles) for g in ir.gates[1:]]
    assert ("S", ()) in got and ("TDG", ()) in got and ("Y", ()) in got
    assert ("RZ", (0.3 * math.pi,)) in got


def test_cirq_cx_pow_decomposition_shares_source_index():
    t = sympy.Symbol("t")
    q = cirq.LineQubit.range(2)
    c = cirq.Circuit(cirq.H(q[0]), cirq.CNOT(q[0], q[1]) ** t)
    ir = from_cirq(c)
    assert [(g.name, g.source_index) for g in ir.gates] == [("H", 0), ("CRX", 1), ("P", 1)]


def test_cirq_source_index_aligns_with_adapter_incl_measurements():
    t = sympy.Symbol("t")
    q = cirq.LineQubit.range(3)
    c = cirq.Circuit(
        cirq.H(q[0]), cirq.H(q[2]),
        cirq.rx(t).on(q[1]),
        cirq.CNOT(q[0], q[1]),
        cirq.measure(q[2], key="m"),
        cirq.CZ(q[0], q[1]),
        cirq.measure(q[0], q[1], key="n"),
    )
    snap = CirqAdapter().extract_snapshot(c)
    ir = from_cirq(c)
    kept = [i for i, g in enumerate(snap.gates) if g.type != "Measure"]
    assert sorted({g.source_index for g in ir.gates}) == kept
    for g in ir.gates:
        sg = snap.gates[g.source_index]
        assert set(g.qubits) == set(sg.targets) | set(sg.controls)
    assert "dropped 2 measurements" in ir.notes


def test_cirq_errors():
    q = cirq.LineQubit.range(2)
    with pytest.raises(IrError) as e:
        from_cirq(cirq.Circuit(cirq.measure(q[0]), cirq.X(q[0])))
    assert e.value.code == "mid_circuit_measurement"
    with pytest.raises(IrError) as e:
        from_cirq(cirq.Circuit(cirq.reset(q[0])))
    assert e.value.code == "unsupported_gate"
    t = sympy.Symbol("t")
    with pytest.raises(IrError) as e:
        from_cirq(cirq.Circuit(cirq.XPowGate(exponent=t * t).on(q[0])))
    assert e.value.code == "nonlinear_parameter"
    with pytest.raises(IrError) as e:
        from_cirq(cirq.Circuit(cirq.SWAP(q[0], q[1]) ** t))
    assert e.value.code == "unsupported_gate"
    with pytest.raises(IrError) as e:
        from_cirq(cirq.Circuit(cirq.MatrixGate(np.eye(2)).on(q[0])))
    assert e.value.code == "unsupported_gate"


def test_cirq_qubit_order_is_sorted():
    a, b = cirq.LineQubit(5), cirq.LineQubit(2)
    ir = from_cirq(cirq.Circuit(cirq.X(a), cirq.CNOT(b, a)))
    assert [(g.name, g.qubits) for g in ir.gates] == [("X", (1,)), ("CX", (0, 1))]


# ---------------------------------------------------------------- dispatch


def test_from_object_dispatch():
    qc = QuantumCircuit(1)
    qc.h(0)
    assert from_object(qc).framework == "qiskit"
    assert from_object(cirq.Circuit(cirq.H(cirq.LineQubit(0)))).framework == "cirq"
    assert from_object(cirq.FrozenCircuit(cirq.H(cirq.LineQubit(0)))).framework == "cirq"
    ir = from_object(qc)
    assert from_object(ir) is ir
    assert from_object(ir.to_json()) == ir
    with pytest.raises(IrError) as e:
        from_object("nope")
    assert e.value.code == "unsupported_object"
