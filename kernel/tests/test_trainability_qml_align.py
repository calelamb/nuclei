"""Kernel-alignment search (extension B; see docs/quantum-ml-extensions-spec.md)."""

from __future__ import annotations

import json

import numpy as np
import pytest

from kernel.trainability._analysis_common import AnalysisCancelled, AnalysisError
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.qml_align import kernel_alignment_search
from kernel.trainability.qml_kernel import centered_alignment, quantum_kernel
from kernel.trainability.qml_data import load_dataset, split_dataset


def _feature_map(coeff: float = 1.0) -> ParamCircuit:
    gates = [
        IrGate("RX", (0,), (ParamRef("x0", coeff),), 0),
        IrGate("RX", (1,), (ParamRef("x1", coeff),), 1),
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


def _strip(res):
    return json.dumps({k: v for k, v in res.items() if k != "elapsed_ms"}, sort_keys=True)


def test_initial_alignment_matches_quantum_kernel_oracle():
    kwargs = dict(dataset="blobs", dataset_samples=24, seed=5, steps=2)
    res = kernel_alignment_search(_feature_map(), **kwargs)
    oracle = quantum_kernel(_feature_map(), dataset="blobs", dataset_samples=24, seed=5)
    data = load_dataset("blobs", 24, 0.1, 5)
    train_idx, _ = split_dataset(data, 0.7, 5)
    kernel = np.array(oracle["kernel"])
    expected = centered_alignment(
        kernel[np.ix_(train_idx, train_idx)], data["y_signed"][train_idx],
    )
    assert res["initial"]["alignment"] == pytest.approx(expected)
    assert res["initial"]["train_accuracy"] == pytest.approx(oracle["train_accuracy"])


def test_best_iterate_restore_and_shrunk_map_recovery():
    res = kernel_alignment_search(
        _feature_map(coeff=0.1), dataset="blobs", dataset_samples=40,
        seed=2, steps=60, spsa_a=0.2,
    )
    assert res["best"]["alignment"] >= res["initial"]["alignment"]
    assert res["best"]["test_accuracy"] >= res["initial"]["test_accuracy"]
    assert all(w > 0 for w in res["bandwidth"])
    assert len(res["history"]) == res["steps_run"] == 60
    assert 0.0 <= res["rbf_baseline_test_accuracy"] <= 1.0
    json.dumps(res, allow_nan=False)


def test_bandwidth_mode_on_classifier_freezes_theta_at_init():
    seed = 4
    res = kernel_alignment_search(
        _classifier(), dataset="blobs", dataset_samples=24, seed=seed, steps=3,
    )
    rng = np.random.default_rng(seed)
    expected_theta = rng.uniform(0.0, 2.0 * np.pi, 3)
    names = ["theta0", "theta1", "theta2"]
    assert res["trainable_params"] == names
    for j, name in enumerate(names):
        assert res["final_parameters"][name] == pytest.approx(float(expected_theta[j]))


def test_error_codes():
    with pytest.raises(AnalysisError) as exc:
        kernel_alignment_search(_feature_map(), mode="embedding", dataset_samples=12, steps=1)
    assert exc.value.code == "no_parameters"
    with pytest.raises(AnalysisError) as exc:
        kernel_alignment_search(_feature_map(), data_params=["nope"], dataset_samples=12, steps=1)
    assert exc.value.code == "qml_dataset_mismatch"
    no_data = ParamCircuit(1, [IrGate("RY", (0,), (ParamRef("theta0"),), 0)], ["theta0"])
    with pytest.raises(AnalysisError) as exc:
        kernel_alignment_search(no_data, dataset_samples=12, steps=1)
    assert exc.value.code == "qml_dataset_mismatch"
    with pytest.raises(AnalysisError) as exc:
        kernel_alignment_search(_feature_map(), mode="bogus", dataset_samples=12, steps=1)
    assert exc.value.code == "invalid_request"


def test_determinism_progress_and_cancel():
    kwargs = dict(dataset="moons", dataset_samples=20, seed=9, steps=3)
    a = kernel_alignment_search(_feature_map(), **kwargs)
    b = kernel_alignment_search(_feature_map(), **kwargs)
    assert _strip(a) == _strip(b)
    fracs: list[float] = []
    kernel_alignment_search(_feature_map(), progress=lambda f, m: fracs.append(f), **kwargs)
    assert fracs == sorted(fracs) and fracs[-1] == 1.0
    with pytest.raises(AnalysisCancelled):
        kernel_alignment_search(_feature_map(), cancel=lambda: True, **kwargs)
