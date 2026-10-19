"""Independent audit of trainability_frontier: agreement on the seed, and catching planted lies."""

from __future__ import annotations

import copy

import pytest

pytest.importorskip("qiskit")

from kernel.discovery.audits import trainability_frontier as frontier_audit  # noqa: E402
from kernel.discovery.evaluators import _frontier_probe  # noqa: E402
from kernel.tests.test_discovery_frontier import (  # noqa: E402
    SIZES, SPEC, artifact, brick_ansatz, config, identity_like, seed_like,
)

SEED = 5


@pytest.fixture(scope="module")
def case():
    cfg = config()
    arts = [{"call_index": i, "artifact": artifact(seed_like(*c["args"]))} for i, c in enumerate(SPEC.calls(cfg))]
    evaluation = SPEC.score(cfg, arts, SEED, None, None, stage="full").to_dict()
    assert evaluation["status"] == "scored"
    return cfg, arts, evaluation


def run_audit(case, evaluation=None, **kwargs):
    cfg, arts, base = case
    return frontier_audit.audit(cfg, arts, SEED, evaluation=evaluation or base, **kwargs)


def by_id(report):
    return {c["id"]: c for c in report["checks"]}


def test_contract_shape(case):
    report = run_audit(case)
    assert set(report) == {"checks", "audit_fitness", "notes"}
    assert all(set(c) == {"id", "label", "status", "detail"} for c in report["checks"])
    assert all(c["status"] in ("pass", "fail", "warn", "skipped") for c in report["checks"])
    assert isinstance(report["audit_fitness"], float) and report["notes"]


def test_audit_agrees_on_the_honest_seed(case):
    report = run_audit(case)
    checks = by_id(report)
    assert [c["status"] for c in report["checks"]] == ["pass"] * 9, report["checks"]
    assert set(checks) == {"reparse", "ppe_reproducible", "ppe_vs_sampling", "structure_recheck", "dla_recheck",
                           "hardness_recheck", "light_cone_recheck", "interval_consistency", "fitness_gap"}
    assert "99% CI" in checks["ppe_vs_sampling"]["detail"] and "samples" in checks["ppe_vs_sampling"]["detail"]
    assert report["audit_fitness"] == pytest.approx(case[2]["fitness"], abs=0.6)


def test_audit_catches_a_planted_wrong_ppe_result(case, monkeypatch):
    """The evaluator's PPE call is patched to return 6x too large a variance; the audit is not."""
    real = _frontier_probe.ppe_gradient_variances

    def wrong(*args, **kwargs):
        out = real(*args, **kwargs)
        scale = 6.0
        out["variance_mean"] *= scale
        out["variance_mean_interval"] = [x * scale for x in out["variance_mean_interval"]]
        for row in out["per_parameter"]:
            row["variance"] *= scale
            row["interval"] = [x * scale for x in row["interval"]]
        return out

    monkeypatch.setattr(_frontier_probe, "ppe_gradient_variances", wrong)
    cfg, arts, honest = case
    planted = SPEC.score(cfg, arts, SEED, None, None, stage="full").to_dict()
    monkeypatch.undo()
    assert planted["status"] == "scored"
    assert planted["metrics"]["variance_points"][0]["variance"] == pytest.approx(
        6 * honest["metrics"]["variance_points"][0]["variance"])
    report = run_audit(case, planted)
    checks = by_id(report)
    assert checks["ppe_vs_sampling"]["status"] == "fail"
    assert checks["ppe_reproducible"]["status"] == "fail"
    assert "outside the sampling 99% CI twice" in checks["ppe_vs_sampling"]["detail"]
    assert report["audit_fitness"] == pytest.approx(honest["fitness"], abs=0.6)  # the audit's own number is honest


def test_audit_catches_an_inflated_hardness_claim(case):
    lie = copy.deepcopy(case[2])
    lie["metrics"]["pp_exact_cost"]["log10_strings_lower"] += 4.0
    lie["objectives"]["pp_exact_cost"]["value"] += 4.0
    lie["fitness"] += 2.0
    checks = by_id(run_audit(case, lie))
    assert checks["hardness_recheck"]["status"] == "fail"
    assert checks["fitness_gap"]["status"] in ("warn", "fail")


def test_audit_catches_a_wrong_dla_claim(case):
    lie = copy.deepcopy(case[2])
    lie["metrics"]["dla"]["dimension"] = 99
    lie["metrics"]["dla"]["dimension_lower_bound"] = 99
    assert by_id(run_audit(case, lie))["dla_recheck"]["status"] == "fail"


def test_audit_catches_an_unreproducible_uncensored_cost_claim(case):
    """A recorded exact cost lower than what the audit measures is also a disagreement."""
    lie = copy.deepcopy(case[2])
    lie["metrics"]["pp_exact_cost"]["log10_strings_lower"] -= 1.0
    assert by_id(run_audit(case, lie))["hardness_recheck"]["status"] == "fail"


def test_audit_catches_a_wrong_light_cone_claim(case):
    lie = copy.deepcopy(case[2])
    lie["metrics"]["light_cone"]["width"] += 5
    assert by_id(run_audit(case, lie))["light_cone_recheck"]["status"] == "fail"


def test_audit_catches_a_degenerate_family_the_evaluator_accepted(case):
    """Planted: the evaluator 'accepted' a product circuit (as the pre-PH-H2 guard did)."""
    cfg, _, evaluation = case
    product_arts = [{"call_index": i, "artifact": artifact(brick_ansatz(*c["args"], entangle=False))}
                    for i, c in enumerate(SPEC.calls(cfg))]
    report = frontier_audit.audit(cfg, product_arts, SEED, evaluation=evaluation)
    structure = by_id(report)["structure_recheck"]
    assert structure["status"] == "fail" and "independent blocks" in structure["detail"]


def test_audit_catches_a_wrong_dla_claim_at_a_smaller_probe(case):
    lie = copy.deepcopy(case[2])
    first = lie["metrics"]["dla_probes"][0]
    first["dimension"] = first["dimension_lower_bound"] = 99
    assert by_id(run_audit(case, lie))["dla_recheck"]["status"] == "fail"


def test_audit_reparses_artifacts_from_json(case):
    cfg, arts, evaluation = case
    broken = copy.deepcopy(arts)
    broken[1]["artifact"]["ir"]["gates"][0]["name"] = "BOGUS"
    report = frontier_audit.audit(cfg, broken, SEED, evaluation=evaluation)
    assert [c["id"] for c in report["checks"]] == ["reparse"] and report["checks"][0]["status"] == "fail"
    assert report["audit_fitness"] is None


def test_audit_skips_unscored_evaluations(case):
    cfg, arts, _ = case
    rejected = SPEC.score(
        cfg, [{"call_index": i, "artifact": artifact(identity_like(*c["args"]))} for i, c in enumerate(SPEC.calls(cfg))],
        SEED, None, None, stage="full",
    ).to_dict()
    report = frontier_audit.audit(cfg, arts, SEED, evaluation=rejected)
    assert report["checks"][0]["status"] == "skipped" and report["audit_fitness"] is None


def test_sampling_check_is_skipped_above_twelve_qubits():
    cfg = config({"qubits": [14, 16], "n_layers": 2})
    arts = [{"call_index": i, "artifact": artifact(seed_like(*c["args"]))} for i, c in enumerate(SPEC.calls(cfg))]
    evaluation = SPEC.score(cfg, arts, SEED, None, None, stage="full").to_dict()
    assert evaluation["status"] == "scored"
    report = frontier_audit.audit(cfg, arts, SEED, evaluation=evaluation)
    assert by_id(report)["ppe_vs_sampling"]["status"] == "skipped"
    assert by_id(report)["ppe_reproducible"]["status"] == "pass"


def test_audit_honours_cancel_callable_and_event(case):
    import threading

    event = threading.Event()
    assert run_audit(case, cancel=event)["checks"][0]["status"] == "pass"
    assert run_audit(case, cancel=lambda: False)["checks"][0]["status"] == "pass"
    assert len(SIZES) == 4
