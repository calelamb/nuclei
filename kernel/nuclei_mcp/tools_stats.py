"""load_stats and fit."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import sinter

from .context import Context
from .errors import ToolInputError
from .estimates import (
    DEFAULT_LIKELIHOOD_FACTOR,
    ESTIMATOR,
    ci_method_label,
    estimate_lambda,
    point_estimate,
)
from .journal import canonical_json, sha256_text
from .manifest import UNITS, build_manifest
from .rows import group_key, mixed_metadata_keys, row_value, stats_to_rows, sum_counts, validated_rows


def load_stats(ctx: Context, paths: list[str]) -> dict[str, Any]:
    """Read sinter CSV files with ``sinter.read_stats_from_csv_files`` semantics."""
    resolved = [Path(p).expanduser() for p in paths]
    for original, path in zip(paths, resolved):
        if not path.is_file():
            raise ToolInputError(f"stats file not found: {original}")
    total = 0
    for original, path in zip(paths, resolved):
        size = path.stat().st_size
        ctx.ceilings.require("max_csv_bytes", size)
        total += size
        ctx.ceilings.require("max_total_csv_bytes", total)
    try:
        stats = sinter.read_stats_from_csv_files(*resolved)
    except Exception as exc:  # sinter raises assorted ValueError/KeyError on bad CSV
        raise ToolInputError(f"could not parse sinter CSV: {exc}") from exc
    rows = stats_to_rows(stats)
    ctx.ceilings.require("max_rows", len(rows))
    files = [{"path": str(p), "sha256": sha256_text(p.read_text(encoding="utf-8"))} for p in resolved]
    totals = sum_counts(rows)
    manifest = build_manifest(
        tool="load_stats",
        parameters={"paths": [str(p) for p in resolved]},
        units={k: UNITS[k] for k in ("shots", "errors", "discards", "seconds")},
        notes=["Rows with equal strong_id across files are merged by sinter."],
    )
    manifest = {**manifest, "input_files": files}
    outputs = {"rows": rows, "totals": totals, "n_rows": len(rows)}
    return ctx.record(tool="load_stats", inputs={"paths": [str(p) for p in resolved]}, outputs=outputs, manifest=manifest)


def _source_rows(ctx: Context, run_id: str | None, rows: list[dict] | None) -> tuple[list[dict], list[str], str]:
    if (run_id is None) == (rows is None):
        raise ToolInputError("provide exactly one of run_id or rows")
    if run_id is not None:
        record = ctx.journal.get(run_id)
        source = record["outputs"].get("rows")
        if not isinstance(source, list) or not source:
            raise ToolInputError(f"run {run_id} ({record['tool']}) has no stats rows to fit")
        return validated_rows(source), [run_id], "journal_run"
    if not rows:
        raise ToolInputError("rows must be non-empty")
    return validated_rows(rows), [], "inline_rows"


def _aggregate(rows: list[dict], group_by: list[str], x: str, rounds_key: str | None) -> dict[str, Any]:
    groups: dict[str, dict[str, Any]] = {}
    for i, row in enumerate(rows):
        label = {k: row_value(row, k, i) for k in group_by}
        xv = row_value(row, x, i)
        rounds = row_value(row, rounds_key, i) if rounds_key else None
        if rounds_key and (isinstance(rounds, bool) or not isinstance(rounds, (int, float)) or rounds < 1):
            raise ToolInputError(f"row {i}: {rounds_key}={rounds!r} must be a number >= 1")
        group = groups.setdefault(group_key(label), {"group": label, "points": {}})
        point = group["points"].setdefault(canonical_json(xv), {"x": xv, "rows": [], "rounds": rounds})
        if point["rounds"] != rounds:
            raise ToolInputError(f"rows at {x}={xv!r} disagree on {rounds_key} ({point['rounds']} vs {rounds}); refusing to merge")
        point["rows"].append(row)
    return groups


def _refuse_mixed_points(groups: dict[str, Any], group_by: list[str], x: str, rounds_key: str | None) -> None:
    pinned = [*group_by, x, *([rounds_key] if rounds_key else [])]
    for group in groups.values():
        for point in group["points"].values():
            mixed = mixed_metadata_keys(point["rows"], pinned)
            if mixed:
                raise ToolInputError(
                    f"refusing to pool rows at group={group['group']} {x}={point['x']!r}: they differ on "
                    f"{mixed}. Add those keys to group_by (or filter the rows) so each point is one experiment."
                )


# Keys that change the physics of an experiment: varying any of them across
# distances makes Lambda meaningless even when each distance has one value.
PHYSICS_KEYS = frozenset({"decoder", "p", "noise", "noise_model", "basis", "b", "code", "code_family"})


def _derived_from_distance(points: list[dict[str, Any]], key: str) -> bool:
    """True when ``key`` is constant within each point and one-to-one with x (e.g. label "surface d=3")."""
    value_by_x: dict[Any, str] = {}
    for point in points:
        values = {canonical_json({"v": (r.get("json_metadata") or {}).get(key)}) for r in point["rows"]}
        if len(values) != 1:
            return False
        value_by_x[point["x"]] = values.pop()
    return len(set(value_by_x.values())) == len(value_by_x)


def _refuse_mixed_lambda_groups(groups: dict[str, Any], group_by: list[str], x: str, rounds_key: str | None) -> list[str]:
    """Lambda compares points across x, so every point in a group must be the same experiment.

    Non-physics keys that are one-to-one with the distance (labels, qubit
    counts) are tolerated and returned so the manifest can name them.
    """
    pinned = [*group_by, x, *([rounds_key] if rounds_key else [])]
    tolerated: set[str] = set()
    for group in groups.values():
        points = list(group["points"].values())
        mixed = mixed_metadata_keys([r for point in points for r in point["rows"]], pinned)
        derived = {k for k in mixed if k not in PHYSICS_KEYS and _derived_from_distance(points, k)}
        offending = {k: v for k, v in mixed.items() if k not in derived}
        if offending:
            raise ToolInputError(
                f"refusing to estimate Lambda across points of group={group['group']}: they differ on {offending}. "
                "Lambda needs one experiment varying only the distance; add those keys to group_by (or filter the rows)."
            )
        tolerated |= derived
    return sorted(tolerated)


def _fit_group(group: dict[str, Any], factor: float) -> dict[str, Any]:
    points = []
    for point in sorted(group["points"].values(), key=lambda p: (str(type(p["x"])), p["x"])):
        counts = sum_counts(point["rows"])
        est = point_estimate(**counts, factor=factor, rounds=point["rounds"])
        points.append({"x": point["x"], "rounds": point["rounds"], "n_rows": len(point["rows"]), **est})
    return {"group": group["group"], "points": points}


def fit(
    ctx: Context,
    *,
    run_id: str | None,
    rows: list[dict] | None,
    group_by: list[str],
    x: str,
    rounds_key: str | None,
    x_is_distance: bool = False,
    max_likelihood_factor: float = DEFAULT_LIKELIHOOD_FACTOR,
) -> dict[str, Any]:
    """Per-shot / per-round rates with CIs per group; Lambda needs >= 3 distances."""
    if max_likelihood_factor <= 1:
        raise ToolInputError("max_likelihood_factor must be > 1")
    source, parents, provenance = _source_rows(ctx, run_id, rows)
    aggregated = _aggregate(source, group_by, x, rounds_key)
    _refuse_mixed_points(aggregated, group_by, x, rounds_key)
    derived_keys = _refuse_mixed_lambda_groups(aggregated, group_by, x, rounds_key) if x_is_distance and rounds_key else []
    groups = [_fit_group(g, max_likelihood_factor) for g in aggregated.values()]
    notes = [
        "Rates are over kept shots (shots - discards); a rate with discards is conditional on post-selection.",
        "The interval is a likelihood-ratio region, not a named confidence level.",
    ]
    if derived_keys:
        notes.append(f"Metadata {derived_keys} varies across distances but is one-to-one with {x!r} "
                     "(treated as derived from the distance, e.g. a label); Lambda was estimated anyway.")
    if any(len({r["strong_id"] for r in pt["rows"]}) > 1 for g in aggregated.values() for pt in g["points"].values()):
        notes.append("Some points merge rows with different strong_ids (same metadata, different circuit/decoder hash); verify they are the same experiment.")
    for g in groups:
        if not x_is_distance:
            g["lambda"] = {"status": "not_estimated", "reason": "x_is_distance is false; Lambda is only estimated when x is declared to be the code-distance key"}
        elif not rounds_key:
            g["lambda"] = {"status": "not_estimated", "reason": "rounds_key not given; Lambda needs per-round rates"}
        else:
            g["lambda"] = estimate_lambda(g["points"])
        if any(p["discards"] > 0 for p in g["points"]):
            g["has_discards"] = True
    manifest = build_manifest(
        tool="fit",
        parameters={"group_by": group_by, "x": x, "rounds_key": rounds_key,
                    "x_is_distance": x_is_distance, "max_likelihood_factor": max_likelihood_factor, "source": provenance},
        estimator=ESTIMATOR + (" ; per-round via sinter.shot_error_rate_to_piece_error_rate" if rounds_key else ""),
        ci_method=ci_method_label(max_likelihood_factor),
        units={k: UNITS[k] for k in ("per_shot_rate", "per_round_rate", "lambda")},
        notes=notes,
    )
    inputs = {"run_id": run_id, "rows": rows, "group_by": group_by, "x": x, "rounds_key": rounds_key,
              "x_is_distance": x_is_distance, "max_likelihood_factor": max_likelihood_factor}
    return ctx.record(tool="fit", inputs=inputs, outputs={"groups": groups}, manifest=manifest, parents=parents)
