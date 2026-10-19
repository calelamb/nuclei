"""gradient_statistics: sampling, PPE, auto selection, determinism, cancellation."""

from __future__ import annotations

import json
import math
import time

import numpy as np
import pytest

from kernel.tests._trainability_physics_helpers import Builder, hea_circuit, random_ppe_circuit, two_axis_hea
from kernel.trainability import analyses
from kernel.trainability._analysis_common import AnalysisCancelled, AnalysisError
from kernel.trainability.analyses import gradient_statistics
from kernel.trainability.compiler import compile_circuit
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.pauli import parse_observable


def _strip(res: dict) -> str:
    return json.dumps({k: v for k, v in res.items() if k != "elapsed_ms"}, sort_keys=True, allow_nan=False)


def _single_rx() -> ParamCircuit:
    b = Builder(1)
    b.rot("RX", (0,))
    return b.build()


Z0 = parse_observable("Z0", 1)


# ------------------------------------------------------------------ sampling
def test_sampling_output_shape_and_closed_form():
    res = gradient_statistics(_single_rx(), Z0, samples=4000, seed=3, method="sampling")
    assert set(res) >= {"samples", "init", "per_parameter", "variance_mean", "variance_mean_ci95", "gradient_norm_mean",
                        "gate_values", "elapsed_ms", "method", "backend", "interval_kind", "interval", "notes",
                        "fallback_reason"}
    assert res["method"] == "sampling" and res["interval_kind"] == "bootstrap" and res["backend"] == "numpy"
    row = res["per_parameter"][0]
    assert row["name"] == "t0" and abs(row["mean"]) < 0.03
    assert row["variance"] == pytest.approx(0.5, abs=0.03)        # g = -sin(t): Var = 1/2
    assert row["abs_mean"] == pytest.approx(2 / math.pi, abs=0.03)  # E|sin| = 2/pi
    lo, hi = row["variance_ci95"]
    assert lo < row["variance"] < hi and lo < 0.5 < hi
    assert res["gradient_norm_mean"] == pytest.approx(2 / math.pi, abs=0.03)
    assert res["gate_values"] == [{"source_index": 0, "gate_index": 0, "parameter": "t0",
                                   "variance": row["variance"], "abs_mean": row["abs_mean"]}]


def test_sampling_matches_direct_compiled_gradients():
    c = two_axis_hea(3, 2)
    obs = parse_observable("preset:local_z", 3)
    res = gradient_statistics(c, obs, samples=64, seed=9, method="sampling")
    rng = np.random.default_rng(9)
    v = rng.uniform(0, 2 * math.pi, (64, len(c.parameters)))
    _, g = compile_circuit(c).value_and_grad(v, obs)
    assert [r["variance"] for r in res["per_parameter"]] == pytest.approx(list(g.var(axis=0, ddof=1)), rel=1e-12)
    assert res["variance_mean"] == pytest.approx(g.var(axis=0, ddof=1).mean(), rel=1e-12)


def test_small_init_uses_narrow_gaussian():
    res = gradient_statistics(_single_rx(), Z0, samples=6000, seed=1, init="small", method="sampling")
    assert res["init"] == "small"
    assert res["per_parameter"][0]["variance"] == pytest.approx(0.01, rel=0.15)  # sin(t)^2 ~ t^2, t ~ N(0, 0.1^2)


def test_shared_parameter_maps_to_every_gate_and_source_index():
    gates = [IrGate("RX", (0,), (ParamRef("a"),), source_index=7), IrGate("H", (0,), (), 8),
             IrGate("RY", (0,), (ParamRef("a", 2.0),), source_index=9),
             IrGate("U", (0,), (ParamRef("b"), 0.1, ParamRef("a")), 10)]
    c = ParamCircuit(1, gates, ["a", "b"])
    res = gradient_statistics(c, Z0, samples=50, seed=2)
    assert res["method"] == "sampling" and "shared" in res["fallback_reason"] or "more than one" in res["fallback_reason"]
    gv = res["gate_values"]
    assert [(g["source_index"], g["parameter"]) for g in gv] == [(7, "a"), (9, "a"), (10, "b"), (10, "a")]
    var = {r["name"]: r["variance"] for r in res["per_parameter"]}
    assert gv[0]["variance"] == gv[1]["variance"] == var["a"] and gv[2]["variance"] == var["b"]


def test_gate_values_fall_back_to_position_without_source_index():
    c = ParamCircuit(1, [IrGate("H", (0,)), IrGate("RX", (0,), (ParamRef("a"),))], ["a"])
    assert gradient_statistics(c, Z0, samples=10)["gate_values"][0]["source_index"] == 1


# ------------------------------------------------------------------- PPE
def test_ppe_output_is_exact_with_truncation_interval():
    res = gradient_statistics(_single_rx(), Z0, method="ppe")
    row = res["per_parameter"][0]
    assert res["method"] == "ppe" and res["interval_kind"] == "truncation"
    assert row["variance"] == pytest.approx(0.5) and row["mean"] == 0.0 and row["abs_mean"] is None
    assert row["variance_ci95"] == [pytest.approx(0.5), pytest.approx(0.5)]
    assert res["interval"]["ppe_method"] == "pauli_propagation_exact" and res["samples"] is None
    assert res["gradient_norm_mean"] is None and res["gradient_norm_rms"] == pytest.approx(math.sqrt(0.5))


def test_forced_ppe_raises_clear_error_when_not_applicable():
    b = Builder(1)
    b.add("T", (0,)).rot("RX", (0,))
    with pytest.raises(AnalysisError) as exc:
        gradient_statistics(b.build(), Z0, method="ppe")
    assert exc.value.code == "ppe_not_applicable" and "non-Clifford" in exc.value.message
    with pytest.raises(AnalysisError) as exc:
        gradient_statistics(_single_rx(), Z0, method="ppe", init="small")
    assert exc.value.code == "ppe_not_applicable"


def test_auto_prefers_tight_ppe_and_agrees_with_sampling():
    c = two_axis_hea(4, 2)
    obs = parse_observable("preset:local_z", 4)
    auto = gradient_statistics(c, obs, samples=3000, seed=4)
    assert auto["method"] == "ppe" and auto["fallback_reason"] is None
    samp = gradient_statistics(c, obs, samples=3000, seed=4, method="sampling")
    lo, hi = samp["variance_mean_ci95"]
    half = (hi - lo) / 2
    assert lo - 0.5 * half <= auto["variance_mean"] <= hi + 0.5 * half


@pytest.mark.parametrize("why", ["shared", "t_gate", "small"])
def test_auto_falls_back_to_sampling_and_records_the_reason(why):
    kwargs = {}
    if why == "shared":
        c = ParamCircuit(1, [IrGate("RX", (0,), (ParamRef("a"),)), IrGate("RY", (0,), (ParamRef("a"),))], ["a"])
    elif why == "t_gate":
        b = Builder(1)
        b.add("T", (0,)).rot("RX", (0,))
        c = b.build()
    else:
        c, kwargs = _single_rx(), {"init": "small"}
    res = gradient_statistics(c, Z0, samples=40, seed=1, **kwargs)
    assert res["method"] == "sampling" and res["interval_kind"] == "bootstrap"
    assert res["fallback_reason"] and any("Fell back" in n for n in res["notes"])


def test_auto_falls_back_when_ppe_bound_is_not_tight(monkeypatch):
    monkeypatch.setattr(analyses, "_AUTO_PPE", {"max_frontier": 3, "time_budget_s": 5.0, "min_weight_abs": 0.0})
    c = two_axis_hea(4, 3)
    res = gradient_statistics(c, parse_observable("preset:global_z", 4), samples=200, seed=1)
    assert res["method"] == "sampling" and "bound width" in res["fallback_reason"]


def test_wide_ppe_is_reported_honestly_when_sampling_is_impossible(monkeypatch):
    monkeypatch.setattr(analyses, "_FORCED_PPE", {"max_frontier": 3, "time_budget_s": 5.0, "min_weight_abs": 0.0})
    c = hea_circuit(22, 3, rot="RX")
    res = gradient_statistics(c, parse_observable("preset:global_z", 22))
    assert res["method"] == "ppe" and res["interval"]["ppe_method"] == "pauli_propagation_bounded"
    assert any("statevector sampling is unavailable" in n for n in res["notes"])


def test_above_statevector_limit_needs_ppe():
    b = Builder(21)
    b.add("T", (0,)).rot("RX", (0,))
    with pytest.raises(AnalysisError) as exc:
        gradient_statistics(b.build(), parse_observable("Z0", 21))
    assert exc.value.code == "ppe_required"
    with pytest.raises(AnalysisError) as exc:
        gradient_statistics(hea_circuit(21, 1), parse_observable("Z0", 21), method="sampling")
    assert exc.value.code == "ppe_required"
    assert gradient_statistics(hea_circuit(21, 1), parse_observable("Z0", 21))["method"] == "ppe"


@pytest.mark.parametrize("kwargs,code", [
    ({"samples": 1}, "invalid_request"), ({"init": "wide"}, "invalid_request"), ({"method": "x"}, "invalid_request"),
])
def test_invalid_requests(kwargs, code):
    with pytest.raises(AnalysisError) as exc:
        gradient_statistics(_single_rx(), Z0, **kwargs)
    assert exc.value.code == code


def test_no_parameters_and_bad_observable():
    with pytest.raises(AnalysisError) as exc:
        gradient_statistics(ParamCircuit(1, [IrGate("H", (0,))], []), Z0)
    assert exc.value.code == "no_parameters"
    with pytest.raises(AnalysisError) as exc:
        gradient_statistics(_single_rx(), parse_observable("Z3", 4))
    assert exc.value.code == "invalid_observable"


# ----------------------------------------------------------- determinism
def test_same_seed_gives_bit_identical_sampling_and_ppe_results():
    c = two_axis_hea(5, 2)
    obs = parse_observable("preset:global_z", 5)
    a = gradient_statistics(c, obs, samples=150, seed=42, method="sampling")
    b = gradient_statistics(c, obs, samples=150, seed=42, method="sampling")
    assert _strip(a) == _strip(b)
    assert _strip(a) != _strip(gradient_statistics(c, obs, samples=150, seed=43, method="sampling"))
    p1 = gradient_statistics(c, obs, method="ppe")
    p2 = gradient_statistics(c, obs, method="ppe")
    assert _strip({k: v for k, v in p1.items()}) == _strip(p2)


def test_determinism_on_random_pauli_circuits():
    rng = np.random.default_rng(5)
    c = random_ppe_circuit(rng, 6, 24)
    obs = parse_observable("Z0*Z1 + X2", 6)
    assert _strip(gradient_statistics(c, obs, samples=64, seed=7, method="sampling")) == \
        _strip(gradient_statistics(c, obs, samples=64, seed=7, method="sampling"))


# ----------------------------------------------------------- cancel/progress
def test_cancel_raises_and_progress_is_monotone_and_prompt():
    c = two_axis_hea(12, 3)
    obs = parse_observable("preset:local_z", 12)
    fracs = []
    gradient_statistics(c, obs, samples=48, seed=1, method="sampling", progress=lambda f, m: fracs.append(f))
    assert fracs == sorted(fracs) and fracs[-1] == 1.0 and len(fracs) >= 4
    # checkpoint spacing is a deterministic work bound (state elements x ops per chunk), never a timer:
    prog = compile_circuit(c)
    chunk = analyses._chunk_size(prog, 48)
    assert chunk == 1 or chunk * (1 << 12) * len(prog.canonical_gates) <= analyses._CHUNK_WORK
    calls = {"n": 0}

    def cancel():
        calls["n"] += 1
        return calls["n"] > 2

    t0 = time.perf_counter()
    with pytest.raises(AnalysisCancelled):
        gradient_statistics(c, obs, samples=48, seed=1, method="sampling", cancel=cancel)
    assert time.perf_counter() - t0 < 1.5


def test_ppe_cancel_is_forwarded():
    c = hea_circuit(64, 2)
    with pytest.raises(AnalysisCancelled):
        gradient_statistics(c, parse_observable("preset:local_z", 64), method="ppe", cancel=lambda: True)


# ------------------------------------------- PH-C1: no invented midpoint (review)
def test_uninformative_ppe_above_statevector_limit_reports_null_headline_and_interval(monkeypatch):
    """Reviewer's n=24 global_z brick: the PPE cannot resolve ~3e-8; the old code reported 0.48."""
    small = {"max_frontier": 20_000, "time_budget_s": 30.0, "min_weight_abs": 0.0}
    monkeypatch.setattr(analyses, "_AUTO_PPE", small)
    monkeypatch.setattr(analyses, "_FORCED_PPE", small)
    c = two_axis_hea(24, 12)
    res = gradient_statistics(c, parse_observable("preset:global_z", 24))
    assert res["method"] == "ppe" and res["interval_kind"] == "truncation"
    assert res["variance_mean"] is None
    lo, hi = res["variance_mean_ci95"]
    assert 0.0 <= lo <= hi and res["interval"]["variance_mean"] == [lo, hi]
    assert any("variance_mean is null" in n for n in res["notes"])
    unresolved = [r for r in res["per_parameter"] if r["variance"] is None]
    assert unresolved and all(r["variance_ci95"][1] > 0 for r in unresolved)
    nulls = {r["name"] for r in unresolved}
    assert {g["parameter"] for g in res["gate_values"] if g["variance"] is None} == nulls
    assert res["gradient_norm_rms"] is None
    json.dumps(res, allow_nan=False)


def test_unresolved_ppe_falls_back_to_sampling_at_or_below_the_limit(monkeypatch):
    monkeypatch.setattr(analyses, "_AUTO_PPE", {"max_frontier": 50, "time_budget_s": 30.0, "min_weight_abs": 0.0})
    res = gradient_statistics(two_axis_hea(6, 4), parse_observable("preset:global_z", 6), samples=64, seed=2)
    assert res["method"] == "sampling" and res["variance_mean"] is not None
    assert res["fallback_reason"]


def test_budget_exhausted_ppe_has_no_numeric_headline(monkeypatch):
    zero = {"max_frontier": 2_000_000, "time_budget_s": 0.0, "min_weight_abs": 0.0}
    monkeypatch.setattr(analyses, "_FORCED_PPE", zero)
    res = gradient_statistics(two_axis_hea(5, 3), parse_observable("preset:global_z", 5), method="ppe")
    assert res["interval"]["status"] == "budget_exhausted" and res["variance_mean"] is None
