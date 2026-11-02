"""Simulated-noise trainability (C1: shots + depolarizing + readout)."""

from __future__ import annotations

import json

import numpy as np
import pytest

from kernel.trainability._analysis_common import AnalysisError
from kernel.trainability._errors import TrainabilityError
from kernel.trainability._settings import normalize_settings
from kernel.trainability.analyses import gradient_statistics
from kernel.trainability.compiler import compile_circuit
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.noise import NoiseSpec, coerce_noise, noisy_expectations
from kernel.trainability.pauli import parse_observable
from kernel.trainability.qml_kernel import quantum_kernel
from kernel.trainability.qml_train import variational_train


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


def _strip(res: dict, *extra: str) -> str:
    drop = {"elapsed_ms", "channel_noise", "kernel_shot_variance", "shot_noise_variance", *extra}
    return json.dumps({k: v for k, v in res.items() if k not in drop}, sort_keys=True)


def test_zero_noise_reproduces_exact_baseline():
    clean_k = quantum_kernel(_feature_map(), dataset="blobs", dataset_samples=16, seed=5)
    zero_k = quantum_kernel(
        _feature_map(), dataset="blobs", dataset_samples=16, seed=5,
        channel_noise={"shots": 0, "depolarizing_p": 0.0, "readout_flip_p": 0.0},
    )
    assert _strip(clean_k) == _strip(zero_k)
    assert zero_k["channel_noise"] == {"shots": 0, "depolarizing_p": 0.0, "readout_flip_p": 0.0}

    obs = parse_observable("Z0", 2)
    kwargs = dict(dataset="blobs", dataset_samples=24, epochs=8, learning_rate=0.2, seed=4)
    clean_t = variational_train(_classifier(), obs, **kwargs)
    zero_t = variational_train(_classifier(), obs, channel_noise=NoiseSpec(), **kwargs)
    assert _strip(clean_t) == _strip(zero_t)

    circuit = _classifier()
    gkwargs = dict(samples=32, seed=3, method="sampling")
    clean_g = gradient_statistics(circuit, obs, **gkwargs)
    zero_g = gradient_statistics(circuit, obs, channel_noise=NoiseSpec(), **gkwargs)
    assert _strip(clean_g) == _strip(zero_g)
    assert zero_g["shot_noise_variance"] is None


def test_depolarizing_shrinks_expectation_monotonically():
    circuit = ParamCircuit(1, [IrGate("RX", (0,), (ParamRef("t"),), 0)], ["t"])
    states = compile_circuit(circuit).states(np.array([[0.7]]))
    obs = parse_observable("Z0", 1)
    rng = np.random.default_rng(0)
    exact, _ = noisy_expectations(states, obs, 1, NoiseSpec(), rng)
    vals = []
    for p in (0.0, 0.1, 0.3, 0.5):
        est, _ = noisy_expectations(states, obs, 1, NoiseSpec(depolarizing_p=p), np.random.default_rng(0))
        vals.append(float(est[0]))
    assert abs(exact[0]) == pytest.approx(np.cos(0.7), abs=1e-9)
    assert vals[0] > vals[1] > vals[2] > vals[3] > 0.0
    assert vals[3] == pytest.approx(0.5 * vals[0], abs=1e-9)

    # Readout flip shrinks a weight-1 Pauli by (1 - 2q) as well.
    est, _ = noisy_expectations(states, obs, 1, NoiseSpec(readout_flip_p=0.25), np.random.default_rng(0))
    assert float(est[0]) == pytest.approx(0.5 * vals[0], abs=1e-9)

    # Kernel diagonal becomes the purity (< 1) under depolarizing.
    noisy_k = quantum_kernel(
        _feature_map(), dataset="blobs", dataset_samples=12, seed=5,
        channel_noise={"depolarizing_p": 0.3},
    )
    assert all(noisy_k["kernel"][i][i] < 1.0 for i in range(12))
    assert any("not a device calibration" in n for n in noisy_k["notes"])


def test_finite_shot_variance_scales_as_one_over_shots():
    circuit = ParamCircuit(1, [IrGate("RX", (0,), (ParamRef("t"),), 0)], ["t"])
    states = compile_circuit(circuit).states(np.array([[0.7]]))
    obs = parse_observable("Z0", 1)
    _, var_small = noisy_expectations(states, obs, 1, NoiseSpec(shots=100), np.random.default_rng(1))
    _, var_large = noisy_expectations(states, obs, 1, NoiseSpec(shots=10000), np.random.default_rng(1))
    assert var_small > 0 and var_large > 0
    assert 50.0 < var_small / var_large < 200.0  # analytic ratio is exactly 100

    # Empirical check (fixed seeds): fewer shots fluctuate more.
    def empirical(shots: int) -> float:
        draws = []
        rng = np.random.default_rng(7)
        for _ in range(48):
            est, _ = noisy_expectations(states, obs, 1, NoiseSpec(shots=shots), rng)
            draws.append(float(est[0]))
        return float(np.var(draws))

    assert empirical(64) > 5.0 * empirical(6400)


def test_ppe_with_noise_is_an_explicit_error_and_auto_samples():
    obs = parse_observable("Z0", 2)
    with pytest.raises(AnalysisError) as exc:
        gradient_statistics(
            _classifier(), obs, samples=16, seed=0, method="ppe",
            channel_noise={"depolarizing_p": 0.1},
        )
    assert exc.value.code == "noise_unsupported"

    res = gradient_statistics(
        _classifier(), obs, samples=32, seed=3, method="auto",
        channel_noise={"shots": 1000, "depolarizing_p": 0.05},
    )
    assert res["method"] == "sampling"
    assert res["channel_noise"]["shots"] == 1000
    assert res["shot_noise_variance"] == pytest.approx(1.0 / 1000.0)
    assert any("noiseless" in n for n in res["notes"])


def test_variational_training_under_noise_still_learns():
    obs = parse_observable("Z0", 2)
    res = variational_train(
        _classifier(), obs, dataset="blobs", dataset_samples=40,
        epochs=30, learning_rate=0.2, seed=4,
        channel_noise={"shots": 2000, "depolarizing_p": 0.05, "readout_flip_p": 0.02},
    )
    assert len(res["history"]) == 30
    assert np.isfinite(res["final_loss"])
    assert res["final_test_accuracy"] >= 0.5
    assert res["channel_noise"] == {"shots": 2000, "depolarizing_p": 0.05, "readout_flip_p": 0.02}
    assert any("not a device calibration" in n for n in res["notes"])


def test_invalid_noise_is_invalid_request_everywhere():
    with pytest.raises(TrainabilityError) as exc:
        normalize_settings({"noise": {"depolarizing_p": 0.9}})
    assert exc.value.code == "invalid_request"
    with pytest.raises(TrainabilityError) as exc:
        normalize_settings({"noise": {"shots": 10}})
    assert exc.value.code == "invalid_request"
    with pytest.raises(TrainabilityError) as exc:
        normalize_settings({"noise": {"readout_flip_p": -0.1}})
    assert exc.value.code == "invalid_request"
    assert normalize_settings(None)["noise"] == {"shots": 0, "depolarizing_p": 0.0, "readout_flip_p": 0.0}
    assert normalize_settings({"noise": {"shots": 10**9}})["noise"]["shots"] == 100000

    with pytest.raises(AnalysisError) as exc:
        coerce_noise({"shots": 31})
    assert exc.value.code == "invalid_request"
    with pytest.raises(AnalysisError) as exc:
        quantum_kernel(
            _feature_map(), dataset="blobs", dataset_samples=12, seed=0,
            channel_noise={"depolarizing_p": 0.75},
        )
    assert exc.value.code == "invalid_request"
    with pytest.raises(AnalysisError) as exc:
        variational_train(
            _classifier(), parse_observable("Z0", 2), dataset="blobs", dataset_samples=12,
            channel_noise={"shots": 5}, seed=0,
        )
    assert exc.value.code == "invalid_request"


def test_job_worker_marks_noise_ignored_for_other_analyses():
    from kernel.trainability._usercode import LoadedCircuit
    from kernel.trainability.job_worker import JobData, run_analysis

    settings = normalize_settings({
        "entanglement": {"samples": 16},
        "noise": {"depolarizing_p": 0.2},
    })
    job = JobData(
        code="", language=None, params={}, observable="Z0", settings=settings,
        loaded=LoadedCircuit(_classifier(), None, {}),
        observable_sum=parse_observable("Z0", 2),
    )
    res = run_analysis(job, "entanglement", lambda f, m: None, lambda: False)
    assert res["channel_noise"]["depolarizing_p"] == 0.2
    assert any("ignored" in n for n in res["notes"])

    train_settings = normalize_settings({
        "qml": {"dataset": "blobs", "samples": 16},
        "variational": {"epochs": 3, "optimizer": "gd"},
        "noise": {"depolarizing_p": 0.05},
    })
    train_job = JobData(
        code="", language=None, params={}, observable="Z0", settings=train_settings,
        loaded=LoadedCircuit(_classifier(), None, {}),
        observable_sum=parse_observable("Z0", 2),
    )
    train_res = run_analysis(train_job, "variational_train", lambda f, m: None, lambda: False)
    assert train_res["optimizer"] == "gd" and train_res["channel_noise"]["depolarizing_p"] == 0.05
