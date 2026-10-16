"""compare: never says "better" without separated intervals."""

from __future__ import annotations

from typing import Any

from .context import Context
from .errors import ToolInputError
from .estimates import DEFAULT_LIKELIHOOD_FACTOR, ESTIMATOR, ci_method_label, intervals_overlap, point_estimate
from .journal import canonical_json
from .manifest import UNITS, build_manifest
from .rows import mixed_metadata_keys, row_value, sum_counts, validated_rows


def _load(ctx: Context, run_id: str, where: dict[str, Any]) -> list[dict]:
    record = ctx.journal.get(run_id)
    rows = record["outputs"].get("rows")
    if not isinstance(rows, list) or not rows:
        raise ToolInputError(f"run {run_id} ({record['tool']}) has no stats rows to compare")
    rows = validated_rows(rows)
    if not where:
        return rows
    return [r for i, r in enumerate(rows) if all(_safe_value(r, k, i) == v for k, v in where.items())]


def _safe_value(row: dict, key: str, index: int) -> Any:
    try:
        return row_value(row, key, index)
    except ToolInputError:
        return object()  # a row lacking the key never matches the filter


def _index(rows: list[dict], match_on: list[str], label: str) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for i, row in enumerate(rows):
        key_values = {k: row_value(row, k, i) for k in match_on}
        slot = out.setdefault(canonical_json(key_values), {"key": key_values, "rows": []})
        slot["rows"].append(row)
    for slot in out.values():
        if len({r["decoder"] for r in slot["rows"]}) > 1:
            raise ToolInputError(
                f"run {label}: rows with match key {slot['key']} mix decoders; add 'decoder' to match_on or filter with where_{label.lower()}"
            )
        mixed = mixed_metadata_keys(slot["rows"], match_on)
        if mixed:
            raise ToolInputError(
                f"run {label}: refusing to pool rows with match key {slot['key']}: they differ on {mixed}. "
                f"Add those keys to match_on or filter with where_{label.lower()}."
            )
    return out


def _meta_value(rows: list[dict], key: str) -> Any:
    return (rows[0].get("json_metadata") or {}).get(key)


def _require_equal_rounds(slot_a: dict[str, Any], slot_b: dict[str, Any], match_on: list[str]) -> None:
    if "rounds" in match_on:
        return
    ra, rb = _meta_value(slot_a["rows"], "rounds"), _meta_value(slot_b["rows"], "rounds")
    if ra is not None and rb is not None and ra != rb:
        raise ToolInputError(
            f"point {slot_a['key']} has rounds={ra} in run A but rounds={rb} in run B; per-shot rates over "
            "different numbers of rounds are not comparable. Add 'rounds' to match_on."
        )


def _differs_on(rows_a: list[dict], rows_b: list[dict], match_on: list[str]) -> dict[str, list[Any]]:
    """Metadata keys (outside match_on) on which the two sides differ, e.g. decoder."""
    return mixed_metadata_keys([rows_a[0], rows_b[0]], match_on)


def _verdict(a: dict[str, Any], b: dict[str, Any]) -> str:
    if a["per_shot"] is None or b["per_shot"] is None:
        return "no_estimate"
    if intervals_overlap(a["per_shot"], b["per_shot"]):
        return "not_distinguishable"
    return "a_lower_error_rate" if a["per_shot"]["high"] < b["per_shot"]["low"] else "b_lower_error_rate"


def compare(
    ctx: Context, *, run_a: str, run_b: str, match_on: list[str], where_a: dict[str, Any] | None = None,
    where_b: dict[str, Any] | None = None, max_likelihood_factor: float = DEFAULT_LIKELIHOOD_FACTOR,
) -> dict[str, Any]:
    if max_likelihood_factor <= 1:
        raise ToolInputError("max_likelihood_factor must be > 1")
    if not match_on:
        raise ToolInputError("match_on must name at least one metadata key")
    idx_a = _index(_load(ctx, run_a, where_a or {}), match_on, "A")
    idx_b = _index(_load(ctx, run_b, where_b or {}), match_on, "B")
    comparisons = []
    for key in sorted(set(idx_a) & set(idx_b)):
        ests = {
            side: point_estimate(**sum_counts(idx[key]["rows"]), factor=max_likelihood_factor)
            for side, idx in (("a", idx_a), ("b", idx_b))
        }
        _require_equal_rounds(idx_a[key], idx_b[key], match_on)
        comparisons.append({"key": idx_a[key]["key"], "a": ests["a"], "b": ests["b"],
                            "differs_on": _differs_on(idx_a[key]["rows"], idx_b[key]["rows"], match_on),
                            "verdict": _verdict(ests["a"], ests["b"])})
    if not comparisons:
        raise ToolInputError("no matching points between the two runs for the given match_on keys")
    notes = [
        "'not_distinguishable' means the intervals overlap at this precision; it does NOT show the two are equal.",
        "A lower-error-rate verdict requires non-overlapping intervals. No correction for multiple comparisons "
        f"is applied across the {len(comparisons)} point(s).",
        "Per-shot rates are only comparable at equal rounds: include your rounds key in match_on.",
    ]
    if any(c[s]["discards"] for c in comparisons for s in ("a", "b")):
        notes.append("Some points have discards; rates are conditional on post-selection and only comparable if both runs post-select identically.")
    outputs = {
        "comparisons": comparisons,
        "only_in_a": [idx_a[k]["key"] for k in sorted(set(idx_a) - set(idx_b))],
        "only_in_b": [idx_b[k]["key"] for k in sorted(set(idx_b) - set(idx_a))],
    }
    params = {"run_a": run_a, "run_b": run_b, "match_on": match_on, "where_a": where_a or {},
              "where_b": where_b or {}, "max_likelihood_factor": max_likelihood_factor}
    manifest = build_manifest(
        tool="compare", parameters=params, estimator=ESTIMATOR, ci_method=ci_method_label(max_likelihood_factor),
        units={"per_shot_rate": UNITS["per_shot_rate"]}, notes=notes,
    )
    return ctx.record(tool="compare", inputs=params, outputs=outputs, manifest=manifest, parents=list(dict.fromkeys([run_a, run_b])))
