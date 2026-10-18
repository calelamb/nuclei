"""Fidelity ``F(theta) = |<target|U(theta)|0>|^2`` and its exact gradient.

``F`` is not a Pauli observable, so ``KernelProgram.value_and_grad`` cannot
differentiate it directly. The compiler's adjoint recursion only needs a
"co-state" ``lam = O |psi>``; for the rank-one projector ``O = |t><t|`` that is
``lam = <t|psi> |t>``. We run the compiler's own forward pass and backward
sweep with that ``lam`` (the same per-op ``backward`` calls ``_vag_chunk``
makes), so every gate type, fused diagonal op and shared parameter is handled
exactly as for Pauli observables:

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
    v = program._check_values(values)
    bk = program._bk
    xp = bk.xp
    target_dev = bk.asarray(np.asarray(target, dtype=np.complex128))

    def chunk(vc: Any, s0: Any):
        state, auxs = program._forward(vc, s0, True)
        overlap = xp.sum(xp.conj(target_dev)[None, :] * state, axis=1)
        lam = overlap[:, None] * target_dev[None, :]
        value = xp.abs(overlap) ** 2
        grad = xp.zeros((vc.shape[0], program.n_params), dtype=xp.float64)
        phi = state
        for k in range(len(program.ops) - 1, program._first_param_op - 1, -1):
            op = program.ops[k]
            phi, lam, dgrad = op.backward(bk, phi, lam, vc, auxs[k])
            if dgrad is not None and op.param_idx.size:
                grad = bk.add_at_cols(grad, op.param_idx, dgrad)
        return value, grad

    parts = program._run(chunk, v, None)
    values_out = np.concatenate([bk.to_numpy(p[0]) for p in parts])
    grads_out = np.concatenate([bk.to_numpy(p[1]) for p in parts], axis=0)
    return values_out, grads_out.reshape(v.shape[0], program.n_params)


def fidelity_from_states(states: np.ndarray, target: np.ndarray) -> np.ndarray:
    """``|<target|psi_b>|^2`` for each row of ``states`` (independent of the adjoint path)."""
    overlaps = states @ np.conj(np.asarray(target, dtype=np.complex128))
    return np.abs(overlaps) ** 2
