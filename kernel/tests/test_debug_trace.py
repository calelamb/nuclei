"""Tests for Executor.debug_trace — the Quantum Debugger's per-step state.

Verifies the trajectory reuses the corrected per-adapter Bloch convention
(see test_adapter_bloch_order.py), aligns steps with the gate list, and matches
a full simulation at the final step. Qiskit and Cirq only.
"""

import math

import pytest

from kernel.executor import Executor, MAX_DEBUG_QUBITS

BELL_QISKIT = """from qiskit import QuantumCircuit
qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])
"""

X_ON_Q0_QISKIT = """from qiskit import QuantumCircuit
qc = QuantumCircuit(3)
qc.x(0)
"""

BELL_CIRQ = """import cirq
q0, q1 = cirq.LineQubit.range(2)
circuit = cirq.Circuit([cirq.H(q0), cirq.CNOT(q0, q1)])
"""

QSHARP = """operation Main() : Unit { }
"""


def _trace(code, language="python"):
    payload, _out, _err, error = Executor().debug_trace(code, language=language)
    return payload, error


def test_qiskit_bell_trace_shape_and_initial_state() -> None:
    payload, error = _trace(BELL_QISKIT)
    assert error is None, error
    assert payload["framework"] == "qiskit"
    assert payload["qubit_count"] == 2

    steps = payload["steps"]
    # initial + one per gate (h, cx, measure, measure) = 1 + 4.
    assert len(steps) == 5
    assert steps[0]["gate_index"] == -1
    assert steps[0]["label"] == "initial"
    assert [s["gate_index"] for s in steps[1:]] == [0, 1, 2, 3]

    # Initial state is |00> with certainty.
    assert steps[0]["probabilities"].get("00") == pytest.approx(1.0)
    # Every step carries one Bloch coord per qubit.
    for s in steps:
        assert len(s["bloch_coords"]) == 2


def test_qiskit_step_after_h_puts_q0_on_x_axis() -> None:
    payload, error = _trace(BELL_QISKIT)
    assert error is None
    # steps[1] is the state after gate 0 (H on q0): q0 → +X, q1 still +Z.
    after_h = payload["steps"][1]["bloch_coords"]
    assert after_h[0]["x"] == pytest.approx(1.0, abs=1e-6)
    assert after_h[0]["z"] == pytest.approx(0.0, abs=1e-6)
    assert after_h[1]["z"] == pytest.approx(1.0, abs=1e-6)


def test_qiskit_bloch_order_follows_display_qubit() -> None:
    # X on q0 only: q0 → -Z (|1>), q1/q2 stay +Z. The reversed-order bug would
    # have flipped q2 instead of q0. This pins the debugger to the same fix.
    payload, error = _trace(X_ON_Q0_QISKIT)
    assert error is None
    final = payload["steps"][-1]["bloch_coords"]
    zs = [round(c["z"], 6) for c in final]
    assert zs == [-1.0, 1.0, 1.0]


def test_cirq_bell_trace_matches_qiskit_final_bloch() -> None:
    q_payload, q_err = _trace(BELL_QISKIT)
    c_payload, c_err = _trace(BELL_CIRQ)
    assert q_err is None and c_err is None
    # Final Bloch of a Bell state: both qubits maximally mixed (all coords ~0).
    for coords in (q_payload["steps"][-1]["bloch_coords"], c_payload["steps"][-1]["bloch_coords"]):
        for c in coords:
            assert math.isclose(c["x"], 0.0, abs_tol=1e-6)
            assert math.isclose(c["y"], 0.0, abs_tol=1e-6)
            assert math.isclose(c["z"], 0.0, abs_tol=1e-6)


def test_unsupported_framework_errors() -> None:
    payload, error = _trace(QSHARP, language="qsharp")
    assert payload is None
    assert error is not None
    assert error.code == "debug_unsupported_framework"


def test_over_qubit_cap_errors() -> None:
    code = f"from qiskit import QuantumCircuit\nqc = QuantumCircuit({MAX_DEBUG_QUBITS + 1})\nqc.h(0)\n"
    payload, error = _trace(code)
    assert payload is None
    assert error is not None
    assert error.code == "circuit_too_large"
