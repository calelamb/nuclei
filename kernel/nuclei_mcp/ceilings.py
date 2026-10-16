"""Configurable hard ceilings for run_campaign.

Requests above a ceiling are refused outright (never silently clamped), so a
number in the journal always reflects exactly what the agent asked for.
"""

from __future__ import annotations

import os
from typing import Mapping

from pydantic import BaseModel, ConfigDict, Field

from .errors import CeilingExceeded


class Ceilings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    max_shots: int = Field(10_000_000, ge=1, description="per-task shot cap")
    max_errors: int = Field(100_000, ge=1, description="per-task error cap")
    max_seconds: float = Field(600.0, gt=0, description="wall-clock cap")
    max_tasks: int = Field(200, ge=1, description="number of sinter tasks")
    max_total_shots: int = Field(100_000_000, ge=1, description="max_shots x tasks")
    max_distance: int = Field(25, ge=2)
    max_rounds: int = Field(200, ge=1)
    max_workers: int = Field(4, ge=1)
    max_rows: int = Field(20_000, ge=1, description="rows returned by load_stats")

    max_csv_bytes: int = Field(50_000_000, ge=1, description="size of each stats CSV read by load_stats")
    max_total_csv_bytes: int = Field(200_000_000, ge=1, description="summed size of all stats CSVs in one load_stats call")

    def require(self, name: str, value: float) -> None:
        limit = getattr(self, name)
        if value > limit:
            raise CeilingExceeded(
                f"{name}={value} exceeds the configured ceiling of {limit}. "
                "Lower the request, or ask the researcher to raise the ceiling "
                f"(--ceiling-{name.replace('_', '-')} or NUCLEI_MCP_CEILING_{name.upper()})."
            )

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Ceilings":
        source = os.environ if env is None else env
        overrides: dict[str, float] = {}
        for name, field in cls.model_fields.items():
            raw = source.get(f"NUCLEI_MCP_CEILING_{name.upper()}")
            if raw is not None:
                overrides[name] = float(raw) if field.annotation is float else int(raw)
        return cls(**overrides)

    def with_overrides(self, overrides: Mapping[str, float | None]) -> "Ceilings":
        applied = {k: v for k, v in overrides.items() if v is not None}
        # Re-validate: model_copy(update=...) would skip the ge/gt constraints.
        return Ceilings.model_validate({**self.model_dump(), **applied})
