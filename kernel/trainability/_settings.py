"""Validation and clamping of ``trainability_start`` settings (spec 5.6)."""

from __future__ import annotations

import math
from typing import Any

from kernel.trainability._errors import TrainabilityError

ANALYSES = ("gradients", "scaling", "lie", "expressibility", "entanglement", "landscape", "quantum_kernel", "variational_train")
INITS = ("uniform", "small")
METHODS = ("auto", "sampling", "ppe")
BACKENDS = ("auto", "numpy", "cupy", "jax")
QML_DATASETS = ("moons", "circles", "blobs", "xor")
OPTIMIZERS = ("adam", "gd", "spsa")
GRADIENT_METHODS = ("adjoint", "parameter_shift")

SAMPLES_RANGE = (16, 4096)
PAIRS_RANGE = (100, 20000)
BINS_RANGE = (10, 200)
ENTANGLEMENT_SAMPLES_RANGE = (16, 20000)
RESOLUTION_RANGE = (11, 81)
SPAN_RANGE = (0.1, 4.0 * math.pi)
QUBITS_RANGE = (2, 128)
LAYERS_RANGE = (1, 64)
MAX_SCALING_QUBIT_VALUES = 12
MAX_SCALING_LAYER_VALUES = 4
MAX_DIMENSION_RANGE = (1, 16384)
TIME_BUDGET_RANGE = (0.5, 120.0)
SEED_RANGE = (0, 2**63 - 1)
QML_SAMPLES_RANGE = (8, 200)
QML_NOISE_RANGE = (0.0, 0.5)
TRAIN_FRACTION_RANGE = (0.5, 0.9)
RIDGE_RANGE = (1e-4, 100.0)
EPOCHS_RANGE = (1, 500)
LEARNING_RATE_RANGE = (1e-4, 2.0)
EARLY_STOP_RANGE = (0, 100)
SPSA_A_RANGE = (0.001, 2.0)
SPSA_C_RANGE = (0.001, 2.0)
NOISE_SHOTS_MIN = 32
NOISE_SHOTS_MAX = 100_000
NOISE_P_MAX = 0.5

DEFAULT_SCALING_QUBITS = (2, 3, 4, 5, 6)
DEFAULT_SCALING_LAYERS = (4,)


def _bad(path: str, message: str) -> TrainabilityError:
    return TrainabilityError("invalid_request", f"settings.{path}: {message}")


def _clamp(value: float, bounds: tuple[float, float]) -> float:
    return min(max(value, bounds[0]), bounds[1])


def _is_finite_number(raw: Any) -> bool:
    """A real, finite number.  Never raises: ``math.isfinite(10**400)`` overflows."""
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return False
    return isinstance(raw, int) or math.isfinite(raw)


def _int(raw: Any, path: str, default: int, bounds: tuple[int, int]) -> int:
    if raw is None:
        return default
    if not _is_finite_number(raw):
        raise _bad(path, "must be a number")
    return int(_clamp(int(raw), bounds))


def _float(raw: Any, path: str, default: float, bounds: tuple[float, float]) -> float:
    if raw is None:
        return default
    if not _is_finite_number(raw):
        raise _bad(path, "must be a finite number")
    try:
        return float(_clamp(float(raw), bounds))
    except OverflowError:  # an integer beyond float range: clamp it as an integer
        return float(_clamp(raw, bounds))


def _choice(raw: Any, path: str, default: str, allowed: tuple[str, ...]) -> str:
    if raw is None:
        return default
    if raw not in allowed:
        raise _bad(path, f"must be one of {', '.join(allowed)}")
    return raw


def _section(raw: dict, key: str) -> dict:
    value = raw.get(key)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise _bad(key, "must be an object")
    return value


def _int_list(raw: Any, path: str, default: tuple[int, ...], bounds: tuple[int, int], limit: int) -> list[int]:
    if raw is None:
        return list(default)
    if not isinstance(raw, list) or not raw:
        raise _bad(path, "must be a non-empty array of integers")
    values = [_int(v, f"{path}[]", 0, bounds) for v in raw]
    return sorted(set(values))[:limit]


def _identifier_list(raw: Any, path: str) -> list[str] | None:
    if raw is None:
        return None
    if not isinstance(raw, list) or not all(isinstance(v, str) and v.isidentifier() and len(v) <= 64 for v in raw):
        raise _bad(path, "must be an array of Python identifiers")
    return list(raw)


def _identifier(raw: Any, path: str, default: str) -> str:
    if raw is None:
        return default
    if not isinstance(raw, str) or not raw.isidentifier() or len(raw) > 64:
        raise _bad(path, "must be a Python identifier")
    return raw


def _noise_shots(raw: Any) -> int:
    if raw is None:
        return 0
    if not _is_finite_number(raw):
        raise _bad("noise.shots", "must be an integer (0 for exact, or 32..100000)")
    value = int(raw)
    if value == 0:
        return 0
    if 1 <= value <= 31:
        raise _bad("noise.shots", "must be 0 (exact) or in [32, 100000]; use 0 for exact expectations")
    if value < 0:
        raise _bad("noise.shots", "must be 0 (exact) or in [32, 100000]")
    return min(value, NOISE_SHOTS_MAX)


def _noise_probability(raw: Any, path: str) -> float:
    if raw is None:
        return 0.0
    if not _is_finite_number(raw):
        raise _bad(path, "must be a finite number in [0, 0.5]")
    try:
        value = float(raw)
    except OverflowError:
        raise _bad(path, "must be in [0, 0.5]") from None
    if not (0.0 <= value <= NOISE_P_MAX):
        raise _bad(path, "must be in [0, 0.5]")
    return value


def normalize_settings(raw: Any) -> dict[str, Any]:
    """Return the complete, clamped settings that the job will actually use."""
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise TrainabilityError("invalid_request", "`settings` must be an object.")
    scaling = _section(raw, "scaling")
    expr = _section(raw, "expressibility")
    ent = _section(raw, "entanglement")
    land = _section(raw, "landscape")
    lie = _section(raw, "lie")
    qml = _section(raw, "qml")
    kernel_sec = _section(raw, "kernel")
    variational = _section(raw, "variational")
    noise_sec = _section(raw, "noise")
    qubit_param = _identifier(scaling.get("qubit_param"), "scaling.qubit_param", "n_qubits")
    layer_param = _identifier(scaling.get("layer_param"), "scaling.layer_param", "n_layers")
    if qubit_param == layer_param:
        raise _bad("scaling", "qubit_param and layer_param must differ")
    return {
        "samples": _int(raw.get("samples"), "samples", 200, SAMPLES_RANGE),
        "seed": _int(raw.get("seed"), "seed", 0, SEED_RANGE),
        "init": _choice(raw.get("init"), "init", "uniform", INITS),
        "method": _choice(raw.get("method"), "method", "auto", METHODS),
        "backend": _choice(raw.get("backend"), "backend", "auto", BACKENDS),
        "scaling": {
            "qubits": _int_list(
                scaling.get("qubits"), "scaling.qubits", DEFAULT_SCALING_QUBITS, QUBITS_RANGE, MAX_SCALING_QUBIT_VALUES
            ),
            "layers": _int_list(
                scaling.get("layers"), "scaling.layers", DEFAULT_SCALING_LAYERS, LAYERS_RANGE, MAX_SCALING_LAYER_VALUES
            ),
            "qubit_param": qubit_param,
            "layer_param": layer_param,
        },
        "expressibility": {
            "pairs": _int(expr.get("pairs"), "expressibility.pairs", 2000, PAIRS_RANGE),
            "bins": _int(expr.get("bins"), "expressibility.bins", 75, BINS_RANGE),
        },
        "entanglement": {
            "samples": _int(ent.get("samples"), "entanglement.samples", 1000, ENTANGLEMENT_SAMPLES_RANGE),
        },
        "landscape": {
            "resolution": _int(land.get("resolution"), "landscape.resolution", 41, RESOLUTION_RANGE),
            "span": _float(land.get("span"), "landscape.span", math.pi, SPAN_RANGE),
        },
        "lie": {
            "max_dimension": _int(lie.get("max_dimension"), "lie.max_dimension", 4096, MAX_DIMENSION_RANGE),
            "time_budget_s": _float(lie.get("time_budget_s"), "lie.time_budget_s", 10.0, TIME_BUDGET_RANGE),
        },
        "qml": {
            "dataset": _choice(qml.get("dataset"), "qml.dataset", "moons", QML_DATASETS),
            "samples": _int(qml.get("samples"), "qml.samples", 48, QML_SAMPLES_RANGE),
            "noise": _float(qml.get("noise"), "qml.noise", 0.1, QML_NOISE_RANGE),
            "train_fraction": _float(qml.get("train_fraction"), "qml.train_fraction", 0.7, TRAIN_FRACTION_RANGE),
        },
        "kernel": {
            "ridge_lambda": _float(kernel_sec.get("ridge_lambda"), "kernel.ridge_lambda", 1.0, RIDGE_RANGE),
        },
        "variational": {
            "epochs": _int(variational.get("epochs"), "variational.epochs", 60, EPOCHS_RANGE),
            "learning_rate": _float(variational.get("learning_rate"), "variational.learning_rate", 0.1, LEARNING_RATE_RANGE),
            "data_params": _identifier_list(variational.get("data_params"), "variational.data_params"),
            "optimizer": _choice(variational.get("optimizer"), "variational.optimizer", "adam", OPTIMIZERS),
            "gradient_method": _choice(
                variational.get("gradient_method"), "variational.gradient_method", "adjoint", GRADIENT_METHODS
            ),
            "early_stop_patience": _int(
                variational.get("early_stop_patience"), "variational.early_stop_patience", 0, EARLY_STOP_RANGE
            ),
            "spsa_a": _float(variational.get("spsa_a"), "variational.spsa_a", 0.05, SPSA_A_RANGE),
            "spsa_c": _float(variational.get("spsa_c"), "variational.spsa_c", 0.1, SPSA_C_RANGE),
        },
        "noise": {
            "shots": _noise_shots(noise_sec.get("shots")),
            "depolarizing_p": _noise_probability(noise_sec.get("depolarizing_p"), "noise.depolarizing_p"),
            "readout_flip_p": _noise_probability(noise_sec.get("readout_flip_p"), "noise.readout_flip_p"),
        },
    }


def normalize_analyses(raw: Any) -> list[str]:
    """Validate ``analyses``; returns them deduplicated in canonical order."""
    if not isinstance(raw, list) or not raw:
        raise TrainabilityError("invalid_request", "`analyses` must be a non-empty array.")
    unknown = [a for a in raw if a not in ANALYSES]
    if unknown:
        raise TrainabilityError(
            "unknown_analysis",
            f"Unknown analyses: {', '.join(map(str, unknown))}. Valid: {', '.join(ANALYSES)}.",
        )
    return [a for a in ANALYSES if a in raw]
