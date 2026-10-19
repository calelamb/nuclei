"""Shared plumbing for the Lab analyses: errors, cancellation and progress helpers.

Every analysis takes ``progress(fraction, message)`` and ``cancel() -> bool`` callables
(both optional) and raises :class:`AnalysisCancelled` when ``cancel`` fires.  The only
run-dependent fields in any analysis result are the ``elapsed_ms`` timings (and results
truncated by a wall-clock budget); everything else is a pure function of the inputs and
the seed.
"""

from __future__ import annotations

from typing import Callable

from kernel.trainability.pauli import PauliSum

Progress = Callable[[float, str], None]
Cancel = Callable[[], bool]

__all__ = ["AnalysisError", "AnalysisCancelled", "check_cancel", "report", "observable_terms"]


class AnalysisError(Exception):
    """A user-facing analysis failure with a stable ``code`` (e.g. ``ppe_not_applicable``)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"{self.code}: {self.message}"


class AnalysisCancelled(Exception):
    """Raised when the ``cancel`` callback returns true."""


def check_cancel(cancel: Cancel | None) -> None:
    if cancel is not None and cancel():
        raise AnalysisCancelled()


def report(progress: Progress | None, fraction: float, message: str) -> None:
    if progress is not None:
        progress(min(max(float(fraction), 0.0), 1.0), message)


def observable_terms(observable: PauliSum, *, drop_identity: bool = False) -> list[tuple[float, tuple]]:
    """``PauliSum`` -> ``[(coeff, ops)]`` as the math cores expect."""
    return [(float(t.coeff), t.ops) for t in observable.terms if not (drop_identity and not t.ops)]
