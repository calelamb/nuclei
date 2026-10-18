"""The trusted scorer subprocess and its supervisor."""

from __future__ import annotations

import threading
import time

import pytest

stim = pytest.importorskip("stim")
pytest.importorskip("pymatching")

from kernel.discovery.scoring import run_scorer  # noqa: E402
from kernel.discovery.seeds.qec_repetition import build  # noqa: E402

EVALUATOR = {"kind": "qec_memory", "config": {"shots": {"min": 1000, "max": 3000, "max_errors": 20}}}


def artifacts(*distances: int) -> list[dict]:
    return [{"call_index": i, "artifact": {"circuit_text": str(build(d, d))}} for i, d in enumerate(distances)]


def run(evaluator=EVALUATOR, arts=None, seed=3, stage="full", **kw):
    return run_scorer(evaluator, arts if arts is not None else artifacts(3, 5), seed, stage=stage, wall_seconds=kw.pop("wall_seconds", 60), **kw)


def test_scorer_subprocess_scores_artifacts():
    core = run()
    assert core["status"] == "scored" and core["fitness"] > 0
    assert len(core["guardrails"]) == 10 and "protocol_version" not in core


def test_scorer_is_deterministic_across_processes():
    assert run(seed=5) == run(seed=5)


def test_scorer_rejects_via_guardrails():
    arts = [{"call_index": 0, "artifact": {"circuit_text": "H 0\nDEPOLARIZE1(0.1) 0"}},
            {"call_index": 1, "artifact": {"circuit_text": "H 0"}}]
    core = run(arts=arts)
    assert core["status"] == "rejected" and core["rejection"]["guardrail"] == "noiseless"


def test_unknown_evaluator_and_bad_config_are_coded_failures():
    unknown = run({"kind": "nope", "config": {}})
    assert unknown["status"] == "failed" and unknown["failure"]["code"] == "unknown_evaluator"
    bad = run({"kind": "qec_memory", "config": {"distances": [1]}})
    assert bad["failure"]["code"] == "invalid_config" and bad["failure"]["stage"] == "score"


def test_missing_artifact_is_a_scorer_failure_not_a_crash():
    core = run(arts=artifacts(3))  # config wants two distances
    assert core["status"] == "failed" and core["failure"]["code"] == "scorer_exception"


def test_wall_timeout_and_cancel_kill_the_scorer():
    slow = {"kind": "qec_memory", "config": {"distances": [15], "max_qubits": 2000, "shots": {"min": 1000, "max": 1000000, "max_errors": 1000000}}}
    arts = [{"call_index": 0, "artifact": {"circuit_text": str(stim.Circuit.generated("surface_code:rotated_memory_z", distance=15, rounds=15))}}]
    started = time.monotonic()
    timed = run(slow, arts, wall_seconds=1.0)
    assert timed["failure"]["code"] == "worker_timeout" and time.monotonic() - started < 90
    cancel = threading.Event()
    threading.Timer(0.8, cancel.set).start()
    cancelled = run(slow, arts, wall_seconds=60, cancel_event=cancel)
    assert cancelled["failure"]["code"] == "cancelled"


def test_cpu_limit_kills_the_scorer():
    slow = {"kind": "qec_memory", "config": {"distances": [15], "max_qubits": 2000, "shots": {"min": 1000, "max": 1000000, "max_errors": 1000000}}}
    arts = [{"call_index": 0, "artifact": {"circuit_text": str(stim.Circuit.generated("surface_code:rotated_memory_z", distance=15, rounds=15))}}]
    core = run(slow, arts, wall_seconds=60, cpu_seconds=1)
    assert core["failure"]["code"] in {"worker_killed", "worker_timeout"}
