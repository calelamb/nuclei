"""Calibrated variational trainer (threshold + best-theta restore)."""

from __future__ import annotations

import json

import numpy as np
import pytest

from kernel.trainability._analysis_common import AnalysisCancelled, AnalysisError
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.pauli import parse_observable
from kernel.trainability.qml_calibrated import select_threshold, variational_calibrated
from kernel.trainability.qml_data import load_dataset, split_dataset


def _classifier() -> ParamCircuit:
    # The 2-layer re-uploading classifier of docs/qml-benchmark-results.
    gates = [
        IrGate("RX", (0,), (ParamRef("x0"),), 0),
        IrGate("RX", (1,), (ParamRef("x1"),), 1),
        IrGate("RY", (0,), (ParamRef("theta0"),), 2),
        IrGate("RY", (1,), (ParamRef("theta1"),), 3),
        IrGate("CZ", (0, 1), (), 4),
        IrGate("RX", (0,), (ParamRef("x0"),), 5),
        IrGate("RX", (1,), (ParamRef("x1"),), 6),
        IrGate("RY", (0,), (ParamRef("theta2"),), 7),
        IrGate("RY", (1,), (ParamRef("theta3"),), 8),
        IrGate("CZ", (0, 1), (), 9),
        IrGate("RY", (0,), (ParamRef("theta4"),), 10),
    ]
    return ParamCircuit(2, gates, ["x0", "x1", "theta0", "theta1", "theta2", "theta3", "theta4"])


_THETAS = {"theta0", "theta1", "theta2", "theta3", "theta4"}


def _strip(res):
    return json.dumps({k: v for k, v in res.items() if k != "elapsed_ms"}, sort_keys=True)


# ------------------------------------------------------------- threshold unit
def test_select_threshold_recovers_offset_scores():
    # Both classes shifted positive: sign() calls everything +1 (acc 0.5),
    # but the ranking is perfect, so a threshold at 0.3 separates them.
    scores = np.array([0.1, 0.2, 0.5, 0.6])
    y = np.array([-1.0, -1.0, 1.0, 1.0])
    t, acc = select_threshold(scores, y)
    assert acc == 1.0
    assert 0.2 < t <= 0.5


def test_select_threshold_keeps_zero_when_it_is_optimal():
    scores = np.array([-0.8, -0.2, 0.3, 0.9])
    y = np.array([-1.0, -1.0, 1.0, 1.0])
    t, acc = select_threshold(scores, y)
    assert acc == 1.0
    assert t == 0.0  # tie-break: closest to 0


def test_select_threshold_never_worse_than_sign_on_its_inputs():
    rng = np.random.default_rng(0)
    for _ in range(20):
        scores = rng.uniform(-1.0, 1.0, 30)
        y = rng.choice([-1.0, 1.0], 30)
        t, acc = select_threshold(scores, y)
        sign_acc = float((np.sign(scores) == y).mean())
        assert acc >= sign_acc
        assert scores.min() - 1e-12 <= t <= max(scores.max(), 0.0) + 1e-12


# ------------------------------------------------------------------- end to end
def test_calibrated_trains_on_blobs_and_beats_sign_baseline():
    obs = parse_observable("Z0", 2)
    res = variational_calibrated(
        _classifier(), obs, dataset="blobs", dataset_samples=48,
        epochs=60, learning_rate=0.15, seed=7,
    )
    assert res["optimizer"] == "adam"
    assert res["data_params"] == ["x0", "x1"]
    assert res["trainable_params"] == ["theta0", "theta1", "theta2", "theta3", "theta4"]
    assert len(res["history"]) == 60
    assert -1.0 <= res["threshold"] <= 1.0
    # Guaranteed on train by construction (t=0 is a candidate); also hold the
    # deployed test number to the sign baseline at the same restored theta.
    assert res["final_train_accuracy"] >= res["sign_train_accuracy"]
    assert res["final_test_accuracy"] >= res["sign_test_accuracy"]
    assert res["final_train_accuracy"] == pytest.approx(res["threshold_train_accuracy"])
    assert 0 <= res["best_epoch"] <= res["epochs_run"]
    assert res["selection"] == "train_loss" and res["n_val"] == 0
    assert res["n_subtrain"] + res["n_val"] == res["n_train"]
    assert set(res["final_parameters"]) == _THETAS
    json.dumps(res, allow_nan=False)


def test_validation_carve_selects_on_val_loss():
    obs = parse_observable("Z0", 2)
    res = variational_calibrated(
        _classifier(), obs, dataset="blobs", dataset_samples=48,
        epochs=8, seed=1, val_fraction=0.25,
    )
    assert res["selection"] == "val_loss"
    assert res["n_val"] > 0 and res["n_subtrain"] + res["n_val"] == res["n_train"]
    assert res["history"][0]["val_loss"] is not None
    assert res["final_train_accuracy"] >= res["sign_train_accuracy"]
    json.dumps(res, allow_nan=False)


def test_no_test_label_leakage_in_threshold_or_selection(monkeypatch):
    # Threshold, best epoch and restored theta are functions of train rows
    # only: flipping the signed labels of test rows must not move them.
    import kernel.trainability.qml_calibrated as mod

    obs = parse_observable("Z0", 2)
    kwargs = dict(dataset="moons", dataset_samples=48, epochs=30, learning_rate=0.15, seed=7)
    base = variational_calibrated(_classifier(), obs, **kwargs)

    real_load = mod.load_dataset

    def flipped_load(name, n, noise, seed):
        data = real_load(name, n, noise, seed)
        _, test_idx = split_dataset(data, 0.7, seed)
        data = dict(data)
        y = data["y_signed"].copy()
        y[test_idx] = -y[test_idx]
        data["y_signed"] = y
        return data

    monkeypatch.setattr(mod, "load_dataset", flipped_load)
    flipped = variational_calibrated(_classifier(), obs, **kwargs)
    assert flipped["threshold"] == base["threshold"]
    assert flipped["best_epoch"] == base["best_epoch"]
    assert flipped["final_parameters"] == base["final_parameters"]
    assert flipped["final_train_accuracy"] == base["final_train_accuracy"]


def test_balanced_class_weight_path():
    obs = parse_observable("Z0", 2)
    res = variational_calibrated(
        _classifier(), obs, dataset="blobs", dataset_samples=24,
        epochs=6, seed=2, class_weight="balanced",
    )
    assert res["class_weight"] == "balanced"
    json.dumps(res, allow_nan=False)
    with pytest.raises(AnalysisError) as exc:
        variational_calibrated(_classifier(), obs, dataset_samples=12, epochs=1, class_weight="heavy")
    assert exc.value.code == "invalid_request"
    with pytest.raises(AnalysisError) as exc:
        variational_calibrated(_classifier(), obs, dataset_samples=12, epochs=1, val_fraction=0.9)
    assert exc.value.code == "invalid_request"


# --------------------------------------------------------------------- protocol
def test_determinism_progress_cancel():
    obs = parse_observable("Z0", 2)
    kwargs = dict(dataset="moons", dataset_samples=20, epochs=6, seed=9)
    a = variational_calibrated(_classifier(), obs, **kwargs)
    b = variational_calibrated(_classifier(), obs, **kwargs)
    assert _strip(a) == _strip(b)
    fracs: list[float] = []
    variational_calibrated(_classifier(), obs, progress=lambda f, m: fracs.append(f), **kwargs)
    assert fracs == sorted(fracs) and fracs[-1] == 1.0
    with pytest.raises(AnalysisCancelled):
        variational_calibrated(_classifier(), obs, cancel=lambda: True, **kwargs)
