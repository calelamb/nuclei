"""End-to-end through the official MCP SDK client (in-memory and real stdio)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from mcp import Client, StdioServerParameters

from nuclei_mcp.ceilings import Ceilings
from nuclei_mcp.server import build_server

from .conftest import KERNEL_DIR

pytestmark = pytest.mark.asyncio

NOISE = {"name": "uniform", "channels": {"after_clifford_depolarization": 1.0}}
CAMPAIGN = {
    "source": {"kind": "generator", "code": "repetition_code:memory", "distances": [3, 5, 7], "rounds": 3,
               "noise_model": NOISE, "physical_error_rates": [0.05]},
    "decoders": ["pymatching"], "max_shots": 3000, "max_errors": 200, "max_seconds": 60, "max_tasks": 3,
}


@pytest.fixture
def server(tmp_path: Path):
    return build_server(tmp_path / "journal", Ceilings())


async def test_tool_surface(server):
    async with Client(server) as client:
        names = {t.name for t in (await client.list_tools()).tools}
    assert names == {"inspect_circuit", "load_stats", "fit", "run_campaign", "compare", "journal_list", "journal_get"}


async def test_required_inputs_are_in_the_schema(server):
    async with Client(server) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
    schema = tools["run_campaign"].input_schema
    campaign = schema["$defs"]["CampaignRequest"] if "$defs" in schema else schema
    assert {"decoders", "max_shots", "max_errors", "max_seconds", "max_tasks", "source"} <= set(campaign["required"])


async def test_research_workflow_is_fully_traceable(server, fixture_csv):
    async with Client(server) as client:
        loaded = (await client.call_tool("load_stats", {"paths": [str(fixture_csv)]})).structured_content
        fitted = (await client.call_tool(
            "fit", {"run_id": loaded["run_id"], "group_by": ["decoder", "p"], "x": "d", "rounds_key": "d"})).structured_content
        assert fitted["parent_run_ids"] == [loaded["run_id"]]
        assert fitted["manifest"]["ci_method"] and fitted["manifest"]["units"]

        camp = (await client.call_tool("run_campaign", {"request": CAMPAIGN})).structured_content
        assert camp["terminated_by"] == "completed" and len(camp["rows"]) == 3
        rates = (await client.call_tool(
            "fit", {"run_id": camp["run_id"], "group_by": ["p"], "x": "d", "rounds_key": "rounds"})).structured_content
        assert rates["groups"][0]["lambda"]["status"] in {"estimated", "not_estimated"}

        cmp_ = (await client.call_tool(
            "compare", {"run_a": camp["run_id"], "run_b": camp["run_id"], "match_on": ["d", "p"]})).structured_content
        assert {c["verdict"] for c in cmp_["comparisons"]} == {"not_distinguishable"}

        listed = (await client.call_tool("journal_list", {})).structured_content["records"]
        ids = {r["run_id"] for r in listed}
        assert {loaded["run_id"], fitted["run_id"], camp["run_id"], rates["run_id"], cmp_["run_id"]} <= ids
        full = (await client.call_tool("journal_get", {"run_id": rates["run_id"]})).structured_content
        assert full["parent_run_ids"] == [camp["run_id"]] and full["rerun"]["tool"] == "fit"
        assert full["record_sha256"]


async def test_inspect_circuit_over_the_wire(server):
    text = "R 0 1\nX_ERROR(0.1) 0 1\nM 0 1\nDETECTOR rec[-1] rec[-2]\nOBSERVABLE_INCLUDE(0) rec[-1]"
    async with Client(server) as client:
        out = (await client.call_tool("inspect_circuit", {"stim_text": text})).structured_content
    assert out["num_detectors"] == 1 and out["num_observables"] == 1 and out["run_id"].startswith("run-")


async def test_tool_errors_reach_the_agent_with_the_reason(server):
    async with Client(server) as client:
        bad_fit = await client.call_tool("fit", {"group_by": ["d"], "x": "d"})
        assert bad_fit.is_error and "exactly one of run_id or rows" in bad_fit.content[0].text
        no_noise = {**CAMPAIGN, "source": {k: v for k, v in CAMPAIGN["source"].items() if k != "noise_model"}}
        res = await client.call_tool("run_campaign", {"request": no_noise})
        assert res.is_error and "noise_model" in res.content[0].text
        over = await client.call_tool("run_campaign", {"request": {**CAMPAIGN, "max_shots": 10**12}})
        assert over.is_error and "ceiling" in over.content[0].text
        missing = await client.call_tool("journal_get", {"run_id": "run-20260101T000000Z-00000000"})
        assert missing.is_error and "no journal record" in missing.content[0].text
        assert (await client.call_tool("journal_list", {})).structured_content["records"] == []  # failures leave no records


async def test_real_stdio_subprocess(tmp_path, fixture_csv):
    params = StdioServerParameters(
        command=sys.executable, args=["-m", "nuclei_mcp", "--journal", str(tmp_path / "j"), "--ceiling-max-shots", "5000"],
        cwd=str(KERNEL_DIR),
    )
    async with Client(params) as client:
        assert "run_campaign" in {t.name for t in (await client.list_tools()).tools}
        loaded = (await client.call_tool("load_stats", {"paths": [str(fixture_csv)]})).structured_content
        assert loaded["n_rows"] == 8
        refused = await client.call_tool("run_campaign", {"request": {**CAMPAIGN, "max_shots": 6000}})
        assert refused.is_error and "max_shots=6000" in refused.content[0].text
    assert (tmp_path / "j" / "runs" / f"{loaded['run_id']}.json").is_file()
