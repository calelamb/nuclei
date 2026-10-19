"""Validation error shared by the Conjecture Engine's spec parsers."""

from __future__ import annotations


class SpecError(ValueError):
    """A malformed conjecture, predicate or family spec.

    ``path`` locates the offending field, e.g. ``feature_predicate.all[1].op``.
    """

    def __init__(self, path: str, message: str) -> None:
        super().__init__(f"{path}: {message}")
        self.path = path
        self.message = message
