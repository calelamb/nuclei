"""Variational training with a calibrated decision threshold and best-theta restore.

Same model, loss and data binding as ``qml_train.variational_train`` (MSE
against signed labels, exact adjoint gradients, full-batch Adam), with two
decision-rule fixes that ``variational_train`` lacks (see
``docs/qml-benchmark-results/vqc-diagnosis.md``):

* **Best-theta restore.** ``variational_train`` always returns the theta
  after the final epoch, even when the train loss bottomed out earlier and
  later epochs drifted.  Here each epoch's theta is scored by train MSE --
  the objective being optimized -- and the best theta is restored at the
  end.  A stratified validation carve of the *train* split is available via
  ``val_fraction > 0`` (selection then uses validation MSE and gradients
  use the remaining subtrain rows), but it is off by default: at benchmark
  sizes the train split has 34--140 rows, and carving out a validation
  slice both starves the optimizer and makes selection depend on as few as
  ~8 rows, which empirically selects undertrained thetas (see the
  diagnosis doc).  Selection never reads test rows or labels either way.
* **Calibrated threshold.** Prediction in ``variational_train`` is
  ``sign(<O>)`` -- a hard-coded zero threshold with no bias term.  Here the
  deployed rule is ``+1 iff <O> >= t`` where ``t`` maximizes accuracy on
  the full train split at the restored theta.  ``t = 0`` is always a
  candidate, so calibrated train accuracy is never below the ``sign(<O>)``
  baseline on train.  Both accuracies are reported for train and test.

An optional ``class_weight="balanced"`` reweights the MSE by inverse class
frequency on the optimization (subtrain) rows.  Everything is deterministic
given ``seed``: the init stream matches tandem's, and the validation carve
uses its own seeded stream.
"""

from __future__ import annotations

import time
from typing import Any, Callable, Sequence

import numpy as np

from kernel.trainability._analysis_common import AnalysisError, check_cancel, report
from kernel.trainability.compiler import MAX_STATEVECTOR_QUBITS, compile_circuit
from kernel.trainability.ir import IrError, ParamCircuit
from kernel.trainability.noise import (
    NOISE_NOTE,
    NoiseSpec,
    coerce_noise,
    expectation_scale,
    noisy_expectations,
    shot_variance_numerator,
)
from kernel.trainability.pauli import PauliSum
from kernel.trainability.qml_data import load_dataset, split_dataset
from kernel.trainability.qml_train import resolve_data_params

__all__ = ["variational_calibrated", "select_threshold"]

Progress = Callable[[float, str], None] | None
Cancel = Callable[[], bool] | None

_CLASS_WEIGHTS = ("none", "balanced")


def select_threshold(scores: np.ndarray, y_signed: np.ndarray) -> tuple[float, float]:
    """Accuracy-maximizing threshold for ``+1 iff score >= t``.

    Candidates are ``0.0``, every observed score, and every midpoint between
    consecutive distinct scores.  Ties break toward the candidate closest to
    ``0`` (then the smaller candidate), so an uninformative score vector
    keeps the plain ``sign`` rule.  Pure function of its inputs -- callers
    pass train rows only.
    """
    s = np.asarray(scores, dtype=np.float64)
    y = np.asarray(y_signed, dtype=np.float64)
    if s.size == 0:
        return 0.0, 0.0
    uniq = np.unique(s)
    mids = (uniq[:-1] + uniq[1:]) / 2.0 if uniq.size > 1 else np.empty(0)
    candidates = np.unique(np.concatenate([[0.0], uniq, mids]))
    best_t, best_acc = 0.0, -1.0
    for t in candidates:
        acc = float(((s >= t) == (y > 0)).mean())
        if acc > best_acc or (
            acc == best_acc and (abs(float(t)), float(t)) < (abs(best_t), best_t)
        ):
            best_t, best_acc = float(t), acc
    return best_t, best_acc


def _values_matrix(
    n_rows: int, index: dict[str, int], data_cols: dict[str, np.ndarray],
    train_cols: dict[str, int], theta: np.ndarray,
) -> np.ndarray:
    values = np.zeros((n_rows, len(index)))
    for name, column in data_cols.items():
        values[:, index[name]] = column
    for name, j in train_cols.items():
        values[:, index[name]] = theta[j]
    return values


def _carve_validation(
    train_idx: np.ndarray, y_signed: np.ndarray, val_fraction: float, seed: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Stratified ``(subtrain, val)`` carve of the train split (seeded)."""
    if val_fraction <= 0.0 or len(train_idx) < 4:
        return train_idx, np.empty(0, dtype=int)
    rng = np.random.default_rng((int(seed) + 5_000_003) % (2**63))
    sub: list[int] = []
    val: list[int] = []
    for label in (-1.0, 1.0):
        rows = train_idx[y_signed[train_idx] == label]
        rows = rows[rng.permutation(len(rows))]
        n_val = int(round(len(rows) * val_fraction))
        n_val = min(max(n_val, 1), len(rows) - 1) if len(rows) > 1 else 0
        val.extend(rows[:n_val].tolist())
        sub.extend(rows[n_val:].tolist())
    if not val or not sub:
        return train_idx, np.empty(0, dtype=int)
    return np.array(sorted(sub), dtype=int), np.array(sorted(val), dtype=int)


def variational_calibrated(
    circuit: ParamCircuit,
    observable: PauliSum,
    *,
    dataset: str = "moons",
    dataset_samples: int = 48,
    noise: float = 0.1,
    train_fraction: float = 0.7,
    epochs: int = 60,
    learning_rate: float = 0.1,
    data_params: Sequence[str] | None = None,
    val_fraction: float = 0.0,
    class_weight: str = "none",
    seed: int = 0,
    progress: Progress = None,
    cancel: Cancel = None,
    backend: str = "auto",
    channel_noise: NoiseSpec | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Train like ``variational_train`` (Adam), then calibrate the decision rule.

    ``final_train_accuracy`` / ``final_test_accuracy`` are the *calibrated*
    accuracies at the restored best theta; ``sign_train_accuracy`` /
    ``sign_test_accuracy`` give the plain ``sign(<O>)`` rule at the same
    theta for comparison.  ``best_epoch`` is the 0-based epoch whose theta
    was restored (``epochs_run`` means the post-training final theta won).
    """
    if circuit.n_qubits > MAX_STATEVECTOR_QUBITS:
        raise IrError(
            "too_many_qubits",
            f"{circuit.n_qubits} qubits exceeds the statevector limit of {MAX_STATEVECTOR_QUBITS}.",
        )
    if observable.max_qubit() >= circuit.n_qubits:
        raise AnalysisError("invalid_observable", "the observable touches qubits outside the circuit")
    data_names = resolve_data_params(circuit, data_params)
    train_names = [p for p in circuit.parameters if p not in set(data_names)]
    if not data_names:
        raise AnalysisError(
            "qml_dataset_mismatch",
            "no data parameters found: name the encoding parameters x0, x1, ... "
            "or list them in settings",
        )
    if not train_names:
        raise AnalysisError("no_parameters", "the circuit has no trainable parameters (all parameters are data parameters)")
    data = load_dataset(dataset, dataset_samples, noise, seed)
    if len(data_names) != data["n_features"]:
        raise AnalysisError(
            "qml_dataset_mismatch",
            f"data parameters ({', '.join(data_names)}) number {len(data_names)} but dataset "
            f"'{dataset}' has {data['n_features']} features",
        )
    if epochs < 1:
        raise AnalysisError("invalid_request", "epochs must be >= 1")
    if not (learning_rate > 0):
        raise AnalysisError("invalid_request", "learning_rate must be positive")
    if not (0.0 <= float(val_fraction) <= 0.5):
        raise AnalysisError("invalid_request", "val_fraction must be in [0, 0.5]")
    if class_weight not in _CLASS_WEIGHTS:
        raise AnalysisError(
            "invalid_request", f"class_weight must be one of {', '.join(_CLASS_WEIGHTS)}, got {class_weight!r}"
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
    subtrain_idx, val_idx = _carve_validation(train_idx, y_signed, float(val_fraction), seed)
    selection_rows = val_idx if len(val_idx) else train_idx
    selection_name = "val_loss" if len(val_idx) else "train_loss"

    def columns(rows: np.ndarray) -> dict[str, np.ndarray]:
        return {name: x_all[rows, order[name]] for name in data_names}

    rng = np.random.default_rng(seed)
    theta = rng.uniform(0.0, 2.0 * np.pi, len(train_names))
    theta0 = theta.copy()
    noise_rng = np.random.default_rng((int(seed) + 1_000_003) % (2**63))
    grad_scale = expectation_scale(observable, noise_spec)
    grad_shot_var = (
        shot_variance_numerator(observable) / float(noise_spec.shots) if noise_spec.shots > 0 else 0.0
    )

    if class_weight == "balanced" and len(subtrain_idx):
        sub_y = y_signed[subtrain_idx]
        weights = np.array([
            len(sub_y) / (2.0 * max(int((sub_y == lab).sum()), 1)) for lab in sub_y
        ])
    else:
        weights = np.ones(len(subtrain_idx))
    weight_sum = float(weights.sum()) or 1.0

    def expectations_for(rows: np.ndarray, theta_now: np.ndarray) -> np.ndarray:
        values = _values_matrix(len(rows), index, columns(rows), train_pos, theta_now)
        if noise_spec.is_exact:
            return program.expectations(values, observable)
        states = program.states(values)
        estimates, _ = noisy_expectations(states, observable, circuit.n_qubits, noise_spec, noise_rng, cancel)
        return estimates

    def mse(rows: np.ndarray, theta_now: np.ndarray) -> float:
        if not len(rows):
            return 0.0
        e = expectations_for(rows, theta_now)
        return float(np.mean((e - y_signed[rows]) ** 2))

    def sign_accuracy(rows: np.ndarray, theta_now: np.ndarray) -> float:
        if not len(rows):
            return 0.0
        e = expectations_for(rows, theta_now)
        return float((np.sign(e) == y_signed[rows]).mean())

    history: list[dict[str, Any]] = []
    m_avg = np.zeros_like(theta)
    v_avg = np.zeros_like(theta)
    best_loss = float("inf")
    best_theta = theta.copy()
    best_epoch = 0

    def consider(theta_now: np.ndarray, epoch_label: int) -> float:
        nonlocal best_loss, best_theta, best_epoch
        sel = mse(selection_rows, theta_now)
        if sel < best_loss:
            best_loss, best_theta, best_epoch = sel, theta_now.copy(), epoch_label
        return sel

    for epoch in range(epochs):
        check_cancel(cancel)
        rows = subtrain_idx
        values = _values_matrix(len(rows), index, columns(rows), train_pos, theta)
        expectations_exact, grads = program.value_and_grad(values, observable)
        if noise_spec.is_exact:
            expectations = expectations_exact
        else:
            expectations = expectations_for(rows, theta)
            grads = grads * grad_scale
            if grad_shot_var > 0:
                grads = grads + noise_rng.normal(0.0, float(np.sqrt(grad_shot_var)), size=grads.shape)
        residuals = expectations - y_signed[rows]
        loss = float(np.sum(weights * residuals ** 2) / weight_sum)
        train_grad = np.array([
            float(np.sum(2.0 * weights * residuals * grads[:, index[name]]) / weight_sum)
            for name in train_names
        ])
        train_accuracy = float((np.sign(expectations) == y_signed[rows]).mean()) if len(rows) else 0.0
        sel_loss = consider(theta, epoch)
        history.append({
            "epoch": epoch,
            "loss": loss,
            "train_accuracy": train_accuracy,
            "val_loss": sel_loss if len(val_idx) else None,
            "val_accuracy": sign_accuracy(val_idx, theta) if len(val_idx) else None,
            "test_accuracy": sign_accuracy(test_idx, theta),
        })
        report(progress, (epoch + 1) / epochs, f"Epoch {epoch + 1} of {epochs}: loss {loss:.4f}")
        step = epoch + 1
        m_avg = 0.9 * m_avg + 0.1 * train_grad
        v_avg = 0.999 * v_avg + 0.001 * train_grad ** 2
        m_hat = m_avg / (1.0 - 0.9 ** step)
        v_hat = v_avg / (1.0 - 0.999 ** step)
        theta = theta - float(learning_rate) * m_hat / (np.sqrt(v_hat) + 1e-8)

    consider(theta, len(history))
    theta = best_theta

    train_scores = expectations_for(train_idx, theta)
    test_scores = expectations_for(test_idx, theta)
    threshold, threshold_train_accuracy = select_threshold(train_scores, y_signed[train_idx])

    def calibrated_accuracy(scores: np.ndarray, rows: np.ndarray) -> float:
        if not len(rows):
            return 0.0
        return float(((scores >= threshold) == (y_signed[rows] > 0)).mean())

    final_train_loss = float(np.mean((train_scores - y_signed[train_idx]) ** 2)) if len(train_idx) else 0.0
    final_test_loss = float(np.mean((test_scores - y_signed[test_idx]) ** 2)) if len(test_idx) else 0.0
    sign_train = float((np.sign(train_scores) == y_signed[train_idx]).mean()) if len(train_idx) else 0.0
    sign_test = float((np.sign(test_scores) == y_signed[test_idx]).mean()) if len(test_idx) else 0.0

    notes = [
        "Full-batch Adam on the exact adjoint gradient of <O> (MSE to signed labels); "
        f"best theta restored by {selection_name} (epoch {best_epoch}); deployed prediction "
        f"is +1 iff <O> >= {threshold:.4f} (threshold fit on train split only). "
        "Synthetic binary benchmark; accuracies are not a quantum advantage claim.",
    ]
    if class_weight == "balanced":
        notes.append("MSE reweighted by inverse class frequency on the optimization rows.")
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
        "n_subtrain": int(len(subtrain_idx)),
        "n_val": int(len(val_idx)),
        "data_params": list(data_names),
        "trainable_params": list(train_names),
        "observable": observable.to_text(),
        "epochs": epochs,
        "epochs_run": int(len(history)),
        "learning_rate": float(learning_rate),
        "optimizer": "adam",
        "val_fraction": float(val_fraction),
        "class_weight": class_weight,
        "selection": selection_name,
        "best_epoch": int(best_epoch),
        "best_selection_loss": float(best_loss),
        "threshold": float(threshold),
        "threshold_train_accuracy": float(threshold_train_accuracy),
        "sign_train_accuracy": sign_train,
        "sign_test_accuracy": sign_test,
        "initial_parameters": {name: float(theta0[train_pos[name]]) for name in train_names},
        "final_parameters": {name: float(theta[train_pos[name]]) for name in train_names},
        "initial_loss": history[0]["loss"] if history else None,
        "final_loss": final_train_loss,
        "final_train_accuracy": calibrated_accuracy(train_scores, train_idx),
        "final_test_accuracy": calibrated_accuracy(test_scores, test_idx),
        "final_test_loss": final_test_loss,
        "history": history,
        "n_qubits": circuit.n_qubits,
        "backend": program.backend,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
        "notes": notes,
    }
