"""Bind free circuit parameters to numbers (PRD 15 R-4, kernel side).

``bind_parameters(circuit, parameter_values)`` is framework-agnostic over
Qiskit and Cirq circuits. The execute path (R-B) calls it with the wire value
of ``execute.parameter_values``: either ``{name: number}`` or
``{"random_seed": int}``, and reports the returned ``bound_at`` in the result.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
from numbers import Real
from typing import Any

import numpy as np

from kernel.adapters.errors import UnboundParametersError

RANDOM_SEED_KEY = "random_seed"
# Seeded draws land on one full turn, the natural domain of rotation angles.
RANDOM_POINT_LOW = 0.0
RANDOM_POINT_HIGH = 2.0 * math.pi


def _natural_key(name: str) -> list[object]:
    """Sort key putting ``theta[2]`` before ``theta[10]``."""
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", name)]


def free_parameter_names(circuit: Any) -> list[str]:
    """Names of the circuit's free parameters in natural order; ``[]`` when fully bound."""
    if hasattr(circuit, "assign_parameters"):  # Qiskit QuantumCircuit
        names = [p.name for p in circuit.parameters]
    else:
        import cirq

        names = list(cirq.parameter_names(circuit))
    return sorted(names, key=_natural_key)


def bind_parameters(
    circuit: Any,
    parameter_values: Mapping[str, Any] | None = None,
    *,
    random_seed: int | None = None,
) -> tuple[Any, dict[str, float]]:
    """Return ``(bound_circuit, bound_at)`` for a Qiskit or Cirq circuit.

    ``parameter_values`` maps parameter name to a finite number. As on the
    wire, a mapping of exactly ``{"random_seed": n}`` means "draw every
    parameter uniformly from [0, 2*pi) with that seed" (parameters taken in
    natural name order, so one seed is one point); a circuit that really has a
    parameter named ``random_seed`` treats it as an ordinary value instead.
    ``random_seed=`` is the same request as a keyword.

    Names the circuit does not have are ignored, so a stored point survives
    edits; names it has but the request lacks raise ``UnboundParametersError``
    listing them. A circuit with nothing to bind is returned as-is with
    ``bound_at == {}``. The input circuit is never mutated.
    """
    names = free_parameter_names(circuit)
    if not names:
        return circuit, {}

    values = _resolve_values(names, parameter_values, random_seed)
    missing = [name for name in names if name not in values]
    if missing:
        raise UnboundParametersError(missing)

    bound_at = {name: values[name] for name in names}
    return _apply(circuit, bound_at), bound_at


def _resolve_values(
    names: list[str], parameter_values: Mapping[str, Any] | None, random_seed: int | None
) -> dict[str, float]:
    if random_seed is None and _is_seed_request(parameter_values, names):
        random_seed = parameter_values[RANDOM_SEED_KEY]  # type: ignore[index]
        parameter_values = None
    if random_seed is not None:
        _require_seed(random_seed)
        draws = np.random.default_rng(int(random_seed)).uniform(
            RANDOM_POINT_LOW, RANDOM_POINT_HIGH, size=len(names)
        )
        return {name: float(draw) for name, draw in zip(names, draws)}
    return {name: _finite_number(name, value) for name, value in (parameter_values or {}).items()}


def _is_seed_request(parameter_values: Mapping[str, Any] | None, names: list[str]) -> bool:
    return (
        parameter_values is not None
        and set(parameter_values) == {RANDOM_SEED_KEY}
        and RANDOM_SEED_KEY not in names
    )


def _require_seed(seed: Any) -> None:
    if isinstance(seed, bool) or not isinstance(seed, (int, np.integer)):
        raise ValueError(f"{RANDOM_SEED_KEY} must be an integer, got {seed!r}")


def _finite_number(name: str, value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (Real, np.number)):
        raise ValueError(f"parameter_values[{name!r}] must be a finite number, got {value!r}")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"parameter_values[{name!r}] must be a finite number, got {value!r}")
    return number


def _apply(circuit: Any, bound_at: Mapping[str, float]) -> Any:
    if hasattr(circuit, "assign_parameters"):
        by_name = {p.name: p for p in circuit.parameters}
        return circuit.assign_parameters({by_name[name]: value for name, value in bound_at.items()})
    import cirq

    return cirq.resolve_parameters(circuit, cirq.ParamResolver(dict(bound_at)))
