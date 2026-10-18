"""Conjecture tester: interval semantics, ground-truth conjectures, budgets and the ledger."""

from __future__ import annotations

import copy

import pytest

from kernel.discovery.conjecture import ledger, semantics, tester
from kernel.discovery.conjecture.errors import SpecError
from kernel.discovery.conjecture.grammar import build_variant, validate_family
from kernel.discovery.conjecture.spec import qubit_counts, validate_conjecture
from kernel.trainability._analysis_common import AnalysisCancelled
from kernel.trainability.ir import ParamCircuit, ir_hash

BRICK = {"feature": "entangler_pattern", "op": "==", "value": "brick"}


def conjecture(**overrides) -> dict:
    base = {
        "id": "c1", "statement": "a test conjecture", "feature_predicate": BRICK,
        "prediction": {"quantity": "beta_upper95", "op": "<", "value": 0.2},
        "test_family": {"rotation_axes": ["Y", "Z"], "entangler": "cz", "pattern": "brick", "brick_start": "even",
                        "layers": [1, 2], "rotations_per_qubit_per_layer": 2, "observable": "preset:local_z"},
        "n_range": [8, 64], "circuits": 5, "points": 8,
    }
    return {**base, **overrides}


# ---------------------------------------------------------------- semantics
@pytest.mark.parametrize("lo,hi,op,value,expected", [
    (0.0, 0.05, "<", 0.1, "meets"), (0.0, 0.2, "<", 0.1, "indeterminate"), (0.5, 0.9, "<", 0.1, "violates"),
    (0.1, 0.3, "<", 0.1, "violates"), (0.2, 0.3, "<=", 0.1, "violates"), (0.0, 0.1, "<=", 0.1, "meets"),
    (0.3, 0.4, ">", 0.1, "meets"), (0.0, 0.4, ">", 0.1, "indeterminate"), (0.0, 0.1, ">", 0.1, "violates"),
    (0.1, None, ">=", 0.1, "meets"), (0.0, None, "<", 5, "indeterminate"), (6, None, "<", 5, "violates"),
])
def test_interval_outcome(lo, hi, op, value, expected):
    assert semantics.interval_outcome(lo, hi, op, value) == expected


def test_loose_points_are_bounded_not_exact():
    assert semantics.point_is_loose(1e-3, [0.9e-3, 1.1e-3], "complete") is False
    assert semantics.point_is_loose(1e-3, [0.0, 5e-3], "complete") is True
    assert semantics.point_is_loose(1e-3, [1e-3, 1e-3], "budget_exhausted") is True


def test_a_loose_point_makes_a_circuit_indeterminate_even_if_beta_looks_decisive():
    pred = {"quantity": "beta_upper95", "op": "<", "value": 0.1}
    observed = {"beta_ci95": [0.9, 1.1], "loose_points": [48], "errors": [], "max_n": 48}
    assert semantics.evaluate_prediction(pred, observed)[0] == "indeterminate"
    assert semantics.evaluate_prediction(pred, {**observed, "loose_points": []})[0] == "violates"


def test_verdict_prediction_semantics():
    pred = {"quantity": "verdict", "op": "==", "value": "polynomial"}
    assert semantics.evaluate_prediction(pred, {"fit_verdict": "polynomial"})[0] == "meets"
    assert semantics.evaluate_prediction(pred, {"fit_verdict": "barren_plateau"})[0] == "violates"
    assert semantics.evaluate_prediction(pred, {"fit_verdict": "inconclusive"})[0] == "indeterminate"


def test_qubit_counts_are_geometric_and_bounded():
    assert qubit_counts([8, 64], 5) == [8, 13, 23, 38, 64]
    assert qubit_counts([4, 7], 8) == [4, 5, 6, 7]
    ns = qubit_counts([5, 128], 8)
    assert ns[0] == 5 and ns[-1] == 128 and len(ns) == 8


@pytest.mark.parametrize("change,path", [
    ({"circuits": 4}, "circuits"), ({"circuits": 33}, "circuits"), ({"points": 3}, "points"),
    ({"n_range": [4, 200]}, "n_range[1]"), ({"n_range": [4, 6]}, "n_range"), ({"id": ""}, "id"),
    ({"prediction": {"quantity": "magic", "op": "<", "value": 1}}, "prediction.quantity"),
    ({"prediction": {"quantity": "verdict", "op": "<", "value": "polynomial"}}, "prediction.op"),
    ({"prediction": {"quantity": "verdict", "op": "==", "value": "fast"}}, "prediction.value"),
    ({"feature_predicate": {"feature": "__class__", "op": "==", "value": 1}}, "feature_predicate.feature"),
    ({"test_family": {"pattern": "star"}}, "test_family.pattern"),
    ({"surprise": 1}, "conjecture"),
])
def test_invalid_conjectures_carry_a_path(change, path):
    with pytest.raises(SpecError) as info:
        validate_conjecture(conjecture(**change))
    assert info.value.path == path


# ------------------------------------------------------------- ground truth
def test_local_z_shallow_brick_is_supported_up_to_n_64():
    result = tester.test_conjecture(conjecture(), seed=3)
    assert result["verdict"] == "supported", result["summary"]
    assert "supported on 5 held-out circuits up to n = 64" in result["summary"]
    assert "proven" not in result["summary"].lower()
    assert result["n_values"][-1] == 64 and len(result["evidence"]) == 5
    for item in result["evidence"]:
        assert item["outcome"] == "meets" and item["quantity"]["observed"][1] < 0.2
        assert all(p["method"] == "ppe" and not p["loose"] for p in item["points"])
        assert item["features"]["entangler_pattern"] == "brick" and item["features"]["n_layers"] <= 2


def test_global_z_brick_is_refuted_with_a_counterexample_near_beta_one():
    claim = conjecture(
        prediction={"quantity": "beta_upper95", "op": "<", "value": 0.1}, n_range=[6, 64], points=5,
        test_family={"rotation_axes": ["Y", "Z"], "entangler": "cz", "pattern": "brick", "brick_start": "even",
                     "layers": 1, "rotations_per_qubit_per_layer": 2, "observable": "preset:global_z"})
    result = tester.test_conjecture(claim, seed=3)
    assert result["verdict"] == "refuted", result["summary"]
    ce = result["counterexamples"][0]
    lo, hi = ce["quantity"]["observed"]
    assert lo == pytest.approx(1.0, abs=0.05) and hi == pytest.approx(1.0, abs=0.05)
    assert ce["family_params"]["observable"] == "preset:global_z" and ce["regenerate"]["variant"] >= 0
    # The IR is loadable and regenerable from (family, seed, variant).
    circuit = ParamCircuit.from_json(ce["ir"])
    again, _ = build_variant(validate_family(claim["test_family"]), ce["ir_n_qubits"], 3, ce["regenerate"]["variant"])
    assert ir_hash(circuit) == ir_hash(again)
    assert "refuted" in result["summary"].lower() and "proven" not in result["summary"].lower()


def test_unrealizable_predicate_is_inconclusive():
    claim = conjecture(feature_predicate={"feature": "entangler_pattern", "op": "==", "value": "ring"})
    result = tester.test_conjecture(claim, seed=1)
    assert result["verdict"] == "inconclusive" and result["evidence"] == []
    assert "family does not realize the predicate" in result["reasons"][0]
    assert result["resampling"]["accepted"] == 0 and result["resampling"]["rejected"] == result["resampling"]["attempts"]


def test_predicate_resampling_discards_nonconforming_draws():
    claim = conjecture(feature_predicate={"feature": "n_layers", "op": "==", "value": 2}, n_range=[6, 12], points=4)
    result = tester.test_conjecture(claim, seed=1)
    assert result["resampling"]["rejected"] >= 1
    assert all(e["features"]["n_layers"] == 2 for e in result["evidence"])


def test_budget_overrun_is_inconclusive_with_partial_evidence():
    claim = conjecture(
        prediction={"quantity": "beta_upper95", "op": "<", "value": 0.1}, n_range=[8, 48], points=5,
        test_family={"rotation_axes": ["Y", "Z"], "entangler": "cz", "pattern": "brick", "brick_start": "even",
                     "layers": 2, "rotations_per_qubit_per_layer": 2, "observable": "preset:global_z"})
    result = tester.test_conjecture(claim, seed=3, total_budget_s=0.05)
    assert result["verdict"] == "inconclusive" and result["partial"] is True
    assert "budget" in result["summary"].lower()
    assert 1 <= len(result["evidence"]) < 5
    assert result["evidence"][0]["outcome"] == "indeterminate"


def test_zero_total_budget_tests_nothing_and_says_so():
    result = tester.test_conjecture(conjecture(), seed=3, total_budget_s=0.0)
    assert result["verdict"] == "inconclusive" and result["evidence"] == [] and result["partial"]


def test_cancel_raises_and_progress_and_evidence_stream():
    with pytest.raises(AnalysisCancelled):
        tester.test_conjecture(conjecture(), seed=3, cancel=lambda: True)
    seen, fractions = [], []
    tester.test_conjecture(conjecture(n_range=[6, 12], points=4), seed=3,
                           progress=lambda f, m, i: fractions.append((f, i)), on_evidence=seen.append)
    assert [e["circuit_index"] for e in seen] == [0, 1, 2, 3, 4]
    assert fractions == sorted(fractions) and fractions[-1][0] == 1.0


def test_results_are_deterministic_apart_from_timings():
    def strip(r):
        r = copy.deepcopy(r)
        r["timings"] = {}
        for e in r["evidence"]:
            e["elapsed_ms"] = 0
            for p in e["points"]:
                p["elapsed_ms"] = 0
        return r
    claim = conjecture(n_range=[6, 20], points=4)
    assert strip(tester.test_conjecture(claim, seed=5)) == strip(tester.test_conjecture(claim, seed=5))


def test_verdict_and_variance_and_dla_quantities():
    shallow = conjecture(n_range=[8, 64])
    verdict = tester.test_conjecture({**shallow, "prediction": {"quantity": "verdict", "op": "==",
                                                                "value": "polynomial"}}, seed=3)
    assert verdict["verdict"] == "supported", verdict["summary"]
    variance = tester.test_conjecture(
        {**shallow, "prediction": {"quantity": "variance_at_max_n", "op": "<", "value": 1e-3}}, seed=3)
    assert variance["verdict"] == "supported"
    small = conjecture(n_range=[4, 8], points=4)
    dla_ok = tester.test_conjecture({**small, "prediction": {"quantity": "log2_dla_dimension", "op": "<",
                                                              "value": 20}}, seed=3)
    assert dla_ok["verdict"] == "supported" and dla_ok["evidence"][0]["dla"]["dimension"] > 0
    dla_bad = tester.test_conjecture({**small, "prediction": {"quantity": "log2_dla_dimension", "op": ">",
                                                               "value": 20}}, seed=3)
    assert dla_bad["verdict"] == "refuted"


def test_sampling_is_used_only_when_the_ppe_does_not_apply_and_n_is_small(monkeypatch):
    monkeypatch.setattr(tester, "ppe_applicable", lambda *a, **k: (False, "forced for the test"))
    claim = conjecture(n_range=[4, 12], points=4, circuits=5,
                       test_family={**conjecture()["test_family"], "layers": 1, "rotations_per_qubit_per_layer": 1,
                                    "rotation_axes": ["Y"]})
    small = tester.test_conjecture(claim, seed=2)
    assert all(p["method"] == "sampling" for e in small["evidence"] for p in e["points"])
    big = tester.test_conjecture({**claim, "n_range": [6, 16]}, seed=2)
    errors = [p["error"] for e in big["evidence"] for p in e["points"] if p["error"]]
    assert errors and errors[0]["code"] == "ppe_required"
    assert big["verdict"] == "inconclusive"


# ------------------------------------------------------------------- ledger
def synthetic_result() -> dict:
    conj = validate_conjecture(conjecture(id="demo", statement="Shallow brick ansatzes keep beta small.",
                                          n_range=[8, 64], points=4))
    feats = {"n_layers": 2, "entangler_pattern": "brick"}
    params = {"layers": 2, "axis_order_per_layer": ["YZ", "ZY"], "brick_start": 0}
    points = [{"n_qubits": 8, "variance": 0.0039, "interval": [0.0039, 0.0039], "method": "ppe",
               "status": "complete", "error": None}]
    meets = {"circuit_index": 0, "variant_id": "v0", "family_params": params, "features": feats,
             "regenerate": {"seed": 7, "variant": 0}, "points": points, "fit": {"verdict": "polynomial",
             "exponential": {"beta": 0.12, "beta_ci95": [0.08, 0.165]}, "preferred": "power_law", "summary": "s"},
             "dla": None, "quantity": {"quantity": "beta_upper95", "op": "<", "value": 0.2,
                                       "observed": [0.08, 0.165]},
             "outcome": "meets", "meets": True, "reason": ""}
    bad = {**meets, "circuit_index": 1, "variant_id": "v1", "outcome": "violates", "meets": False,
           "quantity": {**meets["quantity"], "observed": [0.9, 1.0]}}
    counter = {k: bad[k] for k in ("circuit_index", "variant_id", "family_params", "features", "regenerate",
                                   "points", "fit", "quantity", "reason")}
    counter |= {"ir": {"gates": [1, 2, 3]}, "ir_n_qubits": 8}
    return {"conjecture": conj, "verdict": "refuted", "summary": "Refuted: 1 of 2 held-out circuits violate it.",
            "reasons": [], "partial": False, "tally": {"meets": 1, "violates": 1, "indeterminate": 0},
            "n_circuits_tested": 2, "n_values": [8, 64], "n_max_tested": 64, "seed": 7,
            "resampling": {"attempts": 3}, "evidence": [meets, bad], "counterexamples": [counter],
            "timings": {"elapsed_ms": 12}}


EXPECTED_MARKDOWN = """\
# Conjecture ledger

Run: run-1
Prompt hash: `abc123`
Generated: 2026-10-18T00:00:00Z

Supported means the prediction held on held-out circuits within their 95% intervals. It is evidence, not a guarantee. Refuted and inconclusive conjectures are kept.

| Conjecture | Verdict | Circuits | Max n |
|---|---|---|---|
| demo | refuted | 2 | 64 |

## demo: refuted

> Shallow brick ansatzes keep beta small.

- Prediction: `beta_upper95 < 0.2`
- Qubit range tested: 8 to 64 (8, 64)
- Circuits: 2 tested of 5 requested (meets 1, violates 1, indeterminate 0)
- Seed: 7

Refuted: 1 of 2 held-out circuits violate it.

### Evidence

| Circuit | Layers | Pattern | Observed | Outcome |
|---|---|---|---|---|
| v0 | 2 | brick | [0.08, 0.165] | meets |
| v1 | 2 | brick | [0.9, 1] | violates |

### Counterexample v1

- Observed: [0.9, 1]
- Family parameters: layers 2, axis order YZ,ZY, brick start 0
- Regenerate with seed 7, variant 0
- IR: 3 gates on 8 qubits (in `conjectures.json`)

Evaluator fingerprint: `0123456789abcdef`
"""


def test_ledger_markdown_snapshot_and_entry_shape():
    entry = ledger.build_entry(synthetic_result(), fingerprint="0123456789abcdef" * 4,
                               versions={"engine": "1.0"})
    assert entry["evaluator_fingerprint"] == "0123456789abcdef" * 4 and entry["counterexamples"]
    assert entry["evidence"][0]["fit"]["beta_ci95"] == [0.08, 0.165]
    doc = ledger.build_ledger([entry], run_id="run-1", prompt_hash="abc123", generated_at="2026-10-18T00:00:00Z")
    assert ledger.render_markdown(doc) == EXPECTED_MARKDOWN
    assert ledger.render_markdown(doc) == ledger.render_markdown(copy.deepcopy(doc))


def test_ledger_add_entry_is_immutable_and_replaces_by_id():
    entry = ledger.build_entry(synthetic_result(), fingerprint="f" * 64, versions={})
    doc = ledger.build_ledger([entry], run_id="r")
    newer = ledger.add_entry(doc, {**entry, "verdict": "inconclusive"})
    assert len(newer["entries"]) == 1 and newer["entries"][0]["verdict"] == "inconclusive"
    assert doc["entries"][0]["verdict"] == "refuted"


def test_evaluator_fingerprint_is_stable_sha256():
    first = ledger.evaluator_fingerprint(refresh=True)
    assert len(first) == 64 and first == ledger.evaluator_fingerprint(refresh=True)
    assert "numpy" in ledger.kernel_versions()


def test_result_carries_the_tester_fingerprint() -> None:
    from kernel.discovery.conjecture.ledger import evaluator_fingerprint
    from kernel.discovery.conjecture.tester import partial_result

    conj = {
        "id": "fp", "statement": "s",
        "feature_predicate": {"all": [{"feature": "n_qubits", "op": ">=", "value": 1}]},
        "prediction": {"quantity": "beta_upper95", "op": "<", "value": 0.2},
        "test_family": {"family": "layered", "rotation_axes": ["Y", "Z"], "entangler": "cz", "pattern": "brick",
                        "layers": 1, "rotations_per_qubit_per_layer": 2, "observable": "preset:local_z", "variants": 5},
        "n_range": [4, 16], "circuits": 5, "points": 4,
    }
    result = partial_result(conj, [], "cancelled", seed=0)
    assert result["fingerprint"] == evaluator_fingerprint()
    assert len(result["fingerprint"]) == 64
