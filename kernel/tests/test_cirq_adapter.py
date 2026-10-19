"""Cirq snapshots draw one Measure per measured qubit (ui-r8 interaction-r-02)."""

from __future__ import annotations

import pytest

pytest.importorskip("cirq")


def _snapshot(circuit):
    from kernel.adapters.cirq_adapter import CirqAdapter

    return CirqAdapter().extract_snapshot(circuit)


def test_multi_qubit_measure_becomes_one_measure_per_qubit():
    import cirq

    q0, q1 = cirq.LineQubit.range(2)
    snap = _snapshot(cirq.Circuit([cirq.H(q0), cirq.CNOT(q0, q1), cirq.measure(q0, q1, key="m")]))
    measures = [g for g in snap.gates if g.type == "Measure"]
    assert [g.targets for g in measures] == [[0], [1]]
    assert {g.layer for g in measures} == {2}
    assert snap.classical_bit_count == 2


def test_single_qubit_measures_count_one_clbit_each():
    import cirq

    q0, q1, q2 = cirq.LineQubit.range(3)
    snap = _snapshot(cirq.Circuit([cirq.measure(q0, key="a"), cirq.measure(q1, q2, key="b")]))
    assert [g.targets for g in snap.gates if g.type == "Measure"] == [[0], [1], [2]]
    assert snap.classical_bit_count == 3


def test_non_measure_gates_are_unchanged():
    import cirq

    q0, q1 = cirq.LineQubit.range(2)
    snap = _snapshot(cirq.Circuit([cirq.H(q0), cirq.CNOT(q0, q1)]))
    assert [(g.type, g.controls, g.targets) for g in snap.gates] == [("H", [], [0]), ("CNOT", [0], [1])]
    assert snap.classical_bit_count == 0
