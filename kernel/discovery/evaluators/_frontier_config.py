"""Config schema, defaults, stages and call plan for ``trainability_frontier`` (addendum B).

The stage rules of the addendum are split between this module and the scorer:

* ``screen``: ``max_sizes = 2`` here (so ``calls`` emits only ``qubits[:2]`` plus the DLA
  probe) and ``max_frontier`` is divided by ``SCREEN_FRONTIER_DIVISOR`` inside the scorer
  (a static stage override cannot divide a user-chosen number).
* ``full``: every qubit size.
* ``confirm``: identical config; the scorer draws the hardness-probe parameter points from
  an independent random stream (see ``STAGE_STREAM`` in ``_frontier_probe``).

``max_sizes`` is not in the addendum's config list: it is the mechanism that lets a static
stage override express "the first two sizes". Its default (6) never truncates ``qubits``.
"""

from __future__ import annotations

from typing import Any

from kernel.trainability.pauli import ObservableError, parse_observable

MAX_QUBIT_SIZES = 6
SCREEN_FRONTIER_DIVISOR = 10
MIN_FRONTIER = 100
DLA_PROBE_MAX = 8

DEFAULT_CONFIG: dict[str, Any] = {
    "qubits": [8, 16, 32, 64],
    "n_layers": 4,
    "observable": "preset:local_z",
    "estimation": {"target_width": 0.02, "max_frontier": 200000, "time_budget_s": 8},
    "dla_probe_qubits": 4,
    "max_parameters_per_qubit": 24,
    "weights": {"trainability": 1.0, "hardness": 0.5},
    "max_sizes": MAX_QUBIT_SIZES,
}

CONFIG_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "qubits": {
            "type": "array", "minItems": 2, "maxItems": MAX_QUBIT_SIZES,
            "items": {"type": "integer", "minimum": 4, "maximum": 128},
        },
        "n_layers": {"type": "integer", "minimum": 1, "maximum": 32},
        "observable": {"type": "string", "minLength": 1},
        "estimation": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "target_width": {"type": "number", "minimum": 1e-6, "maximum": 1},
                "max_frontier": {"type": "integer", "minimum": MIN_FRONTIER, "maximum": 5000000},
                "time_budget_s": {"type": "number", "minimum": 0.05, "maximum": 120},
            },
        },
        "dla_probe_qubits": {"type": "integer", "minimum": 2, "maximum": DLA_PROBE_MAX},
        "max_parameters_per_qubit": {"type": "integer", "minimum": 1, "maximum": 64},
        "weights": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "trainability": {"type": "number", "minimum": 0, "maximum": 100},
                "hardness": {"type": "number", "minimum": 0, "maximum": 100},
            },
        },
        "max_sizes": {"type": "integer", "minimum": 2, "maximum": MAX_QUBIT_SIZES},
    },
}

STAGES: dict[str, dict[str, Any]] = {
    "screen": {"max_sizes": 2},
    "full": {},
    "confirm": {},
}


def validate_extra(config: dict[str, Any]) -> str | None:
    """Cross-field rules: ascending distinct sizes, and an observable valid at every size."""
    sizes = config["qubits"]
    if any(b <= a for a, b in zip(sizes, sizes[1:])):
        return "qubits must be strictly ascending (the scaling fit and the hardness probe use the largest)"
    for n in sorted({*sizes, config["dla_probe_qubits"]}):
        try:
            parse_observable(config["observable"], n)
        except ObservableError as exc:
            return f"observable is invalid at n={n}: {exc}"
    return None


def effective_sizes(config: dict[str, Any]) -> list[int]:
    """The qubit sizes this evaluation scores (``qubits[:max_sizes]``)."""
    return list(config["qubits"][: config["max_sizes"]])


def calls(config: dict[str, Any]) -> list[dict[str, Any]]:
    """One ``build(n, n_layers)`` call per scored size, then one at ``dla_probe_qubits``."""
    sizes = [*effective_sizes(config), config["dla_probe_qubits"]]
    return [{"args": [n, config["n_layers"]], "kwargs": {}} for n in sizes]


def frontier_cap(config: dict[str, Any], stage: str) -> int:
    """``estimation.max_frontier``, ten times smaller on the ``screen`` stage."""
    cap = int(config["estimation"]["max_frontier"])
    return max(MIN_FRONTIER, cap // SCREEN_FRONTIER_DIVISOR) if stage == "screen" else cap
