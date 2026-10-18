"""2-D loss-landscape slice along two random orthonormal directions."""

from __future__ import annotations

import time
from typing import Callable, Sequence

import numpy as np

from kernel.trainability._errors import check_cancel, report
from kernel.trainability.compiler import MAX_STATEVECTOR_QUBITS, compile_circuit
from kernel.trainability.ir import IrError, ParamCircuit
from kernel.trainability.pauli import PauliSum

__all__ = ["landscape", "orthonormal_directions"]

_BATCH = 512
_DEGENERATE = 1e-12


def orthonormal_directions(rng: np.random.Generator, m: int) -> tuple[np.ndarray, np.ndarray]:
    """Two Gaussian vectors made orthonormal by Gram-Schmidt.

    A direction that cannot exist (m < 2) is returned as the zero vector.
    """
    g1, g2 = rng.standard_normal(m), rng.standard_normal(m)
    n1 = np.linalg.norm(g1)
    d1 = g1 / n1 if n1 > _DEGENERATE else np.zeros(m)
    r = g2 - (g2 @ d1) * d1
    n2 = np.linalg.norm(r)
    d2 = r / n2 if n2 > _DEGENERATE else np.zeros(m)
    return d1, d2


def _center(rng: np.random.Generator, m: int, spec: str | Sequence[float]) -> np.ndarray:
    if isinstance(spec, str):
        if spec == "random":
            return rng.uniform(0.0, 2.0 * np.pi, size=m)
        if spec == "zero":
            return np.zeros(m)
        raise IrError("invalid_request", f"unknown landscape center '{spec}'")
    vec = np.asarray(spec, dtype=float)
    if vec.shape != (m,):
        raise IrError("invalid_request", f"center must have {m} values")
    return vec


def landscape(
    circuit: ParamCircuit,
    observable: PauliSum,
    *,
    resolution: int = 41,
    span: float = float(np.pi),
    seed: int = 0,
    center: str | Sequence[float] = "random",
    progress: Callable[[float, str], None] | None = None,
    cancel: Callable[[], bool] | None = None,
    backend: str = "auto",
) -> dict:
    if circuit.n_qubits > MAX_STATEVECTOR_QUBITS:
        raise IrError(
            "too_many_qubits",
            f"{circuit.n_qubits} qubits exceeds the statevector limit of {MAX_STATEVECTOR_QUBITS}.",
        )
    started = time.monotonic()
    rng = np.random.default_rng(seed)
    program = compile_circuit(circuit, backend=backend)
    m = program.n_params
    c = _center(rng, m, center)
    d1, d2 = orthonormal_directions(rng, m)
    axis = np.linspace(-span, span, resolution)
    # Row-major with y outer: flat index = iy * resolution + ix.
    xs, ys = np.meshgrid(axis, axis)  # xs[iy, ix] = axis[ix]
    points = (
        c[None, :]
        + xs.reshape(-1, 1) * d1[None, :]
        + ys.reshape(-1, 1) * d2[None, :]
    )
    total = points.shape[0]
    flat = np.empty(total)
    for lo in range(0, total, _BATCH):
        check_cancel(cancel)
        hi = min(lo + _BATCH, total)
        flat[lo:hi] = program.expectations(points[lo:hi], observable)
        report(progress, hi / total, f"Evaluated {hi} of {total} grid points")
    center_value = float(program.expectations(c[None, :], observable)[0])
    values = flat.reshape(resolution, resolution)
    return {
        "resolution": resolution,
        "span": float(span),
        "axis": [float(x) for x in axis],
        "values": values.tolist(),
        "center": [float(x) for x in c],
        "min": float(values.min()),
        "max": float(values.max()),
        "center_value": center_value,
        "n_qubits": circuit.n_qubits,
        "backend": program.backend,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
    }
