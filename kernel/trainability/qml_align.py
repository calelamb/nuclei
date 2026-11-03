"""Kernel-alignment search: make the feature map itself trainable.

The quantum-kernel analysis treats the feature map as fixed.  Here the
per-feature bandwidths ``x -> w (.) x`` (parameterized as ``exp(log_w)``,
so bandwidths stay positive) and optionally the circuit's non-data
parameters ``theta`` in ``U(x; theta)`` are optimized to maximize the
centred kernel-target alignment of the **train** Gram matrix (Hubregtsen
et al., Phys. Rev. A 106, 042431).  The optimizer is SPSA with tandem's
gain schedule (``a/k^0.602``, ``c/k^0.101``): alignment couples the whole
batch, so a per-sample adjoint gradient does not directly apply.

Data binding follows ``qml_train.resolve_data_params`` (``x``-prefixed =
data, the rest trainable), which is how this escapes ``quantum_kernel``'s
"exactly ``n_features`` parameters" restriction.  The best iterate by
train alignment is restored and returned.  Every result embeds the
best-RBF test accuracy from ``qml_baseline`` on the same split, because
bandwidth-tuned quantum kernels collapse toward RBF kernels
(arXiv:2503.05602) and must not be read without that number.
"""

from __future__ import annotations

import time
from typing import Any, Callable, Sequence

import numpy as np

from kernel.trainability._analysis_common import AnalysisError, check_cancel, report
from kernel.trainability.compiler import MAX_STATEVECTOR_QUBITS, compile_circuit
from kernel.trainability.ir import IrError, ParamCircuit
from kernel.trainability.noise import NOISE_NOTE, NoiseSpec, coerce_noise, noisy_fidelity_kernel
from kernel.trainability.qml_baseline import classical_baseline, effective_dimension
from kernel.trainability.qml_data import load_dataset, split_dataset
from kernel.trainability.qml_kernel import centered_alignment, fidelity_kernel, kernel_ridge_accuracy
from kernel.trainability.qml_train import resolve_data_params

__all__ = ["kernel_alignment_search"]

Progress = Callable[[float, str], None] | None
Cancel = Callable[[], bool] | None

_MODES = ("bandwidth", "embedding", "both")


def _values_matrix(
    n_rows: int, index: dict[str, int], data_cols: dict[str, np.ndarray],
    train_cols: dict[str, int], theta: np.ndarray, bandwidth: np.ndarray,
    data_order: dict[str, int],
) -> np.ndarray:
    values = np.zeros((n_rows, len(index)))
    for name, column in data_cols.items():
        values[:, index[name]] = column * bandwidth[data_order[name]]
    for name, j in train_cols.items():
        values[:, index[name]] = theta[j]
    return values


def _concentration(kernel: np.ndarray) -> dict[str, float]:
    n = kernel.shape[0]
    off = kernel[~np.eye(n, dtype=bool)] if n > 1 else np.zeros(0)
    return {
        "offdiag_mean": float(off.mean()) if off.size else 0.0,
        "offdiag_var": float(off.var()) if off.size else 0.0,
        "effective_dimension": effective_dimension(kernel),
    }


def kernel_alignment_search(
    circuit: ParamCircuit,
    *,
    dataset: str = "moons",
    dataset_samples: int = 48,
    noise: float = 0.1,
    train_fraction: float = 0.7,
    ridge_lambda: float = 1.0,
    data_params: Sequence[str] | None = None,
    mode: str = "bandwidth",
    steps: int = 40,
    learning_rate: float = 0.1,
    spsa_a: float = 0.05,
    spsa_c: float = 0.1,
    seed: int = 0,
    progress: Progress = None,
    cancel: Cancel = None,
    backend: str = "auto",
    channel_noise: NoiseSpec | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """SPSA-maximize train centred alignment over bandwidths and/or ``theta``."""
    if circuit.n_qubits > MAX_STATEVECTOR_QUBITS:
        raise IrError(
            "too_many_qubits",
            f"{circuit.n_qubits} qubits exceeds the statevector limit of {MAX_STATEVECTOR_QUBITS}.",
        )
    if mode not in _MODES:
        raise AnalysisError("invalid_request", f"mode must be one of {', '.join(_MODES)}, got {mode!r}")
    if steps < 1:
        raise AnalysisError("invalid_request", "steps must be >= 1")
    if not (learning_rate > 0):
        raise AnalysisError("invalid_request", "learning_rate must be positive")
    for _name, _val in (("spsa_a", spsa_a), ("spsa_c", spsa_c)):
        if isinstance(_val, bool) or not isinstance(_val, (int, float)) or not (0.0 < float(_val) <= 2.0):
            raise AnalysisError("invalid_request", f"{_name} must be a finite number in (0, 2]")
    spsa_a, spsa_c = float(spsa_a), float(spsa_c)

    data_names = resolve_data_params(circuit, data_params)
    train_names = [p for p in circuit.parameters if p not in set(data_names)]
    if not data_names:
        raise AnalysisError(
            "qml_dataset_mismatch",
            "no data parameters found: name the encoding parameters x0, x1, ... "
            "or list them in settings",
        )
    if mode in ("embedding", "both") and not train_names:
        raise AnalysisError(
            "no_parameters",
            f"mode {mode!r} optimizes the circuit's non-data parameters, but this circuit has none",
        )
    data = load_dataset(dataset, dataset_samples, noise, seed)
    if len(data_names) != data["n_features"]:
        raise AnalysisError(
            "qml_dataset_mismatch",
            f"data parameters ({', '.join(data_names)}) number {len(data_names)} but dataset "
            f"'{dataset}' has {data['n_features']} features",
        )
    noise_spec = coerce_noise(channel_noise)
    started = time.monotonic()
    check_cancel(cancel)
    program = compile_circuit(circuit, backend=backend)
    index = circuit.param_index()
    order = {name: i for i, name in enumerate(data_names)}
    train_pos = {name: j for j, name in enumerate(train_names)}
    train_idx, test_idx = split_dataset(data, train_fraction, seed)
    x_all = data["X"]
    y_signed = data["y_signed"]
    n_features = int(data["n_features"])

    # Tandem's init draw: same seed => same theta0 variational_train would use.
    rng = np.random.default_rng(seed)
    theta0 = rng.uniform(0.0, 2.0 * np.pi, len(train_names))
    spsa_rng = np.random.default_rng((int(seed) + 2_000_003) % (2**63))
    noise_rng = np.random.default_rng((int(seed) + 3_000_003) % (2**63))

    data_cols = {name: x_all[:, order[name]] for name in data_names}

    def build(log_w: np.ndarray, theta: np.ndarray) -> tuple[np.ndarray, dict[str, float]]:
        values = _values_matrix(
            len(x_all), index, data_cols, train_pos, theta, np.exp(log_w), order,
        )
        states = program.states(values)
        if noise_spec.is_exact:
            kernel = fidelity_kernel(states)
        else:
            kernel, _kv = noisy_fidelity_kernel(states, noise_spec, noise_rng, cancel)
        alignment = centered_alignment(
            kernel[np.ix_(train_idx, train_idx)], y_signed[train_idx],
        )
        train_accuracy, test_accuracy = kernel_ridge_accuracy(
            kernel, y_signed, train_idx, test_idx, ridge_lambda,
        )
        return kernel, {
            "alignment": alignment,
            "train_accuracy": train_accuracy,
            "test_accuracy": test_accuracy,
        }

    use_bandwidth = mode in ("bandwidth", "both")
    use_theta = mode in ("embedding", "both")
    log_w = np.zeros(n_features)
    theta = theta0.copy()

    def pack(lw: np.ndarray, th: np.ndarray) -> np.ndarray:
        parts = ([lw] if use_bandwidth else []) + ([th] if use_theta else [])
        return np.concatenate(parts) if parts else np.zeros(0)

    def unpack(vec: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        lw = vec[:n_features].copy() if use_bandwidth else log_w.copy()
        rest = vec[n_features:] if use_bandwidth else vec
        th = rest.copy() if use_theta else theta0.copy()
        return lw, th

    vec = pack(log_w, theta)
    initial_kernel, initial = build(log_w, theta)
    best_vec, best, best_kernel = vec.copy(), dict(initial), initial_kernel
    history: list[dict[str, Any]] = []
    current = dict(initial)

    for step in range(steps):
        check_cancel(cancel)
        history.append({
            "step": step,
            "alignment": current["alignment"],
            "train_accuracy": current["train_accuracy"],
            "test_accuracy": current["test_accuracy"],
        })
        report(
            progress, 0.9 * (step + 1) / steps,
            f"Step {step + 1} of {steps}: train alignment {current['alignment']:.4f}",
        )
        if vec.size == 0:
            break
        k = step + 1
        # learning_rate scales the SPSA step gain (defaults give tandem's 0.05).
        a_k = (spsa_a * float(learning_rate) / 0.1) / (k ** 0.602)
        c_k = spsa_c / (k ** 0.101)
        delta = (spsa_rng.integers(0, 2, size=len(vec)) * 2 - 1).astype(np.float64)
        lw_plus, th_plus = unpack(vec + c_k * delta)
        _, scores_plus = build(lw_plus, th_plus)
        lw_minus, th_minus = unpack(vec - c_k * delta)
        _, scores_minus = build(lw_minus, th_minus)
        grad_hat = ((scores_plus["alignment"] - scores_minus["alignment"]) / (2.0 * c_k)) * delta
        vec = vec + a_k * grad_hat
        lw_now, th_now = unpack(vec)
        kernel_now, current = build(lw_now, th_now)
        if current["alignment"] > best["alignment"]:
            best_vec, best, best_kernel = vec.copy(), dict(current), kernel_now

    final = dict(current)
    best_log_w, best_theta = unpack(best_vec)

    baseline = classical_baseline(
        circuit, dataset=dataset, dataset_samples=dataset_samples, noise=noise,
        train_fraction=train_fraction, ridge_lambda=ridge_lambda, seed=seed,
        backend=backend, channel_noise=channel_noise,
    )
    rbf_entries = [b for b in baseline["baselines"] if b["name"] == "rbf"]
    best_rbf = max(rbf_entries, key=lambda b: (b["alignment"], b["train_accuracy"]))
    report(progress, 1.0, "Restored the best-alignment feature map")

    notes = [
        "Alignment is optimized on the train split only; test accuracy is observational.",
        "Bandwidth-tuned quantum kernels collapse toward RBF kernels "
        "(arXiv:2503.05602); compare rbf_baseline_test_accuracy before reading "
        "anything into the tuned numbers.",
        "Synthetic binary benchmark; not a quantum advantage claim.",
    ]
    if not noise_spec.is_exact:
        notes.append(NOISE_NOTE)
    return {
        "dataset": data["name"],
        "n_samples": data["n_samples"],
        "n_features": data["n_features"],
        "noise": data["noise"],
        "channel_noise": noise_spec.echo(),
        "n_train": int(len(train_idx)),
        "n_test": int(len(test_idx)),
        "mode": mode,
        "data_params": list(data_names),
        "trainable_params": list(train_names),
        "initial": initial,
        "final": final,
        "best": best,
        "bandwidth": [float(v) for v in np.exp(best_log_w)],
        "final_parameters": {name: float(best_theta[train_pos[name]]) for name in train_names},
        "history": history,
        "concentration": {
            "before": _concentration(initial_kernel),
            "after": _concentration(best_kernel),
        },
        "rbf_baseline_test_accuracy": float(best_rbf["test_accuracy"]),
        "kernel": [[float(v) for v in row] for row in best_kernel],
        "labels": [int(v) for v in data["y"]],
        "train_indices": [int(i) for i in train_idx],
        "steps": int(steps),
        "steps_run": int(len(history)),
        "ridge_lambda": float(ridge_lambda),
        "n_qubits": circuit.n_qubits,
        "backend": program.backend,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
        "notes": notes,
    }
