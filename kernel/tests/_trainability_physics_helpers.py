"""Circuit builders shared by the physics-analysis tests (PPE, DLA, scaling, lint)."""

from __future__ import annotations

import math

import numpy as np

from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef

ROT1 = ["RX", "RY", "RZ"]
ROT2 = ["RXX", "RYY", "RZZ", "RZX"]
CLIFF1 = ["H", "S", "SDG", "X", "Y", "Z", "SX", "SXDG"]
CLIFF2 = ["CX", "CY", "CZ", "SWAP", "ISWAP"]


class Builder:
    """Append-only circuit builder with auto-named independent parameters."""

    def __init__(self, n: int) -> None:
        self.n = n
        self.gates: list[IrGate] = []
        self.params: list[str] = []

    def param(self, prefix: str = "t") -> ParamRef:
        name = f"{prefix}{len(self.params)}"
        self.params.append(name)
        return ParamRef(name)

    def add(self, name: str, qubits, *angles) -> "Builder":
        self.gates.append(IrGate(name, tuple(qubits), tuple(angles), len(self.gates)))
        return self

    def rot(self, name: str, qubits) -> "Builder":
        return self.add(name, qubits, self.param())

    def build(self) -> ParamCircuit:
        return ParamCircuit(self.n, list(self.gates), list(self.params))


def random_ppe_circuit(rng: np.random.Generator, n: int, n_gates: int, *, with_u: bool = True) -> ParamCircuit:
    """Random PPE-class circuit: independent Pauli rotations (some coeff 2 / -1) plus Cliffords."""
    b = Builder(n)
    while len(b.gates) < n_gates:
        r = rng.random()
        if r < 0.45:
            name = ROT1[int(rng.integers(0, 3))]
            q = int(rng.integers(0, n))
            ref = b.param()
            coeff = [1.0, 1.0, 2.0, -1.0][int(rng.integers(0, 4))]
            b.add(name, (q,), ParamRef(ref.name, coeff))
        elif r < 0.65 and n >= 2:
            q = tuple(int(x) for x in rng.choice(n, size=2, replace=False))
            b.rot(ROT2[int(rng.integers(0, 4))], q)
        elif r < 0.72 and with_u:
            q = int(rng.integers(0, n))
            b.add("U", (q,), b.param(), b.param(), float(rng.integers(0, 4)) * math.pi / 2)
        elif r < 0.78:
            q = int(rng.integers(0, n))
            b.add("P", (q,), b.param())
        elif r < 0.84:
            q = int(rng.integers(0, n))
            b.add(ROT1[int(rng.integers(0, 3))], (q,), float(rng.integers(-3, 4)) * math.pi / 2)
        elif r < 0.92 or n < 2:
            b.add(CLIFF1[int(rng.integers(0, len(CLIFF1)))], (int(rng.integers(0, n)),))
        else:
            q = tuple(int(x) for x in rng.choice(n, size=2, replace=False))
            b.add(CLIFF2[int(rng.integers(0, len(CLIFF2)))], q)
    return b.build()


def hea_circuit(n: int, layers: int, *, entangler: str = "CZ", rot: str = "RY") -> ParamCircuit:
    """Hardware-efficient ansatz: [rot on every qubit, brick CZ] x layers, open chain."""
    b = Builder(n)
    for _ in range(layers):
        for q in range(n):
            b.rot(rot, (q,))
        for start in (0, 1):
            for q in range(start, n - 1, 2):
                b.add(entangler, (q, q + 1))
    return b.build()


def two_axis_hea(n: int, layers: int) -> ParamCircuit:
    """RY + RZ rotations on every qubit then a brick CZ layer (complex HEA)."""
    b = Builder(n)
    for _ in range(layers):
        for q in range(n):
            b.rot("RY", (q,))
            b.rot("RZ", (q,))
        for start in (0, 1):
            for q in range(start, n - 1, 2):
                b.add("CZ", (q, q + 1))
    return b.build()


def brickwork_hea(n: int, layers: int, *, rot: str = "RY") -> ParamCircuit:
    """Brickwork HEA: rot on every qubit, then CZ on pairs (l%2, l%2+1), ... (alternating per layer)."""
    b = Builder(n)
    for layer in range(layers):
        for q in range(n):
            b.rot(rot, (q,))
        for q in range(layer % 2, n - 1, 2):
            b.add("CZ", (q, q + 1))
    return b.build()
