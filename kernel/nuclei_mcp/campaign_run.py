"""Bounded, cancellable sinter.collect."""

from __future__ import annotations

import asyncio
import threading
import time
from typing import Any

import sinter

from .campaign_models import CampaignRequest
from .campaign_tasks import build_tasks, task_circuit_texts
from .context import Context
from .estimates import ESTIMATOR
from .manifest import UNITS, build_manifest
from .rows import stats_to_rows
from .journal import sha256_text


class _Stop(Exception):
    """Raised inside sinter's progress callback to abort collection."""


class _Collector:
    def __init__(self, deadline: float, cancel: threading.Event) -> None:
        self.deadline = deadline
        self.cancel = cancel
        self.reason: str | None = None

    def __call__(self, _progress: Any) -> None:
        if self.cancel.is_set():
            self.reason = "cancelled"
            raise _Stop
        if time.monotonic() >= self.deadline:
            self.reason = "max_seconds"
            raise _Stop


def _collect(req: CampaignRequest, tasks: list, cancel: threading.Event) -> tuple[list, str]:
    """Run sinter.collect; partial results are kept via the accumulator."""
    acc: dict[str, Any] = {}
    collector = _Collector(time.monotonic() + req.max_seconds, cancel)

    def on_progress(progress: Any) -> None:
        for stat in progress.new_stats:
            acc[stat.strong_id] = acc[stat.strong_id] + stat if stat.strong_id in acc else stat
        collector(progress)

    try:
        sinter.collect(
            num_workers=req.num_workers,
            tasks=tasks,
            max_shots=req.max_shots,
            max_errors=req.max_errors,
            progress_callback=on_progress,
            hint_num_tasks=len(tasks),
        )
        reason = "completed"
    except _Stop:
        reason = collector.reason or "stopped"
    return list(acc.values()), reason


async def run_campaign(ctx: Context, req: CampaignRequest) -> dict[str, Any]:
    tasks = build_tasks(req, ctx.ceilings)
    cancel = threading.Event()
    try:
        stats, reason = await asyncio.to_thread(_collect, req, tasks, cancel)
    except asyncio.CancelledError:
        # Best effort: the worker thread aborts at its next sinter progress
        # callback. No journal record is written for a cancelled campaign.
        cancel.set()
        raise
    rows = stats_to_rows(stats)
    csv = sinter.CSV_HEADER + "\n" + "".join(s.to_csv_line() + "\n" for s in stats)
    circuits = task_circuit_texts(tasks)
    artifacts = {sha: ctx.journal.write_artifact(f"circuit-{sha}.stim", text) for sha, text in circuits.items()}
    csv_name = f"stats-{sha256_text(csv)[:16]}.csv"
    csv_art = ctx.journal.write_artifact(csv_name, csv)
    inputs = req.model_dump(mode="json")
    outputs = {
        "rows": rows,
        "terminated_by": reason,
        "partial": reason != "completed",
        "n_tasks": len(tasks),
        "stats_csv": csv_art,
        "circuit_artifacts": artifacts,
    }
    manifest = build_manifest(
        tool="run_campaign",
        parameters=inputs,
        estimator=ESTIMATOR,
        ci_method="none",  # raw counts only; fit records its own method
        circuit_sha256=list(circuits),
        units={k: UNITS[k] for k in ("shots", "errors", "discards", "seconds")},
        reproducible=False,
        notes=[
            "sinter.collect has no seed parameter: re-running gives statistically consistent, not identical, counts.",
            "Counts are raw; run fit for rates and intervals.",
        ] + (["PARTIAL: collection stopped early (" + reason + "); counts are valid but incomplete."] if reason != "completed" else []),
    )
    return ctx.record(
        tool="run_campaign", inputs=inputs, outputs=outputs, manifest=manifest,
        rerun={"tool": "run_campaign", "arguments": {"request": inputs}},
    )
