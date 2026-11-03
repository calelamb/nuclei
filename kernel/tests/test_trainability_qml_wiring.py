"""Registry wiring for QML extensions A/B/C (see docs/quantum-ml-extensions-spec.md S5)."""

from __future__ import annotations

import pytest

from kernel.trainability._errors import TrainabilityError
from kernel.trainability._settings import normalize_analyses, normalize_settings
from kernel.trainability._usercode import LoadedCircuit
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.job_worker import JobData, run_analysis
from kernel.trainability.pauli import parse_observable


def _feature_map() -> ParamCircuit:
    gates = [
        IrGate("RX", (0,), (ParamRef("x0"),), 0),
        IrGate("RX", (1,), (ParamRef("x1"),), 1),
        IrGate("CZ", (0, 1), (), 2),
    ]
    return ParamCircuit(2, gates, ["x0", "x1"])


def _classifier() -> ParamCircuit:
    gates = [
        IrGate("RX", (0,), (ParamRef("x0"),), 0),
        IrGate("RX", (1,), (ParamRef("x1"),), 1),
        IrGate("RY", (0,), (ParamRef("theta0"),), 2),
        IrGate("RY", (1,), (ParamRef("theta1"),), 3),
        IrGate("CZ", (0, 1), (), 4),
        IrGate("RY", (0,), (ParamRef("theta2"),), 5),
    ]
    return ParamCircuit(2, gates, ["x0", "x1", "theta0", "theta1", "theta2"])


def _job(circuit, settings):
    return JobData(
        code="", language=None, params={}, observable="Z0", settings=settings,
        loaded=LoadedCircuit(circuit, None, {}),
        observable_sum=parse_observable("Z0", 2),
    )


def test_settings_normalize_extension_sections_and_ordering():
    settings = normalize_settings(None)
    assert settings["baseline"] == {"include_linear": True}
    assert settings["align"] == {
        "mode": "bandwidth", "steps": 40, "learning_rate": 0.1, "spsa_a": 0.05, "spsa_c": 0.1,
    }
    assert settings["qng"] == {
        "metric_regularization": 1e-3, "metric_every": 1, "max_metric_params": 32,
    }
    clamped = normalize_settings({"align": {"steps": 9999}, "qng": {"metric_regularization": 9.0}})
    assert clamped["align"]["steps"] == 500
    assert clamped["qng"]["metric_regularization"] == 1.0
    assert normalize_analyses(["variational_qng", "classical_baseline", "quantum_kernel"]) == [
        "quantum_kernel", "classical_baseline", "variational_qng",
    ]
    with pytest.raises(TrainabilityError):
        normalize_settings({"baseline": {"include_linear": "yes"}})
    with pytest.raises(TrainabilityError):
        normalize_settings({"align": {"mode": "sideways"}})


def test_job_worker_dispatches_classical_baseline():
    settings = normalize_settings({"qml": {"dataset": "blobs", "samples": 16}})
    res = run_analysis(_job(_feature_map(), settings), "classical_baseline", lambda f, m: None, lambda: False)
    assert res["dataset"] == "blobs"
    assert res["verdict"] in ("quantum_ahead", "classical_ahead", "tie")
    assert res["quantum"] is not None


def test_job_worker_dispatches_kernel_alignment_search():
    settings = normalize_settings({"qml": {"dataset": "blobs", "samples": 16}, "align": {"steps": 2}})
    res = run_analysis(_job(_feature_map(), settings), "kernel_alignment_search", lambda f, m: None, lambda: False)
    assert res["dataset"] == "blobs" and "initial" in res


def test_job_worker_dispatches_variational_qng():
    settings = normalize_settings({"qml": {"dataset": "blobs", "samples": 16}, "variational": {"epochs": 3}})
    res = run_analysis(_job(_classifier(), settings), "variational_qng", lambda f, m: None, lambda: False)
    assert res["optimizer"] == "qng" and len(res["history"]) == 3


def test_classical_baseline_allows_parameter_free_circuit():
    settings = normalize_settings({"qml": {"dataset": "blobs", "samples": 16}})
    fixed = ParamCircuit(2, [IrGate("RX", (0,), (0.5,), 0)], [])
    res = run_analysis(_job(fixed, settings), "classical_baseline", lambda f, m: None, lambda: False)
    assert res["quantum"] is None and res["verdict"] == "no_quantum_kernel"
