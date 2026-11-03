"""QML datasets, quantum kernel and variational training (Trainability Lab)."""

from __future__ import annotations

import json

import numpy as np
import pytest

from kernel.trainability._analysis_common import AnalysisError
from kernel.trainability._settings import normalize_analyses, normalize_settings
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.pauli import parse_observable
from kernel.trainability.qml_data import DATASETS, load_dataset, split_dataset
from kernel.trainability.qml_kernel import centered_alignment, fidelity_kernel, quantum_kernel
from kernel.trainability.qml_train import resolve_data_params, variational_train


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


# ------------------------------------------------------------------ datasets
@pytest.mark.parametrize("name", DATASETS)
def test_datasets_are_deterministic_binary_and_angle_scaled(name):
    a = load_dataset(name, 40, 0.1, 7)
    b = load_dataset(name, 40, 0.1, 7)
    assert a["n_features"] == 2 and a["X"].shape == (40, 2)
    assert np.array_equal(a["X"], b["X"]) and np.array_equal(a["y"], b["y"])
    assert set(np.unique(a["y"])) == {0, 1}
    assert np.all(a["X"] >= 0.0) and np.all(a["X"] < 2.0 * np.pi)
    assert set(np.unique(a["y_signed"])) == {-1.0, 1.0}
    assert not np.array_equal(a["X"], load_dataset(name, 40, 0.1, 8)["X"])


def test_split_is_stratified_and_deterministic():
    data = load_dataset("blobs", 40, 0.1, 3)
    train, test = split_dataset(data, 0.7, 3)
    assert len(train) + len(test) == 40 and not set(train) & set(test)
    assert set(data["y"][train]) == {0, 1} and set(data["y"][test]) == {0, 1}
    train2, test2 = split_dataset(data, 0.7, 3)
    assert np.array_equal(train, train2) and np.array_equal(test, test2)


def test_unknown_dataset_is_a_clean_error():
    with pytest.raises(AnalysisError) as exc:
        load_dataset("mnist", 10, 0.1, 0)
    assert exc.value.code == "invalid_request"


# -------------------------------------------------------------------- kernel
def test_fidelity_kernel_matches_product_closed_form_without_entangler():
    gates = [IrGate("RX", (0,), (ParamRef("x0"),), 0), IrGate("RX", (1,), (ParamRef("x1"),), 1)]
    circuit = ParamCircuit(2, gates, ["x0", "x1"])
    res = quantum_kernel(circuit, dataset="blobs", dataset_samples=12, seed=5)
    x = load_dataset("blobs", 12, 0.1, 5)["X"]
    expected = (
        np.cos((x[:, 0][:, None] - x[:, 0][None, :]) / 2) ** 2
        * np.cos((x[:, 1][:, None] - x[:, 1][None, :]) / 2) ** 2
    )
    assert np.allclose(res["kernel"], expected, atol=1e-10)
    assert res["kernel"][0][0] == 1.0
    json.dumps(res, allow_nan=False)


def test_kernel_result_shape_alignment_and_accuracy():
    res = quantum_kernel(_feature_map(), dataset="blobs", dataset_samples=40, seed=2)
    assert res["n_train"] + res["n_test"] == 40
    assert 0.0 <= res["alignment"] <= 1.0
    assert 0.0 <= res["train_accuracy"] <= 1.0 and 0.0 <= res["test_accuracy"] <= 1.0
    assert len(res["eigenvalues"]) == 40 and res["eigenvalues"][0] >= res["eigenvalues"][-1] >= 0.0
    assert 1.0 <= res["effective_dimension"] <= 40.0
    # Separable blobs should be learnable by a reasonable feature map.
    assert res["test_accuracy"] >= 0.6


def test_kernel_is_deterministic():
    a = quantum_kernel(_feature_map(), dataset="moons", dataset_samples=20, seed=9)
    b = quantum_kernel(_feature_map(), dataset="moons", dataset_samples=20, seed=9)
    strip = lambda r: json.dumps({k: v for k, v in r.items() if k != "elapsed_ms"}, sort_keys=True)
    assert strip(a) == strip(b)


def test_kernel_rejects_parameter_count_mismatch():
    circuit = ParamCircuit(1, [IrGate("RX", (0,), (ParamRef("x0"),), 0)], ["x0"])
    with pytest.raises(AnalysisError) as exc:
        quantum_kernel(circuit, dataset="moons", dataset_samples=12, seed=0)
    assert exc.value.code == "qml_dataset_mismatch"


def test_centered_alignment_of_label_kernel_is_one():
    y = np.array([1.0, 1.0, -1.0, -1.0])
    assert centered_alignment(np.outer(y, y), y) == pytest.approx(1.0)
    states = np.eye(4, dtype=complex)
    assert fidelity_kernel(states) == pytest.approx(np.eye(4))


# ------------------------------------------------------------------ training
def test_variational_training_reduces_loss_and_is_deterministic():
    obs = parse_observable("Z0", 2)
    kwargs = dict(dataset="blobs", dataset_samples=40, epochs=40, learning_rate=0.2, seed=4)
    res = variational_train(_classifier(), obs, **kwargs)
    assert res["data_params"] == ["x0", "x1"]
    assert res["trainable_params"] == ["theta0", "theta1", "theta2"]
    assert len(res["history"]) == 40
    assert res["final_loss"] < res["initial_loss"]
    assert res["final_test_accuracy"] >= 0.75
    assert set(res["final_parameters"]) == {"theta0", "theta1", "theta2"}
    json.dumps(res, allow_nan=False)
    again = variational_train(_classifier(), obs, **kwargs)
    strip = lambda r: json.dumps({k: v for k, v in r.items() if k != "elapsed_ms"}, sort_keys=True)
    assert strip(res) == strip(again)


def test_variational_training_reports_progress_and_honours_cancel():
    obs = parse_observable("Z0", 2)
    fracs: list[float] = []
    variational_train(
        _classifier(), obs, dataset="blobs", dataset_samples=16, epochs=5,
        seed=1, progress=lambda f, m: fracs.append(f),
    )
    assert fracs == sorted(fracs) and fracs[-1] == 1.0
    from kernel.trainability._analysis_common import AnalysisCancelled
    with pytest.raises(AnalysisCancelled):
        variational_train(
            _classifier(), obs, dataset="blobs", dataset_samples=16, epochs=5,
            seed=1, cancel=lambda: True,
        )


def test_data_param_resolution_rules():
    circuit = _classifier()
    assert resolve_data_params(circuit, None) == ["x0", "x1"]
    assert resolve_data_params(circuit, ["theta0"]) == ["theta0"]
    with pytest.raises(AnalysisError):
        resolve_data_params(circuit, ["nope"])
    obs = parse_observable("Z0", 2)
    feature_only = _feature_map()
    with pytest.raises(AnalysisError) as exc:
        variational_train(feature_only, obs, dataset="blobs", dataset_samples=12, seed=0)
    assert exc.value.code == "no_parameters"
    no_data = ParamCircuit(1, [IrGate("RY", (0,), (ParamRef("theta0"),), 0)], ["theta0"])
    with pytest.raises(AnalysisError) as exc:
        variational_train(no_data, parse_observable("Z0", 1), dataset="blobs", dataset_samples=12, seed=0)
    assert exc.value.code == "qml_dataset_mismatch"


# ----------------------------------------------------------------- job wiring
def test_job_worker_dispatches_both_qml_analyses():
    from kernel.trainability._usercode import LoadedCircuit
    from kernel.trainability.job_worker import JobData, run_analysis

    settings = normalize_settings({"qml": {"dataset": "blobs", "samples": 16}, "variational": {"epochs": 3}})
    kernel_job = JobData(
        code="", language=None, params={}, observable="Z0", settings=settings,
        loaded=LoadedCircuit(_feature_map(), None, {}),
        observable_sum=parse_observable("Z0", 2),
    )
    kernel_res = run_analysis(kernel_job, "quantum_kernel", lambda f, m: None, lambda: False)
    assert kernel_res["dataset"] == "blobs" and len(kernel_res["kernel"]) == 16
    train_job = JobData(
        code="", language=None, params={}, observable="Z0", settings=settings,
        loaded=LoadedCircuit(_classifier(), None, {}),
        observable_sum=parse_observable("Z0", 2),
    )
    train_res = run_analysis(train_job, "variational_train", lambda f, m: None, lambda: False)
    assert train_res["epochs"] == 3 and len(train_res["history"]) == 3


# ------------------------------------------------------------------ settings
def test_settings_normalize_qml_sections_and_analyses():
    settings = normalize_settings(None)
    assert settings["qml"] == {"dataset": "moons", "samples": 48, "noise": 0.1, "train_fraction": 0.7}
    assert settings["kernel"] == {"ridge_lambda": 1.0}
    assert settings["variational"]["epochs"] == 60 and settings["variational"]["data_params"] is None
    clamped = normalize_settings({"qml": {"samples": 9999, "noise": 9}, "variational": {"epochs": 0}})
    assert clamped["qml"]["samples"] == 200 and clamped["qml"]["noise"] == 0.5
    assert clamped["variational"]["epochs"] == 1
    assert normalize_analyses(["variational_train", "quantum_kernel", "gradients"]) == [
        "gradients", "quantum_kernel", "variational_train",
    ]
