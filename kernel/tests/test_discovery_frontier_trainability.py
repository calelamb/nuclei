"""trainability_frontier: the trainability term, None-robust variance points, the term-normalised observable."""

from __future__ import annotations

import pytest

pytest.importorskip("qiskit")

from kernel.discovery.evaluators import _frontier_probe  # noqa: E402
from kernel.discovery.evaluators._frontier_observable import frontier_observable, l1_norm  # noqa: E402
from kernel.discovery.evaluators._frontier_probe import is_exact_point, is_informative_point  # noqa: E402
from kernel.discovery.evaluators._frontier_trainability import (  # noqa: E402
    TRAIN_PENALTY_CAP, fit_trainability,
)
from kernel.tests.test_discovery_frontier import SPEC, artifact, config, seed_like  # noqa: E402

SIZES = [8, 16, 32, 64]


def point(n, variance, width=0.0, status="complete"):
    low = None if variance is None else variance * (1 - width / 2)
    high = None if variance is None else variance * (1 + width / 2)
    return {"n_qubits": n, "n_layers": 4, "variance": variance, "status": status,
            "variance_ci95": [low if low is not None else 0.0, high if high is not None else 1.0]}


def series(law):
    return [point(n, law(n)) for n in SIZES]


def test_flat_variance_earns_no_penalty():
    fit = fit_trainability(series(lambda n: 0.1), seed=1)
    assert fit["fit_method"] == "weighted_log_fit" and fit["decay_per_doubling"] == pytest.approx(0, abs=0.05)
    assert fit["trainability_term"] == pytest.approx(0, abs=0.05)


def test_power_law_is_charged_its_exponent_per_doubling():
    fit = fit_trainability(series(lambda n: 1.0 / n), seed=1)
    assert fit["preferred"] == "power_law"
    assert fit["decay_basis"] == "alpha_upper95"
    assert fit["decay_per_doubling"] == pytest.approx(1.0, abs=0.05)
    assert fit["trainability_term"] == pytest.approx(-1.0, abs=0.05)


def test_exponential_decay_is_charged_beta_times_half_n_max_and_capped():
    fit = fit_trainability(series(lambda n: 2.0 ** (-0.5 * n)), seed=1)
    assert fit["preferred"] == "exponential" and fit["beta"] == pytest.approx(0.5, abs=0.01)
    assert fit["decay_per_doubling"] == pytest.approx(0.5 * 64 / 2, abs=0.5)
    assert fit["trainability_term"] == -TRAIN_PENALTY_CAP


def test_two_sizes_fall_back_to_a_labelled_secant_without_a_confidence_interval():
    fit = fit_trainability([point(8, 0.1, 0.02), point(16, 0.05, 0.02)], seed=1)
    assert fit["fit_method"] == "secant" and fit["beta_ci95"] is None and fit["beta_upper95"] is None
    low, high = fit["beta_extreme_bound"]
    assert low <= fit["beta"] <= high
    assert fit["decay_basis"] == "secant_exponential_upper" and fit["trainability_term"] < 0


def test_stopped_and_none_points_are_never_variances():
    stopped = point(32, 0.5, width=2.0, status="budget_exhausted")  # a midpoint a stopped run would report
    stopped["variance_ci95"] = [0.0, 1.0]
    missing = point(64, None, status="budget_exhausted")
    assert not is_exact_point(stopped) and not is_exact_point(missing)
    assert not is_informative_point(stopped) and not is_informative_point(missing)
    fit = fit_trainability([point(8, 0.1), point(16, 0.1), stopped, missing], seed=1)
    assert fit["informative_sizes"] == [8, 16] and fit["fit_method"] == "secant"


def test_no_informative_points_is_the_maximum_penalty_not_a_crash():
    fit = fit_trainability([point(8, None, status="budget_exhausted"), point(16, None, status="budget_exhausted")], seed=1)
    assert fit["fit_method"] == "unavailable" and fit["trainability_term"] == -TRAIN_PENALTY_CAP
    assert fit["beta_ci95"] is None


def test_observable_is_term_normalised():
    local = frontier_observable("preset:local_z", 12)
    assert [t.coeff for t in local.terms] == [1.0] * 12 and l1_norm(local) == 12.0
    single = frontier_observable("Z0", 12)
    assert l1_norm(single) == 1.0
    assert l1_norm(frontier_observable("0.25*Z0*Z1 - 0.5*X2", 4)) == pytest.approx(1.5)  # 0.25, 0.5 rescaled to 0.5, 1


def run(builder, overrides=None, seed=1):
    cfg = config(overrides)
    arts = [{"call_index": i, "artifact": artifact(builder(*c["args"]))} for i, c in enumerate(SPEC.calls(cfg))]
    return SPEC.score(cfg, arts, seed, None, None, stage="full").to_dict()


def test_seed_variance_is_flat_in_n_not_a_normalisation_artifact():
    """With the 1/n of local_z removed the shallow seed's variance is flat, so its penalty is ~0 (PH-M2)."""
    fit = run(seed_like)["metrics"]["fit"]
    assert fit["verdict"] in ("polynomial", "inconclusive")
    assert fit["decay_per_doubling"] < 0.5 and fit["trainability_term"] > -0.5


def test_a_concentrating_cost_is_penalised_far_more_than_the_shallow_seed():
    """The same circuit with a global observable concentrates exponentially: the term must see it."""
    local = run(seed_like)
    global_z = run(seed_like, {"observable": "preset:global_z"})
    assert local["status"] == global_z["status"] == "scored"
    assert global_z["metrics"]["fit"]["trainability_term"] < local["metrics"]["fit"]["trainability_term"] - 1.0
    assert global_z["objectives"]["beta"]["value"] > local["objectives"]["beta"]["value"]


def test_a_stopped_ppe_run_cannot_pass_as_a_variance(monkeypatch):
    """The sibling PPE returns variance_mean=None after a timeout; the frontier treats it as not exact."""
    real = _frontier_probe.ppe_gradient_variances

    def stopped_above_six(circuit, *args, **kwargs):
        out = real(circuit, *args, **kwargs)
        if circuit.n_qubits > 6:
            out["status"] = "budget_exhausted"
            out["variance_mean"] = None
            out["variance_mean_interval"] = [0.0, 1.0]
        return out

    monkeypatch.setattr(_frontier_probe, "ppe_gradient_variances", stopped_above_six)
    result = run(seed_like)
    assert result["status"] == "scored"
    points = result["metrics"]["variance_points"]
    assert [p["exact"] for p in points] == [True, True, False, False]
    assert all(p["variance"] is None for p in points[2:])
    assert result["metrics"]["exactness"]["inexact_sizes"] == [8, 10]
    assert result["metrics"]["fit"]["fit_method"] == "secant" and result["objectives"]["beta"]["ci95"] is None
    assert result["metrics"]["terms"]["inexact_penalty"] == pytest.approx(-0.5)


def test_a_candidate_whose_smallest_point_is_not_exact_is_rejected(monkeypatch):
    real = _frontier_probe.ppe_gradient_variances

    def always_stopped(circuit, *args, **kwargs):
        out = real(circuit, *args, **kwargs)
        out.update(status="budget_exhausted", variance_mean=None, variance_mean_interval=[0.0, 1.0])
        return out

    monkeypatch.setattr(_frontier_probe, "ppe_gradient_variances", always_stopped)
    result = run(seed_like)
    assert result["status"] == "rejected" and result["rejection"]["guardrail"] == "nontrivial_variance"
    assert "not pinned down" in result["rejection"]["message"]
