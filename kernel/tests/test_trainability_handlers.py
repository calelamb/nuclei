"""Protocol tests: inspect, lint, validation and errors via the real server."""

from __future__ import annotations

import asyncio
import sys
import types

import pytest

pytest.importorskip("qiskit")

from kernel.tests._trainability_job_helpers import QISKIT_CODE, connection  # noqa: E402
from kernel.trainability._settings import normalize_analyses, normalize_settings  # noqa: E402
from kernel.trainability._errors import TrainabilityError  # noqa: E402


def run(scenario):
    return asyncio.run(scenario())


async def ask(ws, message: dict, response_type: str, timeout: float = 120.0) -> dict:
    ws.push(message)
    matches = await ws.wait_for(lambda m: m.get("type") in (response_type, "error"), timeout)
    return matches[0]


def test_inspect_finds_parameters_and_sweepables():
    code = QISKIT_CODE + "nuclei_observable = 'Z0*Z1'\n"

    async def scenario():
        async with connection() as ws:
            return await ask(ws, {"type": "trainability_inspect", "code": code,
                                  "params": {"n_qubits": 3}}, "trainability_inspected")

    msg = run(scenario)
    assert msg["type"] == "trainability_inspected"
    assert msg["framework"] == "qiskit" and msg["n_qubits"] == 3
    assert msg["parameters"] == ["a0_0", "a0_1", "a0_2"]
    assert msg["sweepable_params"] == ["n_qubits", "n_layers"]
    assert msg["observable_declared"] == "Z0*Z1"
    assert len(msg["param_gates"]) == 3 and msg["gate_count"] == 5


def test_inspect_circuit_without_parameters():
    code = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.h(0)\nqc.cx(0, 1)\n"

    async def scenario():
        async with connection() as ws:
            return await ask(ws, {"type": "trainability_inspect", "code": code}, "trainability_inspected")

    msg = run(scenario)
    assert msg["parameters"] == [] and msg["param_gates"] == [] and msg["sweepable_params"] == []


def test_inspect_unsupported_gate_uses_ir_code():
    code = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(1, 1)\nqc.h(0)\nqc.measure(0, 0)\nqc.h(0)\n"

    async def scenario():
        async with connection() as ws:
            return await ask(ws, {"type": "trainability_inspect", "code": code}, "trainability_inspected")

    msg = run(scenario)
    assert msg["type"] == "error" and msg["phase"] == "trainability"
    assert msg["code"] == "mid_circuit_measurement"
    assert "job_id" not in msg


@pytest.mark.parametrize(
    "request_extra,code_name",
    [
        ({"code": "x = 1\n"}, "no_circuit"),
        ({"code": "def f(:\n"}, "compile_error"),
        ({"code": "raise ValueError('x')\n"}, "execution_error"),
        ({"code": ""}, "invalid_request"),
        ({"code": QISKIT_CODE, "params": [1]}, "invalid_request"),
    ],
)
def test_inspect_error_envelopes(request_extra, code_name):
    async def scenario():
        async with connection() as ws:
            return await ask(ws, {"type": "trainability_inspect", **request_extra}, "trainability_inspected")

    msg = run(scenario)
    assert msg["type"] == "error" and msg["phase"] == "trainability" and msg["code"] == code_name


def test_inspect_bad_declared_observable_has_column():
    code = QISKIT_CODE + "nuclei_observable = 'Z0 + Q1'\n"

    async def scenario():
        async with connection() as ws:
            return await ask(ws, {"type": "trainability_inspect", "code": code}, "trainability_inspected")

    msg = run(scenario)
    assert msg["code"] == "invalid_observable" and msg["column"] == 5


def test_unknown_trainability_message():
    async def scenario():
        async with connection() as ws:
            return await ask(ws, {"type": "trainability_bogus"}, "never")

    assert run(scenario)["code"] == "unknown_message"


# ----------------------------------------------------------------- lint


@pytest.fixture
def fake_lint(monkeypatch):
    calls: list[dict] = []
    module = types.ModuleType("kernel.trainability.lint")

    def lint(circuit, observable, *, source_lines=None, time_budget_s=0.35):
        calls.append({"n": circuit.n_qubits, "obs": observable.to_text(),
                      "lines": source_lines, "budget": time_budget_s})
        return {"diagnostics": [{"code": "TRN001", "severity": "warning", "title": "t", "message": "m",
                                 "citation": None, "line": 9, "source_indices": [0]}],
                "summary": {"n_qubits": circuit.n_qubits, "n_parameters": len(circuit.parameters),
                            "dla": None, "observable": observable.to_text(), "elapsed_ms": 1}}

    module.lint = lint
    monkeypatch.setitem(sys.modules, "kernel.trainability.lint", module)
    return calls


def test_lint_round_trip_passes_lines_budget_and_observable(fake_lint):
    async def scenario():
        async with connection() as ws:
            return await ask(ws, {"type": "trainability_lint", "code": QISKIT_CODE,
                                  "observable": "Z0*Z1"}, "trainability_lint_result")

    msg = run(scenario)
    assert msg["type"] == "trainability_lint_result"
    assert msg["diagnostics"][0]["code"] == "TRN001"
    assert msg["summary"]["observable"] == "Z0*Z1"
    call = fake_lint[0]
    assert call["budget"] <= 0.5 and call["budget"] > 0
    # source_index -> line: two RY gates on line 8 and the CZ on line 10.
    assert call["lines"] == {0: 8, 1: 8, 2: 10}


def test_lint_defaults_observable_to_local_z(fake_lint):
    async def scenario():
        async with connection() as ws:
            return await ask(ws, {"type": "trainability_lint", "code": QISKIT_CODE}, "trainability_lint_result")

    run(scenario)
    assert fake_lint[0]["obs"].count("Z") == 2


def test_lint_observable_error_carries_column(fake_lint):
    async def scenario():
        async with connection() as ws:
            return await ask(ws, {"type": "trainability_lint", "code": QISKIT_CODE,
                                  "observable": "Z0 + Q9"}, "trainability_lint_result")

    msg = run(scenario)
    assert msg["type"] == "error" and msg["code"] == "invalid_observable" and msg["column"] == 5
    assert not fake_lint


def test_lint_missing_module_reports_unavailable(monkeypatch):
    monkeypatch.setitem(sys.modules, "kernel.trainability.lint", None)  # forces ImportError

    async def scenario():
        async with connection() as ws:
            return await ask(ws, {"type": "trainability_lint", "code": QISKIT_CODE}, "trainability_lint_result")

    assert run(scenario)["code"] == "analysis_unavailable"


# ------------------------------------------------------ settings clamping


def test_settings_defaults_and_clamping():
    assert normalize_settings(None)["samples"] == 200
    s = normalize_settings({
        "samples": 1, "seed": -5, "init": "small", "method": "ppe", "backend": "numpy",
        "scaling": {"qubits": [1, 500, 4, 4] + list(range(5, 30)), "layers": [0, 2, 3, 4, 5, 6, 99]},
        "expressibility": {"pairs": 10, "bins": 9999},
        "entanglement": {"samples": 10**9},
        "landscape": {"resolution": 3, "span": 100},
        "lie": {"max_dimension": 0, "time_budget_s": 10**6},
    })
    assert s["samples"] == 16 and s["seed"] == 0 and s["init"] == "small"
    assert s["scaling"]["qubits"][0] == 2 and len(s["scaling"]["qubits"]) == 12
    assert max(s["scaling"]["qubits"]) <= 128
    assert s["scaling"]["layers"] == [1, 2, 3, 4]
    assert s["expressibility"] == {"pairs": 100, "bins": 200}
    assert s["entanglement"]["samples"] == 20000
    assert s["landscape"]["resolution"] == 11 and s["landscape"]["span"] <= 4 * 3.1416
    assert s["lie"] == {"max_dimension": 1, "time_budget_s": 120.0}
    assert normalize_settings({"samples": 10**6})["samples"] == 4096
    assert normalize_settings({"scaling": {"qubits": [500]}})["scaling"]["qubits"] == [128]


@pytest.mark.parametrize(
    "bad",
    [
        {"samples": "many"}, {"init": "gaussian"}, {"method": "magic"}, {"backend": "tpu"},
        {"scaling": {"qubit_param": "not valid"}}, {"scaling": {"qubit_param": "a", "layer_param": "a"}},
        {"scaling": {"qubits": []}}, {"scaling": []}, {"samples": True}, {"landscape": {"span": float("nan")}},
    ],
)
def test_settings_reject_malformed(bad):
    with pytest.raises(TrainabilityError) as err:
        normalize_settings(bad)
    assert err.value.code == "invalid_request"
    with pytest.raises(TrainabilityError):
        normalize_settings("nope")


def test_analyses_validation_dedupes_in_canonical_order():
    assert normalize_analyses(["landscape", "gradients", "landscape"]) == ["gradients", "landscape"]
    for bad in ([], "gradients", None):
        with pytest.raises(TrainabilityError) as err:
            normalize_analyses(bad)
        assert err.value.code == "invalid_request"
    with pytest.raises(TrainabilityError) as err:
        normalize_analyses(["gradients", "magic"])
    assert err.value.code == "unknown_analysis"


def test_start_validation_errors_reach_the_client():
    async def scenario():
        async with connection() as ws:
            out = []
            for msg in (
                {"type": "trainability_start", "job_id": "v1", "code": QISKIT_CODE, "analyses": ["nope"]},
                {"type": "trainability_start", "code": QISKIT_CODE, "analyses": ["lie"]},
                {"type": "trainability_start", "job_id": "v3", "code": QISKIT_CODE, "analyses": ["lie"],
                 "settings": {"init": "x"}},
            ):
                ws.push(msg)
            await ws.wait_for(lambda m: m.get("type") == "error" and m.get("code") == "invalid_request"
                              and "settings" in m["message"])
            return list(ws.sent)

    sent = run(scenario)
    assert [m["type"] for m in sent] == ["error"] * 3
    assert sent[0]["code"] == "unknown_analysis" and sent[0]["job_id"] == "v1"
    assert sent[1]["code"] == "invalid_request" and "job_id" not in sent[1]
    assert sent[2]["job_id"] == "v3"
    assert all(m["phase"] == "trainability" for m in sent)


def test_cancel_unknown_job_is_not_accepted():
    async def scenario():
        async with connection() as ws:
            return await ask(ws, {"type": "trainability_cancel", "job_id": "ghost"}, "trainability_cancelled")

    assert run(scenario) == {"type": "trainability_cancelled", "job_id": "ghost", "accepted": False}
