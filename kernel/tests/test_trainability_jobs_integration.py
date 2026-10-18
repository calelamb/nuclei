"""End-to-end jobs against the real analyses (runs once the physics modules merge)."""

from __future__ import annotations

import asyncio

import pytest

pytest.importorskip("qiskit")
pytest.importorskip("kernel.trainability.analyses")
pytest.importorskip("kernel.trainability.scaling")
pytest.importorskip("kernel.trainability.lie")
pytest.importorskip("kernel.trainability.lint")

from kernel.tests._trainability_job_helpers import QISKIT_CODE, connection  # noqa: E402

# Shallow RY + CZ ladder: PPE-applicable and small enough for fast sampling.
CODE = QISKIT_CODE
OBSERVABLE = "Z0*Z1"


def run(scenario):
    return asyncio.run(scenario())


def strip_timing(value):
    """Drop wall-clock fields; everything else must reproduce bit-for-bit."""
    if isinstance(value, dict):
        return {k: strip_timing(v) for k, v in value.items() if k != "elapsed_ms"}
    if isinstance(value, list):
        return [strip_timing(v) for v in value]
    return value


async def run_job(job_id: str, analyses: list[str], settings: dict, params: dict | None = None) -> dict:
    async with connection() as ws:
        ws.push({"type": "trainability_start", "job_id": job_id, "code": CODE, "observable": OBSERVABLE,
                 "analyses": analyses, "settings": settings, "params": params or {"n_qubits": 3, "n_layers": 2}})
        return await ws.wait_type("trainability_result", timeout=240)


def test_real_job_end_to_end():
    settings = {
        "samples": 32, "seed": 5, "method": "sampling",
        "scaling": {"qubits": [2, 3, 4, 5], "layers": [2]},
        "expressibility": {"pairs": 100}, "entanglement": {"samples": 32},
        "landscape": {"resolution": 11},
    }
    result = run(lambda: run_job("int-1", ["gradients", "scaling", "lie", "expressibility",
                                           "entanglement", "landscape"], settings))
    assert result["status"] == "complete", result["errors"]
    assert set(result["results"]) == {"gradients", "scaling", "lie", "expressibility", "entanglement", "landscape"}
    assert result["results"]["gradients"]["samples"] == 32
    assert len(result["results"]["scaling"]["points"]) == 4
    assert result["results"]["lie"]["status"] in {"complete", "truncated", "unsupported"}
    prov = result["provenance"]
    assert prov["settings"]["seed"] == 5 and prov["observable"] == OBSERVABLE


def test_lint_round_trip_with_real_rules():
    async def scenario():
        async with connection() as ws:
            ws.push({"type": "trainability_lint", "code": CODE, "observable": OBSERVABLE,
                     "params": {"n_qubits": 3}})
            return await ws.wait_type("trainability_lint_result", timeout=30)

    msg = run(scenario)
    assert isinstance(msg["diagnostics"], list)
    assert msg["summary"]["n_qubits"] == 3 and msg["summary"]["observable"] == OBSERVABLE


@pytest.mark.parametrize("method", ["sampling", "ppe"])
def test_gradients_are_reproducible_for_the_same_seed(method):
    """Addendum D: same code, settings and seed give identical numbers."""
    settings = {"samples": 64, "seed": 11, "method": method}
    first = run(lambda: run_job("rep-a", ["gradients"], settings))
    second = run(lambda: run_job("rep-b", ["gradients"], settings))
    for result in (first, second):
        assert result["status"] == "complete", result["errors"]
    assert strip_timing(first["results"]["gradients"]) == strip_timing(second["results"]["gradients"])
    assert first["results"]["gradients"].get("method") == method
    assert first["provenance"]["code_sha256"] == second["provenance"]["code_sha256"]
    assert first["provenance"]["analyses_fingerprint"] == second["provenance"]["analyses_fingerprint"]


def test_lie_algebra_is_reproducible():
    settings = {"seed": 2}
    first = run(lambda: run_job("lie-a", ["lie"], settings))
    second = run(lambda: run_job("lie-b", ["lie"], settings))
    assert first["status"] == second["status"] == "complete", (first["errors"], second["errors"])
    assert strip_timing(first["results"]["lie"]) == strip_timing(second["results"]["lie"])


def test_different_seeds_change_sampling_gradients():
    a = run(lambda: run_job("seed-a", ["gradients"], {"samples": 64, "seed": 1, "method": "sampling"}))
    b = run(lambda: run_job("seed-b", ["gradients"], {"samples": 64, "seed": 2, "method": "sampling"}))
    assert strip_timing(a["results"]["gradients"]) != strip_timing(b["results"]["gradients"])
