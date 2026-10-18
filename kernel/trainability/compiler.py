"""The Lab Compiler: IR -> optimized, batched kernel program (spec 4.1.1, 5.4).

``compile_circuit`` runs the pass pipeline (canonicalize, merge same-axis
rotations, fuse fixed 1q runs, diagonal-run fusion, monomial fusion, Clifford
marking), lowers to a flat list of ops over a state tensor ``(B, 2**n)`` whose
batch axis is the parameter-sample axis, and caches the resulting
:class:`KernelProgram` by :func:`ir_hash`.

Conventions: qubit ``q`` = bit ``q`` of the column index; ``values`` is
``(B, m)`` in ``circuit.parameters`` order; all results are numpy arrays
(complex128 states, float64 values/gradients).

Gradients use the batched adjoint method (see ``ops.py``): per gate
``dC/dtheta = 2 Im <lam|G|phi>``, chained through ``ParamRef.coeff`` and
summed over every gate sharing a parameter.  Fused diagonal ops
differentiate analytically (``d/dv_j`` of the phase op is ``i hp_j``).

Chunking: batches are split so that one chunk's state never exceeds
``MEMORY_GUARD_BYTES`` (1 GiB); on numpy chunks are additionally sized to
stay cache-resident (``CACHE_CHUNK_BYTES``).
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any

import numpy as np

from kernel.trainability.backends import (
    BYTES_PER_AMPLITUDE,
    MEMORY_GUARD_BYTES,
    Backend,
    get_backend,
)
from kernel.trainability.ir import IrError, ParamCircuit, ir_hash
from kernel.trainability.lowering import lower_items
from kernel.trainability.ops import LinAngle, ObservablePlan, Op
from kernel.trainability.passes import (
    CGate,
    canonicalize,
    clifford_segments,
    fuse_fixed_1q,
    merge_rotations,
)
from kernel.trainability.pauli import PauliSum

__all__ = ["compile_circuit", "KernelProgram", "MAX_STATEVECTOR_QUBITS", "clear_compile_cache"]

MAX_STATEVECTOR_QUBITS = 20
_CACHE_SIZE = 32
#: A returned (B, 2**n) states array above this size is refused rather than chunked.
_MAX_OUTPUT_BYTES = 4 << 30
_cache: "OrderedDict[tuple[str, str], KernelProgram]" = OrderedDict()
_cache_lock = threading.Lock()


class KernelProgram:
    """A compiled circuit; build once, run many times."""

    def __init__(
        self,
        n_qubits: int,
        n_params: int,
        backend: Backend,
        ops: tuple[Op, ...],
        global_phase: LinAngle,
        canonical: tuple[CGate, ...],
        segments: tuple[tuple[int, int], ...],
        stats: dict[str, Any],
    ) -> None:
        self.n_qubits, self.n_params, self._bk = n_qubits, n_params, backend
        self.backend = backend.name
        self.ops = ops
        self.stats = stats
        self.canonical_gates = canonical
        self.clifford_segments = segments
        self._global_phase = global_phase
        self._plans: "OrderedDict[PauliSum, ObservablePlan]" = OrderedDict()
        self._jit: dict[Any, Any] = {}
        pidx = [i for i, op in enumerate(ops) if op.param_idx.size]
        self._first_param_op = pidx[0] if pidx else len(ops)

    # ----------------------------------------------------------- helpers
    def _check_values(self, values: Any) -> np.ndarray:
        v = np.asarray(values, dtype=np.float64)
        if v.ndim != 2 or v.shape[1] != self.n_params:
            raise IrError(
                "invalid_ir",
                f"values must have shape (B, {self.n_params}), got {tuple(v.shape)}",
            )
        return v

    def _plan(self, observable: PauliSum) -> ObservablePlan:
        if observable.max_qubit() >= self.n_qubits:
            raise IrError("invalid_ir", "observable touches a qubit outside the circuit")
        plan = self._plans.get(observable)
        if plan is None:
            plan = ObservablePlan(observable, self.n_qubits)
            self._plans[observable] = plan
            if len(self._plans) > 16:
                self._plans.popitem(last=False)
        return plan

    def chunk_size(self, batch: int) -> int:
        per_sample = BYTES_PER_AMPLITUDE << self.n_qubits
        limit = min(self._bk.chunk_bytes, MEMORY_GUARD_BYTES)
        return int(max(1, min(batch, limit // per_sample)))

    def _initial(self, b: int, initial: Any, lo: int, hi: int) -> Any:
        bk = self._bk
        if initial is None:
            return bk.basis_zero(b, 1 << self.n_qubits)
        init = np.asarray(initial, dtype=np.complex128)
        if init.shape[-1] != 1 << self.n_qubits:
            raise IrError("invalid_ir", f"initial state must have length 2**{self.n_qubits}")
        if init.ndim == 1:
            init = np.broadcast_to(init, (b, init.shape[0]))
        else:
            init = init[lo:hi]
        return bk.asarray(np.ascontiguousarray(init))

    def _forward(self, v: Any, s: Any, keep_aux: bool):
        bk, auxs = self._bk, []
        for op in self.ops:
            s, aux = op.forward(bk, s, v)
            if keep_aux:
                auxs.append(aux)
        return s, auxs

    def _phase(self, v: Any) -> Any | None:
        gp = self._global_phase
        if gp.is_constant and gp.offset == 0.0:
            return None
        return self._bk.xp.exp(1j * gp.evaluate(self._bk, v))[:, None]

    def _jitted(self, key: Any, fn):
        """``jax.jit`` of ``fn`` over the static op list (identity elsewhere)."""
        if self._bk.jit is None:
            return fn
        if key not in self._jit:  # pragma: no cover - jax is optional
            self._jit[key] = self._bk.jit(fn)
        return self._jit[key]

    def _run(self, fn, values: np.ndarray, initial: Any) -> list[Any]:
        """Run ``fn(v_chunk, s0_chunk)`` over memory/cache-sized chunks."""
        total, step = values.shape[0], self.chunk_size(values.shape[0])
        parts = []
        for lo in range(0, total, step):
            hi = min(lo + step, total)
            parts.append(fn(self._bk.asarray(values[lo:hi]), self._initial(hi - lo, initial, lo, hi)))
        return parts

    # -------------------------------------------------------- public API
    def states(self, values: Any, initial: Any = None) -> np.ndarray:
        """Final states ``(B, 2**n)`` complex128."""
        v = self._check_values(values)
        if v.shape[0] * (BYTES_PER_AMPLITUDE << self.n_qubits) > _MAX_OUTPUT_BYTES:
            raise IrError("too_many_qubits", "requested states exceed the memory guard; use expectations()")

        def raw(vc, s0):
            s, _ = self._forward(vc, s0, False)
            ph = self._phase(vc)
            return s if ph is None else s * ph

        fn = self._jitted("states", raw)
        parts = [self._bk.to_numpy(p) for p in self._run(fn, v, initial)]
        return parts[0] if len(parts) == 1 else np.concatenate(parts, axis=0)

    def expectations(self, values: Any, observable: PauliSum, initial: Any = None) -> np.ndarray:
        """``<psi(v_b)|O|psi(v_b)>`` for each sample, shape ``(B,)``."""
        v = self._check_values(values)
        plan = self._plan(observable)

        def raw(vc, s0):
            s, _ = self._forward(vc, s0, False)
            return plan.expectation(self._bk, s)

        fn = self._jitted(("expect", observable), raw)
        return np.concatenate([self._bk.to_numpy(p) for p in self._run(fn, v, initial)])

    def value_and_grad(
        self, values: Any, observable: PauliSum, initial: Any = None
    ) -> tuple[np.ndarray, np.ndarray]:
        """Batched adjoint: ``(values (B,), grads (B, m))``."""
        v = self._check_values(values)
        plan = self._plan(observable)
        fn = self._jitted(("vag", observable), lambda vc, s0: self._vag_chunk(vc, plan, s0))
        parts = self._run(fn, v, initial)
        vals = np.concatenate([self._bk.to_numpy(p[0]) for p in parts])
        grads = np.concatenate([self._bk.to_numpy(p[1]) for p in parts], axis=0)
        return vals, grads.reshape(v.shape[0], self.n_params)

    def _vag_chunk(self, v: Any, plan: ObservablePlan, s0: Any):
        bk = self._bk
        s, auxs = self._forward(v, s0, True)
        lam = plan.apply(bk, s)
        value = bk.xp.sum(s.real * lam.real + s.imag * lam.imag, axis=1)
        grad = bk.xp.zeros((v.shape[0], self.n_params), dtype=bk.xp.float64)
        phi = s
        first = self._first_param_op
        for k in range(len(self.ops) - 1, first - 1, -1):
            op = self.ops[k]
            phi_prev, lam_prev, dgrad = op.backward(bk, phi, lam, v, auxs[k])
            if dgrad is not None and op.param_idx.size:
                grad = bk.add_at_cols(grad, op.param_idx, dgrad)
            phi, lam = phi_prev, lam_prev
        return value, grad


# ----------------------------------------------------------------- compile


def _count_kinds(ops: list[Op]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for op in ops:
        counts[op.kind] = counts.get(op.kind, 0) + 1
    return counts


def _build(circuit: ParamCircuit, bk: Backend) -> KernelProgram:
    t0 = time.perf_counter()
    n = circuit.n_qubits
    if n > MAX_STATEVECTOR_QUBITS:
        raise IrError(
            "too_many_qubits",
            f"{n} qubits exceeds the statevector limit of {MAX_STATEVECTOR_QUBITS}",
        )
    canonical, gphase = canonicalize(circuit)
    merged, n_merged = merge_rotations(canonical)
    items, n_fixed = fuse_fixed_1q(merged)
    segments = clifford_segments(merged)
    ops, low = lower_items(items, n)
    stats = {
        "backend": bk.name,
        "dtype": "complex128",
        "n_qubits": n,
        "n_params": len(circuit.parameters),
        "ir_gates": len(circuit.gates),
        "canonical_gates": len(canonical),
        "ops": len(ops),
        "op_counts": _count_kinds(ops),
        "merged_rotations": n_merged,
        "fused_fixed_1q": n_fixed,
        "diag_gates_fused": low["diag_gates_fused"],
        "mono_fused": low["mono_fused"],
        "clifford_gates": sum(b - a for a, b in segments),
        "clifford_segments": len(segments),
        "compile_ms": round((time.perf_counter() - t0) * 1000, 3),
    }
    return KernelProgram(
        n, len(circuit.parameters), bk, tuple(ops), gphase, tuple(merged), segments, stats
    )


def compile_circuit(circuit: ParamCircuit, *, backend: str = "auto") -> KernelProgram:
    """Compile (cached by IR hash + resolved backend)."""
    bk = get_backend(backend)
    key = (ir_hash(circuit), bk.name)
    with _cache_lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
            return hit
    program = _build(circuit, bk)
    with _cache_lock:
        _cache[key] = program
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
    return program


def clear_compile_cache() -> None:
    with _cache_lock:
        _cache.clear()
