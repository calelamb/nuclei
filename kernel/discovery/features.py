"""Structural features of a parameterized circuit (PRD 14 addendum §B, §G).

The Frontier evaluator reports these in ``metrics.features``, and the
Conjecture Engine filters elites and generated test circuits with them. A
feature is a plain JSON scalar or string, computed only from the IR gate
list. It never simulates.

Entangler pattern heuristics, over nearest-neighbour two-qubit pairs in
program order:

- ``ladder``: the first ``n-1`` entanglers are ``(0,1), (1,2), …``.
- ``brick``: they start with the even bonds ``(0,1), (2,3), …``.
- ``ring``: nearest-neighbour bonds plus the wrap-around ``(0, n-1)``.
- ``all_to_all``: every pair appears.
- ``nearest_neighbor``: other nearest-neighbour schedules.
- ``long_range``: anything else with entanglers.
- ``none``: no entanglers at all.
"""

from __future__ import annotations

from itertools import combinations
from typing import Any

from kernel.discovery.cost import gate_cost, two_qubit_cost, two_qubit_depth
from kernel.trainability.ir import ParamCircuit, ParamRef

_ROTATION_AXES = {
    "RX": "X", "RY": "Y", "RZ": "Z", "P": "Z",
    "RXX": "XX", "RYY": "YY", "RZZ": "ZZ", "RZX": "ZX",
    "CRX": "CX", "CRY": "CY", "CRZ": "CZ", "CP": "CZ",
}
_ENTANGLER_KIND = {"CX": "cx", "CY": "cy", "CZ": "cz", "ISWAP": "iswap", "SWAP": "swap"}


def _is_parametric(gate) -> bool:
    return any(isinstance(angle, ParamRef) for angle in gate.angles)


def _pair(qubits: tuple[int, ...]) -> tuple[int, int]:
    a, b = qubits[0], qubits[1]
    return (a, b) if a < b else (b, a)


def entangler_pattern(n_qubits: int, pairs: list[tuple[int, int]]) -> str:
    """Classify the two-qubit connectivity schedule (see the module docstring)."""
    if not pairs:
        return "none"
    distinct = set(pairs)
    if n_qubits > 2 and len(distinct) == n_qubits * (n_qubits - 1) // 2:
        return "all_to_all"
    nearest = all(b - a == 1 for a, b in distinct)
    if not nearest:
        wraps = (0, n_qubits - 1) in distinct
        rest_nearest = all(b - a == 1 for a, b in distinct if (a, b) != (0, n_qubits - 1))
        return "ring" if wraps and rest_nearest and n_qubits > 2 else "long_range"
    head = pairs[: max(1, n_qubits - 1)]
    if head == [(i, i + 1) for i in range(len(head))]:
        return "ladder"
    evens = [(i, i + 1) for i in range(0, n_qubits - 1, 2)]
    if evens and head[: len(evens)] == evens:
        return "brick"
    return "nearest_neighbor"


def extract_features(circuit: ParamCircuit, *, n_layers: int | None = None) -> dict[str, Any]:
    """Return JSON-ready structural features for ``circuit``.

    ``n_layers`` (when the caller knows it, e.g. ``build(n, L)``) adds the
    per-layer densities. Keys are stable; the Conjecture Engine's predicate
    language refers to them by name.
    """
    n = circuit.n_qubits
    gates = [(g.name, tuple(g.qubits)) for g in circuit.gates]
    axis_counts: dict[str, int] = {}
    entanglers: dict[str, int] = {}
    pairs: list[tuple[int, int]] = []
    param_gates = 0
    for gate in circuit.gates:
        if _is_parametric(gate):
            param_gates += 1
            axis = _ROTATION_AXES.get(gate.name)
            if axis is not None:
                axis_counts[axis] = axis_counts.get(axis, 0) + 1
        if len(gate.qubits) >= 2 and gate_cost(gate.name, tuple(gate.qubits)) > 0:
            pairs.append(_pair(tuple(gate.qubits)))
            if not _is_parametric(gate):
                kind = _ENTANGLER_KIND.get(gate.name, "other")
                entanglers[kind] = entanglers.get(kind, 0) + 1
    single_axes = sorted(a for a in axis_counts if len(a) == 1)
    two_q = two_qubit_cost(gates)
    features: dict[str, Any] = {
        "n_qubits": n,
        "n_params": len(circuit.parameters),
        "parametric_gates": param_gates,
        "params_per_qubit": len(circuit.parameters) / n if n else 0.0,
        "two_qubit_gates": two_q,
        "two_qubit_depth": two_qubit_depth(gates),
        "rotation_axis_counts": dict(sorted(axis_counts.items())),
        "rotation_axes": "".join(single_axes),
        "entangler": (next(iter(entanglers)) if len(entanglers) == 1 else ("mixed" if entanglers else "none")),
        "entangler_pattern": entangler_pattern(n, pairs),
        "distinct_bonds": len(set(pairs)),
        "connectivity_fraction": (len(set(pairs)) / len(list(combinations(range(n), 2)))) if n > 1 else 0.0,
    }
    if n_layers:
        features["n_layers"] = n_layers
        features["two_qubit_gates_per_layer"] = two_q / n_layers
        features["params_per_layer"] = len(circuit.parameters) / n_layers
    return features
