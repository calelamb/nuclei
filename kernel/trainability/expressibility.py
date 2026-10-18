"""Expressibility (Sim et al. 2019) and entangling capability (Meyer-Wallach).

Pure functions returning JSON-ready dicts; ``numpy.random.default_rng(seed)``
only, so the same seed gives identical output.
"""

from __future__ import annotations

import time
from typing import Callable

import numpy as np

from kernel.trainability._errors import check_cancel, report
from kernel.trainability.compiler import MAX_STATEVECTOR_QUBITS, compile_circuit
from kernel.trainability.ir import IrError, ParamCircuit

__all__ = ["expressibility", "entangling_capability", "haar_log_masses", "meyer_wallach"]

EPSILON = 1e-10
BOOTSTRAP_RESAMPLES = 500
ENTANGLEMENT_BINS = 30
_CHUNK_BYTES = 64 << 20
_TWO_PI = 2.0 * np.pi

Progress = Callable[[float, str], None] | None
Cancel = Callable[[], bool] | None


def _require_statevector(circuit: ParamCircuit) -> None:
    if circuit.n_qubits > MAX_STATEVECTOR_QUBITS:
        raise IrError(
            "too_many_qubits",
            f"{circuit.n_qubits} qubits exceeds the statevector limit of {MAX_STATEVECTOR_QUBITS}.",
        )


def _chunk(total: int, n_qubits: int, states_per_item: int) -> int:
    per_item = states_per_item * 16 * (1 << n_qubits)
    return int(max(1, min(total, _CHUNK_BYTES // per_item)))


def haar_log_masses(dim: int, bins: int) -> np.ndarray:
    """log of the exact Haar mass of each fidelity bin.

    mass = (1-a)^(N-1) - (1-b)^(N-1) for bin [a, b], evaluated in log space so
    large N does not underflow.
    """
    edges = np.linspace(0.0, 1.0, bins + 1)
    k = dim - 1
    log_lo = k * np.log1p(-edges[:-1])  # (1-a)^k
    out = np.empty(bins)
    for i in range(bins):
        if edges[i + 1] >= 1.0:
            out[i] = log_lo[i]
        else:
            log_hi = k * np.log1p(-edges[i + 1])
            out[i] = log_lo[i] + np.log1p(-np.exp(log_hi - log_lo[i]))
    return out


def _kl(counts: np.ndarray, pairs: int, log_q: np.ndarray) -> float:
    p = counts / pairs
    mask = p > 0
    return float(np.sum(p[mask] * (np.log(p[mask] + EPSILON) - log_q[mask])))


def _fidelities(
    program, rng: np.random.Generator, pairs: int, progress: Progress, cancel: Cancel
) -> np.ndarray:
    m = program.n_params
    values = rng.uniform(0.0, _TWO_PI, size=(2 * pairs, m))
    step = _chunk(pairs, program.n_qubits, 2)
    fid = np.empty(pairs)
    for lo in range(0, pairs, step):
        check_cancel(cancel)
        hi = min(lo + step, pairs)
        states = program.states(values[2 * lo : 2 * hi])
        a, b = states[0::2], states[1::2]
        fid[lo:hi] = np.abs(np.einsum("ij,ij->i", a.conj(), b)) ** 2
        report(progress, hi / pairs, f"Sampled {hi} of {pairs} state pairs")
    return np.clip(fid, 0.0, 1.0)


def expressibility(
    circuit: ParamCircuit,
    *,
    pairs: int = 2000,
    bins: int = 75,
    seed: int = 0,
    progress: Progress = None,
    cancel: Cancel = None,
    backend: str = "auto",
) -> dict:
    """KL divergence of the circuit's fidelity distribution from Haar."""
    _require_statevector(circuit)
    started = time.monotonic()
    rng = np.random.default_rng(seed)
    program = compile_circuit(circuit, backend=backend)
    dim = 1 << circuit.n_qubits
    log_q = haar_log_masses(dim, bins)
    fid = _fidelities(program, rng, pairs, progress, cancel)
    index = np.minimum((fid * bins).astype(np.int64), bins - 1)
    counts = np.bincount(index, minlength=bins).astype(float)
    kl = _kl(counts, pairs, log_q)

    boot = np.empty(BOOTSTRAP_RESAMPLES)
    for r in range(BOOTSTRAP_RESAMPLES):
        if r % 50 == 0:
            check_cancel(cancel)
        pick = rng.integers(0, pairs, size=pairs)
        boot[r] = _kl(np.bincount(index[pick], minlength=bins).astype(float), pairs, log_q)
    lo_ci, hi_ci = np.percentile(boot, [2.5, 97.5])

    edges = np.linspace(0.0, 1.0, bins + 1)
    haar = np.exp(log_q)
    histogram = [
        {"lo": float(edges[i]), "hi": float(edges[i + 1]), "observed": float(counts[i] / pairs), "haar": float(haar[i])}
        for i in range(bins)
    ]
    idle = float(np.log1p(EPSILON) - log_q[-1])
    return {
        "kl": kl,
        "kl_ci95": [float(lo_ci), float(hi_ci)],
        "pairs": pairs,
        "bins": bins,
        "dimension": dim,
        "histogram": histogram,
        "reference": {
            "idle_kl": idle,
            "note": "KL of a circuit that always outputs the same state (upper reference) at this bin count.",
        },
        "n_qubits": circuit.n_qubits,
        "backend": program.backend,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
    }


def meyer_wallach(states: np.ndarray, n_qubits: int) -> np.ndarray:
    """Q = 2 (1 - (1/n) sum_k Tr rho_k^2) for each row of ``states``."""
    batch = states.shape[0]
    purity_sum = np.zeros(batch)
    for q in range(n_qubits):
        view = states.reshape(batch, 1 << (n_qubits - 1 - q), 2, 1 << q)
        a, b = view[:, :, 0, :], view[:, :, 1, :]
        r00 = np.sum(np.abs(a) ** 2, axis=(1, 2))
        r11 = np.sum(np.abs(b) ** 2, axis=(1, 2))
        r01 = np.sum(a * b.conj(), axis=(1, 2))
        purity_sum += r00**2 + r11**2 + 2.0 * np.abs(r01) ** 2
    return np.maximum(0.0, 2.0 * (1.0 - purity_sum / n_qubits))


def entangling_capability(
    circuit: ParamCircuit,
    *,
    samples: int = 1000,
    seed: int = 0,
    progress: Progress = None,
    cancel: Cancel = None,
    backend: str = "auto",
) -> dict:
    """Meyer-Wallach distribution over random parameters, vs the Haar mean."""
    _require_statevector(circuit)
    started = time.monotonic()
    rng = np.random.default_rng(seed)
    program = compile_circuit(circuit, backend=backend)
    n = circuit.n_qubits
    values = rng.uniform(0.0, _TWO_PI, size=(samples, program.n_params))
    step = _chunk(samples, n, 1)
    q = np.empty(samples)
    for lo in range(0, samples, step):
        check_cancel(cancel)
        hi = min(lo + step, samples)
        q[lo:hi] = meyer_wallach(program.states(values[lo:hi]), n)
        report(progress, hi / samples, f"Sampled {hi} of {samples} states")
    mean = float(q.mean())
    std = float(q.std(ddof=1)) if samples > 1 else 0.0
    half = 1.96 * std / np.sqrt(samples)
    counts, edges = np.histogram(q, bins=ENTANGLEMENT_BINS, range=(0.0, 1.0))
    dim = float(1 << n)
    return {
        "mean": mean,
        "std": std,
        "ci95": [mean - half, mean + half],
        "histogram": [
            {"lo": float(edges[i]), "hi": float(edges[i + 1]), "count": int(counts[i])}
            for i in range(ENTANGLEMENT_BINS)
        ],
        "haar_mean": (dim - 2.0) / (dim + 1.0),
        "samples": samples,
        "n_qubits": n,
        "backend": program.backend,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
    }
