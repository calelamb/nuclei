"""MCP server wiring: typed tools over the journaled implementations."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from mcp.server import MCPServer
from pydantic import Field

from . import __version__
from .campaign_models import CampaignRequest
from .campaign_run import run_campaign as _run_campaign
from .ceilings import Ceilings
from .context import Context
from .estimates import DEFAULT_LIKELIHOOD_FACTOR
from .journal import Journal, default_journal_dir
from .manifest import build_manifest
from .rows import StatRow
from .tools_compare import compare as _compare
from .tools_inspect import inspect_circuit as _inspect, read_circuit_text
from .tools_stats import fit as _fit, load_stats as _load_stats

INSTRUCTIONS = (
    "Nuclei QEC research tools. Every numeric result has a run_id and a manifest and is appended "
    "to an immutable journal: cite run_ids for every number you report. Noise model, rounds and "
    "decoder are always required; nothing is defaulted. compare never claims one run is better "
    "unless the confidence regions are separated. Counts from run_campaign are raw; use fit for "
    "rates and intervals."
)


def build_server(journal_dir: Path | None = None, ceilings: Ceilings | None = None) -> MCPServer:
    ctx = Context(
        journal=Journal(journal_dir or default_journal_dir()),
        ceilings=ceilings or Ceilings.from_env(),
    )
    server = MCPServer("nuclei-mcp", instructions=INSTRUCTIONS, version=__version__)

    @server.tool(description="Structural facts about a stim circuit (qubits, detectors, observables, graphlike distance). Give exactly one of stim_text or path.")
    def inspect_circuit(stim_text: str | None = None, path: str | None = None) -> dict[str, Any]:
        text = read_circuit_text(stim_text=stim_text, path=path)
        result = _inspect(text, source_path=path)
        manifest = build_manifest(
            tool="inspect_circuit", parameters={"source": "path" if path else "stim_text", "path": path},
            circuit_sha256=[result["circuit_sha256"]],
            notes=["Counts are exact structural properties, not statistical estimates."],
        )
        inputs = {"stim_text": stim_text, "path": path}
        return ctx.record(tool="inspect_circuit", inputs=inputs, outputs=result, manifest=manifest)

    @server.tool(description="Load sinter CSV stats files (sinter.read_stats_from_csv_files semantics) and journal the rows.")
    def load_stats(paths: list[str] = Field(min_length=1, max_length=100)) -> dict[str, Any]:
        return _load_stats(ctx, paths)

    @server.tool(description=(
        "Per-shot and per-round logical error rates with likelihood-ratio intervals, grouped by metadata keys. "
        "Rows that differ on metadata outside group_by/x are refused, not pooled. Lambda is estimated only when x_is_distance=true, rounds_key is given and there are >=3 distinct distances. Give exactly one of run_id or rows."))
    def fit(
        group_by: list[str], x: str, run_id: str | None = None, rows: list[StatRow] | None = None,
        rounds_key: str | None = None, x_is_distance: bool = False, max_likelihood_factor: float = DEFAULT_LIKELIHOOD_FACTOR,
    ) -> dict[str, Any]:
        dumped = [r.model_dump() for r in rows] if rows is not None else None
        return _fit(ctx, run_id=run_id, rows=dumped, group_by=group_by, x=x, rounds_key=rounds_key,
                    x_is_distance=x_is_distance, max_likelihood_factor=max_likelihood_factor)

    @server.tool(description=(
        "Run a bounded sinter campaign. noise_model, rounds, decoders and every max_* are REQUIRED; requests above "
        "the server's ceilings are refused. Results are written to the journal as CSV plus manifest."))
    async def run_campaign(request: CampaignRequest) -> dict[str, Any]:
        return await _run_campaign(ctx, request)

    @server.tool(description=(
        "Compare two journaled runs point by point. Returns 'not_distinguishable' when intervals overlap; only "
        "separated intervals yield a lower-error-rate verdict."))
    def compare(
        run_a: str, run_b: str, match_on: list[str], where_a: dict[str, Any] | None = None,
        where_b: dict[str, Any] | None = None, max_likelihood_factor: float = DEFAULT_LIKELIHOOD_FACTOR,
    ) -> dict[str, Any]:
        return _compare(ctx, run_a=run_a, run_b=run_b, match_on=match_on, where_a=where_a, where_b=where_b,
                        max_likelihood_factor=max_likelihood_factor)

    @server.tool(description="List journal records, newest first (summaries only).")
    def journal_list(tool: str | None = None, limit: int = Field(50, ge=1, le=500)) -> dict[str, Any]:
        return {"records": ctx.journal.list(tool=tool, limit=limit), "journal": str(ctx.journal.root)}

    @server.tool(description="Fetch one full journal record (inputs, outputs, manifest, parents, rerun arguments) by run_id.")
    def journal_get(run_id: str) -> dict[str, Any]:
        return ctx.journal.get(run_id)

    return server
