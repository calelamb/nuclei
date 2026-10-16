from __future__ import annotations

import asyncio

import pytest
import sinter
from pydantic import ValidationError

from nuclei_mcp.campaign_models import CampaignRequest
from nuclei_mcp.campaign_run import run_campaign
from nuclei_mcp.ceilings import Ceilings
from nuclei_mcp.context import Context
from nuclei_mcp.errors import CeilingExceeded, ToolInputError

NOISE = {"name": "uniform-depolarizing", "channels": {"after_clifford_depolarization": 1.0}}


def request(**over):
    base = {
        "source": {"kind": "generator", "code": "repetition_code:memory", "distances": [3, 5], "rounds": 3,
                   "noise_model": NOISE, "physical_error_rates": [0.05]},
        "decoders": ["pymatching"], "max_shots": 2000, "max_errors": 100, "max_seconds": 60, "max_tasks": 4,
    }
    return CampaignRequest.model_validate({**base, **over})


def run(ctx, req):
    return asyncio.run(run_campaign(ctx, req))


def test_small_campaign_end_to_end(ctx):
    out = run(ctx, request())
    assert out["terminated_by"] == "completed" and out["partial"] is False
    assert out["n_tasks"] == 2 and len(out["rows"]) == 2
    assert all(r["shots"] >= 1 for r in out["rows"])
    assert {r["json_metadata"]["rounds"] for r in out["rows"]} == {3}
    m = out["manifest"]
    assert m["deterministically_reproducible"] is False
    assert m["parameters"]["decoders"] == ["pymatching"] and m["parameters"]["source"]["rounds"] == 3
    assert len(m["circuit_sha256"]) == 2 and m["versions"]["stim"] and m["versions"]["pymatching"]
    # the CSV in the journal is sinter-native and agrees with the journaled rows
    loaded = sinter.read_stats_from_csv_files(out["stats_csv"]["path"])
    assert sorted((s.shots, s.errors) for s in loaded) == sorted((r["shots"], r["errors"]) for r in out["rows"])
    record = ctx.journal.get(out["run_id"])
    assert record["inputs"]["decoders"] == ["pymatching"] and record["rerun"]["tool"] == "run_campaign"


def test_two_decoders_make_two_tasks_each(ctx):
    out = run(ctx, request(decoders=["pymatching", "pymatching-correlated"], max_tasks=4))
    assert out["n_tasks"] == 4


@pytest.mark.parametrize(
    "over, name",
    [
        ({"max_shots": 10**9}, "max_shots"),
        ({"max_errors": 10**9}, "max_errors"),
        ({"max_seconds": 10**6}, "max_seconds"),
        ({"max_tasks": 10**6}, "max_tasks"),
        ({"num_workers": 99}, "max_workers"),
    ],
)
def test_ceiling_refusals(ctx, over, name):
    with pytest.raises(CeilingExceeded, match=name):
        run(ctx, request(**over))
    assert ctx.journal.list() == []  # refused requests leave no record and no numbers


def test_distance_rounds_and_total_shots_ceilings(ctx):
    tight = Context(journal=ctx.journal, ceilings=Ceilings(max_distance=5, max_rounds=4, max_total_shots=3000))
    with pytest.raises(CeilingExceeded, match="max_distance"):
        run(tight, request(source={**request().source.model_dump(), "distances": [7]}))
    with pytest.raises(CeilingExceeded, match="max_rounds"):
        run(tight, request(source={**request().source.model_dump(), "rounds": 9}))
    with pytest.raises(CeilingExceeded, match="max_total_shots"):
        run(tight, request())  # 2 tasks x 2000 shots > 3000


def test_decoder_with_missing_package_is_refused_up_front(ctx, monkeypatch):
    import importlib.util as iu
    real = iu.find_spec
    monkeypatch.setattr(iu, "find_spec", lambda name, *a: None if name == "pymatching" else real(name, *a))
    with pytest.raises(ToolInputError, match="not installed"):
        run(ctx, request())


def test_expansion_above_requested_max_tasks_is_refused(ctx):
    with pytest.raises(ToolInputError, match="expands to 4 tasks"):
        run(ctx, request(decoders=["pymatching", "pymatching-correlated"], max_tasks=3))


@pytest.mark.parametrize("missing", ["decoders", "max_shots", "max_errors", "max_seconds", "max_tasks"])
def test_required_top_level_fields(missing):
    payload = request().model_dump(mode="json")
    payload.pop(missing)
    payload.pop("num_workers")
    with pytest.raises(ValidationError):
        CampaignRequest.model_validate(payload)


@pytest.mark.parametrize("missing", ["rounds", "noise_model", "code", "distances", "physical_error_rates"])
def test_required_source_fields(missing):
    payload = request().model_dump(mode="json")
    payload["source"].pop(missing)
    with pytest.raises(ValidationError):
        CampaignRequest.model_validate(payload)


def test_unknown_fields_rejected():
    with pytest.raises(ValidationError):
        request(surprise=1)


@pytest.mark.parametrize(
    "over, message",
    [
        ({"decoders": ["nope"]}, "unknown decoder"),
        ({"decoders": ["pymatching", "pymatching"]}, "must not repeat"),
        ({"source": {"kind": "generator", "code": "nope", "distances": [3], "rounds": 3, "noise_model": NOISE, "physical_error_rates": [0.01]}}, "unknown code"),
        ({"source": {"kind": "generator", "code": "repetition_code:memory", "distances": [3], "rounds": 3, "noise_model": {"name": "x"}, "physical_error_rates": [0.01]}}, "no default noise"),
        ({"source": {"kind": "generator", "code": "repetition_code:memory", "distances": [3], "rounds": 3, "noise_model": {"name": "x", "channels": {"bogus": 1.0}}, "physical_error_rates": [0.01]}}, "unknown noise channel"),
        ({"source": {"kind": "generator", "code": "repetition_code:memory", "distances": [3], "rounds": 3, "noise_model": NOISE, "physical_error_rates": [1.5]}}, "physical error rate"),
        ({"source": {"kind": "generator", "code": "repetition_code:memory", "distances": [1], "rounds": 3, "noise_model": NOISE, "physical_error_rates": [0.01]}}, "distance must be"),
        ({"source": {"kind": "generator", "code": "color_code:memory_xyz", "distances": [4], "rounds": 3, "noise_model": NOISE, "physical_error_rates": [0.01]}}, "stim rejected"),
    ],
)
def test_semantic_validation_failures(ctx, over, message):
    with pytest.raises(ToolInputError, match=message):
        run(ctx, request(**over))


def test_stim_paths_source(ctx, tmp_path):
    import stim
    path = tmp_path / "c.stim"
    path.write_text(str(stim.Circuit.generated("repetition_code:memory", distance=3, rounds=3, after_clifford_depolarization=0.05)))
    out = run(ctx, request(source={"kind": "stim_paths", "paths": [str(path)], "rounds": 3, "noise_model": {"name": "file-declared"}}))
    meta = out["rows"][0]["json_metadata"]
    assert meta["noise_model"] == "file-declared" and meta["rounds"] == 3 and len(meta["circuit_sha256"]) == 64
    with pytest.raises(ToolInputError, match="not found"):
        run(ctx, request(source={"kind": "stim_paths", "paths": [str(tmp_path / "x.stim")], "rounds": 3, "noise_model": {"name": "n"}}))


def test_max_seconds_stops_a_long_campaign_with_partial_flag(ctx):
    src = {"kind": "generator", "code": "surface_code:rotated_memory_z", "distances": [5], "rounds": 5,
           "noise_model": NOISE, "physical_error_rates": [0.001]}
    ceil = Context(journal=ctx.journal, ceilings=Ceilings(max_shots=10**9, max_total_shots=10**10))
    import time
    t0 = time.monotonic()
    out = run(ceil, request(source=src, max_shots=10**9, max_errors=100_000, max_seconds=2, max_tasks=1))
    elapsed = time.monotonic() - t0
    assert out["terminated_by"] == "max_seconds" and out["partial"] is True
    assert elapsed < 30
    assert any("PARTIAL" in n for n in out["manifest"]["notes"])


def test_cancellation_aborts_collection(ctx):
    src = {"kind": "generator", "code": "surface_code:rotated_memory_z", "distances": [5], "rounds": 5,
           "noise_model": NOISE, "physical_error_rates": [0.001]}
    big = Context(journal=ctx.journal, ceilings=Ceilings(max_shots=10**9, max_total_shots=10**10, max_errors=10**9))

    async def go():
        task = asyncio.create_task(run_campaign(big, request(source=src, max_shots=10**9, max_errors=10**8, max_seconds=300, max_tasks=1)))
        await asyncio.sleep(1.5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(asyncio.wait_for(go(), timeout=60))
