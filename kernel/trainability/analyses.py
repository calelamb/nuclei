"""Gradient statistics (spec 5.5): compiled batched sampling or exact Pauli propagation.

Definitions
-----------
For a cost ``C(v) = <0|U(v)† O U(v)|0>`` and parameters ``v``:

* ``init="uniform"``: ``v_k ~ U[0, 2π)`` i.i.d.  ``"small"``: ``v_k ~ N(0, 0.1²)``.
* ``per_parameter[k]``: sample mean, *unbiased* sample variance (``ddof=1``) and ``E|g_k|``
  of ``g_k = ∂C/∂v_k``; 95% intervals are a seeded percentile bootstrap (1000 resamples of
  the samples; the bootstrap redraws *whole samples*, so parameters stay correlated).
* ``variance_mean``: the mean of the per-parameter variances.  For the PPE it is ``None`` (and the
  uninformative per-parameter variances / ``gate_values`` entries are ``None``) when the run is not
  ``complete`` or an interval is uninformative (``lo == 0 < hi`` or ``hi/lo > 2``); the truncation
  interval is still returned.  A midpoint is never reported as an estimate.

``method``
----------
``sampling`` uses :func:`KernelProgram.value_and_grad` (batched adjoint) at a
``default_rng(seed)`` sample.  ``ppe`` uses the exact Pauli-propagation variance
(``pauliprop``): no sampling noise, ``mean`` is exactly 0, and ``variance_ci95`` is the
*rigorous truncation interval* (``interval_kind == "truncation"``).  ``auto`` uses the PPE
when it applies and its ``variance_mean`` interval is at most 10% of the estimate wide,
otherwise (``n <= MAX_STATEVECTOR_QUBITS``) it falls back to sampling and records why in
``fallback_reason``; above that limit it returns ``variance_mean = None`` plus the interval.

Determinism
-----------
The batch chunking is a deterministic function of the problem size (never of timings), and
all randomness comes from ``default_rng(seed)``: the same inputs give bit-identical
results on one backend.  Only ``elapsed_ms`` (and wall-clock-truncated PPE runs) vary.
"""

from __future__ import annotations

import math
import time
from typing import Any

import numpy as np

from kernel.trainability._analysis_common import (
    AnalysisCancelled,
    AnalysisError,
    Cancel,
    Progress,
    check_cancel,
    report,
)
from kernel.trainability._circuit_walk import source_key
from kernel.trainability.compiler import MAX_STATEVECTOR_QUBITS, compile_circuit
from kernel.trainability.ir import ParamCircuit, ParamRef
from kernel.trainability.pauli import PauliSum
from kernel.trainability.pauliprop import ppe_applicable, ppe_gradient_variances

__all__ = ["gradient_statistics", "TIGHT_FRACTION", "BOOTSTRAP_RESAMPLES"]

TIGHT_FRACTION = 0.10
BOOTSTRAP_RESAMPLES = 1000
MAX_SAMPLES = 100_000
_SMALL_SIGMA = 0.1
#: elementary work units (state elements x ops) per sampling chunk; sets cancel latency (~50 ms).
_CHUNK_WORK = 1_500_000
#: ``min_weight_abs=0`` because barren-plateau variances are tiny (2^-64 ~ 5e-20): an absolute weight
#: cut-off like the spec default 1e-12 would discard the whole signal.  The frontier cap and the time
#: budget still bound the work, and every discarded amount is still accounted for in the interval.
_AUTO_PPE = {"max_frontier": 500_000, "time_budget_s": 6.0, "min_weight_abs": 0.0}
_FORCED_PPE = {"max_frontier": 2_000_000, "time_budget_s": 20.0, "min_weight_abs": 0.0}


# ------------------------------------------------------------------ sampling
def _draw_values(rng: np.random.Generator, samples: int, m: int, init: str) -> np.ndarray:
    if init == "uniform":
        return rng.uniform(0.0, 2.0 * math.pi, size=(samples, m))
    return rng.normal(0.0, _SMALL_SIGMA, size=(samples, m))


def _chunk_size(program, samples: int) -> int:
    work = (1 << program.n_qubits) * max(1, len(program.canonical_gates))
    return int(max(1, min(samples, _CHUNK_WORK // work)))


def _gradients(program, values: np.ndarray, observable: PauliSum, progress, cancel) -> np.ndarray:
    samples = values.shape[0]
    chunk = _chunk_size(program, samples)
    out = np.empty_like(values)
    for lo in range(0, samples, chunk):
        check_cancel(cancel)
        hi = min(lo + chunk, samples)
        _, g = program.value_and_grad(values[lo:hi], observable)
        out[lo:hi] = g
        report(progress, hi / samples, f"sampled {hi}/{samples} gradients")
    return out


def _bootstrap_variance(g: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Per-parameter variance bootstrap: returns ``(var_b (B, m), mean_of_var_b (B,))``."""
    s = g.shape[0]
    counts = rng.multinomial(s, np.full(s, 1.0 / s), size=BOOTSTRAP_RESAMPLES).astype(float)
    s1 = counts @ g
    s2 = counts @ (g * g)
    var_b = np.maximum((s2 - s1 * s1 / s) / (s - 1), 0.0)
    return var_b, var_b.mean(axis=1)


def _percentile(a: np.ndarray, axis: int = 0) -> np.ndarray:
    return np.percentile(a, [2.5, 97.5], axis=axis)


def _sampling_result(circuit, observable, samples, seed, init, backend, progress, cancel) -> dict[str, Any]:
    program = compile_circuit(circuit, backend=backend)
    m = len(circuit.parameters)
    rng = np.random.default_rng(seed)
    values = _draw_values(rng, samples, m, init)
    g = _gradients(program, values, observable, progress, cancel)
    mean = g.mean(axis=0)
    var = g.var(axis=0, ddof=1)
    abs_mean = np.abs(g).mean(axis=0)
    check_cancel(cancel)
    var_b, vm_b = _bootstrap_variance(g, rng)
    ci = _percentile(var_b)
    vm_ci = _percentile(vm_b)
    rows = [
        {"name": circuit.parameters[k], "mean": float(mean[k]), "variance": float(var[k]),
         "abs_mean": float(abs_mean[k]), "variance_ci95": [float(ci[0, k]), float(ci[1, k])]}
        for k in range(m)
    ]
    norms = np.linalg.norm(g, axis=1)
    return {
        "samples": samples, "init": init, "method": "sampling", "backend": program.backend,
        "interval_kind": "bootstrap",
        "interval": {"kind": "bootstrap", "resamples": BOOTSTRAP_RESAMPLES, "level": 0.95,
                     "variance_mean": [float(vm_ci[0]), float(vm_ci[1])]},
        "per_parameter": rows,
        "variance_mean": float(var.mean()), "variance_mean_ci95": [float(vm_ci[0]), float(vm_ci[1])],
        "gradient_norm_mean": float(norms.mean()), "gradient_norm_rms": float(math.sqrt((norms ** 2).mean())),
        "_variance": var, "_abs_mean": abs_mean,
    }


# ----------------------------------------------------------------------- PPE
def _is_tight(res: dict) -> tuple[bool, str]:
    lo, hi = res["variance_mean_ci95"]
    width, est = hi - lo, res["variance_mean"]
    if est is None or res["interval"]["status"] != "complete":
        return False, (f"PPE bound width is uninformative: interval [{lo:.3g}, {hi:.3g}] (status "
                       f"{res['interval']['status']}); {res['interval']['ppe_method']}")
    if width <= TIGHT_FRACTION * est:
        return True, ""
    pct = "inf" if est == 0 else f"{100.0 * width / est:.0f}%"
    return False, f"PPE bound width is {pct} of the estimate (limit {TIGHT_FRACTION:.0%}); {res['interval']['ppe_method']}"


def _ppe_result(circuit, observable, init, budget, progress, cancel) -> dict[str, Any]:
    res = ppe_gradient_variances(circuit, observable, progress=progress, cancel=cancel, **budget)
    if res["status"] == "cancelled":
        raise AnalysisCancelled()
    rows = [
        {"name": r["name"], "mean": 0.0, "variance": None if r["variance"] is None else float(r["variance"]),
         "abs_mean": None,
         "variance_ci95": [float(r["interval"][0]), float(r["interval"][1])],
         "dead": bool(r["dead"]), "dead_reason": r["dead_reason"]}
        for r in res["per_parameter"]
    ]
    var = np.array([np.nan if r["variance"] is None else r["variance"] for r in rows])
    vm_ci = [float(res["variance_mean_interval"][0]), float(res["variance_mean_interval"][1])]
    # The headline is a number only for a complete run with an informative interval (PH-C1); otherwise
    # it is None and only the truncation interval is real.
    headline = res["variance_mean"] if res["status"] == "complete" else None
    return {
        "samples": None, "init": init, "method": "ppe", "backend": "numpy", "interval_kind": "truncation",
        "interval": {"kind": "truncation", "variance_mean": vm_ci, "ppe_method": res["method"],
                     "status": res["status"], "frontier_peak": res["frontier_peak"],
                     "discarded_mass": res["discarded_mass"]},
        "per_parameter": rows, "variance_mean": None if headline is None else float(headline),
        "variance_mean_ci95": vm_ci,
        "gradient_norm_mean": None,
        "gradient_norm_rms": None if headline is None else float(math.sqrt(var.sum())),
        "_variance": var, "_abs_mean": np.full(len(rows), np.nan), "_raw": res,
    }


# ------------------------------------------------------------------ assembly
def _gate_values(circuit: ParamCircuit, var: np.ndarray, abs_mean: np.ndarray) -> list[dict[str, Any]]:
    """One entry per (gate, parameter reference); shared parameters appear on every gate."""
    index = circuit.param_index()
    out = []
    for gi, gate in enumerate(circuit.gates):
        for angle in gate.angles:
            if isinstance(angle, ParamRef):
                k = index[angle.name]
                am = None if math.isnan(abs_mean[k]) else float(abs_mean[k])
                v = None if math.isnan(var[k]) else float(var[k])
                out.append({"source_index": source_key(circuit, gi), "gate_index": gi,
                            "parameter": angle.name, "variance": v, "abs_mean": am})
    return out


def _unreached_note(res: dict) -> str | None:
    """Explain a ``None`` headline so no consumer mistakes it for zero (PH-C1)."""
    if res["method"] != "ppe" or res["variance_mean"] is not None:
        return None
    lo, hi = res["variance_mean_ci95"]
    return (f"PPE did not resolve the gradient variance (status {res['interval']['status']}); only the truncation "
            f"interval [{lo:.3g}, {hi:.3g}] is valid, so variance_mean is null.  Per-parameter variances whose "
            "interval is uninformative are null too.")


def _finish(res: dict, circuit, seed, notes, fallback, t0) -> dict[str, Any]:
    var, abs_mean = res.pop("_variance"), res.pop("_abs_mean")
    res.pop("_raw", None)
    res["gate_values"] = _gate_values(circuit, var, abs_mean)
    res["seed"] = seed
    note = _unreached_note(res)
    res["notes"] = notes + ([note] if note else [])
    res["fallback_reason"] = fallback
    res["elapsed_ms"] = int(round((time.perf_counter() - t0) * 1e3))
    return res


def _validate(circuit, observable, samples, init, method) -> None:
    if init not in ("uniform", "small"):
        raise AnalysisError("invalid_request", f"init must be 'uniform' or 'small', got {init!r}")
    if method not in ("auto", "sampling", "ppe"):
        raise AnalysisError("invalid_request", f"method must be auto|sampling|ppe, got {method!r}")
    if not isinstance(samples, int) or isinstance(samples, bool) or not 2 <= samples <= MAX_SAMPLES:
        raise AnalysisError("invalid_request", f"samples must be an integer in [2, {MAX_SAMPLES}]")
    if not circuit.parameters:
        raise AnalysisError("no_parameters", "the circuit has no free parameters")
    if observable.max_qubit() >= circuit.n_qubits:
        raise AnalysisError("invalid_observable", "the observable touches qubits outside the circuit")


def gradient_statistics(
    circuit: ParamCircuit,
    observable: PauliSum,
    *,
    samples: int = 200,
    seed: int = 0,
    init: str = "uniform",
    method: str = "auto",
    backend: str = "auto",
    progress: Progress | None = None,
    cancel: Cancel | None = None,
) -> dict[str, Any]:
    """Gradient statistics of ``C = <O>`` (see the module docstring).

    Returns ``{"samples", "init", "method": "sampling"|"ppe", "backend", "interval_kind":
    "bootstrap"|"truncation", "interval": {...}, "per_parameter": [{"name", "mean", "variance",
    "abs_mean", "variance_ci95"} (+ "dead", "dead_reason" for the PPE)], "variance_mean",
    "variance_mean_ci95", "gradient_norm_mean", "gradient_norm_rms", "gate_values": [{"source_index",
    "gate_index", "parameter", "variance", "abs_mean"}], "seed", "notes", "fallback_reason",
    "elapsed_ms"}``.  For the PPE ``samples``, ``abs_mean`` and ``gradient_norm_mean`` are ``None``
    (not estimated) and ``mean`` is exactly 0.

    Raises :class:`AnalysisError` with code ``ppe_not_applicable`` (forced ``ppe`` outside its
    class), ``ppe_required`` (more than ``MAX_STATEVECTOR_QUBITS`` qubits and no PPE) or
    ``invalid_request``; :class:`AnalysisCancelled` on cancel.
    """
    t0 = time.perf_counter()
    _validate(circuit, observable, samples, init, method)
    n = circuit.n_qubits
    ok, reason = ppe_applicable(circuit, observable, init=init)
    notes: list[str] = []
    if method == "ppe":
        if not ok:
            raise AnalysisError("ppe_not_applicable", reason or "PPE not applicable")
        res = _ppe_result(circuit, observable, init, _FORCED_PPE, progress, cancel)
        return _finish(res, circuit, seed, notes, None, t0)
    fallback = None
    if method == "auto":
        if ok:
            can_sample = n <= MAX_STATEVECTOR_QUBITS
            res = _ppe_result(circuit, observable, init, _AUTO_PPE if can_sample else _FORCED_PPE, progress, cancel)
            tight, why = _is_tight(res)
            if tight or not can_sample:
                if not tight:
                    notes.append(f"{why}; statevector sampling is unavailable above "
                                 f"{MAX_STATEVECTOR_QUBITS} qubits, so only the bounded PPE interval is reported.")
                return _finish(res, circuit, seed, notes, None, t0)
            fallback = why
        else:
            fallback = reason
    if n > MAX_STATEVECTOR_QUBITS:
        raise AnalysisError(
            "ppe_required",
            f"{n} qubits exceeds the statevector limit of {MAX_STATEVECTOR_QUBITS}"
            + (f" and the PPE does not apply: {reason}" if reason else ""),
        )
    res = _sampling_result(circuit, observable, samples, seed, init, backend, progress, cancel)
    if fallback:
        notes.append(f"Fell back to statevector sampling: {fallback}.")
    return _finish(res, circuit, seed, notes, fallback, t0)
