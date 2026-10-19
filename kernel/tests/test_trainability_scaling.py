"""fit_scaling (pure fitter + verdict rules) and scaling_study (barren-plateau gate tests)."""

from __future__ import annotations

import json
import math
import re

import numpy as np
import pytest

from kernel.tests._trainability_physics_helpers import Builder, hea_circuit, two_axis_hea
from kernel.trainability._analysis_common import AnalysisError
from kernel.trainability.scaling import fit_scaling, scaling_study


def _pts(ns, fn, layers=4, ci=None):
    out = []
    for n in ns:
        v = fn(n)
        p = {"n_qubits": n, "n_layers": layers, "variance": v}
        if ci:
            p["variance_ci95"] = [v / ci, v * ci]
        out.append(p)
    return out


# ---------------------------------------------------------------- pure fitter
def test_exponential_decay_is_a_barren_plateau_with_spec_summary_format():
    fit, = fit_scaling(_pts(range(2, 10), lambda n: 0.7 * 2 ** (-0.93 * n)), seed=1)
    assert fit["verdict"] == "barren_plateau" and fit["preferred"] == "exponential"
    e = fit["exponential"]
    assert e["beta"] == pytest.approx(0.93, abs=1e-9) and e["r2"] == pytest.approx(1.0)
    assert e["beta_ci95"][0] > 0.1 and fit["delta_aic"] >= 2 and fit["n_layers"] == 4
    # one sign convention: the exponent is -β and its CI is the CI of that same exponent (PH-LOW)
    m = re.fullmatch(r"Var\[∂C\] ∝ 2\^\(−0\.93 n\) \(95% CI on the exponent −(\d\.\d\d) to −(\d\.\d\d)\); "
                     r"exponential preferred over power law \(ΔAIC \d+\.\d\); barren plateau: .*\.", fit["summary"])
    assert m, fit["summary"]
    assert -float(m.group(1)) <= -e["beta"] <= -float(m.group(2))
    assert set(e) == {"beta", "beta_ci95", "log2_intercept", "r2", "aic"}
    assert set(fit["power_law"]) == {"alpha", "alpha_ci95", "log2_intercept", "r2", "aic"}


def test_power_law_is_polynomial():
    fit, = fit_scaling(_pts([4, 8, 12, 16, 24, 32, 64], lambda n: 3.0 * n ** -2.0), seed=1)
    assert fit["verdict"] == "polynomial" and fit["preferred"] == "power_law"
    assert fit["power_law"]["alpha"] == pytest.approx(2.0, abs=1e-9)
    assert fit["summary"].startswith("Var[∂C] ∝ n^(−2.00) (95% CI on the exponent −2.00 to −2.00); power law preferred")


def test_flat_noisy_variance_is_never_a_false_barren_plateau():
    rng = np.random.default_rng(0)
    for _ in range(25):
        ns = list(range(2, 12))
        fit, = fit_scaling(_pts(ns, lambda n: 0.05 * 2 ** rng.normal(0, 0.15)), seed=2)
        assert fit["verdict"] != "barren_plateau"


def test_fewer_than_four_distinct_n_forces_inconclusive():
    fit, = fit_scaling(_pts([2, 3, 4], lambda n: 2.0 ** (-n)))
    assert fit["verdict"] == "inconclusive" and fit["exponential"] is None
    assert "need at least 4" in fit["summary"]
    dup = _pts([2, 2, 3, 3, 4, 4], lambda n: 2.0 ** (-n))     # six points, three distinct n
    assert fit_scaling(dup)[0]["verdict"] == "inconclusive"


def test_zero_variance_point_is_inconclusive_not_an_exception():
    pts = _pts(range(2, 8), lambda n: 2.0 ** (-n))
    pts[-1]["variance"] = 0.0
    fit, = fit_scaling(pts)
    assert fit["verdict"] == "inconclusive" and "zero" in fit["summary"]


def test_weights_follow_interval_width():
    pts = _pts(range(2, 10), lambda n: 2.0 ** (-n), ci=1.05)
    pts[3]["variance"] *= 4.0                       # an outlier ...
    pts[3]["variance_ci95"] = [pts[3]["variance"] / 1.4, pts[3]["variance"] * 1.4]   # ... that admits it is noisy
    weighted, = fit_scaling(pts, seed=3)
    for p in pts:
        p["variance_ci95"] = None
    unweighted, = fit_scaling(pts, seed=3)
    err_w = abs(weighted["exponential"]["beta"] - 1.0)
    err_u = abs(unweighted["exponential"]["beta"] - 1.0)
    assert err_w < err_u and err_w < 0.02


def test_groups_by_layers_ignores_failed_points_and_is_deterministic():
    pts = _pts(range(2, 8), lambda n: 2.0 ** (-n), layers=2) + _pts(range(2, 8), lambda n: 0.3, layers=6)
    pts.append({"n_qubits": 30, "n_layers": 2, "variance": None, "error": {"code": "ppe_required"}})
    fits = fit_scaling(pts, seed=5)
    assert [f["n_layers"] for f in fits] == [2, 6] and fits[0]["verdict"] == "barren_plateau"
    assert fits[1]["verdict"] == "polynomial"
    assert json.dumps(fits) == json.dumps(fit_scaling(pts, seed=5))
    assert fit_scaling([]) == []


def test_inconclusive_when_models_are_indistinguishable_and_beta_is_not_negligible():
    # stretched exponential 2^(-0.89 sqrt(n)): between the two models, exponential wins by < 2 AIC
    var = [0.41643854, 0.28045819, 0.17165892, 0.0841492, 0.03066306]
    pts = [{"n_qubits": n, "n_layers": 1, "variance": v} for n, v in zip([2, 4, 8, 16, 32], var)]
    fit, = fit_scaling(pts, seed=1)
    assert fit["preferred"] == "exponential" and fit["delta_aic"] < 2 and fit["exponential"]["beta_ci95"][1] > 0.1
    assert fit["verdict"] == "inconclusive"


# ------------------------------------------------------- gate: sampling
def test_global_z_hea_barren_plateau_by_sampling_n2_to_10():
    res = scaling_study(lambda n, l: two_axis_hea(n, l), qubits=list(range(2, 11)), layers=[2],
                        observable_spec="preset:global_z", samples=300, seed=1, method="sampling")
    assert {p["method"] for p in res["points"]} == {"sampling"} and res["points"][0]["n_params"] == 8
    fit, = res["fits"]
    assert fit["verdict"] == "barren_plateau"
    assert fit["exponential"]["beta_ci95"][0] > 0.9 and fit["delta_aic"] > 10


def test_shallow_local_observable_is_never_a_false_barren_plateau_by_sampling():
    res = scaling_study(lambda n, l: two_axis_hea(n, l), qubits=[4, 5, 6, 7, 8, 9, 10], layers=[2],
                        observable_spec="preset:local_z", samples=300, seed=1, method="sampling")
    assert res["fits"][0]["verdict"] in ("polynomial", "inconclusive")


# --------------------------------------------------------------- gate: PPE
def test_global_z_hea_barren_plateau_to_n64_by_ppe():
    qs = [2, 4, 6, 8, 10, 16, 24, 32, 48, 64]
    res = scaling_study(lambda n, l: hea_circuit(n, l), qubits=qs, layers=[1], observable_spec="preset:global_z")
    assert {p["method"] for p in res["points"]} == {"ppe"}
    assert all(p["interval_kind"] == "truncation" for p in res["points"])
    assert res["points"][-1]["variance"] == pytest.approx(2.0 ** -64, rel=1e-9)
    fit, = res["fits"]
    assert fit["verdict"] == "barren_plateau" and fit["exponential"]["beta"] == pytest.approx(1.0, abs=1e-9)


def test_shallow_local_observable_to_n64_is_polynomial():
    res = scaling_study(lambda n, l: two_axis_hea(n, l), qubits=[4, 8, 12, 16, 24, 32, 64], layers=[2],
                        observable_spec="preset:local_z")
    fit, = res["fits"]
    assert {p["method"] for p in res["points"]} == {"ppe"} and fit["verdict"] == "polynomial"
    assert fit["power_law"]["alpha"] == pytest.approx(2.0, abs=0.05)


# ------------------------------------------------------------ study mechanics
def _mixed_build(n, layers):
    """Same physics at every n; the (state-trivial) T gates only keep the PPE out for n <= 20."""
    b = Builder(n)
    if n <= 20:
        for q in range(n):
            b.add("T", (q,))
    for q in range(n):
        b.rot("RY", (q,))
    return b.build()


def test_study_mixes_sampling_below_21_and_ppe_above():
    res = scaling_study(_mixed_build, qubits=[2, 4, 6, 8, 22, 32], layers=[1], observable_spec="preset:global_z",
                        samples=400, seed=2)
    assert [p["method"] for p in res["points"]] == ["sampling"] * 4 + ["ppe"] * 2
    assert [p["interval_kind"] for p in res["points"]] == ["bootstrap"] * 4 + ["truncation"] * 2
    assert res["points"][4]["variance"] == pytest.approx(2.0 ** -22, rel=1e-9)
    assert res["fits"][0]["verdict"] == "barren_plateau"


def test_point_above_20_qubits_without_ppe_fails_with_ppe_required_and_others_continue():
    def build(n, layers):
        b = Builder(n)
        b.add("T", (0,))
        for q in range(n):
            b.rot("RY", (q,))
        return b.build()

    res = scaling_study(build, qubits=[2, 3, 4, 5, 21], layers=[1], observable_spec="preset:global_z",
                        samples=100, seed=1)
    bad = res["points"][-1]
    assert bad["error"]["code"] == "ppe_required" and bad["variance"] is None
    assert all(p["error"] is None for p in res["points"][:-1])
    assert len(res["fits"]) == 1 and res["fits"][0]["verdict"] != "inconclusive" or res["fits"][0]["n_layers"] == 1


def test_study_is_deterministic_and_validates():
    kw = dict(qubits=[2, 3, 4, 5], layers=[1, 2], observable_spec="preset:global_z", samples=50, seed=4,
              method="sampling")
    a = scaling_study(lambda n, l: hea_circuit(n, l), **kw)
    b = scaling_study(lambda n, l: hea_circuit(n, l), **kw)
    strip = lambda r: json.dumps({k: v for k, v in r.items() if k != "elapsed_ms"}, sort_keys=True)  # noqa: E731
    assert strip(a) == strip(b) and [f["n_layers"] for f in a["fits"]] == [1, 2]
    with pytest.raises(AnalysisError):
        scaling_study(lambda n, l: hea_circuit(n, l), qubits=[], layers=[1], observable_spec="Z0")


def test_study_reports_progress_and_wrong_qubit_count_as_point_error():
    seen = []
    res = scaling_study(lambda n, l: hea_circuit(n + 1, l), qubits=[2, 3], layers=[1], observable_spec="Z0",
                        samples=20, progress=lambda f, m: seen.append(f))
    assert seen == sorted(seen) and seen[-1] == 1.0
    assert all(p["error"]["code"] == "qubit_mismatch" for p in res["points"])


# ------------------------------------------ PH-C1: unresolved points never enter a fit
def _noisy_study(rng, vfun, ns, samples=200):
    """Sampling-like points: mean of 2n unbiased variances over `samples` Gaussian gradients, +-1.96 SE interval."""
    pts = []
    for n in ns:
        m = 2 * n
        se = math.sqrt(2.0 / ((samples - 1) * m))
        v = vfun(n) * (1.0 + rng.normal(0.0, se))
        pts.append({"n_qubits": n, "n_layers": 1, "variance": v, "variance_ci95": [v * (1 - 1.96 * se), v * (1 + 1.96 * se)]})
    return pts


def test_midpoint_style_points_at_n24_to_40_are_never_polynomial():
    """The reviewer's case: global_z, 12-layer brick, n = 24..40, PPE timed out.

    The old kernel put the interval midpoint 0.48 at every n -> a flat line -> "polynomial".
    """
    flat = [{"n_qubits": n, "n_layers": 12, "variance": 0.484, "variance_ci95": [0.0, 0.968]} for n in (24, 28, 32, 40)]
    fit, = fit_scaling(flat, seed=0)
    assert fit["verdict"] == "inconclusive" and fit["exponential"] is None
    assert "lower bound of 0" in fit["summary"]
    nulls = [{"n_qubits": n, "n_layers": 12, "variance": None, "variance_ci95": [0.0, 0.968]} for n in (24, 28, 32, 40)]
    fit, = fit_scaling(nulls, seed=0)
    assert fit["verdict"] == "inconclusive" and "null" in fit["summary"]


def test_one_uninformative_point_forces_inconclusive_even_when_the_rest_is_clean():
    pts = _pts(range(2, 10), lambda n: 2.0 ** (-n), ci=1.05)
    assert fit_scaling(pts)[0]["verdict"] == "barren_plateau"
    pts[4]["variance_ci95"] = [pts[4]["variance"] / 3, pts[4]["variance"] * 3]       # hi/lo = 9
    fit, = fit_scaling(pts)
    assert fit["verdict"] == "inconclusive" and "uninformative" in fit["summary"]
    pts[4]["variance_ci95"] = [0.0, pts[4]["variance"]]
    assert "lower bound of 0" in fit_scaling(pts)[0]["summary"]
    pts[4]["variance"] = None
    assert "null" in fit_scaling(pts)[0]["summary"]


def test_scaling_study_with_unresolved_ppe_is_inconclusive(monkeypatch):
    """End to end (n = 24..40 global_z): a PPE too small to resolve the variance must not yield 'polynomial'."""
    from kernel.trainability import analyses
    tiny = {"max_frontier": 2_000, "time_budget_s": 30.0, "min_weight_abs": 0.0}
    monkeypatch.setattr(analyses, "_AUTO_PPE", tiny)
    monkeypatch.setattr(analyses, "_FORCED_PPE", tiny)
    res = scaling_study(lambda n, l: two_axis_hea(n, l), qubits=[24, 28, 32, 40], layers=[8],
                        observable_spec="preset:global_z")
    assert all(p["variance"] is None and p["variance_ci95"][1] > 0 for p in res["points"])
    assert res["fits"][0]["verdict"] == "inconclusive"


# ----------------------------------------------- PH-H4: narrow ranges and misclassification
CASES = {"bp_2^-0.25n": (2.0 ** -0.25, "exp"), "bp_2^-0.5n": (2.0 ** -0.5, "exp"), "poly_n^-1": (None, "poly1"),
         "poly_n^-2": (None, "poly2")}


def _vfun(name):
    base, kind = CASES[name]
    return {"exp": lambda n: base ** n, "poly1": lambda n: 1.0 / n, "poly2": lambda n: 1.0 / n ** 2}[kind]


@pytest.mark.parametrize("name", list(CASES))
def test_narrow_range_is_inconclusive_never_wrong(name):
    """Review: over n = 4..7, n^-1 was 'barren_plateau' 22% of the time and 2^-0.25n 'polynomial' 22.5%."""
    rng = np.random.default_rng(11)
    for t in range(40):
        fit, = fit_scaling(_noisy_study(rng, _vfun(name), [4, 5, 6, 7]), seed=t)
        assert fit["verdict"] == "inconclusive", (name, fit["summary"])
        assert "too narrow" in fit["summary"]


@pytest.mark.parametrize("name,truth", [("bp_2^-0.5n", "barren_plateau"), ("poly_n^-2", "polynomial")])
def test_wide_range_still_classifies_correctly(name, truth):
    rng = np.random.default_rng(5)
    got = [fit_scaling(_noisy_study(rng, _vfun(name), [4, 6, 8, 10, 12]), seed=t)[0]["verdict"] for t in range(60)]
    assert got.count(truth) >= 57 and not any(v not in (truth, "inconclusive") for v in got)


def test_wide_ci_alone_is_not_a_polynomial_verdict():
    """A beta CI that merely reaches below 0.1 used to be 'polynomial'; now only a small upper bound is."""
    rng = np.random.default_rng(3)
    verdicts = []
    for t in range(30):
        pts = [{"n_qubits": n, "n_layers": 1, "variance": 2.0 ** (-0.1 * n) * 2 ** rng.normal(0, 0.4)}
               for n in (4, 5, 6, 7, 8)]
        fit, = fit_scaling(pts, seed=t)
        verdicts.append(fit["verdict"])
        if fit["verdict"] == "polynomial":
            assert fit["exponential"]["beta_ci95"][1] <= 0.1 or (fit["preferred"] == "power_law" and fit["delta_aic"] >= 2)
    assert "inconclusive" in verdicts


def test_polynomial_requires_small_beta_upper_or_power_law_win():
    fit, = fit_scaling(_pts([4, 8, 16, 32, 64], lambda n: 0.3), seed=0)           # flat: beta == 0
    assert fit["verdict"] == "polynomial" and fit["exponential"]["beta_ci95"][1] <= 0.1
    fit, = fit_scaling(_pts([4, 8, 16, 32, 64], lambda n: 5.0 / n), seed=0)
    assert fit["verdict"] == "polynomial" and fit["preferred"] == "power_law" and fit["delta_aic"] >= 2
