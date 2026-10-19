"""qec_memory scoring: statistics, determinism, Lambda, the repetition seed."""

from __future__ import annotations

import math

import pytest

stim = pytest.importorskip("stim")
pytest.importorskip("pymatching")

from kernel.discovery.evaluators import EVALUATORS, effective_config, normalize_config  # noqa: E402
from kernel.discovery.evaluators.qec_stats import lambda_ratio, per_round, round_summary, wilson  # noqa: E402
from kernel.discovery.seeds.qec_repetition import build as seed_build  # noqa: E402

SPEC = EVALUATORS["qec_memory"]


def score(builder, overrides=None, seed=1234, stage="full"):
    config = normalize_config(SPEC, overrides or {})
    artifacts = [
        {"call_index": i, "artifact": {"circuit_text": str(builder(*c["args"]))}}
        for i, c in enumerate(SPEC.calls(config))
    ]
    return SPEC.score(effective_config(SPEC, config, stage), artifacts, seed, stage=stage)


def surface(distance, rounds):
    return stim.Circuit.generated("surface_code:rotated_memory_z", distance=distance, rounds=rounds)


# --- statistics ---------------------------------------------------------------


def test_wilson_matches_reference_values():
    lo, hi = wilson(10, 100)
    assert lo == pytest.approx(0.0552, abs=1e-3) and hi == pytest.approx(0.1744, abs=1e-3)
    lo0, hi0 = wilson(0, 1000)
    assert lo0 == 0.0 and 0.0035 < hi0 < 0.0045
    assert wilson(0, 0) == (0.0, 1.0)


def test_per_round_conversion_inverts_compounding():
    eps = 0.01
    shot = (1 - (1 - 2 * eps) ** 7) / 2
    assert per_round(shot, 7) == pytest.approx(eps)
    assert per_round(0.0, 3) == 0.0
    assert per_round(0.5, 3) == 0.5 and per_round(0.9, 3) == 0.5


def test_round_summary_is_monotone_and_flags_saturation():
    summary = round_summary(40, 1000, 5)
    assert summary["ci95"][0] < summary["ler_round"] < summary["ci95"][1]
    assert not summary["saturated"]
    saturated = round_summary(600, 1000, 5)
    assert saturated["saturated"] and saturated["ler_round"] == 0.5


def test_lambda_with_propagated_interval_and_inconclusive_cases():
    small = {"d": 3, **round_summary(300, 100000, 3)}
    large = {"d": 5, **round_summary(30, 100000, 5)}
    result = lambda_ratio(small, large)
    assert result["value"] > 1 and result["ci95"][0] < result["value"] < result["ci95"][1]
    assert result["verdict"] == "suppressing"
    zero = {"d": 5, **round_summary(0, 1000, 5)}
    assert lambda_ratio(small, zero)["verdict"] == "inconclusive"
    assert lambda_ratio(small, zero)["value"] is None
    noisy_pair = lambda_ratio({"d": 3, **round_summary(5, 100, 3)}, {"d": 5, **round_summary(4, 100, 5)})
    assert noisy_pair["verdict"] == "inconclusive"


# --- repetition seed ----------------------------------------------------------


def test_repetition_seed_passes_every_guardrail_and_has_lambda_above_one():
    # p = 5e-3 (still far below the repetition-code threshold) so both distances see logical
    # errors on every platform: Stim's seeded sampling is not cross-platform, and at the default
    # 1e-3 a d=5 run can legitimately see zero errors, which honestly makes Λ inconclusive.
    core = score(seed_build, {"noise": {"model": "uniform", "p": 5e-3}})
    assert core.status == "scored"
    assert all(g["status"] == "pass" for g in core.guardrails)
    per_distance = core.metrics["per_distance"]
    assert [m["fault_distance"] for m in per_distance] == [3, 5]
    assert core.metrics["lambda"][0]["value"] > 1


@pytest.mark.parametrize("model", ["uniform", "si1000", "biased_z"])
def test_repetition_seed_scores_under_every_noise_model(model):
    core = score(seed_build, {"noise": {"model": model, "p": 2e-3}, "shots": {"min": 1000, "max": 20000, "max_errors": 100}})
    assert core.status == "scored", core.rejection


# --- determinism, fitness, record shape ------------------------------------------


def test_same_seed_is_bit_identical_and_other_seed_differs():
    overrides = {"noise": {"p": 5e-3}, "shots": {"min": 1000, "max": 20000, "max_errors": 100}}
    a, b = score(seed_build, overrides, seed=7), score(seed_build, overrides, seed=7)
    c = score(seed_build, overrides, seed=8)
    assert a.to_dict() == b.to_dict()
    assert [m["errors"] for m in a.metrics["per_distance"]] != [m["errors"] for m in c.metrics["per_distance"]]


def test_fitness_objectives_descriptors_follow_the_spec():
    core = score(seed_build)
    per = core.metrics["per_distance"]
    expected = sum(-math.log10(max(m["ci95"][1], 1e-15)) for m in per) / len(per)
    assert core.fitness == pytest.approx(expected)
    objective = core.objectives["logical_error_per_round"]
    assert objective["direction"] == "minimize" and objective["value"] == per[-1]["ler_round"]
    assert objective["ci95"] == per[-1]["ci95"]
    assert core.objectives["qubits"]["value"] == per[-1]["qubits"] == 9
    assert core.descriptors == {"qubits": 9, "two_qubit_gates_per_round": 8}
    for key in ("d", "rounds", "shots", "errors", "ler_shot", "ler_round", "ci95", "fault_distance", "qubits", "detectors", "two_qubit_gates"):
        assert key in per[0]


def test_shot_limits_and_early_stop_on_errors():
    core = score(seed_build, {"noise": {"p": 0.03}, "shots": {"min": 1000, "max": 50000, "max_errors": 50}})
    for m in core.metrics["per_distance"]:
        assert 1000 <= m["shots"] <= 50000
        assert m["errors"] >= 50 or m["shots"] == 50000


def test_screen_stage_uses_smaller_budget_and_skips_distance():
    full = score(seed_build, {"noise": {"p": 1e-3}})
    screen = score(seed_build, {"noise": {"p": 1e-3}}, stage="screen")
    assert max(m["shots"] for m in screen.metrics["per_distance"]) <= 5000
    assert max(m["shots"] for m in full.metrics["per_distance"]) > 5000
    assert next(g for g in screen.guardrails if g["id"] == "fault_distance")["status"] == "skipped"
    assert all(m["fault_distance"] is None for m in screen.metrics["per_distance"])


def test_saturated_noise_reports_saturation():
    core = score(seed_build, {"noise": {"model": "si1000", "p": 0.05}, "distances": [3, 5], "rounds": 30,
                              "shots": {"min": 1000, "max": 2000, "max_errors": 100}})
    assert core.status == "scored"
    assert any(m["saturated"] for m in core.metrics["per_distance"])


# --- the headline physics gate -----------------------------------------------------


@pytest.mark.parametrize("model", ["uniform", "si1000"])
def test_surface_code_d3_to_d5_shows_lambda_above_one(model):
    core = score(surface, {"noise": {"model": model, "p": 1e-3}})
    assert core.status == "scored", core.rejection
    assert all(g["status"] == "pass" for g in core.guardrails)
    entry = core.metrics["lambda"][0]
    assert entry["d_from"] == 3 and entry["d_to"] == 5
    assert entry["ci95"][0] > 1, entry
    assert entry["verdict"] == "suppressing"
    assert [m["fault_distance"] for m in core.metrics["per_distance"]] == [3, 5]


def test_progress_and_cancel_are_honored():
    import threading

    config = normalize_config(SPEC, {})
    artifacts = [
        {"call_index": i, "artifact": {"circuit_text": str(seed_build(*c["args"]))}}
        for i, c in enumerate(SPEC.calls(config))
    ]
    seen = []
    SPEC.score(effective_config(SPEC, config, "full"), artifacts, 1, progress=lambda f, m: seen.append((f, m)))
    assert seen[0][0] == 0.0 and seen[-1][0] == 1.0
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(InterruptedError):
        SPEC.score(effective_config(SPEC, config, "full"), artifacts, 1, cancel=cancel)
