"""Check records and seed derivation shared by every audit."""

from __future__ import annotations

import hashlib
from typing import Any, Callable

PASS, FAIL, WARN, SKIPPED = "pass", "fail", "warn", "skipped"
CheckResult = tuple[str, str | None]


def check(check_id: str, label: str, status: str, detail: str | None = None) -> dict[str, Any]:
    return {"id": check_id, "label": label, "status": status, "detail": detail}


def guarded(check_id: str, label: str, fn: Callable[[], CheckResult]) -> dict[str, Any]:
    """Run ``fn``; a crash means the check could not run (``skipped``), never a silent pass."""
    try:
        status, detail = fn()
    except InterruptedError:
        raise
    except Exception as exc:  # noqa: BLE001 - an audit check must always answer
        return check(check_id, label, SKIPPED, f"check could not run: {type(exc).__name__}: {str(exc)[:300]}")
    return check(check_id, label, status, detail)


def not_reached(check_id: str, label: str, reason: str) -> dict[str, Any]:
    return check(check_id, label, SKIPPED, f"not reached: {reason}")


def derive_seed(seed: int, tag: str) -> int:
    """Deterministic 63-bit sub-seed; independent of the evaluators' own derivations."""
    digest = hashlib.sha256(f"audit:{tag}:{int(seed)}".encode()).digest()
    return int.from_bytes(digest[:8], "little") & 0x7FFF_FFFF_FFFF_FFFF


def aggregate(items: list[Any], fn: Callable[[Any], CheckResult]) -> CheckResult:
    """First fail wins, else first warn, else pass (mirrors the evaluators' ``across``)."""
    warn: str | None = None
    for item in items:
        status, detail = fn(item)
        if status == FAIL:
            return FAIL, detail
        if status == SKIPPED:
            return SKIPPED, detail
        if status == WARN and warn is None:
            warn = detail
    return (WARN, warn) if warn is not None else (PASS, None)


def result(checks: list[dict[str, Any]], audit_fitness: float | None, notes: list[str]) -> dict[str, Any]:
    return {"checks": checks, "audit_fitness": audit_fitness, "notes": notes}


def scored_metric(evaluation: dict[str, Any], key: str) -> Any:
    metrics = evaluation.get("metrics") if isinstance(evaluation, dict) else None
    return metrics.get(key) if isinstance(metrics, dict) else None
