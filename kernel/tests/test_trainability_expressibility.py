from __future__ import annotations

import numpy as np
import pytest

from kernel.tests._trainability_job_helpers import build, deep_random, ghz
from kernel.trainability._errors import Cancelled
from kernel.trainability.expressibility import (
    entangling_capability,
    expressibility,
    haar_log_masses,
    meyer_wallach,
)
from kernel.trainability.ir import IrError


def test_haar_bin_masses_are_exact_and_normalised():
    for dim in (2, 4, 16, 1024):
        mass = np.exp(haar_log_masses(dim, 75))
        assert mass.sum() == pytest.approx(1.0, abs=1e-9)
    # N = 2: fidelity is uniform on [0, 1], so every bin holds 1/bins.
    assert np.exp(haar_log_masses(2, 10)) == pytest.approx(np.full(10, 0.1))


def test_product_state_has_zero_entanglement():
    circ = build(2, [("RY", (0,), "a"), ("RX", (1,), "b")], ["a", "b"])
    result = entangling_capability(circ, samples=50, seed=1)
    assert result["mean"] == pytest.approx(0.0, abs=1e-12)
    assert result["haar_mean"] == pytest.approx(2 / 5)


def test_ghz_state_has_unit_entanglement():
    states = np.zeros((1, 8), dtype=complex)
    states[0, 0] = states[0, 7] = 1 / np.sqrt(2)
    assert meyer_wallach(states, 3)[0] == pytest.approx(1.0)
    result = entangling_capability(ghz(3), samples=5, seed=0)
    assert result["mean"] == pytest.approx(1.0)


def test_deep_circuit_mean_matches_haar_within_three_sigma():
    samples = 2000
    result = entangling_capability(deep_random(3, 6), samples=samples, seed=3)
    sigma = result["std"] / np.sqrt(samples)
    assert abs(result["mean"] - result["haar_mean"]) < 3 * sigma + 0.01
    assert sum(b["count"] for b in result["histogram"]) == samples


def test_deep_random_circuit_kl_is_near_zero():
    result = expressibility(deep_random(2, 6), pairs=3000, bins=75, seed=2)
    assert result["kl"] < 0.1
    assert result["kl_ci95"][0] <= result["kl"] <= result["kl_ci95"][1] + 0.05
    assert result["dimension"] == 4
    assert sum(b["observed"] for b in result["histogram"]) == pytest.approx(1.0)
    assert sum(b["haar"] for b in result["histogram"]) == pytest.approx(1.0)


def test_idle_circuit_kl_matches_reference():
    idle = build(2, [("H", (0,)), ("CX", (0, 1))])
    result = expressibility(idle, pairs=200, bins=75, seed=0)
    assert result["kl"] == pytest.approx(result["reference"]["idle_kl"], rel=1e-6)
    # N = 4, 75 bins: the last bin holds (1/75)^3 of the Haar mass.
    assert result["reference"]["idle_kl"] == pytest.approx(3 * np.log(75), rel=1e-6)


def test_same_seed_is_bit_identical_and_seed_matters():
    circ = deep_random(2, 2)
    a = expressibility(circ, pairs=300, seed=5)
    b = expressibility(circ, pairs=300, seed=5)
    c = expressibility(circ, pairs=300, seed=6)
    for key in ("kl", "kl_ci95", "histogram"):
        assert a[key] == b[key]
    assert a["kl"] != c["kl"]


def test_progress_is_monotone_and_cancel_raises():
    seen: list[float] = []
    expressibility(deep_random(2, 1), pairs=100, progress=lambda f, m: seen.append(f))
    assert seen == sorted(seen) and seen[-1] == pytest.approx(1.0)
    with pytest.raises(Cancelled):
        expressibility(deep_random(2, 1), pairs=100, cancel=lambda: True)
    with pytest.raises(Cancelled):
        entangling_capability(deep_random(2, 1), samples=100, cancel=lambda: True)


def test_statevector_qubit_cap():
    wide = build(21, [("H", (0,))])
    with pytest.raises(IrError) as err:
        expressibility(wide, pairs=10)
    assert err.value.code == "too_many_qubits"
    with pytest.raises(IrError):
        entangling_capability(wide, samples=10)
