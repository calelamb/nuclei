"""Fidelity ``F(theta) = |<target|U(theta)|0>|^2`` and its exact gradient.

``F`` is not a Pauli observable, so ``KernelProgram.value_and_grad`` cannot
differentiate it directly. The compiler's adjoint recursion only needs a
"co-state" ``lam = O |psi>``; for the rank-one projector ``O = |t><t|`` that is
``lam = <t|psi> |t>``. We run the compiler's own forward pass and backward
sweep with that ``lam`` via the public ``KernelProgram.value_and_grad_costate``,
so every gate type, fused diagonal op and shared parameter is handled exactly
as for Pauli observables:

    dF/dtheta_j = 2 Im sum_ops <lam| G |phi>        (the compiler's formula)

The result is verified against central finite differences and against
``states()`` in ``test_discovery_state_synthesis.py``. Global phase never
changes ``F`` and is ignored (as in the compiler's own adjoint).
"""

from __future__ import annotations

from typing import Any

import numpy as np

from kernel.trainability.compiler import KernelProgram


def fidelity_value_and_grad(
    program: KernelProgram, values: np.ndarray, target: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Batched ``(F (B,), dF/dtheta (B, m))`` for ``values`` of shape ``(B, m)``."""
    target_c = np.asarray(target, dtype=np.complex128)
    target_conj = np.conj(target_c)

    def costate(psi: Any) -> tuple[Any, Any]:
        overlap = (target_conj[None, :] * psi).sum(axis=1)
        return abs(overlap) ** 2, overlap[:, None] * target_c[None, :]

    return program.value_and_grad_costate(values, costate)


def fidelity_from_states(states: np.ndarray, target: np.ndarray) -> np.ndarray:
    """``|<target|psi_b>|^2`` for each row of ``states`` (independent of the adjoint path)."""
    overlaps = states @ np.conj(np.asarray(target, dtype=np.complex128))
    return np.abs(overlaps) ** 2
