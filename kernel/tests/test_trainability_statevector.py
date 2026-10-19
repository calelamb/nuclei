"""Unbatched API, gradient triple-check and Qiskit/Cirq cross-checks."""

import numpy as np
import pytest

from kernel.tests._trainability_helpers import random_circuit, random_observable
from kernel.trainability.compiler import compile_circuit
from kernel.trainability.convert import from_cirq, from_qiskit
from kernel.trainability.ir import IrError, IrGate, ParamCircuit, ParamRef
from kernel.trainability.pauli import PauliSum, PauliTerm, parse_observable, pauli_sum_matrix
from kernel.trainability.reference import reference_expectation, reference_state
from kernel.trainability.statevector import (
    MAX_STATEVECTOR_QUBITS,
    expectation,
    parameter_shift_grad,
    simulate,
    value_and_grad,
)


def finite_diff(c, v, obs, h=1e-5):
    g = np.zeros(len(v))
    for j in range(len(v)):
        vp, vm = v.copy(), v.copy()
        vp[j] += h
        vm[j] -= h
        g[j] = (reference_expectation(c, vp, obs) - reference_expectation(c, vm, obs)) / (2 * h)
    return g


def test_constants_and_signatures():
    assert MAX_STATEVECTOR_QUBITS == 20
    c = ParamCircuit(21, [IrGate("H", (0,))], [], "native", [])
    with pytest.raises(IrError) as e:
        simulate(c, np.zeros(0))
    assert e.value.code == "too_many_qubits"


@pytest.mark.parametrize("seed", range(14))
def test_adjoint_equals_parameter_shift_equals_finite_difference(seed):
    rng = np.random.default_rng(1000 + seed)
    n = 1 + seed % 8  # n = 1..8
    m = int(rng.integers(1, 7))
    c = random_circuit(rng, n, int(rng.integers(5, 28)), m, diag_heavy=seed % 3 == 0)
    obs = random_observable(rng, n)
    v = rng.uniform(-3, 3, size=m)
    val, grad = value_and_grad(c, v, obs)
    assert val == pytest.approx(reference_expectation(c, v, obs), abs=1e-10)
    assert np.abs(grad - parameter_shift_grad(c, v, obs)).max() < 1e-8
    assert np.abs(grad - finite_diff(c, v, obs)).max() < 1e-8


def test_controlled_rotations_u_gates_shared_affine_explicit():
    a, b = ParamRef("a"), ParamRef("b", -2.0, 0.4)
    gates = [
        IrGate("H", (0,)), IrGate("H", (1,)), IrGate("H", (2,)),
        IrGate("CRX", (0, 1), (a,)), IrGate("CRY", (1, 2), (b,)), IrGate("CRZ", (2, 0), (a,)),
        IrGate("U", (1,), (a, b, ParamRef("a", 0.5, 0.1))), IrGate("CP", (0, 2), (b,)),
        IrGate("RZZ", (0, 1), (a,)), IrGate("RZZ", (1, 2), (a,)), IrGate("RXX", (0, 2), (b,)),
        IrGate("RZX", (2, 1), (ParamRef("b", 3.0),)), IrGate("P", (1,), (a,)),
    ]
    c = ParamCircuit(3, gates, ["a", "b"], "native", [])
    obs = parse_observable("0.7*Z0*Z1 + X2 - 0.3*Y0*Z2 + 0.2", 3)
    v = np.array([0.83, -1.21])
    _, g = value_and_grad(c, v, obs)
    assert np.abs(g - parameter_shift_grad(c, v, obs)).max() < 1e-8
    assert np.abs(g - finite_diff(c, v, obs)).max() < 1e-8


def test_batched_gradient_matches_unbatched():
    rng = np.random.default_rng(9)
    c = random_circuit(rng, 5, 30, 5)
    obs = random_observable(rng, 5)
    V = rng.uniform(-3, 3, size=(6, 5))
    vals, grads = compile_circuit(c).value_and_grad(V, obs)
    for b in range(6):
        v1, g1 = value_and_grad(c, V[b], obs)
        assert vals[b] == pytest.approx(v1, abs=1e-12) and np.allclose(grads[b], g1, atol=1e-12)
        assert expectation(c, V[b], obs) == pytest.approx(v1, abs=1e-12)
        assert np.allclose(simulate(c, V[b]), reference_state(c, V[b]), atol=1e-10)


def test_gradient_of_known_closed_forms():
    # <Z> after RX(t) = cos t -> d/dt = -sin t ; shared parameter doubles the angle
    c = ParamCircuit(1, [IrGate("RX", (0,), (ParamRef("t"),)), IrGate("RX", (0,), (ParamRef("t"),))],
                     ["t"], "native", [])
    z = parse_observable("Z0", 1)
    t = 0.37
    val, grad = value_and_grad(c, np.array([t]), z)
    assert val == pytest.approx(np.cos(2 * t))
    assert grad[0] == pytest.approx(-2 * np.sin(2 * t))


def test_parameter_shift_counts_each_occurrence_with_chain_rule():
    c = ParamCircuit(1, [IrGate("RY", (0,), (ParamRef("t", 3.0, 0.2),))], ["t"], "native", [])
    z = parse_observable("Z0", 1)
    t = 0.4
    assert parameter_shift_grad(c, np.array([t]), z)[0] == pytest.approx(-3 * np.sin(3 * t + 0.2))


def test_initial_state_argument():
    c = ParamCircuit(1, [IrGate("X", (0,))], [], "native", [])
    assert np.allclose(simulate(c, np.zeros(0), initial=np.array([0, 1.0])), [1, 0])


# ------------------------------------------------------------ cross-checks

qiskit = pytest.importorskip("qiskit")
cirq = pytest.importorskip("cirq")


def test_compiled_matches_qiskit_statevector_and_expectation():
    from qiskit import QuantumCircuit
    from qiskit.circuit import Parameter
    from qiskit.quantum_info import SparsePauliOp, Statevector

    a, b = Parameter("a"), Parameter("b")
    qc = QuantumCircuit(4)
    qc.h(range(4))
    qc.rx(a, 0); qc.ry(2 * b + 0.3, 1); qc.cx(0, 2); qc.crz(a, 2, 3)
    qc.u(b, a, 0.7, 1); qc.cp(b, 0, 3); qc.rzz(a, 1, 2); qc.rxx(b, 0, 1)
    qc.ccx(0, 1, 3); qc.swap(2, 3); qc.cry(a - 0.1, 3, 0)
    ir = from_qiskit(qc)
    vals = np.array([0.61, -1.4])
    bound = qc.assign_parameters(dict(zip(qc.parameters, vals)))
    sv = Statevector(bound)
    got = simulate(ir, vals)
    assert abs(abs(np.vdot(got, sv.data)) - 1) < 1e-10
    obs = parse_observable("0.5*Z0*Z1 + X2 + 0.25*Y3*Z0", 4)
    op = SparsePauliOp.from_list([("IIZZ", 0.5), ("IXII", 1.0), ("YIIZ", 0.25)])
    # SparsePauliOp strings are little-endian (rightmost = qubit 0)
    assert expectation(ir, vals, obs) == pytest.approx(float(np.real(sv.expectation_value(op))), abs=1e-10)


def test_compiled_matches_cirq_simulator():
    import sympy

    t, u = sympy.Symbol("t"), sympy.Symbol("u")
    q = cirq.LineQubit.range(3)
    circuit = cirq.Circuit(
        cirq.H.on_each(*q), cirq.rx(t).on(q[0]), (cirq.X(q[1]) ** (2 * u)),
        cirq.CNOT(q[0], q[1]), (cirq.CZ(q[1], q[2]) ** t), cirq.ZZPowGate(exponent=u).on(q[0], q[2]),
        cirq.ry(0.4).on(q[2]), cirq.ISWAP(q[0], q[1]),
    )
    ir = from_cirq(circuit)
    vals = {"t": 0.52, "u": -0.33}
    res = cirq.Simulator(dtype=np.complex128).simulate(
        cirq.resolve_parameters(circuit, vals), qubit_order=q).final_state_vector
    want = res.reshape(2, 2, 2).transpose(2, 1, 0).reshape(-1)
    got = simulate(ir, np.array([vals[p] for p in ir.parameters]))
    assert abs(abs(np.vdot(got, want)) - 1) < 1e-10


def test_pauli_sum_matrix_agrees_with_qiskit_operator():
    from qiskit.quantum_info import SparsePauliOp

    ps = PauliSum((PauliTerm(0.5, ((0, "Z"), (2, "X"))), PauliTerm(-1.0, ((1, "Y"),))))
    op = SparsePauliOp.from_list([("XIZ", 0.5), ("IYI", -1.0)])
    assert np.allclose(pauli_sum_matrix(ps, 3), op.to_matrix())
