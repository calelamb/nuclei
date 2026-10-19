"""Evaluator registry (PRD 14 spec 6.2).

To add an evaluator: create ``evaluators/<kind>.py`` exposing a ``SPEC`` built
from :class:`~kernel.discovery.evaluators.base.EvaluatorSpec`, import it here
and add it to ``EVALUATORS``. Its ``score`` receives a normalized, stage-merged
config; use :mod:`.guardrails` for ordered first-fail guardrails. For
``quantum_circuit`` tasks the sandbox emits ``{"ir": <IR JSON>, "framework"}``
artifacts (via ``kernel.trainability.convert.from_object``); parse them with
``kernel.trainability`` inside the evaluator's ``score``.

Optional packages: evaluator modules must import cleanly WITHOUT Stim / PyMatching /
Sinter (the managed venv lacks them). Import those lazily (see
``kernel.discovery._optional.lazy_module``) and list the evaluator's needs in
``availability.REQUIRES``; the registry then reports it ``available: false``
instead of failing the whole engine.
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
from kernel.discovery.evaluators.availability import (  # noqa: F401
    ERR_MISSING_DEPENDENCY,
    describe,
    error_fields,
    missing_for,
)
from kernel.discovery.evaluators.qec_memory import SPEC as _QEC_MEMORY
from kernel.discovery.evaluators.state_synthesis import SPEC as _STATE_SYNTHESIS
from kernel.discovery.evaluators.trainability_frontier import SPEC as _TRAINABILITY_FRONTIER
from kernel.discovery.evaluators.vqe_ground_state import SPEC as _VQE_GROUND_STATE

EVALUATORS: dict[str, EvaluatorSpec] = {
    _QEC_MEMORY.kind: _QEC_MEMORY,
    _STATE_SYNTHESIS.kind: _STATE_SYNTHESIS,
    _TRAINABILITY_FRONTIER.kind: _TRAINABILITY_FRONTIER,
    _VQE_GROUND_STATE.kind: _VQE_GROUND_STATE,
}
