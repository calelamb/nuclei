"""Typed adapter failures the executor can classify without parsing messages.

Both carry a stable wire ``code`` (and ``severity``) so the layer that builds
the ``error`` frame never has to pattern-match prose. They stay plain
``ValueError`` / ``RuntimeError`` subclasses, so any caller that already
catches those keeps working.
"""

from __future__ import annotations

from collections.abc import Sequence

# How many parameter names a message spells out before summarising the rest.
MAX_NAMES_IN_MESSAGE = 8


class UnboundParametersError(ValueError):
    """A circuit still has free parameters, so there is nothing to simulate.

    Info-class on the wire (``severity == "info"``): the editor shows a prompt
    ("Run at point...") rather than a red error. ``parameters`` lists the
    names that still need values, sorted.
    """

    code = "unbound_parameters"
    severity = "info"

    def __init__(self, parameters: Sequence[str]) -> None:
        self.parameters: list[str] = list(parameters)
        super().__init__(self._describe(self.parameters))

    @staticmethod
    def _describe(names: list[str]) -> str:
        shown = ", ".join(names[:MAX_NAMES_IN_MESSAGE])
        hidden = len(names) - MAX_NAMES_IN_MESSAGE
        listed = f"{shown}, and {hidden} more" if hidden > 0 else shown
        noun = "free parameter" if len(names) == 1 else "free parameters"
        return f"{len(names)} {noun} ({listed}); nothing to simulate until they have values."


class UnsupportedInstructionError(RuntimeError):
    """An instruction no available backend can simulate, named for the user."""

    code = "unsupported_instruction"
    severity = "error"

    def __init__(self, instruction: str, detail: str | None = None) -> None:
        self.instruction = instruction
        message = f"The simulator cannot run the instruction '{instruction}'."
        if detail:
            message = f"{message} {detail}"
        super().__init__(message)
