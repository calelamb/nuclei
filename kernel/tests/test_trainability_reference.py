"""The oracle itself: sanity against closed forms and the Qiskit simulator."""

import numpy as np
import pytest

from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.pauli import parse_observable
from kernel.trainability.reference import (
    reference_expectation,
    reference_observable_matrix,
    reference_state,
)


def circ(n, gates, params=()):
    return ParamCircuit(n, list(gates), list(params), "native", [])


def test_bell_state():
    c = circ(2, [IrGate("H", (0,)), IrGate("CX", (0, 1))])
    psi = reference_state(c, np.zeros(0))
    assert np.allclose(psi, [2**-0.5, 0, 0, 2**-0.5])


def test_little_endian_x_on_qubit_one():
    psi = reference_state(circ(3, [IrGate("X", (1,))]), np.zeros(0))
    assert np.argmax(np.abs(psi)) == 0b010


def test_cx_control_target_order():
    c = circ(3, [IrGate("X", (2,)), IrGate("CX", (2, 0))])
    assert np.argmax(np.abs(reference_state(c, np.zeros(0)))) == 0b101


def test_rx_expectation_closed_form():
    c = circ(1, [IrGate("RX", (0,), (ParamRef("t"),))], ["t"])
    z = parse_observable("Z0", 1)
    for t in (0.0, 0.7, 2.1):
        assert reference_expectation(c, np.array([t]), z) == pytest.approx(np.cos(t))


def test_initial_state_and_validation():
    c = circ(1, [IrGate("X", (0,))])
    psi = reference_state(c, np.zeros(0), initial=np.array([0, 1.0]))
    assert np.allclose(psi, [1, 0])


def test_observable_matrix_matches_kron_by_hand():
    ps = parse_observable("0.5*Z0*X1", 2)
    z = np.diag([1, -1]).astype(complex)
    x = np.array([[0, 1], [1, 0]], dtype=complex)
    assert np.allclose(reference_observable_matrix(ps, 2), 0.5 * np.kron(x, z))


def test_matches_qiskit_statevector_on_mixed_circuit():
    qiskit = pytest.importorskip("qiskit")
    from qiskit import QuantumCircuit
    from qiskit.quantum_info import Statevector

    qc = QuantumCircuit(3)
    qc.h(0); qc.rx(0.4, 1); qc.cx(0, 2); qc.crz(0.9, 2, 1); qc.u(0.3, 1.1, -0.6, 0)
    qc.rzx(0.5, 1, 2); qc.ccx(0, 1, 2); qc.cp(0.8, 2, 0); qc.iswap(0, 1)
    c = circ(3, [
        IrGate("H", (0,)), IrGate("RX", (1,), (0.4,)), IrGate("CX", (0, 2)),
        IrGate("CRZ", (2, 1), (0.9,)), IrGate("U", (0,), (0.3, 1.1, -0.6)),
        IrGate("RZX", (1, 2), (0.5,)), IrGate("CCX", (0, 1, 2)),
        IrGate("CP", (2, 0), (0.8,)), IrGate("ISWAP", (0, 1)),
    ])
    assert np.allclose(reference_state(c, np.zeros(0)), Statevector(qc).data, atol=1e-12)
