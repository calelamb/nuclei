"""Variational training with quantum natural gradient (QNG) preconditioning.

Same model, loss and data binding as ``qml_train.variational_train`` (MSE
against signed labels, prediction ``sign(<O>)``, exact adjoint gradients),
but the update is preconditioned by the Fubini-Study metric -- the real
part of the quantum geometric tensor, averaged over the train batch
(Stokes et al., Quantum 4, 269):

    theta <- theta - eta (g + lambda I)^{-1} grad L,
    g_ij = Re[<d_i psi|d_j psi> - <d_i psi|psi><psi|d_j psi>].

State derivatives come from the parameter-shift rule on states, exact for
Pauli-generated rotations (the same caveat tandem documents for its
parameter-shift gradients; a parameter used with several different
``ParamRef`` coefficients falls back to a unit-coefficient shift).  Every
linear-solve fallback (``lstsq``, then a plain gradient step) is counted
in the result -- never silent.  Under a simulated channel the loss
gradient follows tandem's ``expectation_scale`` handling while the metric
is computed on exact states (scoped, like ``noise.py``'s v1 scope).
"""

from __future__ import annotations

import time
from typing import Any, Callable, Sequence

import numpy as np

from kernel.trainability._analysis_common import AnalysisError, check_cancel, report
from kernel.trainability.compiler import MAX_STATEVECTOR_QUBITS, KernelProgram, compile_circuit
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
from kernel.trainability.qml_train import resolve_data_params

__all__ = ["variational_qng", "fubini_study_metric"]

Progress = Callable[[float, str], None] | None
Cancel = Callable[[], bool] | None

_COND_LIMIT = 1e12


def _param_coeffs(circuit: ParamCircuit) -> dict[str, float]:
    """Uniform ``ParamRef`` coefficient per parameter (1.0 if mixed/absent)."""
    seen: dict[str, set[float]] = {}
    for gate in circuit.gates:
        for angle in gate.angles:
            if isinstance(angle, ParamRef):
                seen.setdefault(angle.name, set()).add(float(angle.coeff))
    out: dict[str, float] = {}
    for name in circuit.parameters:
        coeffs = seen.get(name, set())
        out[name] = next(iter(coeffs)) if len(coeffs) == 1 else 1.0
    return out


def _metric_from_program(
    program: KernelProgram, circuit: ParamCircuit,
    values: np.ndarray, param_indices: Sequence[int],
) -> np.ndarray:
    values = np.asarray(values, dtype=np.float64)
    coeffs = _param_coeffs(circuit)
    names = circuit.parameters
    states = program.states(values)
    derivatives: list[np.ndarray] = []
    for idx in param_indices:
        coeff = coeffs.get(names[idx], 1.0) or 1.0
        angle_shift = np.pi / 2.0
        shift = angle_shift / coeff
        plus = values.copy()
        plus[:, idx] += shift
        minus = values.copy()
        minus[:, idx] -= shift
        # For a Pauli rotation exp(-i a P/2), psi(a+s) - psi(a-s) is
        # -2i sin(s/2) P psi, so d psi/d theta is the difference scaled by
        # coeff / (4 sin(s/2)) -- unlike the observable shift rule's /2.
        scale = coeff / (4.0 * np.sin(angle_shift / 2.0))
        derivatives.append(scale * (program.states(plus) - program.states(minus)))
    m = len(derivatives)
    metric = np.zeros((m, m))
    if m == 0 or values.shape[0] == 0:
        return metric
    deriv = np.stack(derivatives)  # (m, B, D)
    overlaps = np.einsum("ibd,bd->ib", deriv.conj(), states)  # <d_i psi|psi>
    gram = np.einsum("ibd,jbd->bij", deriv.conj(), deriv)
    # <d_i|psi><psi|d_j> = overlaps_i * conj(overlaps_j)
    projector = overlaps.transpose(1, 0)[:, :, None] * overlaps.conj().transpose(1, 0)[:, None, :]
    per_sample = np.real(gram - projector)
    metric = per_sample.mean(axis=0)
    return 0.5 * (metric + metric.T)


def fubini_study_metric(
    circuit: ParamCircuit,
    values: np.ndarray,
    *,
    param_indices: Sequence[int] | None = None,
    backend: str = "auto",
) -> np.ndarray:
    """Batch-averaged Fubini-Study metric at ``values`` (rows = samples)."""
    values = np.asarray(values, dtype=np.float64)
    if values.ndim == 1:
        values = values[None, :]
    indices = list(range(len(circuit.parameters))) if param_indices is None else list(param_indices)
    program = compile_circuit(circuit, backend=backend)
    return _metric_from_program(program, circuit, values, indices)


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


def variational_qng(
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
    metric_regularization: float = 1e-3,
    metric_every: int = 1,
    max_metric_params: int = 32,
    seed: int = 0,
    progress: Progress = None,
    cancel: Cancel = None,
    backend: str = "auto",
    channel_noise: NoiseSpec | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Train like ``variational_train`` with a natural-gradient update rule."""
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
    if not (metric_regularization >= 0):
        raise AnalysisError("invalid_request", "metric_regularization must be >= 0")
    if metric_every < 1:
        raise AnalysisError("invalid_request", "metric_every must be >= 1")
    if max_metric_params < 1:
        raise AnalysisError("invalid_request", "max_metric_params must be >= 1")
    if len(train_names) > int(max_metric_params):
        raise AnalysisError(
            "qml_metric_too_large",
            f"{len(train_names)} trainable parameters exceed the metric cap of "
            f"{int(max_metric_params)} (a full Fubini-Study metric costs 2m state batches)",
        )
    noise_spec = coerce_noise(channel_noise)
    started = time.monotonic()
    check_cancel(cancel)
    program = compile_circuit(circuit, backend=backend)
    index = circuit.param_index()
    order = {name: i for i, name in enumerate(data_names)}
    train_pos = {name: j for j, name in enumerate(train_names)}
    train_indices = [index[name] for name in train_names]
    train_idx, test_idx = split_dataset(data, train_fraction, seed)
    x_all = data["X"]
    y_signed = data["y_signed"]

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

    history: list[dict[str, Any]] = []
    fallbacks = 0
    metric = np.eye(len(train_names)) * 0.25
    metric_eigs = np.full(len(train_names), 0.25)
    lam = float(metric_regularization)

    for epoch in range(epochs):
        check_cancel(cancel)
        rows = train_idx
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
        loss = float(np.mean(residuals ** 2))
        train_grad = np.array([
            float(np.mean(2.0 * residuals * grads[:, index[name]])) for name in train_names
        ])
        train_accuracy = float((np.sign(expectations) == y_signed[rows]).mean())
        _, test_accuracy = evaluate(test_idx, theta)

        if epoch % int(metric_every) == 0:
            metric = _metric_from_program(program, circuit, values, train_indices)
            metric_eigs = np.linalg.eigvalsh(metric)[::-1]
        regularized = metric + lam * np.eye(len(train_names))
        reg_eigs = np.clip(metric_eigs, 0.0, None) + lam
        condition = float(reg_eigs[0] / reg_eigs[-1]) if reg_eigs[-1] > 0 else float("inf")

        step_vec: np.ndarray | None = None
        if np.isfinite(condition) and condition <= _COND_LIMIT:
            try:
                step_vec = np.linalg.solve(regularized, train_grad)
            except np.linalg.LinAlgError:
                step_vec = None
        if step_vec is None or not np.all(np.isfinite(step_vec)):
            fallbacks += 1
            try:
                step_vec = np.linalg.lstsq(regularized, train_grad, rcond=None)[0]
            except np.linalg.LinAlgError:
                step_vec = train_grad.copy()
            if not np.all(np.isfinite(step_vec)):
                step_vec = train_grad.copy()

        history.append({
            "epoch": epoch,
            "loss": loss,
            "train_accuracy": train_accuracy,
            "test_accuracy": test_accuracy,
            "grad_norm": float(np.linalg.norm(train_grad)),
            "natural_grad_norm": float(np.linalg.norm(step_vec)),
            "metric_condition": condition if np.isfinite(condition) else None,
        })
        report(progress, (epoch + 1) / epochs, f"Epoch {epoch + 1} of {epochs}: loss {loss:.4f}")
        theta = theta - float(learning_rate) * step_vec

    final_train_loss, final_train_accuracy = evaluate(train_idx, theta)
    final_test_loss, final_test_accuracy = evaluate(test_idx, theta)
    clipped = np.clip(metric_eigs, 0.0, None)
    total = float(clipped.sum())
    metric_eff_dim = float((total * total) / float((clipped ** 2).sum())) if total > 0 else 0.0

    notes = [
        "Quantum natural gradient on the exact adjoint gradient of <O>; prediction "
        "is sign(<O>). Synthetic binary benchmark; accuracies are not a quantum "
        "advantage claim.",
        "Fubini-Study metric by parameter-shift on states (exact for "
        "Pauli-generated rotations; a parameter with mixed ParamRef coefficients "
        "uses a unit-coefficient shift).",
    ]
    if fallbacks:
        notes.append(f"{fallbacks} epoch(s) fell back from the metric solve (lstsq or plain gradient step).")
    if not noise_spec.is_exact:
        notes.append("Metric computed on exact states; only the loss gradient carries the channel. " + NOISE_NOTE)
    return {
        "dataset": data["name"],
        "n_samples": data["n_samples"],
        "n_features": data["n_features"],
        "noise": data["noise"],
        "channel_noise": noise_spec.echo(),
        "n_train": int(len(train_idx)),
        "n_test": int(len(test_idx)),
        "data_params": list(data_names),
        "trainable_params": list(train_names),
        "observable": observable.to_text(),
        "epochs": epochs,
        "epochs_run": int(len(history)),
        "learning_rate": float(learning_rate),
        "optimizer": "qng",
        "metric_regularization": lam,
        "metric_every": int(metric_every),
        "max_metric_params": int(max_metric_params),
        "initial_parameters": {name: float(theta0[train_pos[name]]) for name in train_names},
        "final_parameters": {name: float(theta[train_pos[name]]) for name in train_names},
        "initial_loss": history[0]["loss"] if history else None,
        "final_loss": final_train_loss,
        "final_train_accuracy": final_train_accuracy,
        "final_test_accuracy": final_test_accuracy,
        "final_test_loss": final_test_loss,
        "history": history,
        "metric_eigenvalues": [float(v) for v in metric_eigs],
        "metric_effective_dimension": metric_eff_dim,
        "fallbacks": int(fallbacks),
        "n_qubits": circuit.n_qubits,
        "backend": program.backend,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
        "notes": notes,
    }
