"""Error type shared by the trainability handlers, inspector and job worker."""

from __future__ import annotations

from kernel.trainability.ir import IrError
from kernel.trainability.pauli import ObservableError


class TrainabilityError(Exception):
    """A failure with a stable wire ``code`` (and a column for observables)."""

    def __init__(self, code: str, message: str, column: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.column = column

    def to_payload(self) -> dict:
        payload = {"code": self.code, "message": self.message}
        if self.column is not None:
            payload["column"] = self.column
        return payload


def short_message(text: str) -> str:
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    return lines[-1] if lines else "Execution failed."


def normalize_error(exc: BaseException) -> TrainabilityError:
    """Map any exception raised by user code or an analysis to the envelope."""
    if isinstance(exc, TrainabilityError):
        return exc
    if isinstance(exc, IrError):
        return TrainabilityError(exc.code, exc.message)
    if isinstance(exc, ObservableError):
        return TrainabilityError("invalid_observable", exc.message, exc.column)
    if isinstance(exc, MemoryError):
        return TrainabilityError("out_of_memory", "The analysis ran out of memory.")
    if isinstance(exc, SyntaxError):
        return TrainabilityError("compile_error", f"{exc.msg} (line {exc.lineno})")
    if isinstance(exc, ValueError) and "unbound" in str(exc).lower():
        return TrainabilityError("unbound_parameters", str(exc))
    return TrainabilityError("analysis_failed", f"{type(exc).__name__}: {exc}"[:500])


class Cancelled(Exception):
    """Raised by an analysis when its ``cancel`` callback returns True."""


def check_cancel(cancel) -> None:
    if cancel is not None and cancel():
        raise Cancelled()


def report(progress, fraction: float, message: str) -> None:
    if progress is not None:
        progress(max(0.0, min(1.0, float(fraction))), message)
