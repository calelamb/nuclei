"""Quantum kernel analysis: fidelity kernel, alignment and a kernel classifier.

The user's circuit is a *feature map* ``U(x)``: every circuit parameter is a
data coordinate, bound in ``circuit.parameters`` order to the dataset
columns (see :mod:`kernel.trainability.qml_data`).  The analysis computes

* the fidelity kernel ``K_ij = |<0|U(x_j)^dagger U(x_i)|0>|^2`` from
  batched statevectors,
* centred kernel-target alignment (Cristianini et al.) of ``K`` with the
  label kernel ``y y^T``,
* the kernel spectrum (eigenvalues, effective dimension) and
* train/test accuracy of kernel ridge regression on the precomputed kernel
  (closed form, ``numpy`` only): ``alpha = (K_train + lambda I)^-1 y``.
"""

from __future__ import annotations

import time
from typing import Any, Callable

import numpy as np

from kernel.trainability._analysis_common import AnalysisError, check_cancel, report
from kernel.trainability.compiler import MAX_STATEVECTOR_QUBITS, compile_circuit
from kernel.trainability.ir import IrError, ParamCircuit
from kernel.trainability.noise import NOISE_NOTE, NoiseSpec, coerce_noise, noisy_fidelity_kernel
from kernel.trainability.qml_data import load_dataset, split_dataset

__all__ = ["quantum_kernel", "fidelity_kernel", "centered_alignment", "kernel_ridge_accuracy"]

Progress = Callable[[float, str], None] | None
Cancel = Callable[[], bool] | None


def fidelity_kernel(states: np.ndarray) -> np.ndarray:
    """``|S S^dagger|^2`` for rows of ``states``, clipped to [0, 1] with unit diagonal."""
    gram = states @ states.conj().T
    kernel = np.clip(np.abs(gram) ** 2, 0.0, 1.0)
    np.fill_diagonal(kernel, 1.0)
    return kernel


def centered_alignment(kernel: np.ndarray, y_signed: np.ndarray) -> float:
    """Centred alignment between ``K`` and ``y y^T`` (in [0, 1] for PSD kernels)."""
    n = kernel.shape[0]
    h = np.eye(n) - np.full((n, n), 1.0 / n)
    kc = h @ kernel @ h
    target = np.outer(y_signed, y_signed)
    tc = h @ target @ h
    denom = float(np.linalg.norm(kc) * np.linalg.norm(tc))
    if denom == 0.0:
        return 0.0
    return float(np.clip((kc * tc).sum() / denom, 0.0, 1.0))


def kernel_ridge_accuracy(
    kernel: np.ndarray, y_signed: np.ndarray,
    train_idx: np.ndarray, test_idx: np.ndarray, ridge_lambda: float,
) -> tuple[float, float]:
    """(train, test) accuracy of kernel ridge regression on a precomputed kernel."""
    k_train = kernel[np.ix_(train_idx, train_idx)]
    alpha = np.linalg.solve(
        k_train + ridge_lambda * np.eye(len(train_idx)), y_signed[train_idx],
    )

    def accuracy(rows: np.ndarray) -> float:
        scores = kernel[np.ix_(rows, train_idx)] @ alpha
        predicted = np.where(scores >= 0.0, 1.0, -1.0)
        return float((predicted == y_signed[rows]).mean())

    return accuracy(train_idx), accuracy(test_idx)


def quantum_kernel(
    circuit: ParamCircuit,
    *,
    dataset: str = "moons",
    dataset_samples: int = 48,
    noise: float = 0.1,
    train_fraction: float = 0.7,
    ridge_lambda: float = 1.0,
    seed: int = 0,
    progress: Progress = None,
    cancel: Cancel = None,
    backend: str = "auto",
    # ``noise`` above is the *dataset* noise; the simulated channel is separate.
    channel_noise: NoiseSpec | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Quantum-kernel study of a feature-map circuit on a built-in dataset."""
    if circuit.n_qubits > MAX_STATEVECTOR_QUBITS:
        raise IrError(
            "too_many_qubits",
            f"{circuit.n_qubits} qubits exceeds the statevector limit of {MAX_STATEVECTOR_QUBITS}.",
        )
    if not circuit.parameters:
        raise AnalysisError("no_parameters", "the feature map has no free parameters to bind data to")
    data = load_dataset(dataset, dataset_samples, noise, seed)
    if len(circuit.parameters) != data["n_features"]:
        raise AnalysisError(
            "qml_dataset_mismatch",
            f"the feature map has {len(circuit.parameters)} parameters "
            f"({', '.join(circuit.parameters)}) but dataset '{dataset}' has "
            f"{data['n_features']} features; bind one parameter per feature, in order",
        )
    noise_spec = coerce_noise(channel_noise)
    started = time.monotonic()
    program = compile_circuit(circuit, backend=backend)
    check_cancel(cancel)
    states = program.states(data["X"])
    report(progress, 0.6, f"Computed {len(states)} feature states")
    if noise_spec.is_exact:
        kernel = fidelity_kernel(states)
        kernel_shot_variance: float | None = None
    else:
        noise_rng = np.random.default_rng((int(seed) + 3_000_003) % (2**63))
        kernel, _kv = noisy_fidelity_kernel(states, noise_spec, noise_rng, cancel)
        kernel_shot_variance = float(_kv) if noise_spec.shots > 0 else 0.0
    train_idx, test_idx = split_dataset(data, train_fraction, seed)
    check_cancel(cancel)
    alignment = centered_alignment(kernel, data["y_signed"])
    eigenvalues = np.linalg.eigvalsh(kernel)[::-1]
    eigenvalues = np.clip(eigenvalues, 0.0, None)
    total = float(eigenvalues.sum())
    effective_dimension = float((total * total) / float((eigenvalues ** 2).sum())) if total > 0 else 0.0
    train_accuracy, test_accuracy = kernel_ridge_accuracy(
        kernel, data["y_signed"], train_idx, test_idx, ridge_lambda,
    )
    report(progress, 1.0, "Scored the kernel classifier")
    notes = [
        "Synthetic binary benchmark (numpy-generated, features scaled to [0, 2pi)); "
        "accuracies describe this feature map on this dataset, not a quantum advantage claim.",
    ]
    if not noise_spec.is_exact:
        notes.append(NOISE_NOTE + " Kernel entries are Tr(rho_i rho_j) under the channel, resampled per shot when shots > 0.")
    return {
        "dataset": data["name"],
        "n_samples": data["n_samples"],
        "n_features": data["n_features"],
        "noise": data["noise"],
        "channel_noise": noise_spec.echo(),
        "kernel_shot_variance": kernel_shot_variance,
        "n_train": int(len(train_idx)),
        "n_test": int(len(test_idx)),
        "parameters": list(circuit.parameters),
        "labels": [int(v) for v in data["y"]],
        "train_indices": [int(i) for i in train_idx],
        "kernel": [[float(v) for v in row] for row in kernel],
        "alignment": alignment,
        "eigenvalues": [float(v) for v in eigenvalues],
        "effective_dimension": effective_dimension,
        "top_eigenvalue_share": float(eigenvalues[0] / total) if total > 0 else 0.0,
        "ridge_lambda": float(ridge_lambda),
        "train_accuracy": train_accuracy,
        "test_accuracy": test_accuracy,
        "n_qubits": circuit.n_qubits,
        "backend": program.backend,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
        "notes": notes,
    }
