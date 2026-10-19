"""Which evaluators can run in this environment (optional-dependency gating).

The managed venv has numpy / qiskit / cirq but NOT Stim or PyMatching (Research
catalog installs). Every evaluator module imports cleanly without them, so the
registry always lists all evaluators; this module says which are runnable and
what is missing. It is deliberately NOT imported by any evaluator, so it stays
out of every evaluator's fingerprint closure.
"""

from __future__ import annotations

from typing import Any

from kernel.discovery._optional import MissingDependency, install_hint, missing_message, missing_modules

#: evaluator kind -> import names of optional packages it needs at run time.
REQUIRES: dict[str, tuple[str, ...]] = {
    "qec_memory": ("stim", "pymatching"),
}

ERR_MISSING_DEPENDENCY = "missing_dependency"


def missing_for(kind: str) -> list[str]:
    """Absent optional packages for ``kind`` (empty list = runnable)."""
    return missing_modules(REQUIRES.get(kind, ()))


def describe(spec) -> dict[str, Any]:
    """``spec.to_json()`` plus the additive ``available`` / ``missing`` / ``install`` fields."""
    payload = spec.to_json()
    absent = missing_for(spec.kind)
    payload["available"] = not absent
    if absent:
        payload["missing"] = absent
        payload["install"] = install_hint(absent)
    return payload


def require_available(kind: str) -> None:
    """Raise :class:`MissingDependency` when ``kind`` cannot run here."""
    absent = missing_for(kind)
    if absent:
        raise MissingDependency(absent)


def error_fields(absent: list[str]) -> dict[str, Any]:
    """Extra wire fields for a ``missing_dependency`` error envelope."""
    return {"missing": list(absent), "install": install_hint(absent)}


__all__ = ["ERR_MISSING_DEPENDENCY", "MissingDependency", "REQUIRES", "describe", "error_fields",
           "missing_for", "missing_message", "require_available"]
