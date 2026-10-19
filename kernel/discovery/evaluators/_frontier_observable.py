"""The observable ``trainability_frontier`` actually measures: term-normalised, with a known l1 norm.

``preset:local_z`` is ``(1/n) sum_i Z_i``. Its 1/n factor is a pure normalisation, but it enters
every gradient variance squared: ``Var[dC] ~ 1/n^2`` for *every* shallow circuit, so a
trainability term built on the mean variance would mostly measure the preset (adversarial review
PH-M2). The frontier therefore rescales the parsed observable so that its largest coefficient is
exactly 1 (``local_z`` becomes ``sum_i Z_i``; a single Pauli string is unchanged). Variances are
then those of an extensive observable, flat in ``n`` for a shallow circuit and exponentially small
only when the circuit really concentrates.
"""

from __future__ import annotations

from kernel.trainability.pauli import PauliSum, parse_observable


def frontier_observable(text: str, n_qubits: int) -> PauliSum:
    """``parse_observable(text, n)`` rescaled so ``max |coeff| = 1`` (see the module docstring)."""
    observable = parse_observable(text, n_qubits)
    top = max((abs(term.coeff) for term in observable.terms), default=0.0)
    return observable.scaled(1.0 / top) if top > 0 else observable


def l1_norm(observable: PauliSum) -> float:
    """``sum_j |c_j|``: ``|<O>| <= l1_norm`` for every state, so no honest interval exceeds ``+-l1_norm``."""
    return float(sum(abs(term.coeff) for term in observable.terms))
