"""Statistics and sampling for the ``qec_memory`` evaluator (spec 6.3).

* Wilson 95% interval on the per-shot logical error rate P.
* Per-round conversion ``eps = (1 - (1 - 2P)^(1/r)) / 2``, applied to the point
  estimate and to both interval bounds (monotone in P). ``P >= 0.5`` is
  "saturated": eps is reported as 0.5.
* Lambda = eps(d_small) / eps(d_large) with a log-space delta-method interval:
  each eps gets a log-scale standard error ``(ln hi - ln lo) / (2 * 1.96)``,
  the two combine in quadrature and the interval is ``exp(ln r +/- 1.96 se)``.
  A zero or saturated eps makes lambda undefined, reported as ``inconclusive``.
* Sampling is batched and seeded; the stop rule depends only on counts, so a
  given seed always samples the same shots.
"""

from __future__ import annotations

import hashlib
import math
from typing import Any

import numpy as np

Z95 = 1.959963984540054
SATURATION = 0.5
BATCH_MIN = 2000
BATCH_MAX = 50000


def wilson(errors: int, shots: int, z: float = Z95) -> tuple[float, float]:
    if shots <= 0:
        return 0.0, 1.0
    p = errors / shots
    denom = 1 + z * z / shots
    centre = (p + z * z / (2 * shots)) / denom
    half = z * math.sqrt(p * (1 - p) / shots + z * z / (4 * shots * shots)) / denom
    lo = 0.0 if errors == 0 else max(0.0, centre - half)
    hi = 1.0 if errors == shots else min(1.0, centre + half)
    return lo, hi


def per_round(shot_rate: float, rounds: int) -> float:
    """Per-round error from a per-shot rate; 0.5 once saturated."""
    if shot_rate >= SATURATION:
        return SATURATION
    if shot_rate <= 0:
        return 0.0
    return (1.0 - (1.0 - 2.0 * shot_rate) ** (1.0 / rounds)) / 2.0


def round_summary(errors: int, shots: int, rounds: int) -> dict[str, Any]:
    p = errors / shots if shots else 0.0
    lo, hi = wilson(errors, shots)
    return {
        "ler_shot": p,
        "ci95_shot": [lo, hi],
        "ler_round": per_round(p, rounds),
        "ci95": [per_round(lo, rounds), per_round(hi, rounds)],
        "saturated": p >= SATURATION,
    }


def lambda_ratio(small: dict[str, Any], large: dict[str, Any]) -> dict[str, Any]:
    """Lambda between two per-distance summaries (each has ``d``, ``ler_round``, ``ci95``)."""
    out: dict[str, Any] = {"d_from": small["d"], "d_to": large["d"], "value": None, "ci95": None}
    e1, e2 = small["ler_round"], large["ler_round"]
    if small.get("saturated") or large.get("saturated") or e1 <= 0 or e2 <= 0:
        out["verdict"] = "inconclusive"
        out["reason"] = "a per-round error rate is zero or saturated"
        return out
    se2 = 0.0
    for summary in (small, large):
        lo, hi = summary["ci95"]
        if lo <= 0 or hi <= 0:
            out["verdict"] = "inconclusive"
            out["reason"] = "an interval bound is zero; more shots are needed"
            return out
        se2 += (math.log(hi) - math.log(lo)) ** 2 / (4 * Z95 * Z95)
    ratio = e1 / e2
    half = Z95 * math.sqrt(se2)
    lo_r, hi_r = ratio * math.exp(-half), ratio * math.exp(half)
    out["value"], out["ci95"] = ratio, [lo_r, hi_r]
    out["verdict"] = "suppressing" if lo_r > 1 else "anti-suppressing" if hi_r < 1 else "inconclusive"
    return out


def derive_seed(seed: int, distance: int) -> int:
    digest = hashlib.sha256(f"qec_memory:{seed}:{distance}".encode()).digest()
    return int.from_bytes(digest[:8], "little") & 0x7FFF_FFFF_FFFF_FFFF


def sample_logical_errors(
    noisy,
    dem,
    *,
    seed: int,
    min_shots: int,
    max_shots: int,
    max_errors: int,
    cancel=None,
) -> tuple[int, int]:
    """Batched seeded sampling decoded with PyMatching; returns (shots, errors)."""
    import pymatching

    matching = pymatching.Matching.from_detector_error_model(dem)
    sampler = noisy.compile_detector_sampler(seed=seed)
    shots = errors = 0
    while shots < max_shots and (shots < min_shots or errors < max_errors):
        if cancel is not None and cancel.is_set():
            raise InterruptedError("sampling cancelled")
        if shots < min_shots:
            batch = min(min_shots - shots, BATCH_MAX)
        else:
            batch = min(max(BATCH_MIN, shots // 2), BATCH_MAX)
        batch = min(batch, max_shots - shots)
        detections, observables = sampler.sample(batch, separate_observables=True)
        predictions = matching.decode_batch(detections)
        wrong = np.any(np.asarray(predictions, dtype=bool) != observables, axis=1)
        shots += batch
        errors += int(wrong.sum())
    return shots, errors
