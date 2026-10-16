from __future__ import annotations

import math

import pytest
import sinter

from nuclei_mcp.errors import ToolInputError
from nuclei_mcp.estimates import estimate_lambda
from nuclei_mcp.tools_stats import fit, load_stats

from .conftest import make_row


def _fit(ctx, **kw):
    base = dict(run_id=None, rows=None, group_by=["decoder", "p"], x="d", rounds_key=None)
    return fit(ctx, **{**base, **kw})


def test_load_stats_agrees_with_sinter_on_fixture(ctx, fixture_csv):
    out = load_stats(ctx, [str(fixture_csv)])
    expected = sinter.read_stats_from_csv_files(fixture_csv)
    assert out["n_rows"] == len(expected) == 8
    for row, stat in zip(out["rows"], expected):
        assert (row["shots"], row["errors"], row["discards"]) == (stat.shots, stat.errors, stat.discards)
        assert row["strong_id"] == stat.strong_id and row["json_metadata"] == stat.json_metadata
    assert out["totals"] == {"shots": 160000, "errors": sum(s.errors for s in expected), "discards": 0}
    assert out["manifest"]["input_files"][0]["sha256"]
    assert out["manifest"]["versions"]["sinter"] == sinter.__version__


def test_fit_golden_agreement_with_sinter_helpers(ctx, fixture_csv):
    run = load_stats(ctx, [str(fixture_csv)])
    out = _fit(ctx, run_id=run["run_id"], rounds_key="d")
    assert out["parent_run_ids"] == [run["run_id"]]
    stats = sinter.read_stats_from_csv_files(fixture_csv)
    by_key = {(s.json_metadata["decoder"], s.json_metadata["p"], s.json_metadata["d"]): s for s in stats}
    assert len(out["groups"]) == 4
    for group in out["groups"]:
        for point in group["points"]:
            s = by_key[(group["group"]["decoder"], group["group"]["p"], point["x"])]
            ref = sinter.fit_binomial(num_shots=s.shots - s.discards, num_hits=s.errors, max_likelihood_factor=1000)
            assert point["per_shot"] == {"best": ref.best, "low": ref.low, "high": ref.high}
            pr = sinter.shot_error_rate_to_piece_error_rate(ref, pieces=point["x"])
            assert point["per_round"]["best"] == pytest.approx(pr.best)
            assert point["per_round"]["low"] <= point["per_round"]["best"] <= point["per_round"]["high"]
        # fixture has only d=3 and d=5: Lambda must be refused, not guessed
        assert group["lambda"]["status"] == "not_estimated"
        assert ">= 3" in group["lambda"]["reason"]
    assert out["manifest"]["ci_method"].startswith("sinter.fit_binomial")
    assert "per_round_rate" in out["manifest"]["units"]


def test_discards_reduce_trials(ctx):
    rows = [make_row(3, 0.01, 1000, 10, discards=500)]
    point = _fit(ctx, rows=rows)["groups"][0]["points"][0]
    ref = sinter.fit_binomial(num_shots=500, num_hits=10, max_likelihood_factor=1000)
    assert point["kept_shots"] == 500 and point["per_shot"]["best"] == ref.best == 0.02
    assert _fit(ctx, rows=rows)["groups"][0]["has_discards"] is True


def test_all_discarded_has_no_rate(ctx):
    point = _fit(ctx, rows=[make_row(3, 0.01, 100, 0, discards=100)])["groups"][0]["points"][0]
    assert point["per_shot"] is None


def _lambda_rows(true_lambda: float, distances=(3, 5, 7), shots=10**9):
    rows = []
    for d in distances:
        per_round = 0.01 * true_lambda ** (-(d - 3) / 2)
        per_shot = 0.5 * (1 - (1 - 2 * per_round) ** d)
        rows.append(make_row(d, 0.001, shots, round(per_shot * shots)))
    return rows


def test_lambda_recovered_with_three_distances(ctx):
    lam = _fit(ctx, rows=_lambda_rows(2.0), group_by=["p"], rounds_key="rounds")["groups"][0]["lambda"]
    assert lam["status"] == "estimated" and lam["n_points"] == 3 and lam["degrees_of_freedom"] == 1
    assert lam["lambda"] == pytest.approx(2.0, rel=1e-3)
    assert lam["ci95"]["low"] <= lam["lambda"] <= lam["ci95"]["high"]


def test_lambda_requires_rounds_key(ctx):
    lam = _fit(ctx, rows=_lambda_rows(2.0), group_by=["p"])["groups"][0]["lambda"]
    assert lam["status"] == "not_estimated" and "rounds_key" in lam["reason"]


def test_lambda_excludes_zero_error_points_and_can_fall_below_three(ctx):
    rows = _lambda_rows(2.0)[:2] + [make_row(7, 0.001, 1000, 0)]
    lam = _fit(ctx, rows=rows, group_by=["p"], rounds_key="rounds")["groups"][0]["lambda"]
    assert lam["status"] == "not_estimated"
    assert lam["excluded_points"][0]["x"] == 7


def test_lambda_non_numeric_x_refused():
    pts = [{"x": "a", "errors": 1, "per_round": {"best": 0.1}}]
    assert estimate_lambda(pts)["status"] == "not_estimated"


def test_lambda_noisy_points_have_wider_ci_than_exact(ctx):
    exact = _fit(ctx, rows=_lambda_rows(2.0), group_by=["p"], rounds_key="rounds")["groups"][0]["lambda"]
    noisy_rows = _lambda_rows(2.0, shots=10**9)
    noisy_rows[1] = {**noisy_rows[1], "errors": int(noisy_rows[1]["errors"] * 1.3)}
    noisy = _fit(ctx, rows=noisy_rows, group_by=["p"], rounds_key="rounds")["groups"][0]["lambda"]
    assert (noisy["ci95"]["high"] - noisy["ci95"]["low"]) > (exact["ci95"]["high"] - exact["ci95"]["low"])
    assert math.isfinite(noisy["lambda"])


def test_same_point_rows_are_summed(ctx):
    rows = [make_row(3, 0.01, 1000, 10), {**make_row(3, 0.01, 1000, 30), "strong_id": "other"}]
    point = _fit(ctx, rows=rows)["groups"][0]["points"][0]
    assert (point["shots"], point["errors"], point["n_rows"]) == (2000, 40, 2)


@pytest.mark.parametrize(
    "kwargs, message",
    [
        ({"run_id": None, "rows": None}, "exactly one"),
        ({"rows": []}, "non-empty"),
        ({"rows": [make_row(3, 0.01, 10, 1)], "group_by": ["nope"]}, "no key 'nope'"),
        ({"rows": [make_row(3, 0.01, 10, 1)], "x": "nope"}, "no key 'nope'"),
        ({"rows": [make_row(3, 0.01, 10, 20)]}, "exceed kept shots"),
        ({"rows": [make_row(3, 0.01, 10, 1)], "max_likelihood_factor": 1.0}, "> 1"),
        ({"rows": [{"shots": -1, "errors": 0}]}, "invalid"),
        ({"run_id": "run-20260101T000000Z-00000000"}, "no journal record"),
        ({"rows": [make_row(3, 0.01, 10, 1)], "rounds_key": "nope"}, "no key 'nope'"),
    ],
)
def test_fit_validation_failures(ctx, kwargs, message):
    with pytest.raises(ToolInputError, match=message):
        _fit(ctx, **kwargs)


def test_fit_rejects_runs_without_rows(ctx):
    from nuclei_mcp.tools_inspect import inspect_circuit  # noqa: F401
    rec = ctx.journal.append(tool="inspect_circuit", inputs={}, outputs={"num_qubits": 1}, manifest={}, parent_run_ids=[])
    with pytest.raises(ToolInputError, match="no stats rows"):
        _fit(ctx, run_id=rec["run_id"])


def test_rounds_disagreement_refused(ctx):
    rows = [make_row(3, 0.01, 10, 1, rounds=3), {**make_row(3, 0.01, 10, 1, rounds=5), "strong_id": "z"}]
    with pytest.raises(ToolInputError, match="disagree"):
        _fit(ctx, rows=rows, rounds_key="rounds")


def test_load_stats_failures(ctx, tmp_path):
    with pytest.raises(ToolInputError, match="not found"):
        load_stats(ctx, [str(tmp_path / "missing.csv")])
    bad = tmp_path / "bad.csv"
    bad.write_text("this,is,not,sinter\n1,2,3,4\n")
    with pytest.raises(ToolInputError, match="could not parse"):
        load_stats(ctx, [str(bad)])


def test_load_stats_row_cap(ctx, fixture_csv):
    small = ctx.__class__(journal=ctx.journal, ceilings=ctx.ceilings.model_copy(update={"max_rows": 2}))
    with pytest.raises(ToolInputError, match="max_rows"):
        load_stats(small, [str(fixture_csv)])
