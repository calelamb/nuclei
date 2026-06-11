"""Bloch coordinate qubit-order regression tests.

The frontend contract (BlochPanel labels sphere ``i`` as ``q{i}``) is that
``bloch_coords[i]`` is display qubit ``i`` — for every adapter.

``partial_trace_qubit`` reshapes the statevector C-order, so its axis 0 is
the MSB of the statevector index. Qiskit statevectors are little-endian
(qubit 0 = LSB), so axis ``k`` is Qiskit qubit ``n-1-k`` — tracing axis
``i`` for qubit ``i`` returned the Bloch vector of qubit ``n-1-i`` and the
panel showed qiskit qubits mirrored. Symmetric states (Bell) masked it,
which is why the bug survived: every fixture asserted z ≈ 0 on both qubits.

Cirq and Q# feed BIG-endian statevectors (qubit 0 = MSB) through the same
helper, so their natural order already matches the contract — the
cross-adapter test below pins them all to the same convention.
"""

from __future__ import annotations

import pytest

from kernel.adapters.qsharp_adapter import QsharpAdapter

# X on qubit 0 only, 3 qubits — asymmetric on purpose so reversed ordering
# cannot hide. DumpMachine gives the Q# run an exact state to trace.
X_ON_Q0_QSHARP = """\
import Std.Diagnostics.DumpMachine;

operation Main() : Result[] {
    use qs = Qubit[3];
    X(qs[0]);
    DumpMachine();
    let results = [M(qs[0]), M(qs[1]), M(qs[2])];
    ResetAll(qs);
    return results;
}
"""


def _qiskit_x_on_q0_result():
    pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")
    from qiskit import QuantumCircuit

    from kernel.adapters.qiskit_adapter import QiskitAdapter

    qc = QuantumCircuit(3, 3)
    qc.x(0)
    qc.measure_all(add_bits=False)  # simulate()'s counts pass needs measures
    return QiskitAdapter().simulate(qc, shots=100)


# ───────── qiskit: z orientation per qubit ─────────


def test_qiskit_bloch_coords_follow_display_qubit_order():
    # X on qubit 0 only: qubit 0 is |1> (z = -1), qubits 1 and 2 stay |0>
    # (z = +1). The reversed-order bug reported [+1, +1, -1] instead.
    result = _qiskit_x_on_q0_result()

    assert len(result.bloch_coords) == 3
    assert result.bloch_coords[0]["z"] == pytest.approx(-1.0, abs=1e-6)
    assert result.bloch_coords[1]["z"] == pytest.approx(+1.0, abs=1e-6)
    assert result.bloch_coords[2]["z"] == pytest.approx(+1.0, abs=1e-6)


# ───────── qiskit: x/y orientation per qubit ─────────


def test_qiskit_bloch_x_axis_lands_on_the_hadamard_qubit():
    # H on qubit 0 (others idle): qubit 0 is |+> (x = +1), the rest |0>.
    # Pins the x/y components to the right qubit, not just z.
    pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")
    from qiskit import QuantumCircuit

    from kernel.adapters.qiskit_adapter import QiskitAdapter

    qc = QuantumCircuit(3, 3)
    qc.h(0)
    qc.measure_all(add_bits=False)
    result = QiskitAdapter().simulate(qc, shots=100)

    assert result.bloch_coords[0]["x"] == pytest.approx(+1.0, abs=1e-6)
    assert result.bloch_coords[0]["z"] == pytest.approx(0.0, abs=1e-6)
    assert result.bloch_coords[1]["z"] == pytest.approx(+1.0, abs=1e-6)
    assert result.bloch_coords[2]["z"] == pytest.approx(+1.0, abs=1e-6)


# ───────── cross-adapter consistency ─────────


def test_qsharp_and_qiskit_agree_on_bloch_qubit_order():
    # The equivalent Q# program (X on qs[0], 3 qubits, DumpMachine) must
    # produce the same bloch_coords ordering as qiskit — every adapter is
    # pinned to the frontend's bloch_coords[i] == qubit i convention.
    qiskit_result = _qiskit_x_on_q0_result()

    result, snapshot, stdout, stderr, error = QsharpAdapter().execute_source(
        X_ON_Q0_QSHARP, 100
    )
    assert error is None
    assert result is not None
    assert len(result.bloch_coords) == 3

    for i in range(3):
        assert result.bloch_coords[i]["z"] == pytest.approx(
            qiskit_result.bloch_coords[i]["z"], abs=1e-6
        )
    assert result.bloch_coords[0]["z"] == pytest.approx(-1.0, abs=1e-6)
