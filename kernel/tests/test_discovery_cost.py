"""Canonical two-qubit cost/depth table (spec 4.1.6)."""

from __future__ import annotations

import pytest

from kernel.discovery.cost import (
    CANONICAL_COST_TABLE,
    UnknownGateCost,
    gate_cost,
    stim_two_qubit_cost,
    stim_two_qubit_depth,
    total_depth,
    two_qubit_cost,
    two_qubit_depth,
)


@pytest.mark.parametrize(
    "name,qubits,expected",
    [
        ("CX", (0, 1), 1), ("CZ", (0, 1), 1), ("CY", (0, 1), 1), ("ISWAP", (0, 1), 2),
        ("SWAP", (0, 1), 3), ("RXX", (0, 1), 2), ("RYY", (0, 1), 2), ("RZZ", (0, 1), 2),
        ("RZX", (0, 1), 2), ("CRX", (0, 1), 2), ("CRY", (0, 1), 2), ("CRZ", (0, 1), 2),
        ("CP", (0, 1), 2), ("CH", (0, 1), 2), ("CCX", (0, 1, 2), 6), ("CCZ", (0, 1, 2), 6),
        ("CSWAP", (0, 1, 2), 8), ("cx", (3, 4), 1), ("H", (0,), 0), ("RZ", (2,), 0),
    ],
)
def test_spec_table(name, qubits, expected):
    assert gate_cost(name, qubits) == expected


def test_unknown_multiqubit_gate_is_not_free():
    with pytest.raises(UnknownGateCost):
        gate_cost("MYSTERY", (0, 1))
    with pytest.raises(UnknownGateCost):
        gate_cost("CX", (0, 1, 2))


def test_composite_never_cheaper_than_decomposition():
    assert gate_cost("SWAP", (0, 1)) == 3 * gate_cost("CX", (0, 1))
    assert CANONICAL_COST_TABLE["CCX"] >= 3 * CANONICAL_COST_TABLE["CX"]


def test_cost_and_depth_over_tuples():
    gates = [("H", (0,)), ("CX", (0, 1)), ("CX", (1, 2)), ("SWAP", (0, 2)), ("BARRIER", (0, 1, 2))]
    assert two_qubit_cost(gates) == 5
    assert two_qubit_depth(gates) == 5  # CX(0,1)->CX(1,2)->SWAP(0,2): 1+1+3
    assert total_depth(gates) == 6  # the leading H adds one layer on qubit 0 first


def test_parallel_gates_share_depth():
    gates = [("CX", (0, 1)), ("CX", (2, 3)), ("CZ", (1, 2))]
    assert two_qubit_depth(gates) == 2


def test_stim_counter_flattens_repeat_and_skips_classical_control():
    stim = pytest.importorskip("stim")

    circuit = stim.Circuit(
        """
        R 0 1 2
        REPEAT 3 {
            CX 0 1 1 2
            TICK
        }
        M 2
        CX rec[-1] 0
        SWAP 0 2
        ISWAP 0 1
        """
    )
    assert stim_two_qubit_cost(circuit) == 3 * 2 + 3 + 2
    assert stim_two_qubit_depth(circuit) >= 3


def test_stim_cost_matches_generated_surface_code_cx_count():
    stim = pytest.importorskip("stim")

    circuit = stim.Circuit.generated("surface_code:rotated_memory_z", distance=3, rounds=3)
    expected = sum(
        len(inst.targets_copy()) // 2
        for inst in circuit.flattened()
        if inst.name in ("CX", "CZ")
    )
    assert stim_two_qubit_cost(circuit) == expected > 0
