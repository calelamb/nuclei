"""Quantum natural gradient trainer (extension C; see docs/quantum-ml-extensions-spec.md)."""

from __future__ import annotations

import json

import numpy as np
import pytest

from kernel.trainability._analysis_common import AnalysisCancelled, AnalysisError
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.pauli import parse_observable
from kernel.trainability.qml_qng import fubini_study_metric, variational_qng


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


def _strip(res):
    return json.dumps({k: v for k, v in res.items() if k != "elapsed_ms"}, sort_keys=True)


# ------------------------------------------------------------------ metric math
@pytest.mark.parametrize("theta", [0.0, 0.7, 2.1, 4.0])
def test_rx_metric_closed_form(theta):
    circuit = ParamCircuit(1, [IrGate("RX", (0,), (ParamRef("theta"),), 0)], ["theta"])
    metric = fubini_study_metric(circuit, np.array([[theta]]))
    assert metric.shape == (1, 1)
    assert metric[0, 0] == pytest.approx(0.25, abs=1e-10)


def test_metric_is_symmetric_psd_and_transforms_under_rescaling():
    values = np.array([[0.3, 1.1, 0.5, 2.0, 0.9], [1.0, 0.2, 1.4, 0.6, 0.1]])
    metric = fubini_study_metric(_classifier(), values, param_indices=[2, 3, 4])
    assert np.allclose(metric, metric.T, atol=1e-12)
    assert np.linalg.eigvalsh(metric).min() >= -1e-12

    # Reparameterizing theta0 by a factor 2 (angle = 2*theta) scales its
    # metric block: g' = D g D with D = diag(2, 1, 1) at the same state.
    scaled = ParamCircuit(
        2,
        [
            IrGate("RX", (0,), (ParamRef("x0"),), 0),
            IrGate("RX", (1,), (ParamRef("x1"),), 1),
            IrGate("RY", (0,), (ParamRef("theta0", 2.0),), 2),
            IrGate("RY", (1,), (ParamRef("theta1"),), 3),
            IrGate("CZ", (0, 1), (), 4),
            IrGate("RY", (0,), (ParamRef("theta2"),), 5),
        ],
        ["x0", "x1", "theta0", "theta1", "theta2"],
    )
    scaled_values = values.copy()
    scaled_values[:, 2] /= 2.0  # same physical angles
    metric_scaled = fubini_study_metric(scaled, scaled_values, param_indices=[2, 3, 4])
    d = np.diag([2.0, 1.0, 1.0])
    assert np.allclose(metric_scaled, d @ metric @ d, atol=1e-9)


# ------------------------------------------------------------------- end to end
def test_qng_trains_on_blobs():
    obs = parse_observable("Z0", 2)
    res = variational_qng(
        _classifier(), obs, dataset="blobs", dataset_samples=40,
        epochs=40, learning_rate=0.5, seed=4,
    )
    assert res["optimizer"] == "qng"
    assert res["data_params"] == ["x0", "x1"] and res["trainable_params"] == ["theta0", "theta1", "theta2"]
    assert len(res["history"]) == 40
    assert res["final_loss"] < res["initial_loss"]
    assert res["final_test_accuracy"] >= 0.75
    assert set(res["final_parameters"]) == {"theta0", "theta1", "theta2"}
    assert res["fallbacks"] == 0
    entry = res["history"][0]
    assert {"grad_norm", "natural_grad_norm", "metric_condition"} <= set(entry)
    assert len(res["metric_eigenvalues"]) == 3
    assert res["metric_eigenvalues"][0] >= res["metric_eigenvalues"][-1] >= -1e-9
    json.dumps(res, allow_nan=False)


def test_metric_cap_and_protocol():
    obs = parse_observable("Z0", 2)
    with pytest.raises(AnalysisError) as exc:
        variational_qng(_classifier(), obs, dataset_samples=12, epochs=1, max_metric_params=2)
    assert exc.value.code == "qml_metric_too_large"

    kwargs = dict(dataset="blobs", dataset_samples=16, epochs=4, seed=1)
    a = variational_qng(_classifier(), obs, **kwargs)
    b = variational_qng(_classifier(), obs, **kwargs)
    assert _strip(a) == _strip(b)
    fracs: list[float] = []
    variational_qng(_classifier(), obs, progress=lambda f, m: fracs.append(f), **kwargs)
    assert fracs == sorted(fracs) and fracs[-1] == 1.0
    with pytest.raises(AnalysisCancelled):
        variational_qng(_classifier(), obs, cancel=lambda: True, **kwargs)
