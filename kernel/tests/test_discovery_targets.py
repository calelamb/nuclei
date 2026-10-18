"""Target states for state_synthesis."""

from __future__ import annotations

import math

import numpy as np
import pytest

from kernel.discovery import targets as tg


@pytest.mark.parametrize("spec", [
    {"kind": "ghz", "n_qubits": 4},
    {"kind": "w", "n_qubits": 5},
    {"kind": "dicke", "n_qubits": 5, "k": 2},
    {"kind": "haar", "n_qubits": 4, "seed": 3},
])
def test_targets_are_normalized(spec):
    state = tg.target_state(spec)
    assert state.shape == (1 << spec["n_qubits"],)
    assert np.linalg.norm(state) == pytest.approx(1.0)


def test_ghz_support_is_all_zeros_and_all_ones():
    state = tg.ghz(3)
    assert np.flatnonzero(state).tolist() == [0, 7]
    assert abs(state[0]) ** 2 == pytest.approx(0.5)


def test_w_state_is_uniform_over_single_excitations_little_endian():
    state = tg.w_state(4)
    assert np.flatnonzero(state).tolist() == [1, 2, 4, 8]
    assert np.allclose(np.abs(state[[1, 2, 4, 8]]), 1 / math.sqrt(4))


def test_dicke_support_is_hamming_weight_k():
    state = tg.dicke(5, 2)
    support = np.flatnonzero(state)
    assert len(support) == math.comb(5, 2)
    assert all(bin(int(x)).count("1") == 2 for x in support)


def test_dicke_k_zero_is_the_vacuum_and_w_equals_dicke_1():
    assert np.flatnonzero(tg.dicke(3, 0)).tolist() == [0]
    assert np.allclose(tg.dicke(4, 1), tg.w_state(4))


def test_haar_is_seeded():
    assert np.array_equal(tg.haar(4, 11), tg.haar(4, 11))
    assert not np.allclose(tg.haar(4, 11), tg.haar(4, 12))


@pytest.mark.parametrize("spec", [
    {"kind": "nope", "n_qubits": 3},
    {"kind": "ghz", "n_qubits": 0},
    {"kind": "ghz", "n_qubits": 13},
    {"kind": "dicke", "n_qubits": 3, "k": 4},
])
def test_invalid_targets_raise(spec):
    with pytest.raises(tg.TargetError):
        tg.target_state(spec)
