"""Sound detection of dead parameters (lint rule TRN004).

Backward operator-support analysis
----------------------------------
Let ``O_k = V† O V`` be the observable Heisenberg-evolved through all gates *after* gate ``k``
(``V`` their product).  The cost is ``<ψ_k| U_k† O_k U_k |ψ_k>`` with ``ψ_k`` independent of
``θ_k``.  If ``[G_k, O_k] = 0`` then ``U_k† O_k U_k = O_k`` and ``θ_k`` cannot affect the cost.

We over-approximate the Pauli support ``T_k`` of ``O_k`` by a set of strings, built backwards:

* rotation about ``P``: ``T ← T ∪ {P·Q : Q ∈ T, {P, Q} = 0}`` (``U†QU = cos·Q + sin·iPQ``);
* Clifford gate: strings map to strings;
* any other fixed gate on qubits ``S``: a string with a non-identity part on ``S`` may become any
  string with a non-identity part on ``S`` (``U†(P_S ⊗ R)U = Σ_a c_a Q_a ⊗ R``, traceless-preserving).

A rotation whose generator terms all commute with every string of ``T`` is *dead*, and then
``T`` is unchanged (``O_{k-1} = O_k``).  A shared parameter is dead iff all its rotations are.
The test is sound (it never flags a live parameter) but incomplete; the PPE adds the exact
state-dependent cases where it applies.  The set is capped; if the cap or the deadline is hit,
rotations earlier in the circuit are left undecided (``complete = False``).
"""

from __future__ import annotations

import time
from typing import Callable

import numpy as np

from kernel.trainability._analysis_common import observable_terms
from kernel.trainability._circuit_walk import FixedClifford, FixedOther, Item, Rotation
from kernel.trainability._ppe_compile import ints_to_words, ops_to_ints
from kernel.trainability._symplectic_keys import group_rows
from kernel.trainability.ir import ParamCircuit
from kernel.trainability.pauli import PauliSum
from kernel.trainability.symplectic import CliffordConjugator, PauliArray, n_words, popcount

MAX_SUPPORT = 200_000


class _Support:
    """A deduplicated set of Pauli strings as ``(x, z)`` word matrices."""

    def __init__(self, n: int) -> None:
        w = n_words(n)
        self.n = n
        self.x = np.zeros((0, w), np.uint64)
        self.z = np.zeros((0, w), np.uint64)

    def add(self, x: np.ndarray, z: np.ndarray) -> None:
        keep = (x | z).any(axis=1)  # the identity commutes with everything
        x, z = x[keep], z[keep]
        if not len(x):
            return
        ax, az = np.concatenate([self.x, x]), np.concatenate([self.z, z])
        first, _ = group_rows(np.concatenate([ax, az], axis=1))
        first = np.sort(first)
        self.x, self.z = ax[first], az[first]

    def __len__(self) -> int:
        return int(self.x.shape[0])

    def anticommuting(self, px: np.ndarray, pz: np.ndarray) -> np.ndarray:
        return (popcount((px & self.z) ^ (pz & self.x)) & 1).astype(bool)

    def apply_rotation(self, px: np.ndarray, pz: np.ndarray) -> None:
        mask = self.anticommuting(px, pz)
        if mask.any():
            self.add(self.x[mask] ^ px, self.z[mask] ^ pz)

    def apply_clifford(self, names: tuple[str, ...], qubits: tuple[int, ...]) -> None:
        if not len(self):
            return
        for name in reversed(names):
            arr = PauliArray(self.n, self.x, self.z, np.zeros(len(self), np.uint8))
            out = CliffordConjugator([(name, qubits)], self.n, use_stim=False).conjugate(arr)
            self.x, self.z = out.x, out.z

    def apply_mixer(self, qubits: tuple[int, ...]) -> None:
        """Over-approximate a non-Clifford fixed gate on ``qubits`` (see module docstring)."""
        if not len(self):
            return
        k = len(qubits)
        pat = np.zeros(len(self), dtype=np.int64)
        for t, q in enumerate(qubits):
            w, b = divmod(q, 64)
            sh = np.uint64(b)
            pat |= (((self.x[:, w] >> sh) & np.uint64(1)).astype(np.int64) << (2 * t)) | \
                   (((self.z[:, w] >> sh) & np.uint64(1)).astype(np.int64) << (2 * t + 1))
        hit = pat != 0
        if not hit.any():
            return
        base_x, base_z = self.x[hit].copy(), self.z[hit].copy()
        for t, q in enumerate(qubits):  # clear the local part
            w, b = divmod(q, 64)
            keep = ~(np.uint64(1) << np.uint64(b))
            base_x[:, w] &= keep
            base_z[:, w] &= keep
        for new in range(1, 4 ** k):
            nx, nz = base_x.copy(), base_z.copy()
            for t, q in enumerate(qubits):
                w, b = divmod(q, 64)
                bit = np.uint64(1) << np.uint64(b)
                if (new >> (2 * t)) & 1:
                    nx[:, w] |= bit
                if (new >> (2 * t + 1)) & 1:
                    nz[:, w] |= bit
            self.add(nx, nz)


def dead_gates(
    circuit: ParamCircuit, observable: PauliSum, items: list[Item], *, deadline: float,
    cancel: Callable[[], bool] | None = None,
) -> tuple[set[tuple[int, str]], bool]:
    """Return ``({(gate_index, parameter)}, complete)`` for rotations proven dead.

    Shared-parameter semantics are applied by the caller (a parameter is dead only if every
    rotation carrying it is in the set).
    """
    n = circuit.n_qubits
    sup = _Support(n)
    w = n_words(n)
    terms = observable_terms(observable, drop_identity=True)
    if terms:
        xs, zs = zip(*(ops_to_ints(ops, n) for _, ops in terms))
        sup.add(np.array([ints_to_words(x, w) for x in xs]).reshape(-1, w),
                np.array([ints_to_words(z, w) for z in zs]).reshape(-1, w))
    seen: set[tuple[int, str]] = set()
    live: set[tuple[int, str]] = set()
    for item in reversed(items):
        if time.perf_counter() > deadline or len(sup) > MAX_SUPPORT or (cancel is not None and cancel()):
            return seen - live, False
        if isinstance(item, FixedClifford):
            sup.apply_clifford(item.names, item.qubits)
        elif isinstance(item, FixedOther):
            sup.apply_mixer(item.qubits)
        else:
            assert isinstance(item, Rotation)
            gens = []
            for _, ops in item.terms:
                x, z = ops_to_ints(ops, n)
                gens.append((ints_to_words(x, w), ints_to_words(z, w)))
            key = (item.gate_index, item.ref.name)
            seen.add(key)
            if any(sup.anticommuting(px, pz).any() for px, pz in gens):
                live.add(key)
                for px, pz in gens:
                    sup.apply_rotation(px, pz)
    return seen - live, True
