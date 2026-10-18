"""Target states for the ``state_synthesis`` evaluator (little-endian: qubit q = bit q)."""

from __future__ import annotations

import math
from typing import Any

import numpy as np

KINDS = ("ghz", "w", "dicke", "haar")
MAX_TARGET_QUBITS = 12


class TargetError(ValueError):
    """Invalid target description."""


def ghz(n: int) -> np.ndarray:
    state = np.zeros(1 << n, dtype=np.complex128)
    state[0] = state[-1] = 1.0 / math.sqrt(2.0)
    return state


def w_state(n: int) -> np.ndarray:
    state = np.zeros(1 << n, dtype=np.complex128)
    for q in range(n):
        state[1 << q] = 1.0 / math.sqrt(n)
    return state


def dicke(n: int, k: int) -> np.ndarray:
    if not 0 <= k <= n:
        raise TargetError(f"dicke k must be in [0, {n}]")
    weights = np.array([bin(x).count("1") == k for x in range(1 << n)], dtype=np.float64)
    return (weights / math.sqrt(weights.sum())).astype(np.complex128)


def haar(n: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    dim = 1 << n
    state = rng.standard_normal(dim) + 1j * rng.standard_normal(dim)
    return (state / np.linalg.norm(state)).astype(np.complex128)


def target_state(spec: dict[str, Any]) -> np.ndarray:
    """Build the normalized target vector from a config ``target`` object."""
    kind, n = spec.get("kind"), int(spec.get("n_qubits", 0))
    if not 1 <= n <= MAX_TARGET_QUBITS:
        raise TargetError(f"target.n_qubits must be in [1, {MAX_TARGET_QUBITS}]")
    if kind == "ghz":
        return ghz(n)
    if kind == "w":
        return w_state(n)
    if kind == "dicke":
        return dicke(n, int(spec.get("k", n // 2)))
    if kind == "haar":
        return haar(n, int(spec.get("seed", 0)))
    raise TargetError(f"unknown target kind {kind!r}")
