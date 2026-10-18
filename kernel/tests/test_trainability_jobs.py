"""Job subprocess + manager tests (fake external analyses via a test seam)."""

from __future__ import annotations

import asyncio
import json
import os
import time

import pytest

pytest.importorskip("qiskit")

from kernel.tests._trainability_job_helpers import (  # noqa: E402
    FAKE_MODULE,
    QISKIT_CODE,
    connection,
    wait_gone,
    write_fake_analyses,
)
from kernel.trainability import job_worker, jobs  # noqa: E402
from kernel.trainability._settings import normalize_settings  # noqa: E402
from kernel.trainability.jobs import TrainabilityJobManager  # noqa: E402

HANG, BOOM = 777, 888


@pytest.fixture
def make_manager(tmp_path):
    write_fake_analyses(tmp_path)
    created: list[TrainabilityJobManager] = []
    previous = jobs.get_manager()

    def factory(**kwargs) -> TrainabilityJobManager:
        manager = TrainabilityJobManager(
            extra_env={job_worker.OVERRIDE_ENV: FAKE_MODULE},
            extra_sys_path=[str(tmp_path)],
            **kwargs,
        )
        created.append(manager)
        jobs.set_manager(manager)
        return manager

    yield factory
    for manager in created:
        manager.release_all()
    jobs.set_manager(previous)


def start_msg(job_id: str, analyses=("gradients",), **extra) -> dict:
    return {"type": "trainability_start", "job_id": job_id, "code": QISKIT_CODE,
            "observable": "Z0*Z1", "analyses": list(analyses), **extra}


def run(scenario):
    return asyncio.run(scenario())


def result_of(sent: list[dict], job_id: str) -> dict:
    return next(m for m in sent if m["type"] == "trainability_result" and m["job_id"] == job_id)


def test_job_message_order_and_result_payload(make_manager):
    make_manager()

    async def scenario():
        async with connection() as ws:
            ws.push(start_msg("j1", ["landscape", "gradients", "expressibility", "entanglement", "lie"],
                              settings={"samples": 1, "seed": 3, "landscape": {"resolution": 11},
                                        "expressibility": {"pairs": 100}, "entanglement": {"samples": 20}}))
            await ws.wait_type("trainability_result")
            return list(ws.sent)

    sent = run(scenario)
    types = [m["type"] for m in sent]
    assert types[0] == "trainability_started" and types[-1] == "trainability_result"
    partials = [m["analysis"] for m in sent if m["type"] == "trainability_partial"]
    assert partials == ["gradients", "lie", "expressibility", "entanglement", "landscape"]
    # Every progress/partial message precedes the result and carries the job id.
    assert all(m["job_id"] == "j1" for m in sent)
    result = sent[-1]
    assert result["status"] == "complete" and result["errors"] == {}
    assert set(result["results"]) == set(partials)
    assert result["results"]["gradients"]["samples"] == 16  # clamped from 1
    assert result["results"]["gradients"]["observable"] == "Z0*Z1"
    assert result["results"]["landscape"]["resolution"] == 11
    assert result["elapsed_ms"] > 0
    prov = result["provenance"]
    assert prov["observable"] == "Z0*Z1" and prov["backend"] == "numpy"
    assert prov["settings"]["samples"] == 16 and prov["settings"]["seed"] == 3
    assert prov["kernel"]["nuclei_protocol"] == "1.3"
    assert len(prov["code_sha256"]) == 64 and len(prov["analyses_fingerprint"]) == 64
    # Each streamed partial equals the final result for that analysis.
    for m in sent:
        if m["type"] == "trainability_partial":
            assert result["results"][m["analysis"]] == m["result"]
    # Progress messages are well-formed.
    progress = [m for m in sent if m["type"] == "trainability_progress"]
    assert progress and all(0.0 <= m["fraction"] <= 1.0 for m in progress)


def test_observable_resolution_falls_back_to_module_then_preset(make_manager):
    make_manager()
    declared = QISKIT_CODE + "nuclei_observable = 'X0'\n"

    async def scenario():
        async with connection() as ws:
            a = start_msg("m1")
            a["code"], a["observable"] = declared, ""
            b = start_msg("m2")
            b["observable"] = ""
            ws.push(a)
            await ws.wait_for(lambda m: m["type"] == "trainability_result" and m["job_id"] == "m1")
            ws.push(b)
            await ws.wait_for(lambda m: m["type"] == "trainability_result" and m["job_id"] == "m2")
            return list(ws.sent)

    sent = run(scenario)
    assert result_of(sent, "m1")["provenance"]["observable"] == "X0"
    assert result_of(sent, "m2")["provenance"]["observable"] == "0.5*Z0 + 0.5*Z1"


def test_cancel_kills_the_subprocess_and_reports_cancelled(make_manager):
    manager = make_manager()

    async def scenario():
        async with connection() as ws:
            ws.push(start_msg("c1", ["gradients"], settings={"seed": HANG}))
            await ws.wait_for(lambda m: m["type"] == "trainability_progress")
            pids = manager.pids()
            assert len(pids) == 1
            ws.push({"type": "trainability_cancel", "job_id": "c1"})
            cancelled = await ws.wait_type("trainability_cancelled")
            result = await ws.wait_type("trainability_result")
            return pids, cancelled, result

    pids, cancelled, result = run(scenario)
    assert cancelled == {"type": "trainability_cancelled", "job_id": "c1", "accepted": True}
    assert result["status"] == "cancelled" and result["results"] == {}
    assert wait_gone(pids)
    assert manager.running() == 0


def test_cancel_after_completion_or_by_other_owner_is_rejected(make_manager):
    make_manager()

    async def scenario():
        async with connection() as a, connection() as b:
            a.push(start_msg("o1", ["gradients"], settings={"seed": HANG}))
            await a.wait_for(lambda m: m["type"] == "trainability_progress")
            b.push({"type": "trainability_cancel", "job_id": "o1"})
            other = await b.wait_type("trainability_cancelled")
            a.push({"type": "trainability_cancel", "job_id": "o1"})
            await a.wait_type("trainability_result")
            a.push({"type": "trainability_cancel", "job_id": "o1"})
            await a.wait_for(lambda m: m["type"] == "trainability_cancelled" and m["accepted"] is False)
            return other

    assert run(scenario)["accepted"] is False


def test_owner_release_kills_process_group_including_children(make_manager, tmp_path):
    manager = make_manager()
    pidfile = tmp_path / "child.pid"
    code = QISKIT_CODE + (
        "import subprocess, sys\n"
        "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(600)'])\n"
        f"open({str(pidfile)!r}, 'w').write(str(child.pid))\n"
    )

    async def scenario():
        async with connection() as ws:
            msg = start_msg("r1", ["gradients"], settings={"seed": HANG})
            msg["code"] = code
            ws.push(msg)
            await ws.wait_for(lambda m: m["type"] == "trainability_progress")
            pids = manager.pids()
            return pids
        # leaving the context closes the socket -> release_owner

    pids = run(scenario)
    child = int(pidfile.read_text())
    assert wait_gone(pids + [child]), "worker or its child survived owner release"
    deadline = time.monotonic() + 5
    while manager.running() and time.monotonic() < deadline:
        time.sleep(0.05)
    assert manager.running() == 0


def test_busy_limits_per_owner_and_global(make_manager):
    manager = make_manager(max_global=3)

    async def scenario():
        async with connection() as a, connection() as b:
            for job in ("b1", "b2"):
                a.push(start_msg(job, settings={"seed": HANG}))
            await a.wait_for(lambda m: m["type"] == "trainability_progress" and m["job_id"] == "b2")
            a.push(start_msg("b3", settings={"seed": HANG}))
            owner_busy = await a.wait_type("error")
            b.push(start_msg("b4", settings={"seed": HANG}))
            await b.wait_for(lambda m: m["type"] == "trainability_progress")
            b.push(start_msg("b5", settings={"seed": HANG}))
            global_busy = await b.wait_type("error")
            return owner_busy, global_busy, manager.running()

    owner_busy, global_busy, running = run(scenario)
    assert owner_busy["code"] == "trainability_busy" and owner_busy["job_id"] == "b3"
    assert owner_busy["phase"] == "trainability"
    assert global_busy["code"] == "trainability_busy"
    assert running == 3
    deadline = time.monotonic() + 10
    while manager.running() and time.monotonic() < deadline:
        time.sleep(0.05)
    assert manager.running() == 0, "closing both connections must release every job"


def test_duplicate_job_id_is_rejected(make_manager):
    make_manager()

    async def scenario():
        async with connection() as ws:
            ws.push(start_msg("d1", settings={"seed": HANG}))
            await ws.wait_for(lambda m: m["type"] == "trainability_progress")
            ws.push(start_msg("d1", settings={"seed": HANG}))
            return await ws.wait_type("error")

    assert run(scenario)["code"] == "invalid_request"


def test_wall_limit_fails_the_job(make_manager):
    manager = make_manager(wall_limit_s=2.0)

    async def scenario():
        async with connection() as ws:
            ws.push(start_msg("w1", ["gradients", "lie"], settings={"seed": HANG}))
            return await ws.wait_type("trainability_result", timeout=40), manager.pids()

    result, _ = run(scenario)
    assert result["status"] == "failed"
    assert result["errors"]["gradients"]["code"] == "wall_limit"
    assert result["errors"]["lie"]["code"] == "wall_limit"


def test_user_code_exception_in_one_analysis_does_not_stop_the_others(make_manager):
    make_manager()

    async def scenario():
        async with connection() as ws:
            ws.push(start_msg("e1", ["gradients", "lie", "landscape"],
                              settings={"seed": BOOM, "landscape": {"resolution": 11}}))
            return await ws.wait_type("trainability_result")

    result = run(scenario)
    assert result["status"] == "complete"
    assert result["errors"]["gradients"]["code"] == "analysis_failed"
    assert "boom in gradients" in result["errors"]["gradients"]["message"]
    assert set(result["results"]) == {"lie", "landscape"}


def test_all_analyses_failing_is_failed_status(make_manager):
    make_manager()

    async def scenario():
        async with connection() as ws:
            ws.push(start_msg("f1", ["gradients"], settings={"seed": BOOM}))
            return await ws.wait_type("trainability_result")

    assert run(scenario)["status"] == "failed"


@pytest.mark.parametrize(
    "code,observable,expected,column",
    [
        ("raise RuntimeError('user bug')\n", "Z0", "execution_error", None),
        ("def f(:\n", "Z0", "compile_error", None),
        ("x = 1\n", "Z0", "no_circuit", None),
        (QISKIT_CODE, "Z0 + Q1", "invalid_observable", 5),
        (QISKIT_CODE, "Z7", "invalid_observable", 1),
    ],
)
def test_prepare_failures_are_job_correlated_errors(make_manager, code, observable, expected, column):
    make_manager()

    async def scenario():
        async with connection() as ws:
            msg = start_msg("p1")
            msg["code"], msg["observable"] = code, observable
            ws.push(msg)
            err = await ws.wait_type("error")
            return err, list(ws.sent)

    err, sent = run(scenario)
    assert err["code"] == expected and err["job_id"] == "p1" and err["phase"] == "trainability"
    assert err.get("column") == column
    assert "trainability_result" not in [m["type"] for m in sent]


def test_scaling_re_executes_code_with_sweep_params(make_manager):
    make_manager()

    async def scenario():
        async with connection() as ws:
            ws.push(start_msg(
                "s1", ["scaling"],
                params={"n_qubits": 9, "n_layers": 9, "extra": 1},
                settings={"scaling": {"qubits": [2, 3], "layers": [1, 2]}},
            ))
            return await ws.wait_type("trainability_result")

    result = run(scenario)
    points = result["results"]["scaling"]["points"]
    assert [(p["n_qubits"], p["n_layers"], p["n_params"]) for p in points] == [
        (2, 1, 2), (2, 2, 4), (3, 1, 3), (3, 2, 6)
    ]
    assert result["results"]["scaling"]["observable_spec"] == "Z0*Z1"


def test_user_prints_do_not_corrupt_the_protocol_stream(make_manager):
    make_manager()
    code = QISKIT_CODE + "print('{\"event\": \"done\"}')\nprint('noise')\n"

    async def scenario():
        async with connection() as ws:
            msg = start_msg("n1", ["lie"])
            msg["code"] = code
            ws.push(msg)
            return await ws.wait_type("trainability_result")

    result = run(scenario)
    assert result["status"] == "complete" and "lie" in result["results"]


def test_non_finite_numbers_become_null(make_manager, tmp_path):
    (tmp_path / "fake_trn_analyses.py").write_text(
        "def lie_algebra(circuit, *, observable, **kw):\n"
        "    return {'status': 'complete', 'x': float('nan'), 'y': float('inf')}\n",
        encoding="utf-8",
    )
    make_manager()

    async def scenario():
        async with connection() as ws:
            ws.push(start_msg("nan1", ["lie"]))
            return await ws.wait_type("trainability_result")

    result = run(scenario)
    assert result["results"]["lie"]["x"] is None and result["results"]["lie"]["y"] is None
    json.dumps(result, allow_nan=False)


def test_progress_is_rate_limited_to_ten_per_second():
    class Ctx:
        def __init__(self):
            self.sent = []
            self.owner = 1

        def emit_threadsafe(self, payload):
            self.sent.append(payload)

    manager = TrainabilityJobManager()
    ctx = Ctx()
    job = jobs._Job("rl", 1, ctx, {})  # type: ignore[arg-type]
    for i in range(200):
        manager._handle_line(
            job,
            json.dumps({"event": "progress", "analysis": "gradients", "fraction": i / 200, "message": "m"}),
            ctx.emit_threadsafe,
        )
    assert 1 <= len(ctx.sent) <= 2
    time.sleep(0.12)
    manager._handle_line(
        job, json.dumps({"event": "progress", "analysis": "gradients", "fraction": 1.0, "message": "m"}),
        ctx.emit_threadsafe,
    )
    assert len(ctx.sent) >= 2


def test_minimal_env_has_no_leaked_variables(monkeypatch):
    monkeypatch.setenv("SECRET_TOKEN", "hunter2")
    env = jobs.minimal_env({"X": "1"})
    assert "SECRET_TOKEN" not in env and env["X"] == "1" and env["OMP_NUM_THREADS"] == "1"


# ----------------------------------------------- in-process worker dispatch


def run_worker(monkeypatch, tmp_path, code, analyses, **settings):
    write_fake_analyses(tmp_path)
    monkeypatch.syspath_prepend(str(tmp_path))
    monkeypatch.setenv(job_worker.OVERRIDE_ENV, FAKE_MODULE)
    events: list[dict] = []
    job_worker.run_job(
        {"code": code, "language": None, "params": {}, "observable": "Z0", "analyses": analyses,
         "settings": normalize_settings(settings)},
        events.append,
    )
    return events


WIDE = "from qiskit import QuantumCircuit\nfrom qiskit.circuit import Parameter\nqc = QuantumCircuit(21)\nqc.ry(Parameter('t'), 0)\n"
NO_PARAMS = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.h(0)\n"


def test_worker_caps_statevector_analyses(monkeypatch, tmp_path):
    events = run_worker(monkeypatch, tmp_path, WIDE,
                        ["expressibility", "entanglement", "landscape", "gradients", "lie"], method="sampling")
    errors = {e["analysis"]: e for e in events if e["event"] == "analysis_error"}
    assert set(errors) == {"expressibility", "entanglement", "landscape", "gradients"}
    assert all(e["code"] == "too_many_qubits" for e in errors.values())
    assert any(e["event"] == "partial" and e["analysis"] == "lie" for e in events)


def test_worker_allows_ppe_gradients_beyond_statevector_limit(monkeypatch, tmp_path):
    events = run_worker(monkeypatch, tmp_path, WIDE, ["gradients"], method="ppe")
    assert any(e["event"] == "partial" and e["analysis"] == "gradients" for e in events)


def test_worker_reports_parameterless_circuits(monkeypatch, tmp_path):
    events = run_worker(monkeypatch, tmp_path, NO_PARAMS, ["gradients", "landscape", "expressibility"])
    errors = {e["analysis"]: e["code"] for e in events if e["event"] == "analysis_error"}
    assert errors == {"gradients": "no_parameters", "landscape": "no_parameters"}
    assert any(e["event"] == "partial" and e["analysis"] == "expressibility" for e in events)


def test_worker_missing_external_analysis_is_isolated(monkeypatch, tmp_path):
    write_fake_analyses(tmp_path)
    monkeypatch.setenv(job_worker.OVERRIDE_ENV, "definitely_not_a_module")
    events: list[dict] = []
    job_worker.run_job(
        {"code": QISKIT_CODE, "observable": "Z0", "analyses": ["gradients", "landscape"],
         "settings": normalize_settings({"landscape": {"resolution": 11}})},
        events.append,
    )
    errors = {e["analysis"]: e["code"] for e in events if e["event"] == "analysis_error"}
    assert errors == {"gradients": "analysis_unavailable"}
    assert any(e["event"] == "partial" and e["analysis"] == "landscape" for e in events)


def test_call_filtered_drops_unsupported_keywords():
    def narrow(a, *, x):
        return (a, x)

    assert job_worker.call_filtered(narrow, 1, x=2, progress=None, backend="numpy") == (1, 2)

    def wide(a, **kw):
        return kw

    assert job_worker.call_filtered(wide, 1, progress=3) == {"progress": 3}
