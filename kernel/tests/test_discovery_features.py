"""Structural feature extraction used by the Frontier evaluator and Conjecture Engine."""

from __future__ import annotations

import pytest

from kernel.discovery.features import entangler_pattern, extract_features
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef


def _hea(n: int, layers: int, *, brick: bool, axes=("RY",)) -> ParamCircuit:
    gates: list[IrGate] = []
    names: list[str] = []
    for layer in range(layers):
        for q in range(n):
            for axis in axes:
                name = f"t{layer}_{q}_{axis}"
                names.append(name)
                gates.append(IrGate(axis, (q,), (ParamRef(name),)))
        bonds = ([(i, i + 1) for i in range(0, n - 1, 2)] + [(i, i + 1) for i in range(1, n - 1, 2)]
                 if brick else [(i, i + 1) for i in range(n - 1)])
        gates.extend(IrGate("CZ", bond) for bond in bonds)
    return ParamCircuit(n_qubits=n, gates=gates, parameters=names, framework="native", notes=[])


@pytest.mark.parametrize(("pairs", "expected"), [
    ([], "none"),
    ([(0, 1), (1, 2), (2, 3)], "ladder"),
    ([(0, 1), (2, 3), (1, 2)], "brick"),
    ([(0, 1), (1, 2), (2, 3), (0, 3)], "ring"),
    ([(0, 2)], "long_range"),
    ([(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)], "all_to_all"),
    ([(1, 2), (0, 1), (2, 3)], "nearest_neighbor"),
])
def test_entangler_pattern(pairs, expected) -> None:
    assert entangler_pattern(4, pairs) == expected


def test_brick_hea_features() -> None:
    feats = extract_features(_hea(6, 3, brick=True, axes=("RY", "RZ")), n_layers=3)
    assert feats["entangler_pattern"] == "brick"
    assert feats["entangler"] == "cz"
    assert feats["rotation_axes"] == "YZ"
    assert feats["n_params"] == 36
    assert feats["two_qubit_gates"] == 15
    assert feats["two_qubit_gates_per_layer"] == 5
    assert feats["rotation_axis_counts"] == {"Y": 18, "Z": 18}


def test_ladder_without_layers_has_no_per_layer_keys() -> None:
    feats = extract_features(_hea(4, 2, brick=False))
    assert feats["entangler_pattern"] == "ladder"
    assert "two_qubit_gates_per_layer" not in feats
    assert feats["connectivity_fraction"] == pytest.approx(3 / 6)


def test_product_circuit_has_no_entangler() -> None:
    circ = ParamCircuit(2, [IrGate("RX", (0,), (ParamRef("a"),)), IrGate("RX", (1,), (ParamRef("b"),))],
                        ["a", "b"], "native", [])
    feats = extract_features(circ)
    assert (feats["entangler"], feats["entangler_pattern"], feats["two_qubit_gates"]) == ("none", "none", 0)
