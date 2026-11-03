"""Variational classifier training: a QNN fit end to end, in the Lab.

The user's circuit mixes *data* parameters (bound per-sample to dataset
features) with *trainable* parameters (optimized).  Data parameters are the
``x``-prefixed circuit parameters unless an explicit ``data_params`` list is
given; every remaining parameter is trainable.

The model score is ``<O>`` for the job's observable, the loss is the
mean squared error against signed labels ``y in {-1, +1}``, and prediction
is ``sign(<O>)``.  Gradients are the exact batched adjoint gradients of
``<O>`` (``KernelProgram.value_and_grad``) chained through the loss by
default, or parameter-shift gradients when ``gradient_method`` requests
them.  Optimization is full-batch Adam (Kingma & Ba 2015), plain gradient
descent, or SPSA, deterministic given the seed.
"""

from __future__ import annotations

import time
from typing import Any, Callable, Sequence

import numpy as np

from kernel.trainability._analysis_common import AnalysisError, check_cancel, report
from kernel.trainability.compiler import MAX_STATEVECTOR_QUBITS, compile_circuit
from kernel.trainability.ir import IrError, ParamCircuit, ParamRef
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
from kernel.trainability.reference import REFERENCE_MAX_QUBITS
from kernel.trainability.statevector import parameter_shift_grad

__all__ = ["variational_train", "resolve_data_params"]

Progress = Callable[[float, str], None] | None
Cancel = Callable[[], bool] | None


def resolve_data_params(circuit: ParamCircuit, data_params: Sequence[str] | None) -> list[str]:
    """Data-parameter names: the explicit list, else the ``x``-prefixed parameters."""
    if data_params:
        unknown = [p for p in data_params if p not in circuit.parameters]
        if unknown:
            raise AnalysisError(
                "qml_dataset_mismatch",
                f"data_params not in the circuit: {', '.join(unknown)}",
            )
        return list(data_params)
    return [p for p in circuit.parameters if p.startswith("x")]


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


_OPTIMIZERS = ("adam", "gd", "spsa")
_GRADIENT_METHODS = ("adjoint", "parameter_shift")
_EARLY_STOP_MIN_DELTA = 1e-4


def variational_train(
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
    seed: int = 0,
    progress: Progress = None,
    cancel: Cancel = None,
    backend: str = "auto",
    optimizer: str = "adam",
    gradient_method: str = "adjoint",
    early_stop_patience: int = 0,
    spsa_a: float = 0.05,
    spsa_c: float = 0.1,
    # ``noise`` above is the *dataset* noise (historical name); the simulated
    # device channel travels separately as ``channel_noise``.
    channel_noise: NoiseSpec | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Train the trainable parameters on a built-in binary dataset (MSE loss).

    ``optimizer`` is ``adam`` | ``gd`` | ``spsa``; ``gradient_method`` is
    ``adjoint`` | ``parameter_shift`` (SPSA estimates its own gradient and
    ignores ``gradient_method``).  ``channel_noise`` carries the simulated
    channel from :mod:`kernel.trainability.noise`.
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
            "or list them in settings.variational.data_params",
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
    if optimizer not in _OPTIMIZERS:
        raise AnalysisError("invalid_request", f"optimizer must be one of {', '.join(_OPTIMIZERS)}, got {optimizer!r}")
    if gradient_method not in _GRADIENT_METHODS:
        raise AnalysisError(
            "invalid_request", f"gradient_method must be one of {', '.join(_GRADIENT_METHODS)}, got {gradient_method!r}"
        )
    if isinstance(early_stop_patience, bool) or not isinstance(early_stop_patience, (int, np.integer)):
        raise AnalysisError("invalid_request", "early_stop_patience must be an integer in [0, 100]")
    if not (0 <= int(early_stop_patience) <= 100):
        raise AnalysisError("invalid_request", "early_stop_patience must be in [0, 100]")
    early_stop_patience = int(early_stop_patience)
    for _name, _val in (("spsa_a", spsa_a), ("spsa_c", spsa_c)):
        if isinstance(_val, bool) or not isinstance(_val, (int, float)) or not (0.0 < float(_val) <= 2.0):
            raise AnalysisError("invalid_request", f"{_name} must be a finite number in (0, 2]")
    spsa_a, spsa_c = float(spsa_a), float(spsa_c)
    noise_spec = coerce_noise(channel_noise)
    if gradient_method == "parameter_shift" and optimizer != "spsa":
        if circuit.n_qubits > REFERENCE_MAX_QUBITS:
            raise AnalysisError(
                "unsupported_gradient_method",
                f"parameter_shift uses the reference oracle (<= {REFERENCE_MAX_QUBITS} qubits); "
                f"this circuit has {circuit.n_qubits} — use gradient_method 'adjoint'",
            )
        for _gate in circuit.gates:
            if _gate.name == "U" and any(isinstance(a, ParamRef) for a in _gate.angles):
                raise AnalysisError(
                    "unsupported_gradient_method",
                    "parameter_shift cannot shift the multi-angle U gate exactly; use gradient_method 'adjoint'",
                )

    started = time.monotonic()
    program = compile_circuit(circuit, backend=backend)
    index = circuit.param_index()
    order = {name: i for i, name in enumerate(data_names)}
    train_pos = {name: j for j, name in enumerate(train_names)}
    train_idx, test_idx = split_dataset(data, train_fraction, seed)
    x_all = data["X"]
    y_signed = data["y_signed"]

    def columns(rows: np.ndarray) -> dict[str, np.ndarray]:
        return {name: x_all[rows, order[name]] for name in data_names}

    rng = np.random.default_rng(seed)
    theta = rng.uniform(0.0, 2.0 * np.pi, len(train_names))
    theta0 = theta.copy()
    m_avg = np.zeros_like(theta)
    v_avg = np.zeros_like(theta)
    history: list[dict[str, Any]] = []
    # Independent seeded streams so the exact (noiseless) path is bit-identical
    # to the pre-noise implementation and SPSA draws do not perturb init.
    noise_rng = np.random.default_rng((int(seed) + 1_000_003) % (2**63))
    spsa_rng = np.random.default_rng((int(seed) + 2_000_003) % (2**63))
    grad_scale = expectation_scale(observable, noise_spec)
    grad_shot_var = (
        shot_variance_numerator(observable) / float(noise_spec.shots) if noise_spec.shots > 0 else 0.0
    )

    def expectations_for(rows: np.ndarray, theta_now: np.ndarray) -> np.ndarray:
        values = _values_matrix(len(rows), index, columns(rows), train_pos, theta_now)
        if noise_spec.is_exact:
            return program.expectations(values, observable)
        states = program.states(values)
        estimates, _ = noisy_expectations(states, observable, circuit.n_qubits, noise_spec, noise_rng, cancel)
        return estimates

    def evaluate(rows: np.ndarray, theta_now: np.ndarray) -> tuple[float, float]:
        expectations = expectations_for(rows, theta_now)
        loss = float(np.mean((expectations - y_signed[rows]) ** 2))
        accuracy = float((np.sign(expectations) == y_signed[rows]).mean()) if len(rows) else 0.0
        return loss, accuracy

    best_loss = float("inf")
    bad_epochs = 0
    stopped_early = False
    for epoch in range(epochs):
        check_cancel(cancel)
        rows = train_idx
        if optimizer == "spsa":
            loss, train_accuracy = evaluate(rows, theta)
            _, test_accuracy = evaluate(test_idx, theta)
            history.append({
                "epoch": epoch, "loss": loss,
                "train_accuracy": train_accuracy, "test_accuracy": test_accuracy,
            })
            report(progress, (epoch + 1) / epochs, f"Epoch {epoch + 1} of {epochs}: loss {loss:.4f}")
            if early_stop_patience > 0:
                if loss < best_loss - _EARLY_STOP_MIN_DELTA:
                    best_loss, bad_epochs = loss, 0
                else:
                    bad_epochs += 1
                    if bad_epochs >= early_stop_patience:
                        stopped_early = True
                        break
            elif loss < best_loss:
                best_loss = loss
            check_cancel(cancel)
            step = epoch + 1
            delta = (spsa_rng.integers(0, 2, size=len(theta)) * 2 - 1).astype(np.float64)
            a_k = spsa_a / (step ** 0.602)
            c_k = spsa_c / (step ** 0.101)
            loss_plus, _ = evaluate(rows, theta + c_k * delta)
            loss_minus, _ = evaluate(rows, theta - c_k * delta)
            grad_hat = ((loss_plus - loss_minus) / (2.0 * c_k)) * delta
            theta = theta - a_k * grad_hat
            continue
        values = _values_matrix(len(rows), index, columns(rows), train_pos, theta)
        if gradient_method == "parameter_shift":
            if noise_spec.is_exact:
                expectations = program.expectations(values, observable)
            else:
                expectations = expectations_for(rows, theta)
            grad_rows = np.stack([
                parameter_shift_grad(circuit, values[i], observable) for i in range(len(rows))
            ]) if len(rows) else np.zeros((0, len(index)))
            grads = grad_rows
        else:
            expectations_exact, grads = program.value_and_grad(values, observable)
            if noise_spec.is_exact:
                expectations = expectations_exact
            else:
                expectations = expectations_for(rows, theta)
                grads = grads * grad_scale
                if grad_shot_var > 0:
                    grads = grads + noise_rng.normal(0.0, float(np.sqrt(grad_shot_var)), size=grads.shape)
        if gradient_method == "parameter_shift" and not noise_spec.is_exact:
            grads = grads * grad_scale
            if grad_shot_var > 0:
                grads = grads + noise_rng.normal(0.0, float(np.sqrt(grad_shot_var)), size=grads.shape)
        residuals = expectations - y_signed[rows]
        loss = float(np.mean(residuals ** 2))
        # d loss / d theta_j = mean_i 2 (e_i - y_i) de_i/dtheta_j (trainable columns only)
        train_grad = np.array([
            float(np.mean(2.0 * residuals * grads[:, index[name]])) for name in train_names
        ])
        train_accuracy = float((np.sign(expectations) == y_signed[rows]).mean())
        _, test_accuracy = evaluate(test_idx, theta)
        history.append({
            "epoch": epoch,
            "loss": loss,
            "train_accuracy": train_accuracy,
            "test_accuracy": test_accuracy,
        })
        report(progress, (epoch + 1) / epochs, f"Epoch {epoch + 1} of {epochs}: loss {loss:.4f}")
        if early_stop_patience > 0:
            if loss < best_loss - _EARLY_STOP_MIN_DELTA:
                best_loss, bad_epochs = loss, 0
            else:
                bad_epochs += 1
                if bad_epochs >= early_stop_patience:
                    stopped_early = True
                    break
        elif loss < best_loss:
            best_loss = loss
        step = epoch + 1
        if optimizer == "gd":
            theta = theta - learning_rate * train_grad
        else:  # adam
            m_avg = 0.9 * m_avg + 0.1 * train_grad
            v_avg = 0.999 * v_avg + 0.001 * train_grad ** 2
            m_hat = m_avg / (1.0 - 0.9 ** step)
            v_hat = v_avg / (1.0 - 0.999 ** step)
            theta = theta - learning_rate * m_hat / (np.sqrt(v_hat) + 1e-8)

    stopped_early = bool(stopped_early and len(history) < epochs)
    final_train_loss, final_train_accuracy = evaluate(train_idx, theta)
    final_test_loss, final_test_accuracy = evaluate(test_idx, theta)
    if optimizer == "spsa":
        _opt_note = (
            "Full-batch SPSA (2 loss evaluations per epoch, seeded Rademacher perturbations, "
            f"gains a_k={spsa_a}/k^0.602, c_k={spsa_c}/k^0.101); prediction is sign(<O>)."
        )
    elif optimizer == "gd":
        _opt_note = f"Full-batch gradient descent on the {gradient_method} gradient of <O>; prediction is sign(<O>)."
    elif gradient_method == "parameter_shift":
        _opt_note = "Full-batch Adam on parameter-shift gradients of <O>; prediction is sign(<O>)."
    else:
        _opt_note = "Full-batch Adam on the exact adjoint gradient of <O>; prediction is sign(<O>)."
    notes = [
        _opt_note + " Synthetic binary benchmark (features in [0, 2pi)); accuracies are not a quantum advantage claim.",
    ]
    if gradient_method == "parameter_shift" and optimizer == "spsa":
        notes.append("SPSA estimates its own gradient, so gradient_method 'parameter_shift' does not affect the update.")
    if stopped_early:
        notes.append(f"Early stopping after {len(history)} of {epochs} epochs (patience {early_stop_patience}).")
    if not noise_spec.is_exact:
        notes.append(NOISE_NOTE)
    return {
        "dataset": data["name"],
        "n_samples": data["n_samples"],
        "n_features": data["n_features"],
        "noise": data["noise"],
        # ``noise`` above is the legacy dataset-noise float, so the simulated
        # channel echo lives under ``channel_noise`` (settings side: ``noise``).
        "channel_noise": noise_spec.echo(),
        "n_train": int(len(train_idx)),
        "n_test": int(len(test_idx)),
        "data_params": list(data_names),
        "trainable_params": list(train_names),
        "observable": observable.to_text(),
        "epochs": epochs,
        "epochs_run": int(len(history)),
        "stopped_early": bool(stopped_early),
        "learning_rate": float(learning_rate),
        "optimizer": optimizer,
        "gradient_method": gradient_method,
        "spsa_a": float(spsa_a),
        "spsa_c": float(spsa_c),
        "early_stop_patience": int(early_stop_patience),
        "initial_parameters": {name: float(theta0[train_pos[name]]) for name in train_names},
        "final_parameters": {name: float(theta[train_pos[name]]) for name in train_names},
        "initial_loss": history[0]["loss"] if history else None,
        "final_loss": final_train_loss,
        "final_train_accuracy": final_train_accuracy,
        "final_test_accuracy": final_test_accuracy,
        "final_test_loss": final_test_loss,
        "history": history,
        "n_qubits": circuit.n_qubits,
        "backend": program.backend,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
        "notes": notes,
    }
