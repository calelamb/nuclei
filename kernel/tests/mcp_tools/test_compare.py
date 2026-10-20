from __future__ import annotations

import pytest

from nuclei_mcp.errors import ToolInputError
from nuclei_mcp.tools_compare import compare

from .conftest import make_row


def _run(ctx, rows):
    return ctx.journal.append(tool="load_stats", inputs={}, outputs={"rows": rows}, manifest={}, parent_run_ids=[])["run_id"]


def test_overlapping_intervals_not_distinguishable(ctx):
    a = _run(ctx, [make_row(3, 0.01, 1000, 50)])
    b = _run(ctx, [make_row(3, 0.01, 1000, 58)])
    out = compare(ctx, run_a=a, run_b=b, match_on=["d", "p"])
    assert out["comparisons"][0]["verdict"] == "not_distinguishable"
    assert out["parent_run_ids"] == [a, b]
    assert any("does NOT show" in n for n in out["manifest"]["notes"])


def test_separated_intervals_report_direction(ctx):
    a = _run(ctx, [make_row(3, 0.01, 100000, 100)])
    b = _run(ctx, [make_row(3, 0.01, 100000, 1000)])
    assert compare(ctx, run_a=a, run_b=b, match_on=["d", "p"])["comparisons"][0]["verdict"] == "a_lower_error_rate"
    assert compare(ctx, run_a=b, run_b=a, match_on=["d", "p"])["comparisons"][0]["verdict"] == "b_lower_error_rate"


def test_few_shots_never_claim_better(ctx):
    a = _run(ctx, [make_row(3, 0.01, 20, 0)])
    b = _run(ctx, [make_row(3, 0.01, 20, 3)])
    assert compare(ctx, run_a=a, run_b=b, match_on=["d"])["comparisons"][0]["verdict"] == "not_distinguishable"


def test_where_filters_allow_decoder_vs_decoder_in_one_run(ctx):
    r = _run(ctx, [make_row(3, 0.01, 100000, 100, decoder="pymatching"), make_row(3, 0.01, 100000, 1000, decoder="fusion_blossom")])
    out = compare(ctx, run_a=r, run_b=r, match_on=["d", "p"], where_a={"decoder": "pymatching"}, where_b={"decoder": "fusion_blossom"})
    assert out["comparisons"][0]["verdict"] == "a_lower_error_rate"
    assert out["parent_run_ids"] == [r]


def test_mixed_decoders_under_one_key_are_ambiguous(ctx):
    r = _run(ctx, [make_row(3, 0.01, 1000, 5, decoder="pymatching"), make_row(3, 0.01, 1000, 7, decoder="fusion_blossom")])
    with pytest.raises(ToolInputError, match="mix decoders"):
        compare(ctx, run_a=r, run_b=r, match_on=["d"])


def test_unmatched_points_listed_and_no_overlap_error(ctx):
    a = _run(ctx, [make_row(3, 0.01, 1000, 5), make_row(5, 0.01, 1000, 5)])
    b = _run(ctx, [make_row(3, 0.01, 1000, 5), make_row(7, 0.01, 1000, 5)])
    out = compare(ctx, run_a=a, run_b=b, match_on=["d"])
    assert out["only_in_a"] == [{"d": 5}] and out["only_in_b"] == [{"d": 7}]
    c = _run(ctx, [make_row(9, 0.01, 1000, 5)])
    with pytest.raises(ToolInputError, match="no matching points"):
        compare(ctx, run_a=a, run_b=c, match_on=["d"])


def test_discards_note(ctx):
    a = _run(ctx, [make_row(3, 0.01, 1000, 5, discards=100)])
    out = compare(ctx, run_a=a, run_b=a, match_on=["d"])
    assert any("post-select" in n for n in out["manifest"]["notes"])


@pytest.mark.parametrize("kwargs, message", [
    ({"match_on": []}, "at least one"),
    ({"match_on": ["d"], "max_likelihood_factor": 0.5}, "> 1"),
    ({"match_on": ["nope"]}, "no key 'nope'"),
])
def test_compare_validation(ctx, kwargs, message):
    a = _run(ctx, [make_row(3, 0.01, 1000, 5)])
    with pytest.raises(ToolInputError, match=message):
        compare(ctx, run_a=a, run_b=a, **kwargs)


def test_compare_rejects_runs_without_rows(ctx):
    empty = ctx.journal.append(tool="inspect_circuit", inputs={}, outputs={}, manifest={}, parent_run_ids=[])["run_id"]
    with pytest.raises(ToolInputError, match="no stats rows"):
        compare(ctx, run_a=empty, run_b=empty, match_on=["d"])


def test_compare_refuses_to_pool_different_experiments(ctx):
    # match_on=['d'] would pool p=0.001 and p=0.01 into one point.
    a = _run(ctx, [make_row(3, 0.001, 100000, 10), make_row(3, 0.01, 100000, 5000)])
    with pytest.raises(ToolInputError, match=r"refusing to pool.*'p'"):
        compare(ctx, run_a=a, run_b=a, match_on=["d"])
    assert compare(ctx, run_a=a, run_b=a, match_on=["d", "p"])["comparisons"]


def test_compare_refuses_different_rounds_unless_matched(ctx):
    a = _run(ctx, [make_row(3, 0.01, 100000, 100, rounds=3)])
    b = _run(ctx, [make_row(3, 0.01, 100000, 1000, rounds=30)])
    with pytest.raises(ToolInputError, match="not comparable"):
        compare(ctx, run_a=a, run_b=b, match_on=["d", "p"])
    with pytest.raises(ToolInputError, match="no matching points"):
        compare(ctx, run_a=a, run_b=b, match_on=["d", "p", "rounds"])


def test_compare_reports_what_else_differs_between_sides(ctx):
    r = _run(ctx, [make_row(3, 0.01, 100000, 100, decoder="pymatching"), make_row(3, 0.01, 100000, 1000, decoder="fusion_blossom")])
    out = compare(ctx, run_a=r, run_b=r, match_on=["d", "p"], where_a={"decoder": "pymatching"}, where_b={"decoder": "fusion_blossom"})
    assert out["comparisons"][0]["differs_on"] == {"decoder": ["pymatching", "fusion_blossom"]}


@pytest.mark.parametrize("key", ["r", "rounds", "num_rounds"])
def test_compare_refuses_different_rounds_under_any_alias(ctx, key):
    def row(rounds, errors):
        r = make_row(3, 0.01, 100000, errors)
        meta = {k: v for k, v in r["json_metadata"].items() if k != "rounds"}
        return {**r, "json_metadata": {**meta, key: rounds}}

    a = _run(ctx, [row(3, 100)])
    b = _run(ctx, [row(15, 1000)])
    with pytest.raises(ToolInputError, match="not comparable"):
        compare(ctx, run_a=a, run_b=b, match_on=["d", "p"])


def test_compare_never_gives_lower_verdict_when_sides_differ_elsewhere(ctx):
    a = _run(ctx, [{**make_row(3, 0.01, 100000, 100), "json_metadata": {"d": 3, "p": 0.01, "noise_model": "A"}}])
    b = _run(ctx, [{**make_row(3, 0.01, 100000, 1000), "json_metadata": {"d": 3, "p": 0.01, "noise_model": "B"}}])
    out = compare(ctx, run_a=a, run_b=b, match_on=["d", "p"])
    assert out["comparisons"][0]["verdict"] == "not_comparable"
    assert out["comparisons"][0]["differs_on"] == {"noise_model": ["A", "B"]}
