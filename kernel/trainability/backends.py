"""Array-namespace backends and the batched kernels the Lab Compiler lowers to.

A :class:`Backend` wraps an array namespace (``numpy`` always; ``cupy`` and
``jax.numpy`` when importable).  All kernels below are written against
``bk.xp`` in a *functional* style (they return new arrays), so the same code
runs eagerly on numpy/cupy and traces under ``jax.jit``.

State layout: ``(B, 2**n)`` complex128, with qubit ``q`` = bit ``q`` of the
column index (little-endian).  Viewed as ``(B, 2, ..., 2)`` in C order, qubit
``q`` lives on tensor axis ``1 + (n - 1 - q)``.  The batch axis ``B`` is the
parameter-sample axis.

Dense gate matrices use the gate-local convention of ``gates.py``: local
index bit ``j`` is the gate's ``j``-th qubit.
"""

from __future__ import annotations

import importlib
import os
from dataclasses import dataclass
from typing import Any

import numpy as np

__all__ = [
    "Backend",
    "available_backends",
    "get_backend",
    "apply_dense",
    "apply_1q",
    "apply_mono",
    "BYTES_PER_AMPLITUDE",
    "MEMORY_GUARD_BYTES",
    "CACHE_CHUNK_BYTES",
]

BYTES_PER_AMPLITUDE = 16  # complex128
#: Refuse/split any working batch above this many bytes of state (B * 2^n * 16).
MEMORY_GUARD_BYTES = 1 << 30
#: numpy only: target bytes of state per chunk so the op list runs cache-resident.
CACHE_CHUNK_BYTES = int(os.environ.get("NUCLEI_LAB_CHUNK_BYTES", 1 << 20))
#: Qubits below this index are applied through a small block matmul (a single
#: strided qubit on a short axis is slow for matmul).
_LOW_BLOCK = 3


@dataclass(frozen=True)
class Backend:
    name: str  # "numpy" | "cupy" | "jax"
    xp: Any
    is_numpy: bool
    jit: Any = None  # jax.jit when name == "jax"

    def asarray(self, a: Any, dtype: Any = None) -> Any:
        return self.xp.asarray(a, dtype=dtype)

    def to_numpy(self, a: Any) -> np.ndarray:
        if self.name == "cupy":
            return self.xp.asnumpy(a)
        return np.asarray(a)

    def add_at_cols(self, target: Any, idx: np.ndarray, update: Any) -> Any:
        """``target[:, idx] += update`` (``idx`` unique); functional on jax."""
        if self.name == "jax":
            return target.at[:, idx].add(update)
        target[:, idx] += update
        return target

    def basis_zero(self, b: int, dim: int) -> Any:
        """``(b, dim)`` complex128 array holding ``|0...0>`` in every row."""
        out = self.xp.zeros((b, dim), dtype=self.xp.complex128)
        if self.name == "jax":
            return out.at[:, 0].set(1.0)
        out[:, 0] = 1.0
        return out

    @property
    def chunk_bytes(self) -> int:
        return CACHE_CHUNK_BYTES if self.is_numpy else MEMORY_GUARD_BYTES // 4


_NUMPY = Backend("numpy", np, True)
_cache: dict[str, Backend | None] = {"numpy": _NUMPY}


def _load_cupy() -> Backend | None:
    try:
        cp = importlib.import_module("cupy")
        if cp.cuda.runtime.getDeviceCount() < 1:
            return None
        return Backend("cupy", cp, False)
    except Exception:
        return None


def _load_jax(require_gpu: bool = False) -> Backend | None:
    try:
        jax = importlib.import_module("jax")
        jnp = importlib.import_module("jax.numpy")
        if require_gpu and not any(d.platform == "gpu" for d in jax.devices()):
            return None
        jax.config.update("jax_enable_x64", True)
        return Backend("jax", jnp, False, jit=jax.jit)
    except Exception:
        return None


def available_backends() -> list[str]:
    """Names of importable backends (``numpy`` is always first)."""
    names = ["numpy"]
    for name in ("cupy", "jax"):
        if _cache.get(name) is None and name not in _cache:
            _cache[name] = _load_cupy() if name == "cupy" else _load_jax()
        if _cache.get(name) is not None:
            names.append(name)
    return names


def get_backend(name: str = "auto") -> Backend:
    """Resolve ``"auto" | "numpy" | "cupy" | "jax"``.

    ``auto`` prefers cupy (NVIDIA GPU), then jax only when it sees a GPU, and
    otherwise numpy.  An explicitly requested but missing backend raises
    ``ValueError``.
    """
    if name == "numpy":
        return _NUMPY
    if name == "auto":
        if _cache.get("cupy") is None and "cupy" not in _cache:
            _cache["cupy"] = _load_cupy()
        if _cache["cupy"] is not None:
            return _cache["cupy"]
        if "jax_gpu" not in _cache:
            _cache["jax_gpu"] = _load_jax(require_gpu=True)
        return _cache["jax_gpu"] or _NUMPY
    if name not in ("cupy", "jax"):
        raise ValueError(f"unknown backend {name!r}")
    if name not in available_backends():
        raise ValueError(f"backend {name!r} is not available in this environment")
    return _cache[name]  # type: ignore[return-value]


# ------------------------------------------------------------------ kernels


def _kron_low(bk: Backend, m: Any, q: int, k: int) -> Any:
    """``I_{2^{k-q-1}} (x) M (x) I_{2^q}`` for ``M`` of shape ``(b|1, 2, 2)``."""
    xp = bk.xp
    ia = xp.eye(1 << (k - q - 1), dtype=m.dtype)
    ic = xp.eye(1 << q, dtype=m.dtype)
    d = 1 << k
    return xp.einsum("AB,nij,CD->nAiCBjD", ia, m, ic).reshape(m.shape[0], d, d)


def apply_1q(bk: Backend, s: Any, q: int, n: int, m: Any) -> Any:
    """Apply a 2x2 (``(2,2)`` or per-sample ``(b,2,2)``) matrix to qubit ``q``."""
    xp = bk.xp
    b = s.shape[0]
    big_n = 1 << n
    m3 = m[None] if m.ndim == 2 else m
    if q >= _LOW_BLOCK:
        left, right = big_n >> (q + 1), 1 << q
        out = xp.matmul(m3[:, None], s.reshape(b, left, 2, right))
        return out.reshape(b, big_n)
    k = min(_LOW_BLOCK, n)
    mk = _kron_low(bk, m3, q, k)
    d = 1 << k
    out = xp.matmul(s.reshape(b, big_n // d, d), xp.swapaxes(mk, 1, 2))
    return out.reshape(b, big_n)


def apply_dense(bk: Backend, s: Any, qubits: tuple[int, ...], n: int, m: Any) -> Any:
    """Apply a ``2^k x 2^k`` matrix (``(d,d)`` or ``(b,d,d)``) on ``qubits``."""
    k = len(qubits)
    if k == 1:
        return apply_1q(bk, s, qubits[0], n, m)
    xp = bk.xp
    b, big_n, d = s.shape[0], 1 << n, 1 << k
    tensor = s.reshape((b,) + (2,) * n)
    axes = [1 + (n - 1 - q) for q in reversed(qubits)]  # most significant bit first
    dest = list(range(n + 1 - k, n + 1))
    moved = xp.moveaxis(tensor, axes, dest)
    flat = moved.reshape(b, big_n // d, d)
    m3 = m[None] if m.ndim == 2 else m
    out = xp.matmul(flat, xp.swapaxes(m3, 1, 2)).reshape(moved.shape)
    return xp.moveaxis(out, dest, axes).reshape(b, big_n)


def apply_mono(bk: Backend, s: Any, src: Any, phase: Any | None) -> Any:
    """``out[:, y] = phase[y] * s[:, src[y]]`` (monomial / permutation gates)."""
    out = bk.xp.take(s, src, axis=1) if src is not None else s
    return out if phase is None else out * phase
