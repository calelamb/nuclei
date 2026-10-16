"""Shared server state and the single path by which results get journaled."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .ceilings import Ceilings
from .journal import Journal


@dataclass(frozen=True)
class Context:
    journal: Journal
    ceilings: Ceilings

    def record(
        self,
        *,
        tool: str,
        inputs: Mapping[str, Any],
        outputs: Mapping[str, Any],
        manifest: Mapping[str, Any],
        parents: list[str] | None = None,
    ) -> dict[str, Any]:
        """Journal a result and return it as the tool response.

        The response is the journaled record minus bookkeeping, so what the
        agent sees is exactly what is on disk under ``run_id``.
        """
        record = self.journal.append(
            tool=tool,
            inputs=inputs,
            outputs=outputs,
            manifest=manifest,
            parent_run_ids=parents or [],
        )
        return {
            "run_id": record["run_id"],
            "manifest": record["manifest"],
            "parent_run_ids": record["parent_run_ids"],
            **record["outputs"],
        }
