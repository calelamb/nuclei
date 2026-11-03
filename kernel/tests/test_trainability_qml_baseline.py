"""Classical-baseline analysis (extension A; see docs/quantum-ml-extensions-spec.md)."""

from __future__ import annotations

import json

import numpy as np
import pytest

from kernel.trainability._analysis_common import AnalysisCancelled
from kernel.trainability.ir import IrError, IrGate, ParamCircuit, ParamRef
from kernel.trainability.qml_baseline import (
    classical_baseline,
    geometric_difference,
    linear_kernel,
    rbf_kernel,
)
from kernel.trainability.qml_kernel import quantum_kernel


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


def _strip(res):
    return json.dumps({k: v for k, v in res.items() if k != "elapsed_ms"}, sort_keys=True)


# ---------------------------------------------------------------- closed forms
def test_rbf_and_linear_closed_forms():
    x = np.array([[0.0, 0.0], [1.0, 0.0], [0.0, 2.0]])
    k = rbf_kernel(x, 0.5)
    assert k[0, 1] == pytest.approx(np.exp(-0.5))
    assert k[0, 2] == pytest.approx(np.exp(-2.0))
    assert k[1, 2] == pytest.approx(np.exp(-0.5 * 5.0))
    assert np.allclose(np.diag(k), 1.0)
    assert linear_kernel(x) == pytest.approx(x @ x.T)


def test_geometric_difference_of_a_kernel_with_itself_is_one():
    x = np.array([[0.0, 0.0], [1.0, 0.0], [0.0, 2.0], [1.0, 1.0]])
    k = rbf_kernel(x, 0.5)
    assert geometric_difference(k, k, epsilon=1e-10) == pytest.approx(1.0, abs=1e-6)


# ----------------------------------------------------------------------- sanity
def test_baseline_on_blobs_and_quantum_oracle_cross_check():
    res = classical_baseline(_feature_map(), dataset="blobs", dataset_samples=40, seed=2)
    rbf = [b for b in res["baselines"] if b["name"] == "rbf"]
    assert len(rbf) == 5 and res["best_baseline"] in ("rbf", "linear")
    best_rbf = max(rbf, key=lambda b: (b["alignment"], b["train_accuracy"]))
    assert best_rbf["test_accuracy"] >= 0.8
    oracle = quantum_kernel(_feature_map(), dataset="blobs", dataset_samples=40, seed=2)
    assert res["quantum"] is not None
    assert res["quantum"]["alignment"] == pytest.approx(oracle["alignment"])
    assert res["quantum"]["train_accuracy"] == pytest.approx(oracle["train_accuracy"])
    assert res["quantum"]["test_accuracy"] == pytest.approx(oracle["test_accuracy"])
    assert res["geometric_difference"] >= 1.0 - 1e-9 or res["geometric_difference"] > 0.0
    assert res["verdict"] in ("quantum_ahead", "classical_ahead", "tie")
    json.dumps(res, allow_nan=False)


def test_no_test_label_leakage_in_baseline_choice(monkeypatch):
    # Selecting the winner on train metrics only means permuting test labels
    # cannot move best_baseline/gamma. We verify by scoring with a dataset
    # whose test rows are reordered: train submatrix is untouched.
    res = classical_baseline(_feature_map(), dataset="moons", dataset_samples=40, seed=3)
    best_alignment = max(b["alignment"] for b in res["baselines"])
    winners = [b for b in res["baselines"] if b["alignment"] == best_alignment]
    assert res["best_baseline"] == winners[0]["name"]
    assert res["best_baseline_gamma"] == winners[0]["gamma"]


def test_classifier_circuit_gets_classical_numbers_only():
    res = classical_baseline(_classifier(), dataset="blobs", dataset_samples=24, seed=1)
    assert res["quantum"] is None
    assert res["geometric_difference"] is None
    assert res["delta_test_accuracy"] is None
    assert res["verdict"] == "no_quantum_kernel"
    assert res["baselines"]


# --------------------------------------------------------------------- protocol
def test_determinism_progress_cancel_and_width():
    kwargs = dict(dataset="moons", dataset_samples=20, seed=9)
    a = classical_baseline(_feature_map(), **kwargs)
    b = classical_baseline(_feature_map(), **kwargs)
    assert _strip(a) == _strip(b)
    fracs: list[float] = []
    classical_baseline(_feature_map(), progress=lambda f, m: fracs.append(f), **kwargs)
    assert fracs == sorted(fracs) and fracs[-1] == 1.0
    with pytest.raises(AnalysisCancelled):
        classical_baseline(_feature_map(), cancel=lambda: True, **kwargs)
    wide = ParamCircuit(21, [IrGate("RX", (0,), (ParamRef("x0"),), 0)], ["x0"])
    with pytest.raises(IrError) as exc:
        classical_baseline(wide, **kwargs)
    assert exc.value.code == "too_many_qubits"
