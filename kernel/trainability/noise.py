"""Simulated noise for the Trainability Lab (C1, scoped v1).

Scope lock (contract default): finite shots + *global* depolarizing +
symmetric readout flip.  No per-gate depolarizing, no device calibration.

Model (all seeded, Monte-Carlo where shots are finite):

* Depolarizing: ``rho = (1-p) |psi><psi| + p I/D``.  A non-identity Pauli
  term ``P`` therefore contributes ``(1-p) <P>``; the identity term is
  unchanged (``Tr(I)/D = 1``).
* Readout flip: each measured qubit's classical bit flips with probability
  ``q``.  A weight-``w`` Pauli string's expectation is scaled by
  ``(1-2q)**w`` (its eigenvalue parity flips when an odd number of its
  bits flip).
* Finite shots: each Pauli term is estimated from ``shots`` Bernoulli
  eigenvalue draws (``+/-1`` with mean equal to the noisy term
  expectation), via a binomial draw.  The per-estimate variance is
  ``coeff^2 (1 - e^2) / shots`` and scales as ``1/shots``.

This is a *simulated channel, not a device calibration*: it does not model
gate-dependent, correlated, or non-Markovian device noise.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import numpy as np

from kernel.trainability._analysis_common import AnalysisError, check_cancel
from kernel.trainability.pauli import PauliSum, apply_pauli_term

__all__ = [
    "NoiseSpec",
    "NOISE_NOTE",
    "SHOTS_MIN",
    "SHOTS_MAX",
    "P_MAX",
    "coerce_noise",
    "noise_echo",
    "expectation_scale",
    "shot_variance_numerator",
    "noisy_expectations",
    "noisy_fidelity_kernel",
    "perturb_costs_grads",
]

SHOTS_MIN = 32
SHOTS_MAX = 100_000
P_MAX = 0.5

NOISE_NOTE = (
    "Simulated channel, not a device calibration: global depolarizing + "
    "symmetric readout flip + finite-shot Pauli sampling (v1 scope; no "
    "per-gate or correlated noise)."
)


@dataclass(frozen=True)
class NoiseSpec:
    """Validated simulated-noise settings (``shots=0`` means exact)."""

    shots: int = 0
    depolarizing_p: float = 0.0
    readout_flip_p: float = 0.0

    @property
    def is_exact(self) -> bool:
        return self.shots == 0 and self.depolarizing_p == 0.0 and self.readout_flip_p == 0.0

    def echo(self) -> dict[str, Any]:
        return {
            "shots": int(self.shots),
            "depolarizing_p": float(self.depolarizing_p),
            "readout_flip_p": float(self.readout_flip_p),
        }


def _validate(shots: Any, depolarizing_p: Any, readout_flip_p: Any) -> NoiseSpec:
    if isinstance(shots, bool) or not isinstance(shots, (int, np.integer)):
        # Accept integral floats (JSON numbers may arrive as 64.0).
        if isinstance(shots, float) and float(shots).is_integer():
            shots = int(shots)
        else:
            raise AnalysisError("invalid_request", "settings.noise.shots: must be an integer (0 for exact, or 32..100000)")
    shots_i = int(shots)
    if shots_i != 0 and not (SHOTS_MIN <= shots_i <= SHOTS_MAX):
        raise AnalysisError(
            "invalid_request",
            f"settings.noise.shots: must be 0 (exact) or in [{SHOTS_MIN}, {SHOTS_MAX}], got {shots_i}; "
            "use 0 for exact expectations instead of a small shot count",
        )
    probs: list[float] = []
    for name, raw in (("depolarizing_p", depolarizing_p), ("readout_flip_p", readout_flip_p)):
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise AnalysisError("invalid_request", f"settings.noise.{name}: must be a finite number in [0, {P_MAX}]")
        try:
            value = float(raw)
        except OverflowError:
            raise AnalysisError("invalid_request", f"settings.noise.{name}: must be in [0, {P_MAX}]") from None
        if not math.isfinite(value) or not (0.0 <= value <= P_MAX):
            raise AnalysisError("invalid_request", f"settings.noise.{name}: must be in [0, {P_MAX}], got {raw}")
        probs.append(value)
    return NoiseSpec(shots_i, probs[0], probs[1])


def coerce_noise(noise: NoiseSpec | Mapping[str, Any] | None) -> NoiseSpec:
    """Coerce a settings mapping / spec to a validated :class:`NoiseSpec`."""
    if noise is None:
        return NoiseSpec()
    if isinstance(noise, NoiseSpec):
        # Re-validate so a hand-built spec cannot smuggle out-of-range values.
        return _validate(noise.shots, noise.depolarizing_p, noise.readout_flip_p)
    if isinstance(noise, Mapping):
        return _validate(noise.get("shots", 0), noise.get("depolarizing_p", 0.0), noise.get("readout_flip_p", 0.0))
    raise AnalysisError("invalid_request", "settings.noise: must be an object with shots/depolarizing_p/readout_flip_p")


def noise_echo(noise: NoiseSpec | Mapping[str, Any] | None) -> dict[str, Any]:
    return coerce_noise(noise).echo()


def _term_factor(weight: int, spec: NoiseSpec) -> float:
    if weight == 0:
        return 1.0
    return (1.0 - spec.depolarizing_p) * (1.0 - 2.0 * spec.readout_flip_p) ** weight


def expectation_scale(observable: PauliSum, spec: NoiseSpec) -> float:
    """Coeff-weighted mean channel factor for ``<O>`` (1.0 when exact)."""
    if spec.is_exact:
        return 1.0
    total = 0.0
    acc = 0.0
    for term in observable.terms:
        w = abs(float(term.coeff))
        if w == 0.0:
            continue
        total += w
        acc += w * _term_factor(term.weight, spec)
    return acc / total if total > 0 else 1.0


def shot_variance_numerator(observable: PauliSum) -> float:
    """``sum coeff^2`` over non-identity terms (shot-variance scale)."""
    return float(sum(float(t.coeff) ** 2 for t in observable.terms if t.weight > 0))


def noisy_expectations(
    states: np.ndarray,
    observable: PauliSum,
    n_qubits: int,
    spec: NoiseSpec,
    rng: np.random.Generator,
    cancel: Any = None,
) -> tuple[np.ndarray, float]:
    """Noisy ``<O>`` per state row; returns ``(estimates, mean_shot_variance)``.

    With ``shots == 0`` the returned estimates are the exact channel means
    (depolarizing/readout scaling only) and the shot variance is ``0.0``.
    """
    states = np.asarray(states)
    if states.ndim != 2:
        raise AnalysisError("invalid_request", "noisy_expectations: states must have shape (B, 2**n)")
    batch = states.shape[0]
    mu = np.zeros(batch, dtype=np.float64)
    sampled = np.zeros(batch, dtype=np.float64)
    shot_var = np.zeros(batch, dtype=np.float64)
    finite = spec.shots > 0
    for term in observable.terms:
        check_cancel(cancel)
        # apply_pauli_term already includes term.coeff.
        p_psi = apply_pauli_term(states, term, n_qubits)
        exp_term = np.real(np.sum(np.conj(states) * p_psi, axis=1)).astype(np.float64)
        factor = _term_factor(term.weight, spec)
        mu_term = exp_term * factor
        mu += mu_term
        if finite and term.weight > 0 and float(term.coeff) != 0.0:
            e_prime = np.clip(mu_term / float(term.coeff), -1.0, 1.0)
            prob = np.clip((1.0 + e_prime) / 2.0, 0.0, 1.0)
            frac = rng.binomial(spec.shots, prob).astype(np.float64) / float(spec.shots)
            sampled += float(term.coeff) * (2.0 * frac - 1.0)
            shot_var += (float(term.coeff) ** 2) * (1.0 - e_prime ** 2) / float(spec.shots)
        elif finite:
            sampled += mu_term
    estimates = sampled if finite else mu
    return estimates, float(shot_var.mean()) if batch else 0.0


def noisy_fidelity_kernel(
    states: np.ndarray,
    spec: NoiseSpec,
    rng: np.random.Generator,
    cancel: Any = None,
) -> tuple[np.ndarray, float]:
    """Noisy fidelity kernel ``Tr(rho_i rho_j)`` (+ binomial shot noise).

    Depolarizing gives ``K' = a*K + (1-a)/D`` with ``a = (1-p)^2`` (so the
    diagonal becomes the purity ``a + (1-a)/D < 1``).  Readout flip shrinks
    the contrast ``K' - 1/D`` by ``(1-2q)^2``.  Finite shots resample each
    entry as ``Binomial(shots, K')/shots``.  Returns ``(kernel, mean_shot_var)``.
    """
    states = np.asarray(states)
    check_cancel(cancel)
    gram = states @ states.conj().T
    clean = np.clip(np.abs(gram) ** 2, 0.0, 1.0)
    if spec.is_exact:
        np.fill_diagonal(clean, 1.0)
        return clean, 0.0
    dim = states.shape[1]
    a = (1.0 - spec.depolarizing_p) ** 2
    kernel = a * clean + (1.0 - a) / float(dim)
    contrast = (1.0 - 2.0 * spec.readout_flip_p) ** 2
    kernel = 1.0 / float(dim) + (kernel - 1.0 / float(dim)) * contrast
    kernel = np.clip(kernel, 0.0, 1.0)
    if spec.shots <= 0:
        return kernel, 0.0
    check_cancel(cancel)
    sampled = rng.binomial(spec.shots, kernel).astype(np.float64) / float(spec.shots)
    # Symmetrise (binomial draws above are already symmetric in distribution
    # only if the matrix draw is symmetric; enforce it exactly).
    sampled = 0.5 * (sampled + sampled.T)
    mean_var = float(np.mean(kernel * (1.0 - kernel) / float(spec.shots)))
    return sampled, mean_var


def perturb_costs_grads(
    costs: np.ndarray,
    grads: np.ndarray,
    observable: PauliSum,
    spec: NoiseSpec,
    rng: np.random.Generator,
) -> tuple[np.ndarray, np.ndarray, float]:
    """Channel-scale + shot-perturb sampled costs/gradients (gradients tab).

    The exact adjoint gradient of the *noisy* mean cost is the channel-scaled
    exact gradient; finite shots add independent zero-mean noise with
    per-component variance ``shot_variance_numerator / shots``.  Returns
    ``(noisy_costs, noisy_grads, shot_noise_variance)``.
    """
    costs = np.asarray(costs, dtype=np.float64)
    grads = np.asarray(grads, dtype=np.float64)
    if spec.is_exact:
        return costs.copy(), grads.copy(), 0.0
    scale = expectation_scale(observable, spec)
    noisy_costs = costs * scale
    noisy_grads = grads * scale
    if spec.shots <= 0:
        return noisy_costs, noisy_grads, 0.0
    numerator = shot_variance_numerator(observable)
    shot_var = numerator / float(spec.shots) if numerator > 0 else 0.0
    if shot_var > 0:
        # Cost shot variance uses the single-Pauli bound (1 - e^2) <= 1.
        cost_std = math.sqrt(min(shot_var, 1.0 / float(spec.shots) * max(numerator, 1.0)))
        noisy_costs = noisy_costs + rng.normal(0.0, cost_std, size=costs.shape)
        noisy_grads = noisy_grads + rng.normal(0.0, math.sqrt(shot_var), size=grads.shape)
    return noisy_costs, noisy_grads, float(shot_var)
