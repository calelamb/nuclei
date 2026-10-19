"""Shared random-circuit generators for the trainability tests."""

from __future__ import annotations

import numpy as np

from kernel.trainability.gates import GATE_SPECS
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.pauli import PauliSum, PauliTerm

ONE_Q_FIXED = ["H", "X", "Y", "Z", "S", "SDG", "T", "TDG", "SX", "SXDG", "I"]
ONE_Q_PARAM = ["RX", "RY", "RZ", "P"]
TWO_Q_FIXED = ["CX", "CY", "CZ", "CH", "SWAP", "ISWAP"]
TWO_Q_PARAM = ["RXX", "RYY", "RZZ", "RZX", "CRX", "CRY", "CRZ", "CP"]
THREE_Q_FIXED = ["CCX", "CCZ", "CSWAP"]


def random_circuit(
    rng: np.random.Generator,
    n: int,
    n_gates: int,
    n_params: int,
    *,
    names: list[str] | None = None,
    diag_heavy: bool = False,
) -> ParamCircuit:
    """Random circuit mixing every gate family, shared and affine parameters."""
    params = [f"p{i}" for i in range(n_params)]
    pool = list(names) if names else (
        ONE_Q_FIXED + ONE_Q_PARAM * 3 + TWO_Q_FIXED + TWO_Q_PARAM * 2 + THREE_Q_FIXED + ["U"] * 2
    )
    if diag_heavy:
        pool = ["RZ", "P", "RZZ", "CRZ", "CP", "CZ", "S", "T", "Z", "RX", "RY", "H", "CX"] * 2
    gates: list[IrGate] = []

    def angle():
        r = rng.random()
        if r < 0.2 or n_params == 0:
            return float(rng.uniform(-3, 3))
        ref = params[int(rng.integers(0, n_params))]
        if r < 0.6:
            return ParamRef(ref)
        return ParamRef(ref, float(rng.uniform(-2, 2)), float(rng.uniform(-1, 1)))

    while len(gates) < n_gates:
        name = pool[int(rng.integers(0, len(pool)))]
        spec = GATE_SPECS[name]
        if spec.arity > n:
            continue
        qubits = tuple(int(q) for q in rng.choice(n, size=spec.arity, replace=False))
        gates.append(IrGate(name, qubits, tuple(angle() for _ in range(spec.n_angles)), len(gates)))
    return ParamCircuit(n, gates, params, "native", [])


def random_observable(rng: np.random.Generator, n: int, n_terms: int = 4) -> PauliSum:
    terms = []
    for _ in range(n_terms):
        k = int(rng.integers(1, min(n, 3) + 1))
        qs = sorted(int(q) for q in rng.choice(n, size=k, replace=False))
        terms.append(PauliTerm(float(rng.uniform(-1, 1)), tuple((q, "XYZ"[int(rng.integers(0, 3))]) for q in qs)))
    terms.append(PauliTerm(float(rng.uniform(-1, 1)), ()))  # identity offset
    return PauliSum(tuple(terms))
