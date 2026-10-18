"""Barren-plateau scaling fits and the scaling study (spec 5.5).

Model
-----
For points ``(n_i, V_i)`` at a fixed depth, with ``y_i = log2 V_i``:

* exponential:  ``y = a - β n``       (``Var ∝ 2^(−β n)``; barren plateau when ``β > 0``)
* power law:    ``y = a - α log2 n``  (``Var ∝ n^(−α)``)

Both are fitted by weighted least squares with weights ``w_i = 1/σ_i²``, where ``σ_i`` is the
standard error of ``y_i`` implied by the point's 95% interval ``[lo, hi]``:
``σ_i = (log2 hi − log2 lo) / (2·1.96)`` (the delta method on a symmetric-in-log interval),
floored at ``SIGMA_FLOOR`` so exact (zero-width) points do not receive infinite weight.
Points without an interval get equal weights.  Weights are normalised to mean 1, so the
weighted RSS has units of log2² and ``AIC = N ln(RSS_w / N) + 2k`` (``k = 2`` for both
models, hence ``ΔAIC = N ln(RSS_other / RSS_pref)``; RSS is floored at ``RSS_FLOOR`` for
perfect fits).  ``R²`` is the weighted coefficient of determination.

β's and α's 95% CIs are percentile intervals of a seeded bootstrap *over points* (1000
resamples, resamples with < 2 distinct n are skipped).  With few points this interval is
coarse; that is why fewer than 4 distinct n is forced ``inconclusive``.

Verdicts (spec, exactly)
------------------------
* ``barren_plateau``: exponential preferred with ``ΔAIC ≥ 2`` **and** β's lower CI bound ``> 0.1``;
* ``polynomial``: power law preferred with ``ΔAIC ≥ 2``, **or** β's CI includes values ``≤ 0.1``;
* otherwise ``inconclusive`` (always so with fewer than 4 distinct n, or a zero variance point,
  where a log fit is undefined).
"""

from __future__ import annotations

import math
import time
from collections import defaultdict
from typing import Any, Callable, Sequence

import numpy as np

from kernel.trainability._analysis_common import (
    AnalysisCancelled,
    AnalysisError,
    Cancel,
    Progress,
    check_cancel,
    report,
)
from kernel.trainability.analyses import gradient_statistics
from kernel.trainability.convert import from_object
from kernel.trainability.ir import IrError, ParamCircuit
from kernel.trainability.pauli import ObservableError, parse_observable

__all__ = ["fit_scaling", "scaling_study", "MIN_DISTINCT_N", "BETA_THRESHOLD", "DELTA_AIC_THRESHOLD"]

MIN_DISTINCT_N = 4
BETA_THRESHOLD = 0.1
DELTA_AIC_THRESHOLD = 2.0
SIGMA_FLOOR = 0.02
RSS_FLOOR = 1e-12
BOOT_RESAMPLES = 1000
_Z95 = 1.96
MAX_POINTS = 64


# --------------------------------------------------------------------- fitter
def _sigma(point: dict) -> float | None:
    ci = point.get("variance_ci95") or point.get("interval")
    var = float(point["variance"])
    if not ci or var <= 0.0:
        return None
    lo, hi = max(float(ci[0]), 0.0), float(ci[1])
    if hi <= 0.0:
        return None
    lo = max(lo, hi * 1e-12)  # a zero lower bound would give an infinite log-width
    return max((math.log2(hi) - math.log2(lo)) / (2.0 * _Z95), SIGMA_FLOOR)


def _weights(points: Sequence[dict]) -> np.ndarray:
    sig = [_sigma(p) for p in points]
    if any(s is None for s in sig):
        return np.ones(len(points))
    w = 1.0 / np.square(np.array(sig))
    return w / w.mean()


def _wls(x: np.ndarray, y: np.ndarray, w: np.ndarray) -> tuple[float, float, float, float]:
    """Weighted least squares ``y = a + b x``: returns ``(a, b, rss, r2)``."""
    sw = w.sum()
    xm, ym = (w * x).sum() / sw, (w * y).sum() / sw
    sxx = (w * (x - xm) ** 2).sum()
    b = 0.0 if sxx <= 0 else (w * (x - xm) * (y - ym)).sum() / sxx
    a = ym - b * xm
    rss = float((w * (y - a - b * x) ** 2).sum())
    tss = float((w * (y - ym) ** 2).sum())
    r2 = 1.0 - rss / tss if tss > 1e-15 else 1.0
    return float(a), float(b), rss, float(r2)


def _aic(rss: float, n: int) -> float:
    return n * math.log(max(rss, RSS_FLOOR) / n) + 4.0


def _bootstrap_slopes(x: np.ndarray, y: np.ndarray, w: np.ndarray, xn: np.ndarray, seed: int) -> list[np.ndarray]:
    """Bootstrap slopes of ``y`` on ``x`` (first) and ``xn`` (second), resampling points."""
    rng = np.random.default_rng(seed)
    n = len(x)
    slopes: list[list[float]] = [[], []]
    for _ in range(BOOT_RESAMPLES):
        idx = rng.integers(0, n, size=n)
        if len(np.unique(x[idx])) < 2:
            continue
        for j, xv in enumerate((x, xn)):
            slopes[j].append(_wls(xv[idx], y[idx], w[idx])[1])
    return [np.array(s) for s in slopes]


def _ci(samples: np.ndarray, fallback: float) -> list[float]:
    if samples.size == 0:
        return [fallback, fallback]
    lo, hi = np.percentile(samples, [2.5, 97.5])
    return [float(lo), float(hi)]


def _inconclusive(n_layers, reason: str) -> dict[str, Any]:
    return {"n_layers": n_layers, "exponential": None, "power_law": None, "preferred": None,
            "delta_aic": None, "verdict": "inconclusive", "summary": f"Inconclusive: {reason}."}


def _fmt_exp(beta: float) -> str:
    return f"{'−' if beta >= 0 else '+'}{abs(beta):.2f}"


def _fit_group(n_layers, pts: list[dict], seed: int) -> dict[str, Any]:
    distinct = sorted({int(p["n_qubits"]) for p in pts})
    if any(float(p["variance"]) <= 0.0 for p in pts):
        return _inconclusive(n_layers, "the variance is zero at some point, so a log-scale fit is undefined")
    if len(distinct) < MIN_DISTINCT_N:
        return _inconclusive(n_layers, f"only {len(distinct)} distinct qubit counts (need at least {MIN_DISTINCT_N})")
    n = np.array([float(p["n_qubits"]) for p in pts])
    y = np.log2([float(p["variance"]) for p in pts])
    w = _weights(pts)
    ln = np.log2(np.maximum(n, 1.0))
    a_e, b_e, rss_e, r2_e = _wls(n, y, w)
    a_p, b_p, rss_p, r2_p = _wls(ln, y, w)
    beta, alpha = -b_e, -b_p
    boots = _bootstrap_slopes(n, y, w, ln, seed)
    beta_ci = _ci(-boots[0], beta)
    alpha_ci = _ci(-boots[1], alpha)
    aic_e, aic_p = _aic(rss_e, len(pts)), _aic(rss_p, len(pts))
    preferred = "exponential" if aic_e <= aic_p else "power_law"
    delta = abs(aic_e - aic_p)
    if preferred == "exponential" and delta >= DELTA_AIC_THRESHOLD and beta_ci[0] > BETA_THRESHOLD:
        verdict = "barren_plateau"
    elif (preferred == "power_law" and delta >= DELTA_AIC_THRESHOLD) or beta_ci[0] <= BETA_THRESHOLD:
        verdict = "polynomial"
    else:
        verdict = "inconclusive"
    if preferred == "exponential":
        head = f"Var[∂C] ∝ 2^({_fmt_exp(beta)} n) (95% CI {beta_ci[0]:.2f}–{beta_ci[1]:.2f}); exponential"
        tail = "power law"
    else:
        head = f"Var[∂C] ∝ n^({_fmt_exp(alpha)}) (95% CI {alpha_ci[0]:.2f}–{alpha_ci[1]:.2f}); power law"
        tail = "exponential"
    return {
        "n_layers": n_layers,
        "exponential": {"beta": beta, "beta_ci95": beta_ci, "log2_intercept": a_e, "r2": r2_e, "aic": aic_e},
        "power_law": {"alpha": alpha, "alpha_ci95": alpha_ci, "log2_intercept": a_p, "r2": r2_p, "aic": aic_p},
        "preferred": preferred, "delta_aic": delta, "verdict": verdict,
        "summary": f"{head} preferred over {tail} (ΔAIC {delta:.1f}).",
    }


def fit_scaling(points: Sequence[dict], *, seed: int = 0) -> list[dict[str, Any]]:
    """Fit ``Var`` versus ``n`` for each ``n_layers`` group of ``points`` (pure, deterministic).

    ``points`` are dicts with ``n_qubits``, ``variance``, optionally ``n_layers`` and
    ``variance_ci95`` (or ``interval``); points carrying an ``error`` are ignored.  Returns the
    spec's ``fits`` list, one entry per distinct ``n_layers`` (sorted).
    """
    groups: dict[Any, list[dict]] = defaultdict(list)
    for p in points:
        if p.get("error") is None and p.get("variance") is not None:
            groups[p.get("n_layers")].append(p)
    if not groups:
        return []
    keys = sorted(groups, key=lambda k: (k is None, k))
    return [_fit_group(k, groups[k], seed + i) for i, k in enumerate(keys)]


# ---------------------------------------------------------------------- study
def _point_seed(seed: int, n: int, layers: int) -> int:
    return (int(seed) * 1_000_003 + n * 1_009 + layers) % (2**32)


def _error_point(n: int, layers: int, code: str, message: str) -> dict[str, Any]:
    return {"n_qubits": n, "n_layers": layers, "n_params": None, "variance": None, "variance_ci95": None,
            "method": None, "backend": None, "interval_kind": None, "error": {"code": code, "message": message}}


def _run_point(build, n, layers, spec, samples, seed, init, method, cancel) -> dict[str, Any]:
    try:
        circuit = from_object(build(n, layers))
        observable = parse_observable(spec, n)
        if circuit.n_qubits != n:
            return _error_point(n, layers, "qubit_mismatch", f"build({n}, {layers}) returned {circuit.n_qubits} qubits")
        res = gradient_statistics(circuit, observable, samples=samples, seed=_point_seed(seed, n, layers),
                                  init=init, method=method, cancel=cancel)
    except AnalysisCancelled:
        raise
    except AnalysisError as exc:
        return _error_point(n, layers, exc.code, exc.message)
    except IrError as exc:
        return _error_point(n, layers, exc.code, exc.message)
    except ObservableError as exc:
        raise AnalysisError("invalid_observable", exc.message) from exc
    return {
        "n_qubits": n, "n_layers": layers, "n_params": len(circuit.parameters),
        "variance": res["variance_mean"], "variance_ci95": res["variance_mean_ci95"],
        "method": res["method"], "backend": res["backend"], "interval_kind": res["interval_kind"],
        "fallback_reason": res["fallback_reason"], "error": None,
    }


def scaling_study(
    build: Callable[[int, int], ParamCircuit],
    *,
    qubits: Sequence[int],
    layers: Sequence[int],
    observable_spec: str,
    samples: int = 200,
    seed: int = 0,
    init: str = "uniform",
    method: str = "auto",
    progress: Progress | None = None,
    cancel: Cancel | None = None,
) -> dict[str, Any]:
    """Run :func:`gradient_statistics` on ``build(n, l)`` for every ``(n, l)`` and fit.

    Each point's ``variance`` is the mean-over-parameters gradient variance
    (``variance_mean``) with its interval (bootstrap for sampling, rigorous truncation
    interval for the PPE; see ``interval_kind``).  Above ``MAX_STATEVECTOR_QUBITS`` qubits a
    point needs the PPE: if it does not apply the point fails with code ``ppe_required`` and
    the remaining points continue.  Returns ``{"points", "fits", "observable", "samples",
    "seed", "init", "method", "elapsed_ms"}``.
    """
    t0 = time.perf_counter()
    qs = sorted({int(q) for q in qubits})
    ls = sorted({int(x) for x in layers})
    if not qs or not ls or len(qs) * len(ls) > MAX_POINTS or min(qs) < 1 or min(ls) < 1:
        raise AnalysisError("invalid_request", f"need positive qubits/layers with at most {MAX_POINTS} points")
    total, points = len(qs) * len(ls), []
    for done, (layer, n) in enumerate((l, q) for l in ls for q in qs):
        check_cancel(cancel)
        report(progress, done / total, f"n = {n}, layers = {layer}")
        points.append(_run_point(build, n, layer, observable_spec, samples, seed, init, method, cancel))
    report(progress, 1.0, "fitting")
    return {"points": points, "fits": fit_scaling(points, seed=seed), "observable": observable_spec,
            "samples": samples, "seed": seed, "init": init, "method": method,
            "elapsed_ms": int(round((time.perf_counter() - t0) * 1e3))}

