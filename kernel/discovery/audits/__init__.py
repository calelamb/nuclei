"""Independent audits for Red Queen mode (PRD 14 addendum section F).

An audit is a stricter, slower, independent re-scoring of one candidate. Audits
are discovered by naming convention: ``audits/<kind>.py`` audits the evaluator
of the same ``kind``. Nothing here needs editing to register a new audit.

Interface (binding)::

    def audit(config, artifacts, seed, *, evaluation, progress=None, cancel=None,
              cache_dir=None) -> {"checks": [...], "audit_fitness": float | None, "notes": [str]}

``config`` is the normalized, stage-merged evaluator config, ``artifacts`` the
fresh sandbox's per-call artifact list and ``evaluation`` the evaluator's
scored record for the candidate under audit.
"""

from __future__ import annotations

import importlib
import importlib.util
import os
import re
from types import ModuleType

AUDIT_PACKAGE = "kernel.discovery.audits"
#: Modules in this package that are infrastructure, never audits.
RESERVED = frozenset({"handlers", "runner", "audit_worker", "exploits"})
_KIND = re.compile(r"^[a-z][a-z0-9_]*$")
_HERE = os.path.dirname(os.path.abspath(__file__))


class AuditUnavailable(LookupError):
    """No audit module exists for the requested evaluator kind."""


def _valid_kind(kind: object) -> bool:
    return isinstance(kind, str) and bool(_KIND.match(kind)) and kind not in RESERVED


def has_audit(kind: str) -> bool:
    """True if ``audits/<kind>.py`` exists."""
    return _valid_kind(kind) and os.path.isfile(os.path.join(_HERE, f"{kind}.py"))


def load_audit(kind: str) -> ModuleType:
    """Import ``kernel.discovery.audits.<kind>`` (naming-convention registry)."""
    if not has_audit(kind):
        raise AuditUnavailable(f"No audit is registered for evaluator '{kind}'.")
    module = importlib.import_module(f"{AUDIT_PACKAGE}.{kind}")
    if not callable(getattr(module, "audit", None)):
        raise AuditUnavailable(f"Audit module '{kind}' does not define audit().")
    return module


def available_audits() -> list[str]:
    """Kinds that currently have an audit module."""
    names = sorted(f[:-3] for f in os.listdir(_HERE) if f.endswith(".py") and not f.startswith("_"))
    return [name for name in names if has_audit(name)]
