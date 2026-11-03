"""Classical-baseline benchmark for the quantum-kernel analysis.

No quantum-kernel number is interpretable on its own: this analysis scores
out-of-the-box RBF and linear kernels on the *identical* dataset split the
quantum kernel sees (same ``seed`` => bit-identical split), and reports the
geometric difference (Huang et al., Nat. Commun. 12, 2631)

    g_CQ = sqrt(lambda_max(K_q^{1/2} (K_c + epsilon I)^{-1} K_q^{1/2}))

between the quantum kernel and the best classical kernel, which bounds the
separation any kernel method could achieve between the two feature maps.

The RBF grid is anchored at the median heuristic over *train pairs only*
and the winner is selected by train alignment (tie-broken by train
accuracy); test accuracy is reported but never used for selection, so the
baseline choice cannot leak test information.  The quantum side is
optional: a circuit whose parameter count does not match the dataset
feature count gets its classical numbers with ``quantum: null`` instead of
``quantum_kernel``'s ``qml_dataset_mismatch`` error.
"""

from __future__ import annotations

import time
from typing import Any, Callable

import numpy as np

from kernel.trainability._analysis_common import check_cancel, report
from kernel.trainability.compiler import MAX_STATEVECTOR_QUBITS, compile_circuit
from kernel.trainability.ir import IrError, ParamCircuit
from kernel.trainability.noise import NOISE_NOTE, NoiseSpec, coerce_noise, noisy_fidelity_kernel
from kernel.trainability.qml_data import load_dataset, split_dataset
from kernel.trainability.qml_kernel import centered_alignment, fidelity_kernel, kernel_ridge_accuracy

__all__ = ["classical_baseline", "rbf_kernel", "linear_kernel", "geometric_difference"]

Progress = Callable[[float, str], None] | None
Cancel = Callable[[], bool] | None


def _squared_distances(x: np.ndarray) -> np.ndarray:
    sq = np.sum(x ** 2, axis=1)
    dists = sq[:, None] + sq[None, :] - 2.0 * (x @ x.T)
    return np.clip(dists, 0.0, None)


def rbf_kernel(x: np.ndarray, gamma: float) -> np.ndarray:
    """``exp(-gamma ||x - x'||^2)`` on rows of ``x``, clipped to [0, 1]."""
    kernel = np.exp(-float(gamma) * _squared_distances(np.asarray(x, dtype=np.float64)))
    return np.clip(kernel, 0.0, 1.0)


def linear_kernel(x: np.ndarray) -> np.ndarray:
    """``X X^T`` (the unnormalized linear-kernel floor)."""
    x = np.asarray(x, dtype=np.float64)
    return x @ x.T


def _sqrt_psd(matrix: np.ndarray) -> np.ndarray:
    values, vectors = np.linalg.eigh(0.5 * (matrix + matrix.T))
    return (vectors * np.sqrt(np.clip(values, 0.0, None))) @ vectors.T


def geometric_difference(
    kernel_q: np.ndarray, kernel_c: np.ndarray, epsilon: float = 1.0,
) -> float:
    """Huang et al. geometric difference ``g_CQ`` (>= 1 up to regularization)."""
    kq = np.asarray(kernel_q, dtype=np.float64)
    kc = np.asarray(kernel_c, dtype=np.float64)
    n = kq.shape[0]
    kq_half = _sqrt_psd(kq)
    middle = np.linalg.solve(kc + float(epsilon) * np.eye(n), kq_half)
    product = kq_half @ middle
    top = float(np.linalg.eigvalsh(0.5 * (product + product.T))[-1])
    return float(np.sqrt(max(top, 0.0)))


def effective_dimension(kernel: np.ndarray) -> float:
    """Participation ratio ``(sum lambda)^2 / sum lambda^2`` (tandem formula)."""
    values = np.clip(np.linalg.eigvalsh(kernel), 0.0, None)
    total = float(values.sum())
    return float((total * total) / float((values ** 2).sum())) if total > 0 else 0.0


def classical_baseline(
    circuit: ParamCircuit,
    *,
    dataset: str = "moons",
    dataset_samples: int = 48,
    noise: float = 0.1,
    train_fraction: float = 0.7,
    ridge_lambda: float = 1.0,
    gamma_scales: tuple[float, ...] = (0.25, 0.5, 1.0, 2.0, 4.0),
    include_linear: bool = True,
    seed: int = 0,
    progress: Progress = None,
    cancel: Cancel = None,
    backend: str = "auto",
    channel_noise: NoiseSpec | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Classical RBF/linear kernel baselines on the quantum kernel's split."""
    if circuit.n_qubits > MAX_STATEVECTOR_QUBITS:
        raise IrError(
            "too_many_qubits",
            f"{circuit.n_qubits} qubits exceeds the statevector limit of {MAX_STATEVECTOR_QUBITS}.",
        )
    noise_spec = coerce_noise(channel_noise)
    started = time.monotonic()
    check_cancel(cancel)
    data = load_dataset(dataset, dataset_samples, noise, seed)
    train_idx, test_idx = split_dataset(data, train_fraction, seed)
    x_all = data["X"]
    y_signed = data["y_signed"]

    train_dists = _squared_distances(x_all[train_idx])
    upper = train_dists[np.triu_indices(len(train_idx), k=1)]
    median = float(np.median(upper)) if upper.size else 0.0
    gamma0 = 1.0 / median if median > 0.0 else 1.0

    def score(name: str, gamma: float | None, kernel: np.ndarray) -> dict[str, Any]:
        # Selection metrics are train-only; test accuracy is observational.
        alignment = centered_alignment(
            kernel[np.ix_(train_idx, train_idx)], y_signed[train_idx],
        )
        train_accuracy, test_accuracy = kernel_ridge_accuracy(
            kernel, y_signed, train_idx, test_idx, ridge_lambda,
        )
        return {
            "name": name,
            "gamma": None if gamma is None else float(gamma),
            "alignment": alignment,
            "train_accuracy": train_accuracy,
            "test_accuracy": test_accuracy,
            "effective_dimension": effective_dimension(kernel),
        }

    baselines: list[dict[str, Any]] = []
    kernels: dict[int, np.ndarray] = {}
    for scale in gamma_scales:
        check_cancel(cancel)
        kernel = rbf_kernel(x_all, gamma0 * float(scale))
        kernels[len(baselines)] = kernel
        baselines.append(score("rbf", gamma0 * float(scale), kernel))
    if include_linear:
        kernel = linear_kernel(x_all)
        kernels[len(baselines)] = kernel
        baselines.append(score("linear", None, kernel))
    report(progress, 0.5, f"Scored {len(baselines)} classical baselines")

    best_index = max(
        range(len(baselines)),
        key=lambda i: (baselines[i]["alignment"], baselines[i]["train_accuracy"], -i),
    )
    best = baselines[best_index]

    quantum: dict[str, Any] | None = None
    geo_diff: float | None = None
    delta: float | None = None
    program_backend = str(backend)
    notes = [
        "RBF gamma grid is anchored at the train-pairs median heuristic and the "
        "winner is selected by train alignment (tie: train accuracy); test "
        "accuracy is reported but never used for selection.",
        "Synthetic binary benchmark; accuracies describe these kernels on this "
        "dataset, not a quantum advantage claim.",
    ]
    if circuit.parameters and len(circuit.parameters) == data["n_features"]:
        program = compile_circuit(circuit, backend=backend)
        program_backend = program.backend
        check_cancel(cancel)
        states = program.states(x_all)
        if noise_spec.is_exact:
            kernel_q = fidelity_kernel(states)
        else:
            noise_rng = np.random.default_rng((int(seed) + 3_000_003) % (2**63))
            kernel_q, _kv = noisy_fidelity_kernel(states, noise_spec, noise_rng, cancel)
        q_train, q_test = kernel_ridge_accuracy(
            kernel_q, y_signed, train_idx, test_idx, ridge_lambda,
        )
        quantum = {
            "alignment": centered_alignment(kernel_q, y_signed),
            "train_accuracy": q_train,
            "test_accuracy": q_test,
            "effective_dimension": effective_dimension(kernel_q),
        }
        geo_diff = geometric_difference(kernel_q, kernels[best_index], epsilon=ridge_lambda)
        delta = float(q_test - best["test_accuracy"])
        notes.append(
            f"geometric_difference uses epsilon = ridge_lambda = {float(ridge_lambda)} "
            "(same regularizer as the ridge solve)."
        )
        if not noise_spec.is_exact:
            notes.append(NOISE_NOTE)
    else:
        notes.append(
            f"Quantum kernel skipped: the circuit has {len(circuit.parameters)} parameters "
            f"but dataset '{dataset}' has {data['n_features']} features (a pure feature "
            "map binds one parameter per feature)."
        )

    if quantum is None:
        verdict = "no_quantum_kernel"
    elif abs(delta) <= 1.0 / max(len(test_idx), 1):
        verdict = "tie"
    elif delta > 0:
        verdict = "quantum_ahead"
    else:
        verdict = "classical_ahead"

    report(progress, 1.0, "Compared classical baselines with the quantum kernel")
    return {
        "dataset": data["name"],
        "n_samples": data["n_samples"],
        "n_features": data["n_features"],
        "noise": data["noise"],
        "channel_noise": noise_spec.echo(),
        "n_train": int(len(train_idx)),
        "n_test": int(len(test_idx)),
        "labels": [int(v) for v in data["y"]],
        "train_indices": [int(i) for i in train_idx],
        "gamma_median_heuristic": float(gamma0),
        "ridge_lambda": float(ridge_lambda),
        "baselines": baselines,
        "best_baseline": best["name"],
        "best_baseline_gamma": best["gamma"],
        "quantum": quantum,
        "geometric_difference": geo_diff,
        "delta_test_accuracy": delta,
        "verdict": verdict,
        "n_qubits": circuit.n_qubits,
        "backend": program_backend,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
        "notes": notes,
    }
