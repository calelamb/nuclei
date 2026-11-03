"""Optimizer / gradient-method choice for variational training (C3)."""

from __future__ import annotations

import json

import numpy as np
import pytest

from kernel.trainability._analysis_common import AnalysisError
from kernel.trainability._errors import TrainabilityError
from kernel.trainability._settings import normalize_settings
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.pauli import parse_observable
from kernel.trainability.qml_train import variational_train
from kernel.trainability.statevector import parameter_shift_grad, value_and_grad


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


def _strip(res: dict) -> str:
    return json.dumps({k: v for k, v in res.items() if k != "elapsed_ms"}, sort_keys=True)


def test_gd_reduces_loss_and_echoes_optimizer():
    obs = parse_observable("Z0", 2)
    res = variational_train(
        _classifier(), obs, dataset="blobs", dataset_samples=40,
        epochs=30, learning_rate=0.3, seed=4, optimizer="gd",
    )
    assert res["optimizer"] == "gd"
    assert res["gradient_method"] == "adjoint"
    assert res["epochs_run"] == 30 and res["stopped_early"] is False
    assert len(res["history"]) == 30
    assert res["final_loss"] < res["initial_loss"]


def test_spsa_is_seeded_reproducible():
    obs = parse_observable("Z0", 2)
    kwargs = dict(dataset="blobs", dataset_samples=24, epochs=12, seed=11, optimizer="spsa")
    a = variational_train(_classifier(), obs, **kwargs)
    b = variational_train(_classifier(), obs, **kwargs)
    assert a["optimizer"] == "spsa"
    assert _strip(a) == _strip(b)
    c = variational_train(_classifier(), obs, **{**kwargs, "seed": 12})
    assert not np.allclose(
        [a["final_parameters"][k] for k in sorted(a["final_parameters"])],
        [c["final_parameters"][k] for k in sorted(c["final_parameters"])],
    )
    assert np.isfinite(a["final_loss"])


def test_parameter_shift_gradient_matches_adjoint_and_trains():
    circuit = _classifier()
    obs = parse_observable("Z0", 2)
    values = np.array([0.3, 1.1, 0.7, 2.0, 0.5])
    _, adjoint_grad = value_and_grad(circuit, values, obs)
    shift_grad = parameter_shift_grad(circuit, values, obs)
    assert np.allclose(adjoint_grad, shift_grad, atol=1e-6)

    base = dict(dataset="blobs", dataset_samples=40, epochs=25, learning_rate=0.2, seed=4)
    adjoint = variational_train(_classifier(), obs, **base)
    shifted = variational_train(_classifier(), obs, gradient_method="parameter_shift", **base)
    assert shifted["gradient_method"] == "parameter_shift"
    assert shifted["final_test_accuracy"] >= adjoint["final_test_accuracy"] - 0.05
    assert shifted["final_loss"] < shifted["initial_loss"]


def test_early_stop_halts_on_plateau():
    obs = parse_observable("Z0", 2)
    res = variational_train(
        _classifier(), obs, dataset="blobs", dataset_samples=24,
        epochs=50, learning_rate=1e-5, seed=3, optimizer="gd", early_stop_patience=3,
    )
    assert res["stopped_early"] is True
    assert res["epochs_run"] < 50
    assert len(res["history"]) == res["epochs_run"]


def test_unknown_optimizer_and_method_are_invalid_request():
    obs = parse_observable("Z0", 2)
    with pytest.raises(AnalysisError) as exc:
        variational_train(_classifier(), obs, dataset="blobs", dataset_samples=12, optimizer="newton", seed=0)
    assert exc.value.code == "invalid_request"
    with pytest.raises(AnalysisError) as exc:
        variational_train(_classifier(), obs, dataset="blobs", dataset_samples=12, gradient_method="finite_diff", seed=0)
    assert exc.value.code == "invalid_request"
    with pytest.raises(TrainabilityError) as exc:
        normalize_settings({"variational": {"optimizer": "newton"}})
    assert exc.value.code == "invalid_request"
    with pytest.raises(TrainabilityError) as exc:
        normalize_settings({"variational": {"gradient_method": "magic"}})
    assert exc.value.code == "invalid_request"


def test_parameter_shift_rejects_u_gate_without_silent_fallback():
    gates = [
        IrGate("RX", (0,), (ParamRef("x0"),), 0),
        IrGate("RX", (1,), (ParamRef("x1"),), 1),
        IrGate("U", (0,), (ParamRef("theta0"), 0.0, 0.0), 2),
    ]
    circuit = ParamCircuit(2, gates, ["x0", "x1", "theta0"])
    with pytest.raises(AnalysisError) as exc:
        variational_train(
            circuit, parse_observable("Z0", 2), dataset="blobs", dataset_samples=12,
            gradient_method="parameter_shift", seed=0,
        )
    assert exc.value.code == "unsupported_gradient_method"


def test_settings_defaults_and_clamping_for_optimizer_fields():
    defaults = normalize_settings(None)
    assert defaults["variational"]["optimizer"] == "adam"
    assert defaults["variational"]["gradient_method"] == "adjoint"
    assert defaults["variational"]["early_stop_patience"] == 0
    assert defaults["variational"]["spsa_a"] == 0.05 and defaults["variational"]["spsa_c"] == 0.1
    clamped = normalize_settings({"variational": {"early_stop_patience": 999, "spsa_a": 99, "epochs": 3}})
    assert clamped["variational"]["early_stop_patience"] == 100
    assert clamped["variational"]["spsa_a"] == 2.0
    with pytest.raises(AnalysisError) as exc:
        variational_train(
            _classifier(), parse_observable("Z0", 2), dataset="blobs", dataset_samples=12,
            early_stop_patience=101, seed=0,
        )
    assert exc.value.code == "invalid_request"
