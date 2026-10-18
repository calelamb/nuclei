"""Validation and clamping of ``trainability_start`` settings (spec 5.6)."""

from __future__ import annotations

import math
from typing import Any

from kernel.trainability._errors import TrainabilityError

ANALYSES = ("gradients", "scaling", "lie", "expressibility", "entanglement", "landscape")
INITS = ("uniform", "small")
METHODS = ("auto", "sampling", "ppe")
BACKENDS = ("auto", "numpy", "cupy", "jax")

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

DEFAULT_SCALING_QUBITS = (2, 3, 4, 5, 6)
DEFAULT_SCALING_LAYERS = (4,)


def _bad(path: str, message: str) -> TrainabilityError:
    return TrainabilityError("invalid_request", f"settings.{path}: {message}")


def _clamp(value: float, bounds: tuple[float, float]) -> float:
    return min(max(value, bounds[0]), bounds[1])


def _int(raw: Any, path: str, default: int, bounds: tuple[int, int]) -> int:
    if raw is None:
        return default
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw):
        raise _bad(path, "must be a number")
    return int(_clamp(int(raw), bounds))


def _float(raw: Any, path: str, default: float, bounds: tuple[float, float]) -> float:
    if raw is None:
        return default
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw):
        raise _bad(path, "must be a finite number")
    return float(_clamp(float(raw), bounds))


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


def _identifier(raw: Any, path: str, default: str) -> str:
    if raw is None:
        return default
    if not isinstance(raw, str) or not raw.isidentifier() or len(raw) > 64:
        raise _bad(path, "must be a Python identifier")
    return raw


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
