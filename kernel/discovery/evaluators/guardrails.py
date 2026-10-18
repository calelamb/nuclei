"""Ordered guardrail runner shared by every evaluator (spec 6.3).

A guardrail check returns ``(status, detail)`` where status is ``"pass"``,
``"warn"`` or ``"fail"``. The runner executes checks in order; the first
``fail`` stops the run and every later guardrail is listed as ``skipped`` so the
Guardrails tab always shows the full list.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

PASS, WARN, FAIL, SKIPPED = "pass", "warn", "fail", "skipped"

CheckResult = tuple[str, str | None]


@dataclass(frozen=True)
class Guardrail:
    id: str
    label: str
    check: Callable[[], CheckResult]
    # Static skip reason (e.g. stage-deferred guardrails); the check never runs.
    skip_reason: str | None = None


def record(guardrail: Guardrail, status: str, detail: str | None) -> dict[str, Any]:
    return {"id": guardrail.id, "label": guardrail.label, "status": status, "detail": detail}


def run_guardrails(guardrails: list[Guardrail]) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Run in order. Returns (all guardrail records, rejection or None)."""
    records: list[dict[str, Any]] = []
    rejection: dict[str, Any] | None = None
    for guardrail in guardrails:
        if rejection is not None:
            records.append(record(guardrail, SKIPPED, "not reached: an earlier guardrail failed"))
            continue
        if guardrail.skip_reason is not None:
            records.append(record(guardrail, SKIPPED, guardrail.skip_reason))
            continue
        try:
            status, detail = guardrail.check()
        except Exception as exc:  # noqa: BLE001 - a crashing check must not pass silently
            status, detail = FAIL, f"guardrail check crashed: {type(exc).__name__}: {exc}"
        records.append(record(guardrail, status, detail))
        if status == FAIL:
            rejection = {"guardrail": guardrail.id, "message": detail or guardrail.label}
    return records, rejection


def across(items: list[Any], check: Callable[[Any], CheckResult]) -> CheckResult:
    """Apply ``check`` to every item: first fail wins, else warn if any, else pass."""
    warn: str | None = None
    for item in items:
        status, detail = check(item)
        if status == FAIL:
            return FAIL, detail
        if status == WARN and warn is None:
            warn = detail
    return (WARN, warn) if warn is not None else (PASS, None)
