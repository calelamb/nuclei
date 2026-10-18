"""Evaluator registry (PRD 14 spec 6.2).

To add an evaluator: create ``evaluators/<kind>.py`` exposing a ``SPEC`` built
from :class:`~kernel.discovery.evaluators.base.EvaluatorSpec`, import it here
and add it to ``EVALUATORS``. Its ``score`` receives a normalized, stage-merged
config; use :mod:`.guardrails` for ordered first-fail guardrails. For
``quantum_circuit`` tasks the sandbox emits ``{"ir": <IR JSON>, "framework"}``
artifacts (via ``kernel.trainability.convert.from_object``); parse them with
``kernel.trainability`` inside the evaluator's ``score``.
"""

from __future__ import annotations

from kernel.discovery.evaluators.base import (  # noqa: F401
    EvaluationCore,
    EvaluatorSpec,
    InvalidConfig,
    effective_config,
    fingerprint,
    normalize_config,
)
from kernel.discovery.evaluators.qec_memory import SPEC as _QEC_MEMORY

EVALUATORS: dict[str, EvaluatorSpec] = {
    _QEC_MEMORY.kind: _QEC_MEMORY,
}
