"""Canonical two-qubit cost and depth (PRD 14 spec 4.1.6).

Cost is measured after canonical decomposition into {1-qubit, CX}, using one
fixed table, so a composite gate can never look cheaper than what it compiles
to::

    CX = CZ = CY = 1      ISWAP = 2        SWAP = 3
    RXX = RYY = RZZ = RZX = 2              CRX = CRY = CRZ = CP = CH = 2
    CCX = CCZ = 6         CSWAP = 8

This module has no IR dependency: it works on plain ``(name, qubits)`` gate
tuples, plus a counter for Stim circuits (Stim's own two-qubit gate names are
mapped onto the same table; classically controlled gates such as
``CX rec[-1] 0`` cost nothing quantum).

Depth model: a one-qubit gate occupies its qubit for 1 layer, a multi-qubit
gate occupies *all* of its qubits for ``cost`` layers (its canonical CX count).
``two_qubit_depth`` counts only those CX layers (one-qubit gates are free).
"""

from __future__ import annotations

from typing import Iterable, Iterator

Gate = tuple[str, tuple[int, ...]]

# name -> (arity, canonical CX count)
_TABLE: dict[str, tuple[int, int]] = {
    "CX": (2, 1), "CNOT": (2, 1), "CZ": (2, 1), "CY": (2, 1),
    "ISWAP": (2, 2), "ISWAP_DAG": (2, 2), "SWAP": (2, 3),
    "RXX": (2, 2), "RYY": (2, 2), "RZZ": (2, 2), "RZX": (2, 2),
    "CRX": (2, 2), "CRY": (2, 2), "CRZ": (2, 2), "CP": (2, 2), "CPHASE": (2, 2), "CH": (2, 2),
    "CCX": (3, 6), "TOFFOLI": (3, 6), "CCZ": (3, 6),
    "CSWAP": (3, 8), "FREDKIN": (3, 8),
    # Stim-only two-qubit names, mapped onto the same table.
    "XCX": (2, 1), "XCY": (2, 1), "XCZ": (2, 1), "YCX": (2, 1), "YCY": (2, 1), "YCZ": (2, 1),
    "ZCX": (2, 1), "ZCY": (2, 1), "ZCZ": (2, 1),
    "CXSWAP": (2, 2), "SWAPCX": (2, 2), "CZSWAP": (2, 2),
    "SQRT_XX": (2, 2), "SQRT_XX_DAG": (2, 2), "SQRT_YY": (2, 2), "SQRT_YY_DAG": (2, 2),
    "SQRT_ZZ": (2, 2), "SQRT_ZZ_DAG": (2, 2),
    "MXX": (2, 2), "MYY": (2, 2), "MZZ": (2, 2),
}
_FREE_NAMES = frozenset({
    "BARRIER", "MEASURE", "MEAS", "RESET", "DELAY", "TICK", "DETECTOR", "OBSERVABLE_INCLUDE",
    "QUBIT_COORDS", "SHIFT_COORDS", "GLOBAL_PHASE", "GPHASE", "II",
})
# A conservative charge for an unlisted two-qubit Stim gate (SWAP-equivalent).
_UNLISTED_STIM_TWO_QUBIT_COST = 3

CANONICAL_COST_TABLE: dict[str, int] = {name: cost for name, (_, cost) in _TABLE.items()}


class UnknownGateCost(ValueError):
    """A multi-qubit gate that the canonical table cannot price."""


def gate_cost(name: str, qubits: tuple[int, ...]) -> int:
    """Canonical CX count of one gate application."""
    key = name.upper()
    if key in _FREE_NAMES or len(qubits) <= 1:
        return 0
    entry = _TABLE.get(key)
    if entry is None:
        raise UnknownGateCost(f"No canonical two-qubit cost for gate '{name}' on {len(qubits)} qubits.")
    arity, cost = entry
    if len(qubits) != arity:
        raise UnknownGateCost(f"Gate '{name}' expects {arity} qubits, got {len(qubits)}.")
    return cost


def two_qubit_cost(gates: Iterable[Gate]) -> int:
    return sum(gate_cost(name, tuple(qubits)) for name, qubits in gates)


def _depth(gates: Iterable[Gate], *, count_single: bool) -> int:
    frontier: dict[int, int] = {}
    for name, qubits in gates:
        qubits = tuple(qubits)
        if not qubits or name.upper() in _FREE_NAMES:
            continue
        cost = gate_cost(name, qubits)
        if cost == 0 and not count_single:
            continue
        width = max(cost, 1)
        start = max(frontier.get(q, 0) for q in qubits)
        for q in qubits:
            frontier[q] = start + width
    return max(frontier.values(), default=0)


def two_qubit_depth(gates: Iterable[Gate]) -> int:
    """Depth counting only canonical CX layers (one-qubit gates are free)."""
    return _depth(gates, count_single=False)


def total_depth(gates: Iterable[Gate]) -> int:
    """Depth where one-qubit gates take 1 layer and multi-qubit gates take ``cost`` layers."""
    return _depth(gates, count_single=True)


# --- Stim ------------------------------------------------------------------


def stim_gate_tuples(circuit) -> Iterator[Gate]:
    """Yield ``(name, qubits)`` for every quantum gate application of a flattened circuit.

    Two-qubit gates are split into their pairs. Pairs with a classical control
    (measurement-record or sweep target) are skipped, since they are not
    quantum interactions.
    """
    import stim

    for inst in circuit.flattened():
        if not isinstance(inst, stim.CircuitInstruction):
            continue
        name = inst.name
        data = stim.gate_data(name)
        targets = inst.targets_copy()
        if data.is_two_qubit_gate:
            for a, b in zip(targets[0::2], targets[1::2]):
                if a.is_qubit_target and b.is_qubit_target:
                    yield (name, (a.value, b.value))
        elif data.is_single_qubit_gate and data.is_unitary:
            for t in targets:
                if t.is_qubit_target:
                    yield (name, (t.value,))


def _stim_cost_of(name: str, qubits: tuple[int, ...]) -> int:
    key = name.upper()
    if len(qubits) == 2 and key not in _TABLE and key not in _FREE_NAMES:
        return _UNLISTED_STIM_TWO_QUBIT_COST
    return gate_cost(name, qubits)


def stim_two_qubit_cost(circuit) -> int:
    """Total canonical two-qubit cost of a Stim circuit (REPEAT blocks expanded)."""
    return sum(_stim_cost_of(n, q) for n, q in stim_gate_tuples(circuit))


def stim_two_qubit_depth(circuit) -> int:
    gates = [(n, q) for n, q in stim_gate_tuples(circuit) if _stim_cost_of(n, q) > 0]
    priced = [(n if n.upper() in _TABLE else "SWAP", q) for n, q in gates]
    return two_qubit_depth(priced)
